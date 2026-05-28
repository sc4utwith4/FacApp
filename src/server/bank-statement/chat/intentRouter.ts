export type ChatIntentKind =
  | 'confirm_pending_action'
  | 'cancel_pending_action'
  | 'resolve_pending_issues'
  | 'execution_status_query'
  | 'execution_details_query'
  | 'update_plan_status'
  | 'matching'
  | 'trigger_ai'
  | 'refresh_summary'
  | 'run_daily_reconciliation'
  | 'apply_reconciliation_plan'
  | 'daily_close'
  | 'daily_reopen'
  | 'question';

export interface ChatIntentResult {
  kind: ChatIntentKind;
  confidence: number;
  reason: string;
}

const normalize = (value: string): string => {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
};

const tokenize = (normalized: string): string[] => {
  return normalized.split(/[^a-z0-9]+/).map((t) => t.trim()).filter(Boolean);
};

const hasPhrase = (text: string, phrase: string): boolean => text.includes(phrase);

const hasAnyPhrase = (text: string, phrases: string[]): boolean => phrases.some((p) => hasPhrase(text, p));

const hasWord = (tokens: string[], word: string): boolean => tokens.includes(word);

const hasAnyWord = (tokens: string[], words: string[]): boolean => words.some((w) => hasWord(tokens, w));

const hasStem = (text: string, stems: string[]): boolean => stems.some((stem) => text.includes(stem));

const hasConciliacaoStem = (text: string): boolean =>
  /(concili|concial)/.test(text);

