import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeBankChatAction } from '../actionExecutor';

function makeAdminClientRunNoPendingMock() {
  let storedResult: Record<string, unknown> | null = null;

  const runRow = {
    id: 'run-1',
    empresa_id: 'empresa-1',
    conta_bancaria_id: 'conta-1',
    extrato_import_id: 'import-1',
    correlation_id: 'corr-1',
    trigger_source: 'bank_reconciliation',
    status: 'no_pending',
    sugestoes_total: 0,
    match_existing_count: 0,
    create_new_count: 0,
    ignore_count: 0,
    needs_review_count: 0,
    error_message: null,
    metadata: {},
    created_by: null,
    created_at: '2026-02-27T20:39:37.000Z',
    updated_at: '2026-02-27T20:39:40.000Z',
    completed_at: '2026-02-27T20:39:40.000Z',
  };

  return {
    rpc: vi.fn(async (fnName: string) => {
      if (fnName !== 'rpc_bank_sync_conciliacao_itens') {
        throw new Error(`Unexpected RPC call: ${fnName}`);
      }
      return { data: { ok: true }, error: null };
    }),
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

      if (table === 'bank_ai_execution_runs') {
        return {
          select: vi.fn(() => {
            const query: Record<string, unknown> = {
              eq: vi.fn(() => query),
              maybeSingle: vi.fn(async () => ({ data: runRow, error: null })),
            };
            return query;
          }),
        };
      }

      if (table === 'bank_reconciliation_audit_log') {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }

      throw new Error(`Unexpected table access during run_daily_reconciliation: ${table}`);
    }),
  };
}

describe('executeBankChatAction run_daily_reconciliation consistency', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks ai_triggered=1 using trigger payload and hides plan when run status is no_pending', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/api/bank-statement/match')) {
        return {
          ok: true,
          json: async () => ({
            confirmed_count: 0,
            suggested_count: 0,
            skipped_count: 0,
          }),
        };
      }

      if (url.includes('/api/bank-statement/ai/trigger')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            correlation_id: 'corr-1',
            trigger: {
              attempted: true,
              triggered: true,
              message: 'Webhook acionado com sucesso.',
              correlation_id: 'corr-1',
            },
          }),
        };
      }

      if (url.includes('/api/bank-statement/daily/summary')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              summary: {
                pendencias_criticas_total: 57,
              },
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adminClient = makeAdminClientRunNoPendingMock();

    const result = await executeBankChatAction({
      adminClient: adminClient as never,
      baseUrl: 'https://assfac-plataforma.vercel.app',
      accessToken: 'token',
      empresaId: 'empresa-1',
      userId: 'user-1',
      contaBancariaId: 'conta-1',
      dataReferencia: '2026-02-18',
      importId: 'import-1',
      action: 'run_daily_reconciliation',
      idempotencyKey: 'chat-action:test-run-daily-ai-trigger-consistency',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const matchCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/bank-statement/match'));
    expect(matchCall).toBeDefined();
    if (!matchCall) {
      throw new Error('Expected /api/bank-statement/match call');
    }
    const matchInit = matchCall[1] as RequestInit | undefined;
    const matchBodyRaw = typeof matchInit?.body === 'string' ? matchInit.body : '{}';
    const matchBody = JSON.parse(matchBodyRaw) as Record<string, unknown>;
    expect(matchBody).toMatchObject({
      import_id: 'import-1',
      auto_confirm: true,
    });
    expect(result.affected_counts).toMatchObject({
      ai_triggered: 1,
    });
    expect(result.assistant_message).not.toMatch(/nao foi realizado|não foi realizado/i);
    expect(result.ai_processing_status).toMatchObject({
      state: 'no_pending',
    });
    expect(result.reconciliation_plan).toBeUndefined();
    expect(result.pending_cases).toEqual([]);
    expect(result.clarifying_questions).toEqual([]);
  });

  it('keeps run_daily flow stable and skips guided-review sync outside pilot scope', async () => {
    vi.stubEnv('BANK_RECONCILIATION_PILOT_EMPRESA_ID', 'empresa-piloto');

    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes('/api/bank-statement/match')) {
        return {
          ok: true,
          json: async () => ({
            confirmed_count: 0,
            suggested_count: 0,
            skipped_count: 0,
          }),
        };
      }

      if (url.includes('/api/bank-statement/ai/trigger')) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            correlation_id: 'corr-1',
            trigger: {
              attempted: true,
              triggered: true,
              message: 'Webhook acionado com sucesso.',
              correlation_id: 'corr-1',
            },
          }),
        };
      }

      if (url.includes('/api/bank-statement/daily/summary')) {
        return {
          ok: true,
          json: async () => ({
            data: {
              summary: {
                pendencias_criticas_total: 57,
              },
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adminClient = makeAdminClientRunNoPendingMock();

    const result = await executeBankChatAction({
      adminClient: adminClient as never,
      baseUrl: 'https://assfac-plataforma.vercel.app',
      accessToken: 'token',
      empresaId: 'empresa-fora-piloto',
      userId: 'user-1',
      contaBancariaId: 'conta-1',
      dataReferencia: '2026-02-18',
      importId: 'import-1',
      sessionId: 'session-1',
      action: 'run_daily_reconciliation',
      idempotencyKey: 'chat-action:test-run-daily-pilot-gate-guided-review',
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const matchCall = fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/bank-statement/match'));
    expect(matchCall).toBeDefined();
    if (!matchCall) {
      throw new Error('Expected /api/bank-statement/match call');
    }
    const matchInit = matchCall[1] as RequestInit | undefined;
    const matchBodyRaw = typeof matchInit?.body === 'string' ? matchInit.body : '{}';
    const matchBody = JSON.parse(matchBodyRaw) as Record<string, unknown>;
    expect(matchBody).toMatchObject({
      import_id: 'import-1',
      auto_confirm: true,
    });
    expect(result.assistant_message).not.toContain('Revisao guiada');
    expect(result.review_guidance).toBeUndefined();
  });
});
