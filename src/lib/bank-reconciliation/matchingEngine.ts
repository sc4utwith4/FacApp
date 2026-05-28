import type {
  ExtratoTransacaoRow,
  MatchScoreDetail,
  MatchingLancamentoCandidate,
  MatchingSuggestion,
} from '../../types/bank-reconciliation.js';

const normalize = (value: string): string => {
  let text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // Remover prefixos bancários comuns para melhorar o matching de texto puro
  const prefixes = [
    'pix recebido', 'pix enviado', 'ted', 'doc', 'pagamento', 'pagto',
    'deposito', 'redeb2b', 'transf', 'cheque', 'tarifa', 'tar', 'rendimento'
  ];

  for (const prefix of prefixes) {
    if (text.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
    }
  }

  return text
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const toDate = (value: string): Date => new Date(`${value}T00:00:00`);

const getDaysDiff = (a: string, b: string): number => {
  const diffMs = Math.abs(toDate(a).getTime() - toDate(b).getTime());
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
};

const getTokens = (value: string): Set<string> => {
  const text = normalize(value);
  if (!text) return new Set();
  return new Set(text.split(' ').filter(Boolean));
};

const jaccardSimilarity = (a: string, b: string): number => {
  const tokensA = getTokens(a);
  const tokensB = getTokens(b);

  if (!tokensA.size || !tokensB.size) return 0;

  const intersection = [...tokensA].filter((token) => tokensB.has(token)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union > 0 ? intersection / union : 0;
};

const expectedLancamentoType = (tipoExtrato: ExtratoTransacaoRow['tipo']): 'entrada' | 'saida' | 'both' => {
  if (tipoExtrato === 'credit') return 'entrada';
  if (tipoExtrato === 'debit') return 'saida';
  return 'both';
};

const scoreAmount = (extratoCentavos: number, lancamentoValor: number): number => {
  const lancamentoCentavos = Math.round(Math.abs(Number(lancamentoValor || 0)) * 100);
  const diff = Math.abs(extratoCentavos - lancamentoCentavos);

  if (diff === 0) return 1;
  if (diff <= 1) return 0.8;
  return 0;
};

const scoreDate = (dataExtrato: string, dataLancamento: string): number => {
  const diff = getDaysDiff(dataExtrato, dataLancamento);
  if (diff === 0) return 1;
  if (diff === 1) return 0.8;
  if (diff === 2) return 0.6;
  return 0;
};

const scoreText = (extratoDescricao: string, lancamentoHistorico: string | null, lancamentoDocumento: string | null): number => {
  const fromHistorico = jaccardSimilarity(extratoDescricao, lancamentoHistorico || '');
  const fromDocumento = lancamentoDocumento
    ? jaccardSimilarity(extratoDescricao, String(lancamentoDocumento)) * 0.6
    : 0;

  const best = Math.max(fromHistorico, fromDocumento);
  return Math.max(0, Math.min(1, best));
};

export const calculateMatchScore = (
  extrato: Pick<ExtratoTransacaoRow, 'data_movimento' | 'valor_centavos' | 'descricao_norm'>,
  lancamento: Pick<MatchingLancamentoCandidate, 'data' | 'valor' | 'historico' | 'documento'>
): MatchScoreDetail => {
  const amountScore = scoreAmount(extrato.valor_centavos, lancamento.valor);
  const dateScore = scoreDate(extrato.data_movimento, lancamento.data);
  const textScore = scoreText(extrato.descricao_norm, lancamento.historico, lancamento.documento);

  // Se o valor for idêntico, damos mais peso ao texto para diferenciar entre lançamentos do mesmo valor
  const isExactAmount = amountScore === 1;
  const weights = isExactAmount
    ? { amount: 0.4, date: 0.2, text: 0.4 }
    : { amount: 0.5, date: 0.3, text: 0.2 };

  const finalScore = Number(
    (amountScore * weights.amount + dateScore * weights.date + textScore * weights.text).toFixed(4)
  );

  return {
    amount_score: amountScore,
    date_score: dateScore,
    text_score: Number(textScore.toFixed(4)),
    final_score: finalScore,
  };
};

export interface DeterministicMatchingOptions {
  dateWindowDays?: number;
  autoConfirmThreshold?: number;
  uniqueGapThreshold?: number;
  minSuggestedScore?: number;
  autoConfirmTextThreshold?: number;
  autoConfirmRequireExactAmount?: boolean;
}

export interface DeterministicMatchResult {
  suggestions: MatchingSuggestion[];
  autoConfirmIds: string[];
  autoConfirmEligibleIds: string[];
}

const defaultOptions: Required<DeterministicMatchingOptions> = {
  dateWindowDays: 2,
  autoConfirmThreshold: 0.95,
  uniqueGapThreshold: 0.12,
  minSuggestedScore: 0.62,
  autoConfirmTextThreshold: 0.85,
  autoConfirmRequireExactAmount: true,
};

export const explainSuggestion = (
  extrato: Pick<ExtratoTransacaoRow, 'tipo' | 'valor_centavos' | 'data_movimento'>,
  lancamento: Pick<MatchingLancamentoCandidate, 'tipo' | 'data' | 'valor'>,
  score: MatchScoreDetail
): string => {
  const expectedType = expectedLancamentoType(extrato.tipo);
  const lancamentoCentavos = Math.round(Math.abs(lancamento.valor) * 100);

  return [
    `tipo esperado=${expectedType}, tipo lancamento=${lancamento.tipo}`,
    `valor extrato=${extrato.valor_centavos}, valor lancamento=${lancamentoCentavos}`,
    `data extrato=${extrato.data_movimento}, data lancamento=${lancamento.data}`,
    `scores amount=${score.amount_score.toFixed(2)} date=${score.date_score.toFixed(2)} text=${score.text_score.toFixed(2)}`,
  ].join(' | ');
};

export function buildDeterministicMatches(
  extrato: ExtratoTransacaoRow,
  lancamentos: MatchingLancamentoCandidate[],
  options: DeterministicMatchingOptions = {}
): DeterministicMatchResult {
  const config = { ...defaultOptions, ...options };
  const targetType = expectedLancamentoType(extrato.tipo);

  const candidates = lancamentos.filter((candidate) => {
    if (!candidate.conta_bancaria_id || candidate.conta_bancaria_id !== extrato.conta_bancaria_id) {
      return false;
    }

    if (targetType !== 'both' && candidate.tipo !== targetType) {
      return false;
    }

    const diffDays = getDaysDiff(extrato.data_movimento, candidate.data);
    if (diffDays > config.dateWindowDays) {
      return false;
    }

    const amountScore = scoreAmount(extrato.valor_centavos, candidate.valor);
    return amountScore > 0;
  });

  const suggestions = candidates
    .map((candidate) => {
      const score = calculateMatchScore(extrato, candidate);
      return {
        extrato_transacao_id: extrato.id,
        lancamento_caixa_id: candidate.id,
        confidence: score.final_score,
        method: 'deterministic' as const,
        explanation: explainSuggestion(extrato, candidate, score),
        score,
      };
    })
    .filter((suggestion) => suggestion.confidence >= config.minSuggestedScore)
    .sort((a, b) => b.confidence - a.confidence);

  const autoConfirmEligibleIds = suggestions
    .filter((suggestion) => {
      const hasExactAmount = suggestion.score.amount_score === 1;
      const amountEligible = config.autoConfirmRequireExactAmount ? hasExactAmount : suggestion.score.amount_score > 0;
      if (!amountEligible) return false;
      return suggestion.score.text_score >= config.autoConfirmTextThreshold;
    })
    .map((suggestion) => suggestion.lancamento_caixa_id);

  const autoConfirmIds: string[] = [];
  if (autoConfirmEligibleIds.length === 1) {
    autoConfirmIds.push(autoConfirmEligibleIds[0]);
  }

  return {
    suggestions,
    autoConfirmIds,
    autoConfirmEligibleIds,
  };
}
