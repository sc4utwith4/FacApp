import type {
  LancamentoCategoriaOperacional,
  LancamentoOrigem,
  LancamentoOrigemTipo,
} from "@/types/lancamentos";

export interface LancamentoClassificavel {
  tipo?: "entrada" | "saida" | string | null;
  historico?: string | null;
  observacoes?: string | null;
  _isMovimentacao?: boolean;
}

const MOVIMENTACAO_ORIGENS = new Set<LancamentoOrigemTipo>(["movimentacao"]);
const DEVOLUCAO_ORIGENS = new Set<LancamentoOrigemTipo>(["devolucao_estoque"]);
const RECOMPRA_ORIGENS = new Set<LancamentoOrigemTipo>(["recompra_estoque"]);
const OPERACAO_ORIGENS = new Set<LancamentoOrigemTipo>(["operacao_estoque"]);

const DEVOLUCAO_PATTERNS = [/devolucao\s+operacao/, /devolucao\s+de\s+operacao/];
const RECOMPRA_PATTERNS = [
  /recompra\s+operacao/,
  /pagamento\s+recompra/,
  /recompra\s+da\s+operacao\s+de\s+estoque/,
  /pagamento\s+da\s+recompra/,
];
const OPERACAO_HISTORICO_PATTERNS = [
  /operacao\s+sppro\s*#/,
  /operacao\s+soi\s*#/,
  /distribuicao\s+operacao\s*#/,
];
const OPERACAO_OBSERVACOES_PATTERNS = [
  /operacao\s+de\s+estoque/,
  /distribuicao\s+do\s+liquido\s+da\s+operacao\s+de\s+estoque/,
];
const MOVIMENTACAO_OBSERVACOES_PATTERNS = [
  /transferencia/,
  /movimentacao\s+de\s+estoque/,
  /movimentacao\s+conta/,
];

export function normalizeTextForMatch(text?: string | null): string {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hasAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function isTransferenciaByObservacao(observacoes?: string | null): boolean {
  const normalized = normalizeTextForMatch(observacoes);
  if (!normalized) return false;
  return hasAnyPattern(normalized, MOVIMENTACAO_OBSERVACOES_PATTERNS);
}

export function inferOperacaoByText(
  historico?: string | null,
  observacoes?: string | null,
): boolean {
  const normalizedHistorico = normalizeTextForMatch(historico);
  const normalizedObservacoes = normalizeTextForMatch(observacoes);

  return (
    hasAnyPattern(normalizedHistorico, OPERACAO_HISTORICO_PATTERNS) ||
    hasAnyPattern(normalizedObservacoes, OPERACAO_OBSERVACOES_PATTERNS)
  );
}

function inferByText(
  historico?: string | null,
  observacoes?: string | null,
): LancamentoCategoriaOperacional | null {
  const normalizedHistorico = normalizeTextForMatch(historico);
  const normalizedObservacoes = normalizeTextForMatch(observacoes);

  if (hasAnyPattern(normalizedHistorico, DEVOLUCAO_PATTERNS)) {
    return "devolucao";
  }

  if (
    hasAnyPattern(normalizedHistorico, RECOMPRA_PATTERNS) ||
    hasAnyPattern(normalizedObservacoes, RECOMPRA_PATTERNS)
  ) {
    return "recompra";
  }

  if (
    hasAnyPattern(normalizedObservacoes, MOVIMENTACAO_OBSERVACOES_PATTERNS) ||
    hasAnyPattern(normalizedHistorico, [/transferencia/])
  ) {
    return "movimentacao";
  }

  if (
    hasAnyPattern(normalizedHistorico, OPERACAO_HISTORICO_PATTERNS) ||
    hasAnyPattern(normalizedObservacoes, OPERACAO_OBSERVACOES_PATTERNS)
  ) {
    return "operacao";
  }

  return null;
}

export function getLancamentoCategoriaOperacional(
  lancamento: LancamentoClassificavel,
  origem?: LancamentoOrigem | null,
): LancamentoCategoriaOperacional {
  const origemTipo = origem?.tipo;
  const categoriaBase = lancamento.tipo === "entrada" ? "entrada" : "saida";

  if (lancamento._isMovimentacao || (origemTipo && MOVIMENTACAO_ORIGENS.has(origemTipo))) {
    return "movimentacao";
  }

  if (origemTipo && DEVOLUCAO_ORIGENS.has(origemTipo)) {
    return "devolucao";
  }

  if (origemTipo && RECOMPRA_ORIGENS.has(origemTipo)) {
    return "recompra";
  }

  if (origemTipo && OPERACAO_ORIGENS.has(origemTipo)) {
    return "operacao";
  }

  // "previsto_pago" permanece entrada/saida e não deve ser promovido para operação via fallback textual.
  if (origemTipo === "previsto_pago") {
    return categoriaBase;
  }

  const categoriaPorTexto = inferByText(lancamento.historico, lancamento.observacoes);

  if (
    categoriaPorTexto === "movimentacao" ||
    isTransferenciaByObservacao(lancamento.observacoes)
  ) {
    return "movimentacao";
  }

  if (categoriaPorTexto === "devolucao") {
    return "devolucao";
  }

  if (categoriaPorTexto === "recompra") {
    return "recompra";
  }

  if (categoriaPorTexto === "operacao") {
    return "operacao";
  }

  return categoriaBase;
}

export function getCategoriaOperacionalLabel(categoria: LancamentoCategoriaOperacional): string {
  switch (categoria) {
    case "entrada":
      return "Entrada";
    case "saida":
      return "Saída";
    case "movimentacao":
      return "Movimentação";
    case "devolucao":
      return "Devolução";
    case "recompra":
      return "Recompra";
    case "operacao":
      return "Operação";
    default:
      return "Saída";
  }
}
