import { afterEach, describe, expect, it, vi } from 'vitest';

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

const {
  fromMock,
  verifyTokenAndGetEmpresaIdMock,
  isBankReconciliationBalanceMutationDisabledMock,
} = vi.hoisted(() => ({
  fromMock: vi.fn(),
  verifyTokenAndGetEmpresaIdMock: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
  isBankReconciliationBalanceMutationDisabledMock: vi.fn(() => true),
}));

vi.mock('../../../src/server/bank-statement/_shared.js', () => ({
  extractBearerToken: vi.fn(() => 'token-123'),
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const value = req.headers?.[headerName];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.example.com'),
  getAdminClient: vi.fn(() => ({
    from: fromMock,
  })),
  verifyTokenAndGetEmpresaId: verifyTokenAndGetEmpresaIdMock,
  isBankReconciliationBalanceMutationDisabled: isBankReconciliationBalanceMutationDisabledMock,
}));

import handler from '../../../api_legacy/bank-statement/conciliation/workspace';

interface MockResponse {
  statusCode: number;
  payload: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
}

interface WorkspaceMockSetupOptions {
  contaError?: { message: string } | null;
  importError?: { message: string } | null;
  importRow?: Record<string, unknown>;
  txRows?: Array<Record<string, unknown>>;
  txError?: { message: string } | null;
  aiRunStatus?: string | null;
}

const makeAwaitableQuery = (result: QueryResult) => {
  const query: Record<string, unknown> = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => query),
    order: vi.fn(() => query),
    select: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
    then: (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

const createMockResponse = (): MockResponse => ({
  statusCode: 200,
  payload: null,
  status(code: number) {
    this.statusCode = code;
    return this;
  },
  json(data: unknown) {
    this.payload = data;
    return this;
  },
});

const setupWorkspaceSuccessMocks = (options: WorkspaceMockSetupOptions = {}) => {
  const contaRow = { id: 'conta-1', descricao: 'Conta principal' };
  const importRow = {
    id: 'import-1',
    conta_bancaria_id: 'conta-1',
    parse_status: 'parsed',
    file_format: 'ofx',
    original_filename: 'extrato.ofx',
    periodo_inicio: null,
    periodo_fim: null,
    file_sha256: null,
    ...options.importRow,
  };

  const txRows = options.txRows ?? [];
  const aiRunData = options.aiRunStatus ? { status: options.aiRunStatus } : null;

  fromMock.mockImplementation((table: string) => {
    if (table === 'contas_bancarias') {
      return makeAwaitableQuery({
        data: options.contaError ? null : contaRow,
        error: options.contaError || null,
      });
    }

    if (table === 'extratos_import') {
      return makeAwaitableQuery({
        data: options.importError ? null : importRow,
        error: options.importError || null,
      });
    }

    if (table === 'extrato_transacoes') {
      return makeAwaitableQuery({
        data: txRows,
        error: options.txError || null,
      });
    }

    if (table === 'bank_ai_execution_runs') {
      return makeAwaitableQuery({
        data: aiRunData,
        error: null,
      });
    }

    throw new Error(`Unexpected table access during workspace test: ${table}`);
  });
};

describe('api_legacy/bank-statement/conciliation/workspace', () => {
  afterEach(() => {
    fromMock.mockReset();
    verifyTokenAndGetEmpresaIdMock.mockClear();
    isBankReconciliationBalanceMutationDisabledMock.mockClear();
    vi.restoreAllMocks();
  });

  it('prioriza saldo_final_centavos quando o schema atual estiver disponível', async () => {
    setupWorkspaceSuccessMocks({
      importRow: {
        saldo_final_centavos: 12345,
        saldo_final: 999.99,
      },
    });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token-123' },
      query: {
        conta_bancaria_id: 'conta-1',
        import_id: 'import-1',
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      data: {
        summary: {
          saldo_final_centavos: 12345,
        },
      },
    });
  });

  it('faz fallback para saldo_final quando saldo_final_centavos não existir no schema legado', async () => {
    setupWorkspaceSuccessMocks({
      importRow: {
        saldo_final: 321.98,
      },
    });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token-123' },
      query: {
        conta_bancaria_id: 'conta-1',
        import_id: 'import-1',
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      data: {
        summary: {
          saldo_final_centavos: 32198,
        },
      },
    });
  });

  it('retorna saldo_final_centavos nulo quando ambos os campos estiverem ausentes', async () => {
    setupWorkspaceSuccessMocks({
      importRow: {
        saldo_final_centavos: null,
        saldo_final: null,
      },
    });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token-123' },
      query: {
        conta_bancaria_id: 'conta-1',
        import_id: 'import-1',
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      data: {
        summary: {
          saldo_final_centavos: null,
        },
      },
    });
  });

  it('retorna erro operacional genérico (422) sem vazar detalhes internos do banco', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    setupWorkspaceSuccessMocks({
      importError: {
        message: 'column "saldo_final_centavos" does not exist',
      },
    });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token-123' },
      query: {
        conta_bancaria_id: 'conta-1',
        import_id: 'import-1',
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(res.statusCode).toBe(422);
    expect(res.payload).toEqual({
      error: 'Workspace error',
      message: 'Falha ao carregar a importação selecionada para a lista de conciliação.',
    });

    const serializedPayload = JSON.stringify(res.payload);
    expect(serializedPayload).not.toContain('saldo_final_centavos');
    expect(serializedPayload).not.toContain('does not exist');
  });
});
