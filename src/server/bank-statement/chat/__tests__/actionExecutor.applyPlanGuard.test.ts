import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeBankChatAction } from '../actionExecutor';

type SuggestionRow = {
  id: string;
  suggestion_action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
  confidence: number | null;
  explanation: string | null;
  item_financeiro_id: string | null;
  lancamento_caixa_id: string | null;
  proposed_lancamento: Record<string, unknown> | null;
  warnings: string[];
  extrato_transacao_id: string;
  status: 'suggested';
};

function makeAdminClientApplyPlanMock(suggestionRows: SuggestionRow[]) {
  let storedResult: Record<string, unknown> | null = null;

  const txRows = [
    {
      id: 'tx-1',
      valor_centavos: 190000,
      data_movimento: '2026-02-18',
      tipo: 'credit' as const,
      descricao_raw: 'TRANSFERENCIA PIX REM: AVANNT PNEUS REMOLD L 18/02',
      documento_ref: null,
    },
  ];

  const makeAwaitableQuery = (data: unknown) => {
    const query: Record<string, unknown> = {
      eq: vi.fn(() => query),
      in: vi.fn(() => query),
      gte: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data, error: null }).then(resolve, reject),
    };
    return query;
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'extratos_import') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { id: 'import-1', file_format: 'ofx' },
                    error: null,
                  })),
                })),
              })),
            })),
          })),
        };
      }

      if (table === 'bank_reconciliation_chat_action_idempotency') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: storedResult ? { result_json: storedResult } : null,
                  error: null,
                })),
              })),
            })),
          })),
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            storedResult =
              payload.result_json && typeof payload.result_json === 'object'
                ? (payload.result_json as Record<string, unknown>)
                : null;
            return { error: null };
          }),
        };
      }

      if (table === 'extrato_transacoes') {
        return {
          select: vi.fn(() => makeAwaitableQuery(txRows)),
        };
      }

      if (table === 'bank_ai_suggestions') {
        return {
          select: vi.fn(() => makeAwaitableQuery(suggestionRows)),
        };
      }

      if (table === 'bank_reconciliation_audit_log') {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }

      throw new Error(`Unexpected table access: ${table}`);
    }),
  };
}

describe('executeBankChatAction apply_reconciliation_plan guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('blocks apply when selected suggestions are only needs_review', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const adminClient = makeAdminClientApplyPlanMock([
      {
        id: 'sug-1',
        suggestion_action: 'needs_review',
        confidence: 0.12,
        explanation: 'Precisa de revisão humana.',
        item_financeiro_id: null,
        lancamento_caixa_id: null,
        proposed_lancamento: null,
        warnings: [],
        extrato_transacao_id: 'tx-1',
        status: 'suggested',
      },
    ]);

    const result = await executeBankChatAction({
      adminClient: adminClient as never,
      baseUrl: 'https://assfac-plataforma.vercel.app',
      accessToken: 'token',
      empresaId: 'empresa-1',
      userId: 'user-1',
      contaBancariaId: 'conta-1',
      dataReferencia: '2026-02-18',
      importId: 'import-1',
      action: 'apply_reconciliation_plan',
      idempotencyKey: 'chat-action:test-apply-needs-review-only',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.assistant_message).toContain('revisão necessária');
    expect(result.affected_counts).toMatchObject({
      applied: 0,
      needs_review: 1,
      failed: 0,
    });
  });

  it('blocks create_new suggestions when balance mutation policy is enabled', async () => {
    vi.stubEnv('BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION', 'true');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/bank-statement/daily/summary')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, data: { pendencias_criticas_total: 0 } }),
        } as Response;
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adminClient = makeAdminClientApplyPlanMock([
      {
        id: 'sug-create',
        suggestion_action: 'create_new',
        confidence: 0.87,
        explanation: 'Criar lançamento sugerido pela IA.',
        item_financeiro_id: null,
        lancamento_caixa_id: null,
        proposed_lancamento: {
          tipo: 'entrada',
          valor_centavos: 190000,
          data: '2026-02-18',
          descricao: 'Recebimento cliente X',
        },
        warnings: [],
        extrato_transacao_id: 'tx-1',
        status: 'suggested',
      },
    ]);

    const result = await executeBankChatAction({
      adminClient: adminClient as never,
      baseUrl: 'https://assfac-plataforma.vercel.app',
      accessToken: 'token',
      empresaId: 'empresa-1',
      userId: 'user-1',
      contaBancariaId: 'conta-1',
      dataReferencia: '2026-02-18',
      importId: 'import-1',
      action: 'apply_reconciliation_plan',
      idempotencyKey: 'chat-action:test-apply-create-new-blocked',
    });

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/bank-statement/reconcile/create'))
    ).toBe(false);
    expect(result.assistant_message).toContain('sem vínculo automático');
    expect(result.affected_counts).toMatchObject({
      create_new: 0,
      create_new_blocked: 1,
      applied: 0,
      failed: 0,
    });
  });
});
