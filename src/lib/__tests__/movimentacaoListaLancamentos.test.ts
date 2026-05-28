import { describe, expect, it } from 'vitest';
import { isMovimentacaoTipoRedundanteNaListaMista } from '../movimentacaoListaLancamentos';

describe('isMovimentacaoTipoRedundanteNaListaMista', () => {
  it('exclui os três tipos cobertos por lancamentos_caixa', () => {
    expect(isMovimentacaoTipoRedundanteNaListaMista('conta_para_conta')).toBe(true);
    expect(isMovimentacaoTipoRedundanteNaListaMista('conta_para_estoque')).toBe(true);
    expect(isMovimentacaoTipoRedundanteNaListaMista('estoque_para_conta')).toBe(true);
  });

  it('normaliza espaços (evidência: API pode devolver string suja)', () => {
    expect(isMovimentacaoTipoRedundanteNaListaMista('  conta_para_conta  ')).toBe(true);
    expect(isMovimentacaoTipoRedundanteNaListaMista('\tconta_para_estoque\n')).toBe(true);
  });

  it('mantém tipos que devem aparecer como sintéticos na lista mista', () => {
    expect(isMovimentacaoTipoRedundanteNaListaMista('estoque_para_estoque')).toBe(false);
    expect(isMovimentacaoTipoRedundanteNaListaMista('distribuicao_conta')).toBe(false);
    expect(isMovimentacaoTipoRedundanteNaListaMista(null)).toBe(false);
    expect(isMovimentacaoTipoRedundanteNaListaMista('')).toBe(false);
  });
});
