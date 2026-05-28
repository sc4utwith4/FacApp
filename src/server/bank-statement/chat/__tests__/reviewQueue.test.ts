import { describe, expect, it } from 'vitest';
import { buildBlockedCreateNewSummary, getReviewGuidanceSnapshot } from '../reviewQueue';
import type { ChatReconciliationPlan } from '../../../../types/bank-reconciliation';

const makePlan = (): ChatReconciliationPlan => ({
  plan_id: 'plan-1',
  empresa_id: 'empresa-1',
  conta_bancaria_id: 'conta-1',
  data_referencia: '2026-03-02',
  import_id: 'import-1',
  generated_at: '2026-03-02T00:00:00.000Z',
  totals: {
    total: 4,
    match_existing: 1,
    create_new: 3,
    ignore: 0,
    needs_review: 0,
  },
  items: [
    {
      id: 'item-1',
      suggestion_id: 's1',
      extrato_transacao_id: 'tx1',
      action: 'create_new',
      confidence: 0.91,
      extrato_data_movimento: '2026-03-02',
      extrato_valor_centavos: 12000,
      extrato_tipo: 'debit',
      extrato_descricao_raw: 'Tarifa A',
      extrato_documento_ref: null,
      item_financeiro_id: null,
      lancamento_caixa_id: null,
      explanation: 'Criar lançamento',
      proposed_lancamento: null,
    },
    {
      id: 'item-2',
      suggestion_id: 's2',
      extrato_transacao_id: 'tx2',
      action: 'create_new',
      confidence: 0.75,
      extrato_data_movimento: '2026-03-02',
      extrato_valor_centavos: 455000,
      extrato_tipo: 'credit',
      extrato_descricao_raw: 'Recebimento B',
      extrato_documento_ref: null,
      item_financeiro_id: null,
      lancamento_caixa_id: null,
      explanation: 'Criar lançamento',
      proposed_lancamento: null,
    },
    {
      id: 'item-3',
      suggestion_id: 's3',
      extrato_transacao_id: 'tx3',
      action: 'match_existing',
      confidence: 0.88,
      extrato_data_movimento: '2026-03-02',
      extrato_valor_centavos: 20000,
      extrato_tipo: 'debit',
      extrato_descricao_raw: 'Pagamento C',
      extrato_documento_ref: null,
      item_financeiro_id: 'if-1',
      lancamento_caixa_id: null,
      explanation: 'Vincular',
      proposed_lancamento: null,
    },
    {
      id: 'item-4',
      suggestion_id: 's4',
      extrato_transacao_id: 'tx4',
      action: 'create_new',
      confidence: 0.6,
      extrato_data_movimento: '2026-03-02',
      extrato_valor_centavos: -8900,
      extrato_tipo: 'debit',
      extrato_descricao_raw: 'Tarifa D',
      extrato_documento_ref: null,
      item_financeiro_id: null,
      lancamento_caixa_id: null,
      explanation: 'Criar lançamento',
      proposed_lancamento: null,
    },
  ],
});

describe('buildBlockedCreateNewSummary', () => {
  it('returns null when plan is absent', () => {
    expect(buildBlockedCreateNewSummary(null)).toBeNull();
  });

  it('aggregates create_new totals and top items', () => {
    const summary = buildBlockedCreateNewSummary(makePlan());
    expect(summary).not.toBeNull();
    expect(summary?.total).toBe(3);
    expect(summary?.valor_total_centavos).toBe(475900);
    expect(summary?.top_items).toHaveLength(3);
    expect(summary?.top_items[0].suggestion_id).toBe('s2');
  });
});

