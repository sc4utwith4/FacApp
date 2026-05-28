/**
 * Movimentações que também geram linhas em lancamentos_caixa para o mesmo efeito em conta:
 * não devem ser duplicadas na lista mista de Lançamentos.
 */
export const TIPOS_MOVIMENTACAO_JA_EM_LANCAMENTOS_CAIXA = [
  'conta_para_conta',
  'conta_para_estoque',
  'estoque_para_conta',
] as const;

/** true se esta movimentação não deve aparecer como linha sintética na lista mista (já coberta por caixa). */
export function isMovimentacaoTipoRedundanteNaListaMista(tipo: unknown): boolean {
  const t = String(tipo ?? '').trim();
  return (TIPOS_MOVIMENTACAO_JA_EM_LANCAMENTOS_CAIXA as readonly string[]).includes(t);
}
