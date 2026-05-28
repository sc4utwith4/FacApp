import { describe, expect, it } from 'vitest';
import {
  classifyWorkspacePattern,
  sortCandidatesForWorkspace,
} from '@/server/bank-statement/conciliation/workspace';
import type { MatchingLancamentoCandidate } from '@/types/bank-reconciliation';

describe('conciliation workspace helpers', () => {
  it('agrupa descrições PIX em uma mesma família operacional', () => {
    expect(classifyWorkspacePattern('TRANSFERENCIA PIX REM: CLIENTE ABC 20/02')).toEqual({
      key: 'pix',
      label: 'Transferências PIX',
    });
  });

  it('prioriza vínculo estrito por valor, data e direção', () => {
    const tx = {
      id: 'tx-1',
      conta_bancaria_id: 'conta-1',
      data_movimento: '2026-03-04',
      descricao_raw: 'PIX CLIENTE A',
      descricao_norm: 'pix cliente a',
      valor_centavos: 15320,
      tipo: 'credit' as const,
    };

    const candidates: MatchingLancamentoCandidate[] = [
      {
        id: 'item-loose',
        conta_bancaria_id: 'conta-1',
        data: '2026-03-05',
        tipo: 'entrada',
        valor: 153.2,
        historico: 'PIX CLIENTE A',
        documento: null,
        item_financeiro_id: 'if-loose',
        origem_tipo: 'lancamento_caixa',
        origem_id_uuid: 'lanc-loose',
      },
      {
        id: 'item-strict',
        conta_bancaria_id: 'conta-1',
        data: '2026-03-04',
        tipo: 'entrada',
        valor: 153.2,
        historico: 'PIX CLIENTE A',
        documento: null,
        item_financeiro_id: 'if-strict',
        origem_tipo: 'lancamento_caixa',
        origem_id_uuid: 'lanc-strict',
      },
    ];

    const sorted = sortCandidatesForWorkspace(tx, candidates);

    expect(sorted[0]?.item_financeiro_id).toBe('if-strict');
    expect(sorted[0]?.strict_value_date_direction_match).toBe(true);
    expect(sorted[1]?.strict_value_date_direction_match).toBe(false);
  });
});
