import type {
  BankTransactionType,
  ExtratoTransacaoRow,
  ReconciliationRuleRow,
  RuleDirection,
} from '../../types/bank-reconciliation.js';

const normalize = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const resolveDirection = (txType: BankTransactionType): Exclude<RuleDirection, 'both'> | 'other' => {
  if (txType === 'credit') return 'credit';
  if (txType === 'debit') return 'debit';
  return 'other';
};

const isDirectionCompatible = (ruleDirection: RuleDirection, txType: BankTransactionType): boolean => {
  if (ruleDirection === 'both') return true;
  return resolveDirection(txType) === ruleDirection;
};

const safeRegexTest = (pattern: string, value: string): boolean => {
  try {
    const regex = new RegExp(pattern, 'i');
    return regex.test(value);
  } catch {
    return false;
  }
};

export interface RuleMatchResult {
  matched: boolean;
  reason: string;
}

export const doesRuleMatchTransaction = (
  rule: Pick<ReconciliationRuleRow, 'match_type' | 'pattern' | 'direction'>,
  tx: Pick<ExtratoTransacaoRow, 'descricao_raw' | 'descricao_norm' | 'tipo'>
): RuleMatchResult => {
  const normalizedPattern = normalize(rule.pattern);
  const normalizedRaw = normalize(tx.descricao_raw);
  const normalizedNorm = normalize(tx.descricao_norm);
  const target = normalizedNorm || normalizedRaw;

  if (!normalizedPattern) {
    return {
      matched: false,
      reason: 'pattern vazio',
    };
  }

  if (!isDirectionCompatible(rule.direction, tx.tipo)) {
    return {
      matched: false,
      reason: 'direction nao compativel',
    };
  }

  switch (rule.match_type) {
    case 'contains':
      return {
        matched: target.includes(normalizedPattern),
        reason: 'contains',
      };
    case 'startswith':
      return {
        matched: target.startsWith(normalizedPattern),
        reason: 'startswith',
      };
    case 'exact':
      return {
        matched: target === normalizedPattern,
        reason: 'exact',
      };
    case 'regex':
      return {
        matched: safeRegexTest(rule.pattern, tx.descricao_raw) || safeRegexTest(rule.pattern, tx.descricao_norm),
        reason: 'regex',
      };
    default:
      return {
        matched: false,
        reason: 'match_type invalido',
      };
  }
};

export const getFirstMatchingRule = (
  tx: Pick<ExtratoTransacaoRow, 'descricao_raw' | 'descricao_norm' | 'tipo'>,
  rules: ReconciliationRuleRow[]
): ReconciliationRuleRow | null => {
  for (const rule of rules) {
    if (!rule.active) continue;
    const result = doesRuleMatchTransaction(rule, tx);
    if (result.matched) {
      return rule;
    }
  }

  return null;
};

export const inferLancamentoTipoFromTransaction = (
  txType: BankTransactionType
): 'entrada' | 'saida' => {
  return txType === 'credit' ? 'entrada' : 'saida';
};

export const normalizeRuleSearchTerm = normalize;
