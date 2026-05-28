import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateAiTriggerDispatch,
  executeBankChatAction,
} from '../actionExecutor';

function makeAdminClientMock() {
  let storedResult: Record<string, unknown> | null = null;

  return {
    rpc: vi.fn(async (fnName: string) => {
      if (fnName !== 'rpc_bank_sync_conciliacao_itens') {
        throw new Error(`Unexpected RPC call during trigger failure path: ${fnName}`);
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
                    data: {
                      id: 'import-1',
                      file_format: 'ofx',
                    },
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

      if (table === 'bank_reconciliation_audit_log') {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }

      throw new Error(`Unexpected table access during trigger failure path: ${table}`);
    }),
  };
}

describe('evaluateAiTriggerDispatch', () => {
  it('detects trigger not dispatched when API returns ok=false/triggered=false', () => {
    const evaluated = evaluateAiTriggerDispatch({
      ok: false,
      correlation_id: null,
      trigger: {
        triggered: false,
        message: 'Trigger IA bloqueado por configuracao de escopo.',
      },
    });

    expect(evaluated.dispatched).toBe(false);
    expect(evaluated.message).toContain('configuracao de escopo');
    expect(evaluated.correlationId).toBeNull();
  });
});

describe('executeBankChatAction trigger_ai', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses canonical conciliation flow for trigger_ai alias and stops polling when trigger is not dispatched', async () => {
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
            ok: false,
            correlation_id: null,
            trigger: {
              attempted: false,
              triggered: false,
              message: 'Trigger IA bloqueado por configuracao de escopo: conta fora do escopo configurado.',
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
                pendencias_criticas_total: 3,
              },
            },
          }),
        };
      }

      throw new Error(`Unexpected fetch URL during trigger failure path: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adminClient = makeAdminClientMock();

    const result = await executeBankChatAction({
      adminClient: adminClient as never,
      baseUrl: 'https://assfac-plataforma.vercel.app',
      accessToken: 'token',
      empresaId: 'empresa-1',
      userId: 'user-1',
      contaBancariaId: 'conta-1',
      dataReferencia: '2026-02-18',
      importId: 'import-1',
      action: 'trigger_ai',
      idempotencyKey: 'chat-action:test-trigger-failure',
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
    expect(result.action).toBe('run_daily_reconciliation');
    expect(result.ai_polling).toMatchObject({
      attempts: 0,
      elapsed_ms: 0,
      outcome: 'failed',
    });
    expect(result.ai_processing_status).toMatchObject({
      state: 'failed',
      outcome: 'failed',
    });
    expect(result.assistant_message).toContain('disparo da IA não foi realizado');
    expect(result.reconciliation_plan).toBeUndefined();
    expect(result.pending_cases).toBeUndefined();
    expect(result.clarifying_questions).toBeUndefined();
  });

  it('retorna erro estruturado para falha de conectividade interna no matching', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/api/bank-statement/match')) {
        throw new Error('fetch failed');
      }

      throw new Error(`Unexpected fetch URL during network failure path: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const adminClient = makeAdminClientMock();

    let thrown: unknown = null;
    try {
      await executeBankChatAction({
        adminClient: adminClient as never,
        baseUrl: 'http://localhost:8082',
        accessToken: 'token',
        empresaId: 'empresa-1',
        userId: 'user-1',
        contaBancariaId: 'conta-1',
        dataReferencia: '2026-02-18',
        importId: 'import-1',
        action: 'run_daily_reconciliation',
        idempotencyKey: 'chat-action:test-network-failure',
      });
    } catch (error: unknown) {
      thrown = error;
    }

    const structuredError = thrown as Error & { details?: Record<string, unknown> };
    expect(structuredError).toBeInstanceOf(Error);
    expect(structuredError.name).toBe('InternalApiError');
    expect(structuredError.message).toContain(
      'Falha de conectividade interna ao chamar POST /api/bank-statement/match.'
    );
    expect(structuredError.details).toMatchObject({
      type: 'network',
      method: 'POST',
      path: '/api/bank-statement/match',
      target: 'http://localhost:8082',
      reason: 'fetch failed',
    });
  });
});