describe('getReviewGuidanceSnapshot', () => {
  const makeSelectQuery = (rows: unknown[]) => {
    const query: Record<string, unknown> = {
      eq: () => query,
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return query;
  };

  it('keeps deferred items in queue and prioritizes pending before deferred', async () => {
    const rows = [
      {
        id: 'case-pending',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's1',
        extrato_transacao_id: 'tx-1',
        source_action: 'create_new',
        review_status: 'pending',
        decision: null,
        justification: null,
        resolved_by: null,
        resolved_at: null,
        asked_count: 0,
        last_asked_at: null,
        metadata: {
          descricao: 'Transferência sem vínculo',
          question: 'Como deseja tratar?',
          valor_centavos: 100000,
          confidence: 0.5,
          confidence_band: 'low',
        },
        created_at: '2026-03-02T10:00:00.000Z',
        updated_at: '2026-03-02T10:00:00.000Z',
      },
      {
        id: 'case-deferred',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's2',
        extrato_transacao_id: 'tx-2',
        source_action: 'needs_review',
        review_status: 'deferred',
        decision: 'keep_pending',
        justification: null,
        resolved_by: null,
        resolved_at: null,
        asked_count: 1,
        last_asked_at: '2026-03-02T10:10:00.000Z',
        metadata: {
          descricao: 'Pagamento com dúvida',
          question: 'Deseja aprovar vínculo?',
          valor_centavos: 50000,
          confidence: 0.6,
          confidence_band: 'medium',
        },
        created_at: '2026-03-02T10:05:00.000Z',
        updated_at: '2026-03-02T10:10:00.000Z',
      },
    ];

    const adminClient = {
      from: (table: string) => {
        expect(table).toBe('bank_reconciliation_chat_review_items');
        return {
          select: () => makeSelectQuery(rows),
        };
      },
    };

    const snapshot = await getReviewGuidanceSnapshot({
      adminClient: adminClient as never,
      empresaId: 'empresa-1',
      sessionId: 'session-1',
      plan: null,
    });

    expect(snapshot.queue_total).toBe(2);
    expect(snapshot.queue_remaining).toBe(2);
    expect(snapshot.current_case?.case_id).toBe('case-pending');
    expect(snapshot.next_actions?.[0]?.decision).toBe('approve_ignore');
    expect(snapshot.next_actions?.[0]?.label).toBe('Marcar divergência');
  });

  it('exposes batch offer when safe match and auto divergence candidates are available', async () => {
    const rows = [
      {
        id: 'case-safe',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's-safe',
        extrato_transacao_id: 'tx-safe',
        source_action: 'match_existing',
        review_status: 'pending',
        decision: null,
        justification: null,
        resolved_by: null,
        resolved_at: null,
        asked_count: 0,
        last_asked_at: null,
        metadata: {
          descricao: 'PIX cliente A',
          question: 'Confirmar vínculo?',
          valor_centavos: 500000,
          confidence: 0.9,
          safe_match_candidate: true,
          auto_divergence_candidate: false,
        },
        created_at: '2026-03-02T10:00:00.000Z',
        updated_at: '2026-03-02T10:00:00.000Z',
      },
      {
        id: 'case-div',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's-div',
        extrato_transacao_id: 'tx-div',
        source_action: 'create_new',
        review_status: 'pending',
        decision: null,
        justification: null,
        resolved_by: null,
        resolved_at: null,
        asked_count: 0,
        last_asked_at: null,
        metadata: {
          descricao: 'Tarifa sem vínculo',
          question: 'Como deseja tratar?',
          valor_centavos: 165,
          confidence: 0.4,
          safe_match_candidate: false,
          auto_divergence_candidate: true,
        },
        created_at: '2026-03-02T10:05:00.000Z',
        updated_at: '2026-03-02T10:05:00.000Z',
      },
      {
        id: 'case-exception',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's-ex',
        extrato_transacao_id: 'tx-ex',
        source_action: 'needs_review',
        review_status: 'pending',
        decision: null,
        justification: null,
        resolved_by: null,
        resolved_at: null,
        asked_count: 0,
        last_asked_at: null,
        metadata: {
          descricao: 'Caso excepcional',
          question: 'Revisar item',
          valor_centavos: 70000,
          confidence: 0.55,
          safe_match_candidate: false,
          auto_divergence_candidate: false,
        },
        created_at: '2026-03-02T10:10:00.000Z',
        updated_at: '2026-03-02T10:10:00.000Z',
      },
    ];

    const adminClient = {
      from: () => ({
        select: () => makeSelectQuery(rows),
      }),
    };

    const snapshot = await getReviewGuidanceSnapshot({
      adminClient: adminClient as never,
      empresaId: 'empresa-1',
      sessionId: 'session-1',
      plan: null,
    });

    expect(snapshot.queue_phase).toBe('pre_batch');
    expect(snapshot.current_case).toBeNull();
    expect(snapshot.safe_match_count).toBe(1);
    expect(snapshot.auto_divergence_count).toBe(1);
    expect(snapshot.exceptions_count).toBe(1);
    expect(snapshot.batch_offer?.total_candidate_count).toBe(2);
  });

  it('forces guided_1x1 when there are only auto divergence candidates', async () => {
    const rows = [
      {
        id: 'case-div',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's-div',
        extrato_transacao_id: 'tx-div',
        source_action: 'create_new',
        review_status: 'pending',
        decision: null,
        justification: null,
        resolved_by: null,
        resolved_at: null,
        asked_count: 0,
        last_asked_at: null,
        metadata: {
          descricao: 'Tarifa sem vínculo',
          question: 'Como deseja tratar?',
          valor_centavos: 165,
          confidence: 0.4,
          safe_match_candidate: false,
          auto_divergence_candidate: true,
        },
        created_at: '2026-03-02T10:00:00.000Z',
        updated_at: '2026-03-02T10:00:00.000Z',
      },
    ];

    const adminClient = {
      from: () => ({
        select: () => makeSelectQuery(rows),
      }),
    };

    const snapshot = await getReviewGuidanceSnapshot({
      adminClient: adminClient as never,
      empresaId: 'empresa-1',
      sessionId: 'session-1',
      plan: null,
    });

    expect(snapshot.queue_phase).toBe('guided_1x1');
    expect(snapshot.batch_offer).toBeNull();
    expect(snapshot.current_case?.case_id).toBe('case-div');
  });

  it('returns completed display mode and final summary when queue is resolved', async () => {
    const rows = [
      {
        id: 'case-resolved-1',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's-1',
        extrato_transacao_id: 'tx-1',
        source_action: 'create_new',
        review_status: 'resolved',
        decision: 'approve_ignore',
        justification: 'Sem vínculo automático.',
        resolved_by: 'user-1',
        resolved_at: '2026-03-02T11:00:00.000Z',
        asked_count: 1,
        last_asked_at: '2026-03-02T10:30:00.000Z',
        metadata: {
          auto_divergence_candidate: true,
        },
        created_at: '2026-03-02T10:00:00.000Z',
        updated_at: '2026-03-02T11:00:00.000Z',
      },
      {
        id: 'case-resolved-2',
        empresa_id: 'empresa-1',
        session_id: 'session-1',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-02',
        suggestion_id: 's-2',
        extrato_transacao_id: 'tx-2',
        source_action: 'match_existing',
        review_status: 'resolved',
        decision: 'approve_match',
        justification: null,
        resolved_by: 'user-1',
        resolved_at: '2026-03-02T11:05:00.000Z',
        asked_count: 1,
        last_asked_at: '2026-03-02T10:35:00.000Z',
        metadata: {
          safe_match_candidate: true,
        },
        created_at: '2026-03-02T10:05:00.000Z',
        updated_at: '2026-03-02T11:05:00.000Z',
      },
    ];

    const adminClient = {
      from: () => ({
        select: () => makeSelectQuery(rows),
      }),
    };

    const snapshot = await getReviewGuidanceSnapshot({
      adminClient: adminClient as never,
      empresaId: 'empresa-1',
      sessionId: 'session-1',
      plan: null,
    });

    expect(snapshot.queue_phase).toBe('completed');
    expect(snapshot.display_mode).toBe('guided_completed');
    expect(snapshot.queue_total).toBe(0);
    expect(snapshot.queue_remaining).toBe(0);
    expect(snapshot.final_summary).toEqual({
      total: 2,
      resolved: 2,
      unresolved: 0,
      manual_review_count: 0,
    });
  });
});
