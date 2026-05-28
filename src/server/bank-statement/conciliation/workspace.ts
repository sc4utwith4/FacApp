import { calculateMatchScore } from '../../../lib/bank-reconciliation/matchingEngine.js';
import type {
  BankTransactionType,
  ConciliacaoItemOrigem,
  ConciliationCandidateSearchResult,
  MatchingLancamentoCandidate,
} from '../../../types/bank-reconciliation.js';

export interface WorkspaceTransactionSnapshot {
  id: string;
  conta_bancaria_id: string;
  data_movimento: string;
  descricao_raw: string;
  descricao_norm: string;
  valor_centavos: number;
  tipo: BankTransactionType;
}

const normalize = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const expectedDirection = (tipoExtrato: BankTransactionType): 'entrada' | 'saida' | 'both' => {
  if (tipoExtrato === 'credit') return 'entrada';
  if (tipoExtrato === 'debit') return 'saida';
  return 'both';
};

export const classifyWorkspacePattern = (descricao: string): { key: string; label: string } => {
  const normalized = normalize(descricao);

  if (normalized.includes('pix')) return { key: 'pix', label: 'Transferências PIX' };
  if (normalized.includes('tarifa')) return { key: 'tarifa', label: 'Tarifas bancárias' };
  if (normalized.includes('cobranca')) return { key: 'cobranca', label: 'Cobranças e liquidações' };
  if (normalized.includes('cheque')) return { key: 'cheque', label: 'Cheques e devoluções' };
  if (normalized.includes('deposito') || normalized.includes('dep chq')) {
    return { key: 'deposito', label: 'Depósitos' };
  }
  if (normalized.includes('liquidacao')) return { key: 'liquidacao', label: 'Liquidações' };

  return { key: 'outros', label: 'Outras pendências' };
};

export const toCandidateSearchResult = (
  tx: WorkspaceTransactionSnapshot,
  candidate: MatchingLancamentoCandidate
): ConciliationCandidateSearchResult => {
  const score = calculateMatchScore(tx, candidate);
  const candidateCentavos = Math.round(Math.abs(Number(candidate.valor || 0)) * 100);
  const exactAmountMatch = Math.abs(candidateCentavos) === Math.abs(Number(tx.valor_centavos || 0));
  const exactDateMatch = String(candidate.data || '').slice(0, 10) === String(tx.data_movimento || '').slice(0, 10);
  const targetDirection = expectedDirection(tx.tipo);
  const exactDirectionMatch = targetDirection === 'both' ? true : candidate.tipo === targetDirection;
  const strictMatch = exactAmountMatch && exactDateMatch && exactDirectionMatch;

  return {
    item_financeiro_id: String(candidate.item_financeiro_id || candidate.id || ''),
    lancamento_caixa_id: candidate.origem_tipo === 'lancamento_caixa' ? candidate.origem_id_uuid || null : null,
    origem_tipo: (candidate.origem_tipo || null) as ConciliacaoItemOrigem | null,
    data: candidate.data,
    tipo: candidate.tipo,
    valor_centavos: candidateCentavos,
    descricao: candidate.historico || candidate.documento || String(candidate.id || ''),
    documento: candidate.documento || null,
    score: score.final_score,
    exact_amount_match: exactAmountMatch,
    exact_date_match: exactDateMatch,
    exact_direction_match: exactDirectionMatch,
    strict_value_date_direction_match: strictMatch,
  };
};

export const sortCandidatesForWorkspace = (
  tx: WorkspaceTransactionSnapshot,
  candidates: MatchingLancamentoCandidate[]
): ConciliationCandidateSearchResult[] => {
  return candidates
    .map((candidate) => toCandidateSearchResult(tx, candidate))
    .sort((a, b) => {
      const aStrict = a.strict_value_date_direction_match ? 1 : 0;
      const bStrict = b.strict_value_date_direction_match ? 1 : 0;
      if (aStrict !== bStrict) return bStrict - aStrict;

      const aAmount = a.exact_amount_match ? 1 : 0;
      const bAmount = b.exact_amount_match ? 1 : 0;
      if (aAmount !== bAmount) return bAmount - aAmount;

      const aDate = a.exact_date_match ? 1 : 0;
      const bDate = b.exact_date_match ? 1 : 0;
      if (aDate !== bDate) return bDate - aDate;

      return b.score - a.score;
    });
};

export const expectedWorkspaceDirection = expectedDirection;
