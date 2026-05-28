import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  buildDeterministicMatchesMock,
  getFirstMatchingRuleMock,
  callUserRpcMock,
  safeInsertBankAuditLogMock,
  fromMock,
  upsertPayloads,
} = vi.hoisted(() => ({
  buildDeterministicMatchesMock: vi.fn(),
  getFirstMatchingRuleMock: vi.fn(() => null),
  callUserRpcMock: vi.fn(async () => ({ data: { ok: true }, error: null, status: 200 })),
  safeInsertBankAuditLogMock: vi.fn(async () => null),
  fromMock: vi.fn(),
  upsertPayloads: [] as Record<string, unknown>[],
}));

vi.mock('../../../src/lib/bank-reconciliation/matchingEngine.js', () => ({
  buildDeterministicMatches: buildDeterministicMatchesMock,
}));

vi.mock('../../../src/lib/bank-reconciliation/rulesEngine.js', () => ({
  getFirstMatchingRule: getFirstMatchingRuleMock,
  inferLancamentoTipoFromTransaction: vi.fn(() => 'saida'),
}));

vi.mock('../../../src/server/bank-statement/_shared.js', () => ({
  callUserRpc: callUserRpcMock,
  extractBearerToken: vi.fn(() => 'token-123'),
  getAdminClient: vi.fn(() => ({
    from: fromMock,
  })),
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const value = req.headers?.[headerName];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }),
  isBankReconciliationBalanceMutationDisabled: vi.fn(() => false),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.example.com'),
  parseJsonBody: vi.fn((req: { body?: unknown }) => req.body),
  safeInsertBankAuditLog: safeInsertBankAuditLogMock,
  verifyTokenAndGetEmpresaId: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
}));

import handler from '../../../api/bank-statement/match';

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

function buildAdminFromMock() {
  fromMock.mockImplementation((table: string) => {
    if (table === 'extratos_import') {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: {
            id: 'import-1',
            empresa_id: 'empresa-1',
            conta_bancaria_id: 'conta-1',
            parse_status: 'parsed',
            periodo_inicio: '2026-03-18',
            periodo_fim: '2026-03-18',
            error_message: null,
          },
          error: null,
        })),
      };
      return query;
    }

    if (table === 'extrato_transacoes') {
      let orderCount = 0;
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(() => {
          orderCount += 1;
          if (orderCount >= 2) {
            return Promise.resolve({
              data: [
                {
                  id: 'tx-1',
                  empresa_id: 'empresa-1',
                  extrato_import_id: 'import-1',
                  conta_bancaria_id: 'conta-1',
                  data_movimento: '2026-03-18',
                  valor_centavos: 15000,
                  tipo: 'debit',
                  descricao_raw: 'PIX FORNECEDOR XPTO',
                  descricao_norm: 'pix fornecedor xpto',
                  documento_ref: null,
                },
              ],
              error: null,
            });
          }
          return query;
        }),
      };
      return query;
    }

    if (table === 'conciliacoes_bancarias') {
      const selectQuery = {
        eq: vi.fn(() => selectQuery),
        in: vi.fn(async () => ({
          data: [],
          error: null,
        })),
      };
      const deleteQuery = {
        eq: vi.fn(() => deleteQuery),
        in: vi.fn(async () => ({
          error: null,
        })),
      };
      return {
        select: vi.fn(() => selectQuery),
        delete: vi.fn(() => deleteQuery),
        upsert: vi.fn(async (payload: Record<string, unknown>) => {
          upsertPayloads.push(payload);
          return { error: null };
        }),
      };
    }

    if (table === 'conciliacao_itens_financeiros') {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        gte: vi.fn(() => query),
        lte: vi.fn(() => query),
        order: vi.fn(async () => ({
          data: [
            {
              id: 'item-1',
              conta_bancaria_id: 'conta-1',
              data: '2026-03-18',
              tipo: 'saida',
              valor_centavos: 15000,
              descricao_exibicao: 'PIX FORNECEDOR XPTO',
              documento: null,
              origem_tipo: 'lancamento_caixa',
              origem_id_uuid: 'lanc-1',
              origem_id_bigint: null,
            },
            {
              id: 'item-2',
              conta_bancaria_id: 'conta-1',
              data: '2026-03-18',
              tipo: 'saida',
              valor_centavos: 15000,
              descricao_exibicao: 'PIX FORNECEDOR XPTO 2',
              documento: null,
              origem_tipo: 'lancamento_caixa',
              origem_id_uuid: 'lanc-2',
              origem_id_bigint: null,
            },
          ],
          error: null,
        })),
      };
      return query;
    }

    if (table === 'regras_conciliacao') {
      let orderCount = 0;
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        or: vi.fn(() => query),
        order: vi.fn(() => {
          orderCount += 1;
          if (orderCount >= 2) {
            return Promise.resolve({
              data: [],
              error: null,
            });
          }
          return query;
        }),
      };
      return query;
    }

    throw new Error(`Unexpected table ${table}`);
  });
}

