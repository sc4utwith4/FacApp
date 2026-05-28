import { describe, expect, it } from 'vitest';
import { buildDeterministicMatches } from '@/lib/bank-reconciliation/matchingEngine';
import type { ExtratoTransacaoRow, MatchingLancamentoCandidate } from '@/types/bank-reconciliation';

const baseExtrato: ExtratoTransacaoRow = {
  id: 'tx-1',
  empresa_id: 'empresa-1',
  extrato_import_id: 'import-1',
  conta_bancaria_id: 'conta-1',
  fit_id: null,
  hash_fallback: 'hash-1',
  line_number: 1,
  dedupe_ordinal: 1,
  data_movimento: '2026-02-10',
  data_compensacao: null,
  descricao_raw: 'PIX UBER',
  descricao_norm: 'pix uber',
  valor_centavos: 5000,
  tipo: 'debit',
  documento_ref: null,
  metadata: {},
  created_at: '2026-02-10T00:00:00.000Z',
  updated_at: '2026-02-10T00:00:00.000Z',
};

describe('matchingEngine', () => {
  it('auto-confirma quando existe match unico e forte', () => {
    const candidates: MatchingLancamentoCandidate[] = [
      {
        id: 'l-1',
        data: '2026-02-10',
        tipo: 'saida',
        valor: 50,
        historico: 'PIX UBER',
        documento: null,
        conta_bancaria_id: 'conta-1',
      },
      {
        id: 'l-2',
        data: '2026-02-11',
        tipo: 'saida',
        valor: 50,
        historico: 'TARIFA BANCARIA',
        documento: null,
        conta_bancaria_id: 'conta-1',
      },
    ];

    const result = buildDeterministicMatches(baseExtrato, candidates);

    expect(result.suggestions.length).toBeGreaterThan(0);
    expect(result.suggestions[0].lancamento_caixa_id).toBe('l-1');
    expect(result.autoConfirmIds).toEqual(['l-1']);
    expect(result.autoConfirmEligibleIds).toEqual(['l-1']);
  });

  it('nao auto-confirma quando ha ambiguidade de candidatos elegiveis', () => {
    const candidates: MatchingLancamentoCandidate[] = [
      {
        id: 'l-1',
        data: '2026-02-10',
        tipo: 'saida',
        valor: 50,
        historico: 'PIX UBER',
        documento: null,
        conta_bancaria_id: 'conta-1',
      },
      {
        id: 'l-2',
        data: '2026-02-10',
        tipo: 'saida',
        valor: 50,
        historico: 'UBER PIX',
        documento: null,
        conta_bancaria_id: 'conta-1',
      },
    ];

    const result = buildDeterministicMatches(baseExtrato, candidates);

    expect(result.suggestions).toHaveLength(2);
    expect(result.autoConfirmIds).toEqual([]);
    expect(result.autoConfirmEligibleIds).toEqual(expect.arrayContaining(['l-1', 'l-2']));
  });

  it('nao auto-confirma quando texto fica abaixo do limiar de 0.85', () => {
    const candidates: MatchingLancamentoCandidate[] = [
      {
        id: 'l-1',
        data: '2026-02-10',
        tipo: 'saida',
        valor: 50,
        historico: 'UBER TAXA',
        documento: null,
        conta_bancaria_id: 'conta-1',
      },
    ];

    const result = buildDeterministicMatches(baseExtrato, candidates);

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.score.amount_score).toBe(1);
    expect(result.suggestions[0]?.score.text_score).toBeLessThan(0.85);
    expect(result.autoConfirmEligibleIds).toEqual([]);
    expect(result.autoConfirmIds).toEqual([]);
  });
});
