export const MOVIMENTACAO_LANCAMENTO_VINCULO_PREFIX = 'movimentacao_estoque_id:';

export type LancamentoComObservacao = {
  id: string;
  observacoes?: string | null;
};

export function buildMovimentacaoLancamentoVinculo(movimentacaoId: number): string {
  return `${MOVIMENTACAO_LANCAMENTO_VINCULO_PREFIX}${movimentacaoId}`;
}

export function appendMovimentacaoLancamentoVinculo(
  observacoes: string | null | undefined,
  movimentacaoId: number,
): string {
  const tag = buildMovimentacaoLancamentoVinculo(movimentacaoId);
  const base = observacoes?.trim() ?? '';
  if (!base) {
    return tag;
  }
  if (hasMovimentacaoLancamentoVinculo(base, movimentacaoId)) {
    return base;
  }
  return `${base} | ${tag}`;
}

export function hasMovimentacaoLancamentoVinculo(
  observacoes: string | null | undefined,
  movimentacaoId: number,
): boolean {
  if (!observacoes) {
    return false;
  }
  const escapedTag = buildMovimentacaoLancamentoVinculo(movimentacaoId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapedTag}(?!\\d)`);
  return pattern.test(observacoes);
}

export function extractMovimentacaoLancamentoVinculoIds(
  observacoes: string | null | undefined,
): number[] {
  if (!observacoes) {
    return [];
  }

  const ids = new Set<number>();
  const pattern = new RegExp(`${MOVIMENTACAO_LANCAMENTO_VINCULO_PREFIX}(\\d+)(?!\\d)`, 'g');
  let match = pattern.exec(observacoes);

  while (match) {
    ids.add(Number(match[1]));
    match = pattern.exec(observacoes);
  }

  return Array.from(ids);
}

export function filterLancamentosByMovimentacaoVinculo<T extends LancamentoComObservacao>(
  lancamentos: T[],
  movimentacaoId: number,
): T[] {
  return lancamentos.filter((lancamento) =>
    hasMovimentacaoLancamentoVinculo(lancamento.observacoes, movimentacaoId),
  );
}
