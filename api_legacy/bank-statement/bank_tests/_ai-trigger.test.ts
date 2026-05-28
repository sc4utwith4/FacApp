import { afterEach, describe, expect, it, vi } from 'vitest';
import { triggerBankReconciliationAiWorkflow } from '../../../src/server/bank-statement/_ai-trigger';

interface MockAdminClient {
  from: ReturnType<typeof vi.fn>;
}

const makeAwaitableQuery = (data: unknown, error: unknown = null) => {
  const query: Record<string, unknown> = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    limit: vi.fn(() => query),
    select: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve, reject),
  };
  return query;
};

const makeAdminClient = (options?: { supersedeError?: string; txIds?: string[] }) => {
  const inserts: Array<Record<string, unknown>> = [];
  const txIds = (options?.txIds || ['tx-1']).map((id) => ({ id }));

  const runRow = {
    id: 'run-1',
    empresa_id: 'empresa-1',
    conta_bancaria_id: 'conta-1',
    extrato_import_id: 'import-1',
    correlation_id: 'corr-1',
    trigger_source: 'bank_reconciliation',
    status: 'triggered',
    sugestoes_total: 0,
    match_existing_count: 0,
    create_new_count: 0,
    ignore_count: 0,
    needs_review_count: 0,
    error_message: null,
    metadata: {},
    created_by: 'user-1',
    created_at: '2026-02-27T21:00:00.000Z',
    updated_at: '2026-02-27T21:00:00.000Z',
    completed_at: null,
  };

  const adminClient: MockAdminClient = {
    from: vi.fn((table: string) => {
      if (table === 'bank_reconciliation_audit_log') {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            inserts.push(payload);
            return { data: null, error: null };
          }),
        };
      }

      if (table === 'bank_ai_execution_runs') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({ data: runRow, error: null })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: runRow, error: null })),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({ data: runRow, error: null })),
                })),
              })),
            })),
          })),
        };
      }

      if (table === 'extrato_transacoes') {
        return {
          select: vi.fn(() => makeAwaitableQuery(txIds)),
        };
      }

      if (table === 'bank_ai_suggestions') {
        return {
          update: vi.fn(() =>
            makeAwaitableQuery(
              options?.supersedeError
                ? null
                : [
                    { id: 'sug-1' },
                    { id: 'sug-2' },
                  ],
              options?.supersedeError ? { message: options.supersedeError } : null
            )
          ),
        };
      }

      throw new Error(`Unexpected table access during _ai-trigger test: ${table}`);
    }),
  };

  return {
    adminClient,
    inserts,
  };
};

describe('bank _ai-trigger', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('nao tenta chamar webhook quando configuracao obrigatoria nao existe', async () => {
    vi.stubEnv('N8N_BANK_RECONCILIATION_WEBHOOK_URL', '');
    vi.stubEnv('N8N_BANK_RECONCILIATION_INTEGRATION_SECRET', '');

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { adminClient, inserts } = makeAdminClient();

    const result = await triggerBankReconciliationAiWorkflow({
      adminClient: adminClient as never,
      empresaId: 'empresa-1',
      contaBancariaId: 'conta-1',
      extratoImportId: 'import-1',
      initiatedByUserId: 'user-1',
    });

    expect(result.attempted).toBe(false);
    expect(result.triggered).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      empresa_id: 'empresa-1',
      extrato_import_id: 'import-1',
      action: 'ai_workflow_trigger_skipped_config',
      status: 'warning',
    });
  });

  it('chama webhook com sucesso, supersede sugestoes abertas e registra auditoria', async () => {
    vi.stubEnv('N8N_BANK_RECONCILIATION_WEBHOOK_URL', 'https://n8n.example.com/webhook/bank');
    vi.stubEnv('N8N_BANK_RECONCILIATION_INTEGRATION_SECRET', 'integration-secret');

    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true }),
    }));

    vi.stubGlobal('fetch', fetchSpy);

    const { adminClient, inserts } = makeAdminClient();

    const result = await triggerBankReconciliationAiWorkflow({
      adminClient: adminClient as never,
      empresaId: 'empresa-1',
      contaBancariaId: 'conta-1',
      extratoImportId: 'import-1',
      initiatedByUserId: 'user-1',
      source: 'bank_reconciliation',
      reason: 'import_parsed',
    });

    expect(result.attempted).toBe(true);
    expect(result.triggered).toBe(true);
    expect(result.status_code).toBe(200);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchSpy.mock.calls[0];
    expect(requestInit.headers).toMatchObject({
      'x-integration-secret': 'integration-secret',
    });

    expect(inserts.find((row) => row.action === 'ai_suggestions_superseded_before_trigger')).toMatchObject({
      empresa_id: 'empresa-1',
      status: 'info',
    });
    expect(inserts.find((row) => row.action === 'ai_workflow_triggered')).toMatchObject({
      empresa_id: 'empresa-1',
      status: 'success',
    });
  });

  it('aborta trigger quando supersede de sugestoes falha', async () => {
    vi.stubEnv('N8N_BANK_RECONCILIATION_WEBHOOK_URL', 'https://n8n.example.com/webhook/bank');
    vi.stubEnv('N8N_BANK_RECONCILIATION_INTEGRATION_SECRET', 'integration-secret');

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { adminClient, inserts } = makeAdminClient({
      supersedeError: 'database unavailable',
    });

    const result = await triggerBankReconciliationAiWorkflow({
      adminClient: adminClient as never,
      empresaId: 'empresa-1',
      contaBancariaId: 'conta-1',
      extratoImportId: 'import-1',
      initiatedByUserId: 'user-1',
    });

    expect(result.attempted).toBe(false);
    expect(result.triggered).toBe(false);
    expect(result.message).toContain('database unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(inserts.find((row) => row.action === 'ai_suggestions_supersede_before_trigger_failed')).toMatchObject({
      empresa_id: 'empresa-1',
      status: 'error',
    });
  });
});
