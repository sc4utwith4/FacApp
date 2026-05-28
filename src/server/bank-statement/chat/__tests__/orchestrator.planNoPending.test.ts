import { describe, expect, it, vi } from 'vitest';
import { buildCurrentReconciliationPlan } from '../orchestrator';

describe('buildCurrentReconciliationPlan no_pending guard', () => {
  it('returns null plan without loading suggestions when ai execution is no_pending', async () => {
    const adminClient = {
      from: vi.fn(() => {
        throw new Error('buildCurrentReconciliationPlan should not query DB for no_pending execution');
      }),
    };

    const plan = await buildCurrentReconciliationPlan({
      adminClient: adminClient as never,
      contextSnapshot: {
        empresa_id: 'empresa-1',
        conta_bancaria_id: 'conta-1',
        conta_label: 'Conta Teste',
        data_referencia: '2026-02-18',
        import_id: 'import-1',
        import_source: 'ofx_generic',
        import_file_format: 'ofx',
        ofx_required: false,
        ofx_required_reason: null,
        import_parse_status: 'parsed',
        import_error_message: null,
        status_counts: {
          pendente: 57,
          sugerido: 0,
          conciliado: 0,
          divergente: 0,
        },
        pendencias_criticas: 57,
        pending_examples: [],
        daily_summary: null,
      },
      aiExecutionRun: {
        status: 'no_pending',
      } as never,
    });

    expect(plan.plan).toBeNull();
    expect(plan.clarifying_questions).toEqual([]);
    expect(plan.pending_cases).toEqual([]);
    expect(adminClient.from).not.toHaveBeenCalled();
  });
});
