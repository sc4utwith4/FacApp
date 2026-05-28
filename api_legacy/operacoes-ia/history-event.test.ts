import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getAdminClientMock,
  insertExtractionHistoryRowsMock,
} = vi.hoisted(() => ({
  getAdminClientMock: vi.fn(),
  insertExtractionHistoryRowsMock: vi.fn(async () => null),
}));

vi.mock('../../src/server/bank-statement/_shared.js', () => ({
  extractBearerToken: vi.fn(() => 'token-123'),
  getAdminClient: getAdminClientMock,
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const value = req.headers?.[headerName];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.local'),
  parseJsonBody: vi.fn((req: { body?: unknown }) => req.body),
  verifyTokenAndGetEmpresaId: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
}));

vi.mock('../../src/server/operacoes-ia/extractionHistory.js', () => ({
  insertExtractionHistoryRows: insertExtractionHistoryRowsMock,
}));

import handler from './history-event';

interface MockResponse {
  statusCode: number;
  payload: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
}

function createMockResponse(): MockResponse {
  return {
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
  };
}

function createAdminClientMock() {
  const operationImportChain = {
    select: () => operationImportChain,
    eq: () => operationImportChain,
    in: () =>
      Promise.resolve({
        data: [{ id: 'imp-1', empresa_id: 'empresa-1', source: 'disecurit' }],
        error: null,
      }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'operation_import_files') return operationImportChain;
      throw new Error(`Tabela não mapeada no mock: ${table}`);
    }),
  };
}

describe('api_legacy/operacoes-ia/history-event', () => {
  afterEach(() => {
    getAdminClientMock.mockReset();
    insertExtractionHistoryRowsMock.mockReset();
    vi.restoreAllMocks();
  });

  it('registra eventos de correção manual com sucesso', async () => {
    getAdminClientMock.mockReturnValue(createAdminClientMock());

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        events: [
          {
            import_file_id: 'imp-1',
            item_id: 'item:imp-1',
            field_name: 'valor_compra',
            previous_value: 100,
            new_value: 95,
            reason: 'save',
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ ok: true, inserted: 1 });
    expect(insertExtractionHistoryRowsMock).toHaveBeenCalledTimes(1);
  });

  it('retorna 400 quando não recebe events', async () => {
    getAdminClientMock.mockReturnValue(createAdminClientMock());

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(400);
  });
});