export function routeBankChatIntent(message: string): ChatIntentResult {
  const normalized = normalize(message || '');
  const tokens = tokenize(normalized);

  if (!normalized) {
    return { kind: 'question', confidence: 0.1, reason: 'mensagem vazia' };
  }

  const wantsCancelPendingAction =
    ['cancelar', 'cancela', 'nao', 'não'].includes(normalized) ||
    hasAnyPhrase(normalized, ['cancelar acao', 'cancelar ação', 'nao executar', 'não executar']);
  if (wantsCancelPendingAction) {
    return { kind: 'cancel_pending_action', confidence: 0.95, reason: 'cancelamento textual de ação' };
  }

  const wantsConfirmPendingAction =
    ['confirmo', 'sim', 'executa', 'pode executar', 'sim executar', 'sim, executar', 'pode executar agora'].includes(
      normalized
    ) || hasAnyPhrase(normalized, ['confirmar acao', 'confirmar ação']);
  if (wantsConfirmPendingAction) {
    return { kind: 'confirm_pending_action', confidence: 0.95, reason: 'confirmação textual de ação' };
  }

  const wantsExecutionDetails =
    normalized === 'detalhe' ||
    normalized === 'detalhes' ||
    hasAnyPhrase(normalized, [
      'resumo detalhado',
      'resumo detalhado do que executou',
      'me passe um resumo detalhado',
      'o que foi feito',
      'o que executou',
    ]);
  if (wantsExecutionDetails) {
    return { kind: 'execution_details_query', confidence: 0.9, reason: 'follow-up pedindo detalhes da execução' };
  }

  const wantsExecutionStatus =
    hasAnyPhrase(normalized, ['executou', 'deu certo', 'foi executado', 'executou?', 'deu certo?']) ||
    (hasAnyWord(tokens, ['status']) && hasAnyWord(tokens, ['execucao', 'execucao?']));
  if (wantsExecutionStatus) {
    return { kind: 'execution_status_query', confidence: 0.88, reason: 'follow-up pedindo status da execução' };
  }

  const wantsUpdatePlanStatus =
    hasAnyPhrase(normalized, ['atualizar plano', 'atualiza plano', 'status da ia', 'status ia']) ||
    (hasWord(tokens, 'atualizar') && hasWord(tokens, 'plano'));
  if (wantsUpdatePlanStatus) {
    return { kind: 'update_plan_status', confidence: 0.9, reason: 'atualização de status/plano da IA' };
  }

  const wantsResolvePendingIssues =
    ((hasStem(normalized, ['corrig', 'corrij', 'resolv', 'arrum']) &&
      hasStem(normalized, ['pendenc', 'divergenc'])) ||
      hasAnyPhrase(normalized, [
        'corrigir pendencia',
        'corrigir pendencias',
        'corrija pendencia',
        'corrija pendencias',
        'resolver pendencia',
        'resolver pendencias',
        'arrumar pendencia',
        'arrumar pendencias',
        'corrigir divergencia',
        'corrigir divergencias',
      ]));
  if (wantsResolvePendingIssues) {
    return { kind: 'resolve_pending_issues', confidence: 0.9, reason: 'resolver/corrigir pendências' };
  }

  if (hasStem(normalized, ['reabr']) && hasAnyWord(tokens, ['dia', 'fechamento'])) {
    return { kind: 'daily_reopen', confidence: 0.93, reason: 'reabrir dia/fechamento' };
  }

  if (hasStem(normalized, ['fech', 'encerr']) && hasAnyWord(tokens, ['dia', 'fechamento'])) {
    return { kind: 'daily_close', confidence: 0.93, reason: 'fechar dia/fechamento' };
  }

  const wantsApplyPlan =
    hasAnyPhrase(normalized, ['aplicar plano', 'executar plano', 'confirmar plano']) ||
    (hasWord(tokens, 'plano') && hasAnyWord(tokens, ['aplicar', 'executar', 'confirmar']));
  if (wantsApplyPlan) {
    return { kind: 'apply_reconciliation_plan', confidence: 0.92, reason: 'aplicar plano de conciliação' };
  }

  const wantsRunDailyReconciliation =
    hasConciliacaoStem(normalized) &&
    (hasAnyWord(tokens, ['dia', 'hoje', 'extrato']) || hasStem(normalized, ['execut', 'rodar', 'inici', 'faz']));
  if (wantsRunDailyReconciliation) {
    return { kind: 'run_daily_reconciliation', confidence: 0.91, reason: 'conciliação diária operacional' };
  }

  const wantsMatching =
    (hasAnyWord(tokens, ['matching']) ||
      hasAnyPhrase(normalized, [
        'executar matching',
        'rodar matching',
        'executar vinculacao',
        'rodar vinculacao',
        'executar vinculacao automatica',
      ])) ||
    ((hasAnyWord(tokens, ['casar', 'ligar', 'vincular']) || hasStem(normalized, ['vincul'])) &&
      hasStem(normalized, ['execut', 'rodar', 'dispar', 'inici']));
  if (wantsMatching) {
    return {
      kind: 'run_daily_reconciliation',
      confidence: 0.92,
      reason: 'intenção legada de matching roteada para conciliar (fluxo canônico)',
    };
  }

  const wantsAiTrigger =
    hasAnyPhrase(normalized, ['disparar ia', 'rodar ia', 'executar ia']) ||
    (hasAnyWord(tokens, ['ia', 'ai', 'n8n', 'workflow']) && hasStem(normalized, ['dispar', 'execut', 'rodar', 'inici']));
  if (wantsAiTrigger) {
    return {
      kind: 'run_daily_reconciliation',
      confidence: 0.9,
      reason: 'intenção legada de trigger IA roteada para conciliar (fluxo canônico)',
    };
  }

  const wantsSummaryRefresh =
    hasAnyPhrase(normalized, ['atualizar resumo', 'recalcular resumo', 'resumo do dia']) &&
    hasStem(normalized, ['atual', 'recalcul', 'rodar', 'execut', 'mostrar']);
  if (wantsSummaryRefresh) {
    return { kind: 'refresh_summary', confidence: 0.86, reason: 'atualização de resumo diário' };
  }

  if (hasStem(normalized, ['pendent', 'divergenc', 'status', 'resum', 'extrat', 'lancament'])) {
    return { kind: 'question', confidence: 0.8, reason: 'mensagem analítica sobre contexto da conciliação' };
  }

  return {
    kind: 'question',
    confidence: 0.6,
    reason: 'mensagem geral sem intenção operacional explícita',
  };
}