describe('api/bank-statement/match auto-confirm policy', () => {
  afterEach(() => {
    buildDeterministicMatchesMock.mockReset();
    getFirstMatchingRuleMock.mockClear();
    callUserRpcMock.mockReset();
    safeInsertBankAuditLogMock.mockClear();
    fromMock.mockReset();
    upsertPayloads.length = 0;
    vi.restoreAllMocks();
  });

  it('confirma automaticamente quando ha candidato unico elegivel por valor exato + descricao', async () => {
    buildAdminFromMock();
    buildDeterministicMatchesMock.mockReturnValue({
      suggestions: [
        {
          extrato_transacao_id: 'tx-1',
          lancamento_caixa_id: 'item-1',
          confidence: 0.92,
          method: 'deterministic',
          explanation: 'match forte',
          score: {
            amount_score: 1,
            date_score: 1,
            text_score: 0.91,
            final_score: 0.92,
          },
        },
      ],
      autoConfirmIds: ['item-1'],
      autoConfirmEligibleIds: ['item-1'],
    });

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: {
        import_id: 'import-1',
        auto_confirm: true,
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      confirmed_count: 1,
      suggested_count: 0,
    });
    expect(upsertPayloads).toHaveLength(1);
    expect(upsertPayloads[0]).toMatchObject({
      status: 'confirmed',
      item_financeiro_id: 'item-1',
      confirmed_by: 'user-1',
    });
  });

  it('nao confirma automaticamente quando ha ambiguidade entre candidatos elegiveis', async () => {
    buildAdminFromMock();
    buildDeterministicMatchesMock.mockReturnValue({
      suggestions: [
        {
          extrato_transacao_id: 'tx-1',
          lancamento_caixa_id: 'item-1',
          confidence: 0.9,
          method: 'deterministic',
          explanation: 'match 1',
          score: {
            amount_score: 1,
            date_score: 1,
            text_score: 0.9,
            final_score: 0.9,
          },
        },
        {
          extrato_transacao_id: 'tx-1',
          lancamento_caixa_id: 'item-2',
          confidence: 0.89,
          method: 'deterministic',
          explanation: 'match 2',
          score: {
            amount_score: 1,
            date_score: 1,
            text_score: 0.89,
            final_score: 0.89,
          },
        },
      ],
      autoConfirmIds: [],
      autoConfirmEligibleIds: ['item-1', 'item-2'],
    });

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: {
        import_id: 'import-1',
        auto_confirm: true,
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      confirmed_count: 0,
      suggested_count: 1,
    });
    expect(upsertPayloads).toHaveLength(1);
    expect(upsertPayloads[0]).toMatchObject({
      status: 'suggested',
      item_financeiro_id: 'item-1',
      confirmed_by: null,
    });

    const ambiguousAudit = safeInsertBankAuditLogMock.mock.calls.find((call) => {
      const payload = call?.[1] as Record<string, unknown> | undefined;
      return payload?.action === 'matching_auto_confirm_ambiguous';
    });
    expect(ambiguousAudit).toBeDefined();
  });

  it('bloqueia auto_create de regra por politica da fase e segue com match_existing', async () => {
    buildAdminFromMock();
    getFirstMatchingRuleMock.mockReturnValue({
      id: 'rule-1',
      auto_create: true,
      auto_confirm: true,
      default_grupo_contas_id: null,
    });
    buildDeterministicMatchesMock.mockReturnValue({
      suggestions: [
        {
          extrato_transacao_id: 'tx-1',
          lancamento_caixa_id: 'item-1',
          confidence: 0.91,
          method: 'deterministic',
          explanation: 'match seguro',
          score: {
            amount_score: 1,
            date_score: 1,
            text_score: 0.9,
            final_score: 0.91,
          },
        },
      ],
      autoConfirmIds: ['item-1'],
      autoConfirmEligibleIds: ['item-1'],
    });

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
      },
      body: {
        import_id: 'import-1',
        auto_confirm: true,
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      confirmed_count: 1,
      rule_auto_create_blocked_count: 1,
      rule_auto_create_phase_blocked_count: 1,
    });

    const createCall = callUserRpcMock.mock.calls.find((call) => call[3] === 'rpc_bank_create_lancamento_and_reconcile');
    expect(createCall).toBeUndefined();

    const blockedAudit = safeInsertBankAuditLogMock.mock.calls.find((call) => {
      const payload = call?.[1] as Record<string, unknown> | undefined;
      return payload?.action === 'rule_auto_create_blocked_phase_policy';
    });
    expect(blockedAudit).toBeDefined();
  });
});
