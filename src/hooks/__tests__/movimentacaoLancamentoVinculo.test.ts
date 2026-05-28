import { describe, expect, it } from 'vitest';

import {
  appendMovimentacaoLancamentoVinculo,
  buildMovimentacaoLancamentoVinculo,
  extractMovimentacaoLancamentoVinculoIds,
  filterLancamentosByMovimentacaoVinculo,
  hasMovimentacaoLancamentoVinculo,
} from '../movimentacaoLancamentoVinculo';

describe('movimentacaoLancamentoVinculo', () => {
  it('gera tag determinística de vínculo', () => {
    expect(buildMovimentacaoLancamentoVinculo(123)).toBe('movimentacao_estoque_id:123');
  });

  it('anexa vínculo sem duplicar observações existentes', () => {
    const first = appendMovimentacaoLancamentoVinculo('Transferência Conta → Estoque', 55);
    const second = appendMovimentacaoLancamentoVinculo(first, 55);

    expect(first).toContain('movimentacao_estoque_id:55');
    expect(second).toBe(first);
  });

  it('evita exclusão cruzada: id 101 não pode casar com 1010', () => {
    const lancamentos = [
      { id: 'a', observacoes: 'Transferência | movimentacao_estoque_id:101' },
      { id: 'b', observacoes: 'Transferência | movimentacao_estoque_id:1010' },
      { id: 'c', observacoes: 'Texto sem vínculo' },
    ];

    const filtrados = filterLancamentosByMovimentacaoVinculo(lancamentos, 101);
    expect(filtrados.map((l) => l.id)).toEqual(['a']);
  });

  it('valida presença exata do vínculo no lançamento correto', () => {
    expect(hasMovimentacaoLancamentoVinculo('x | movimentacao_estoque_id:42', 42)).toBe(true);
    expect(hasMovimentacaoLancamentoVinculo('x | movimentacao_estoque_id:420', 42)).toBe(false);
    expect(hasMovimentacaoLancamentoVinculo(null, 42)).toBe(false);
  });

  it('extrai ids vinculados sem duplicar tags repetidas', () => {
    expect(
      extractMovimentacaoLancamentoVinculoIds(
        'Transferência | movimentacao_estoque_id:42 | movimentacao_estoque_id:420 | movimentacao_estoque_id:42',
      ),
    ).toEqual([42, 420]);
    expect(extractMovimentacaoLancamentoVinculoIds(null)).toEqual([]);
  });
});
