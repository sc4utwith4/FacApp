import { afterEach, describe, expect, it, vi } from 'vitest';

const reviewQueueMocks = vi.hoisted(() => ({
  loadActiveReviewQueueRows: vi.fn(),
  getReviewGuidanceSnapshot: vi.fn(),
  syncReviewQueueFromPlan: vi.fn(async () => undefined),
  markReviewQueueItemAsked: vi.fn(async () => undefined),
  resolveReviewQueueItem: vi.fn(async () => undefined),
  loadReviewQueueItemById: vi.fn(async () => null),
}));

vi.mock('../reviewQueue.js', () => reviewQueueMocks);

import { executeBankChatReviewInteraction } from '../actionExecutor';

function makeAwaitableQuery(data: unknown[]) {
  const query: Record<string, unknown> = {
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  };
  return query;
}

function makeAdminClientMock() {
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

      if (table === 'extrato_transacoes') {
        return {
          select: vi.fn(() => makeAwaitableQuery([])),
        };
      }

      if (table === 'bank_ai_suggestions') {
        return {
          select: vi.fn(() => makeAwaitableQuery([])),
        };
      }

      if (table === 'bank_reconciliation_audit_log') {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

describe('executeBankChatReviewInteraction review_batch_confirm', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    reviewQueueMocks.loadActiveReviewQueueRows.mockReset();
    reviewQueueMocks.getReviewGuidanceSnapshot.mockReset();
    reviewQueueMocks.syncReviewQueueFromPlan.mockReset();
    reviewQueueMocks.markReviewQueueItemAsked.mockReset();
    reviewQueueMocks.resolveReviewQueueItem.mockReset();
  });

  it('applies safe matches and auto divergence in batch mode', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (
        url.includes('/api/bank-statement/reconcile/link-existing') ||
        url.includes('/api/bank-statement/reconcile/ignore') ||
        url.includes('/api/bank-statement/ai/review')
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    reviewQueueMocks.loadActiveReviewQueueRows.mockResolvedValue([
      {
        id: 'case-safe',
        suggestion_id: 's-safe',
        extrato_transacao_id: 'tx-safe',
        source_action: 'match_existing',
        metadata: {
          safe_match_candidate: true,
          auto_divergence_candidate: false,
          item_financeiro_id: 'if-1',
          valor_centavos: 1000,
          confidence: 0.92,
        },
      },
      {
        id: 'case-div',
        suggestion_id: 's-div',
        extrato_transacao_id: 'tx-div',
        source_action: 'create_new',
        metadata: {
          safe_match_candidate: false,
          auto_divergence_candidate: true,
          descricao: 'Tarifa X',
        },
      },
      {
        id: 'case-exception',
        suggestion_id: 's-ex',
        extrato_transacao_id: 'tx-ex',
        source_action: 'needs_review',
        metadata: {
          safe_match_candidate: false,
          auto_divergence_candidate: false,
        },
      },
    ]);

    reviewQueueMocks.getReviewGuidanceSnapshot.mockResolvedValue({
      queue_total: 3,
      queue_remaining: 1,
      queue_phase: 'guided_1x1',
      current_position: 3,
      current_case: {
        case_id: 'case-exception',
        extrato_transacao_id: 'tx-ex',
        action: 'needs_review',
        question: 'Como deseja tratar este item?',
      },
      next_actions: [
        {
          decision: 'approve_ignore',
          label: 'Marcar divergência',
          requires_justification: true,
        },
      ],
      create_new_summary: null,
    });

    const adminClient = makeAdminClientMock();

    const result = await executeBankChatReviewInteraction({
      adminClient: adminClient as never,
      baseUrl: 'https://assfac-plataforma.vercel.app',
      accessToken: 'token',
      empresaId: 'empresa-1',
      userId: 'user-1',
      sessionId: 'session-1',
      contaBancariaId: 'conta-1',
      dataReferencia: '2026-03-02',
      importId: 'import-1',
      interaction: {
        kind: 'review_batch_confirm',
        strategy: 'strict_date_value',
        apply_safe_matches: true,
        apply_auto_divergence: true,
        global_justification: 'Divergência em lote validada nesta fase.',
      },
    });

    expect(result.assistant_message).toContain('Decisões rápidas aplicadas: 1 vínculo(s) e 1 divergência(s).');

    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/bank-statement/reconcile/link-existing'))
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes('/api/bank-statement/reconcile/ignore'))
    ).toBe(true);

    expect(reviewQueueMocks.resolveReviewQueueItem).toHaveBeenCalledTimes(2);
    expect(reviewQueueMocks.resolveReviewQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 'case-safe',
        decision: 'approve_match',
      })
    );
    expect(reviewQueueMocks.resolveReviewQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: 'case-div',
        decision: 'approve_ignore',
      })
    );
  });
});
