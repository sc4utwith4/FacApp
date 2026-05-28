import { describe, expect, it } from 'vitest';

import {
  getCategoriaOperacionalLabel,
  getLancamentoCategoriaOperacional,
  inferOperacaoByText,
  isTransferenciaByObservacao,
  normalizeTextForMatch,
} from '@/lib/lancamentos/categoria-operacional';
import type { LancamentoOrigem } from '@/types/lancamentos';

describe('categoria-operacional', () => {
  it('normaliza texto com acentos', () => {
    expect(normalizeTextForMatch('  Devolução Operação  ')).toBe('devolucao operacao');
  });

  it('detecta movimentação por observação', () => {
    expect(isTransferenciaByObservacao('Transferência Conta → Conta')).toBe(true);
    expect(isTransferenciaByObservacao('Movimentação de estoque')).toBe(true);
    expect(isTransferenciaByObservacao('Pagamento fornecedor')).toBe(false);
  });

  it('detecta fallback de operação por histórico/observações', () => {
    expect(inferOperacaoByText('Operação SPPRO #123', null)).toBe(true);
    expect(inferOperacaoByText('Distribuição Operação #88', null)).toBe(true);
    expect(inferOperacaoByText(null, 'Distribuição do líquido da operação de estoque')).toBe(true);
    expect(inferOperacaoByText('Pagamento de título', 'Outras observações')).toBe(false);
  });

  it('respeita prioridade: movimentação > devolução > recompra > operação > entrada/saída', () => {
    const origemDevolucao: LancamentoOrigem = { tipo: 'devolucao_estoque', label: 'Devolução de estoque' };
    const categoria = getLancamentoCategoriaOperacional(
      {
        tipo: 'saida',
        historico: 'Devolução Operação #10',
        observacoes: 'Transferência Conta → Estoque',
        _isMovimentacao: true,
      },
      origemDevolucao,
    );

    expect(categoria).toBe('movimentacao');
  });

  it('classifica devolução por origem determinística', () => {
    const origem: LancamentoOrigem = { tipo: 'devolucao_estoque', label: 'Devolução de estoque' };
    expect(
      getLancamentoCategoriaOperacional(
        { tipo: 'saida', historico: 'Pagamento', observacoes: null },
        origem,
      ),
    ).toBe('devolucao');
  });

  it('classifica recompra por origem determinística', () => {
    const origem: LancamentoOrigem = { tipo: 'recompra_estoque', label: 'Recompra de estoque' };
    expect(
      getLancamentoCategoriaOperacional(
        { tipo: 'saida', historico: 'Pagamento', observacoes: null },
        origem,
      ),
    ).toBe('recompra');
  });

  it('classifica operação por fallback textual quando origem ainda é manual', () => {
    expect(
      getLancamentoCategoriaOperacional(
        {
          tipo: 'saida',
          historico: 'Operação SOI #57',
          observacoes: 'Operação de estoque SOI',
        },
        { tipo: 'manual', label: 'Manual' },
      ),
    ).toBe('operacao');
  });

  it('mantém entrada/saída para previsto pago', () => {
    expect(
      getLancamentoCategoriaOperacional(
        { tipo: 'entrada', historico: 'Previsto pago', observacoes: null },
        { tipo: 'previsto_pago', label: 'Previsto pago' },
      ),
    ).toBe('entrada');

    expect(
      getLancamentoCategoriaOperacional(
        { tipo: 'saida', historico: 'Previsto pago', observacoes: null },
        { tipo: 'previsto_pago', label: 'Previsto pago' },
      ),
    ).toBe('saida');
  });

  it('não promove previsto pago para operação por texto', () => {
    expect(
      getLancamentoCategoriaOperacional(
        {
          tipo: 'saida',
          historico: 'Operação SPPRO #901',
          observacoes: 'Distribuição do líquido da operação de estoque',
        },
        { tipo: 'previsto_pago', label: 'Previsto pago' },
      ),
    ).toBe('saida');
  });

  it('retorna label amigável da categoria', () => {
    expect(getCategoriaOperacionalLabel('movimentacao')).toBe('Movimentação');
    expect(getCategoriaOperacionalLabel('recompra')).toBe('Recompra');
  });
});
