import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatAiProcessingStatus,
  ChatClarifyingQuestion,
  ChatMessageInteraction,
  ChatPendingCase,
  ChatPlanConfidenceBand,
  ChatPlanSelectionMode,
  ChatReconciliationPlan,
  ChatReviewGuidance,
  RichMessageContent,
} from '../../../types/bank-reconciliation.js';
import {
  getBankAiExecutionRunByCorrelation,
  getLatestBankAiExecutionRunForContext,
  updateBankAiExecutionRunStatus,
  type BankAiExecutionRunRow,
} from '../aiExecutionRuns.js';
import {
  getErrorMessage,
  isBankReconciliationBalanceMutationDisabled,
  isBankReconciliationOfxOnlyEnabled,
  safeInsertBankAuditLog,
  validateBankReconciliationPilotScope,
} from '../_shared.js';
import {
  getReviewGuidanceSnapshot,
  loadActiveReviewQueueRows,
  loadReviewQueueItemById,
  markReviewQueueItemAsked,
  resolveReviewQueueItem,
  syncReviewQueueFromPlan,
} from './reviewQueue.js';

export type BankChatActionKind =
  | 'matching'
  | 'trigger_ai'
  | 'refresh_summary'
  | 'run_daily_reconciliation'
  | 'apply_reconciliation_plan'
  | 'daily_close'
  | 'daily_reopen';

export interface ExecuteBankChatActionArgs {
  adminClient: SupabaseClient;
  baseUrl: string;
  accessToken: string;
  empresaId: string;
  userId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId: string | null;
  sessionId?: string | null;
  action: BankChatActionKind;
  idempotencyKey: string;
  planId?: string | null;
  selectionMode?: ChatPlanSelectionMode;
  includeSuggestionIds?: string[];
  excludeSuggestionIds?: string[];
}

export interface ExecuteBankChatActionResult {
  ok: boolean;
  action: BankChatActionKind;
  idempotency_key: string;
  executed_at: string;
  result: Record<string, unknown>;
  assistant_message: string;
  rich_content?: RichMessageContent;
  execution_summary?: {
    title: string;
    message: string;
    affected_counts?: Record<string, number>;
    balance_mutation_blocked?: boolean;
    blocked_create_new_count?: number;
  };
  affected_counts?: Record<string, number>;
  reconciliation_plan?: ChatReconciliationPlan | null;
  clarifying_questions?: ChatClarifyingQuestion[] | null;
  pending_cases?: ChatPendingCase[] | null;
  ai_processing_status?: ChatAiProcessingStatus | null;
  ai_polling?: {
    attempts: number;
    elapsed_ms: number;
    outcome: 'completed' | 'timeout' | 'no_pending' | 'failed';
  } | null;
  applied_suggestion_ids?: string[];
  skipped_suggestion_ids?: string[];
  failed_items?: Array<{ suggestion_id?: string; action?: string; message: string }>;
  correlation_id?: string;
  review_guidance?: ChatReviewGuidance | null;
  ui_show_operational_cards?: boolean;
  ui_show_plan_card?: boolean;
  ui_show_guided_card?: boolean;
  reused?: boolean;
}

export interface ExecuteBankChatReviewInteractionArgs {
  adminClient: SupabaseClient;
  baseUrl: string;
  accessToken: string;
  empresaId: string;
  userId: string;
  sessionId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId: string | null;
  interaction: ChatMessageInteraction;
}

export interface ExecuteBankChatReviewInteractionResult {
  assistant_message: string;
  rich_content?: RichMessageContent;
  reconciliation_plan?: ChatReconciliationPlan | null;
  clarifying_questions?: ChatClarifyingQuestion[] | null;
  pending_cases?: ChatPendingCase[] | null;
  review_guidance?: ChatReviewGuidance | null;
  ai_processing_status?: ChatAiProcessingStatus | null;
  ui_show_operational_cards?: boolean;
  ui_show_plan_card?: boolean;
  ui_show_guided_card?: boolean;
}

type SuggestedPlanRow = {
  suggestion_id: string;
  suggestion_action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
  confidence: number | null;
  explanation: string | null;
  item_financeiro_id: string | null;
  lancamento_caixa_id: string | null;
  proposed_lancamento: Record<string, unknown> | null;
  extrato_transacao_id: string;
  extrato_valor_centavos: number;
  extrato_data_movimento: string;
  extrato_tipo: 'credit' | 'debit' | 'other';
  extrato_descricao_raw: string;
  extrato_documento_ref: string | null;
  warnings: string[] | null;
};

type AiPollingOutcome = 'completed' | 'timeout' | 'no_pending' | 'failed';

type AiPollingResult = {
  rows: SuggestedPlanRow[];
  attempts: number;
  elapsedMs: number;
  outcome: AiPollingOutcome;
  auditSignals: {
    aiSuggestionCreated: number;
    aiMatchSuggestionUpserted: number;
  };
};

type AiExecutionPollingResult = {
  run: BankAiExecutionRunRow | null;
  attempts: number;
  elapsedMs: number;
  outcome: AiPollingOutcome;
};

const sanitizeBaseUrl = (value: string): string => value.replace(/\/$/, '');
const AI_POLL_TIMEOUT_MS = 90_000;
const AI_POLL_INTERVAL_MS = 1_500;
const AI_POLL_MAX_ATTEMPTS = 60;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeString = (value: unknown): string | null => {
  const str = String(value || '').trim();
  return str || null;
};

export interface AiTriggerDispatchEvaluation {
  requestOk: boolean;
  triggered: boolean;
  dispatched: boolean;
  correlationId: string | null;
  message: string | null;
  triggerPayload: Record<string, unknown>;
}

export function evaluateAiTriggerDispatch(payload: Record<string, unknown>): AiTriggerDispatchEvaluation {
  const triggerPayload =
    payload.trigger && typeof payload.trigger === 'object'
      ? (payload.trigger as Record<string, unknown>)
      : {};
  const requestOk = payload.ok === true;
  const triggered = triggerPayload.triggered === true;
  const correlationId = safeString(payload.correlation_id) || safeString(triggerPayload.correlation_id);
  const message = safeString(triggerPayload.message) || safeString(payload.message);

  return {
    requestOk,
    triggered,
    dispatched: requestOk && triggered,
    correlationId,
    message,
    triggerPayload,
  };
}

function buildAiTriggerNotDispatchedStatus(args: {
  reason: string | null;
  correlationId?: string | null;
}): ChatAiProcessingStatus {
  return {
    state: 'failed',
    attempts: 0,
    elapsed_ms: 0,
    outcome: 'failed',
    message: args.reason || 'O workflow de IA nao foi disparado.',
    correlation_id: args.correlationId || undefined,
  };
}

function deriveAiProcessingStatusFromRun(args: {
  run: BankAiExecutionRunRow | null;
  attempts: number;
  elapsedMs: number;
  outcome: AiPollingOutcome;
  fallbackMessage?: string;
}): ChatAiProcessingStatus {
  const { run, attempts, elapsedMs, outcome, fallbackMessage } = args;
  const state = run?.status
    ? (run.status as ChatAiProcessingStatus['state'])
    : outcome === 'completed'
      ? 'completed'
      : outcome === 'no_pending'
        ? 'no_pending'
        : outcome === 'failed'
          ? 'failed'
          : 'timeout';

  const message =
    fallbackMessage ||
    (state === 'completed'
      ? 'Sugestões IA carregadas no ciclo atual.'
      : state === 'no_pending'
        ? 'IA concluiu sem gerar sugestões para este contexto.'
        : state === 'failed'
          ? (run?.error_message || 'Workflow IA falhou.')
          : state === 'processing' || state === 'triggered' || state === 'polling'
            ? 'IA ainda processando. Atualize o plano em alguns segundos.'
            : 'Tempo de espera local expirou; a IA pode continuar processando.');

  return {
    state,
    attempts,
    elapsed_ms: elapsedMs,
    outcome,
    message,
    correlation_id: run?.correlation_id || undefined,
    execution_run_id: run?.id || undefined,
    last_updated_at: run?.updated_at || undefined,
    counts: run
      ? {
        sugestoes_total: run.sugestoes_total,
        match_existing_count: run.match_existing_count,
        create_new_count: run.create_new_count,
        ignore_count: run.ignore_count,
        needs_review_count: run.needs_review_count,
      }
      : undefined,
  };
}

async function pollAiExecutionRunForChat(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  importId: string | null;
  correlationId?: string | null;
}): Promise<AiExecutionPollingResult> {
  const startedAt = Date.now();
  let attempts = 0;
  let lastRun: BankAiExecutionRunRow | null = null;

  while (attempts < AI_POLL_MAX_ATTEMPTS && Date.now() - startedAt < AI_POLL_TIMEOUT_MS) {
    attempts += 1;

    lastRun = args.correlationId
      ? await getBankAiExecutionRunByCorrelation({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        correlationId: args.correlationId,
      })
      : await getLatestBankAiExecutionRunForContext({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        contaBancariaId: args.contaBancariaId,
        extratoImportId: args.importId,
      });

    if (lastRun) {
      if (lastRun.status === 'completed') {
        return { run: lastRun, attempts, elapsedMs: Date.now() - startedAt, outcome: 'completed' };
      }
      if (lastRun.status === 'no_pending') {
        return { run: lastRun, attempts, elapsedMs: Date.now() - startedAt, outcome: 'no_pending' };
      }
      if (lastRun.status === 'failed') {
        return { run: lastRun, attempts, elapsedMs: Date.now() - startedAt, outcome: 'failed' };
      }
    }

    if (attempts < AI_POLL_MAX_ATTEMPTS && Date.now() - startedAt + AI_POLL_INTERVAL_MS < AI_POLL_TIMEOUT_MS) {
      await sleep(AI_POLL_INTERVAL_MS);
    }
  }

  if (lastRun && lastRun.status !== 'completed' && lastRun.status !== 'no_pending' && lastRun.status !== 'failed') {
    await updateBankAiExecutionRunStatus({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      correlationId: lastRun.correlation_id,
      status: 'timeout',
      metadataPatch: {
        timeout_detected_by: 'chat_polling',
        timeout_detected_at: new Date().toISOString(),
      },
      setCompletedAt: true,
    }).catch(() => null);
    lastRun = await getBankAiExecutionRunByCorrelation({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      correlationId: lastRun.correlation_id,
    }).catch(() => lastRun);
  }

  return {
    run: lastRun,
    attempts,
    elapsedMs: Date.now() - startedAt,
    outcome: lastRun?.status === 'no_pending' ? 'no_pending' : 'timeout',
  };
}

async function callInternalApi(args: {
  baseUrl: string;
  accessToken: string;
  path: string;
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const target = sanitizeBaseUrl(args.baseUrl);
  const requestUrl = `${target}${args.path}`;

  let response: Response;
  try {
    response = await fetch(requestUrl, {
      method: args.method,
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        ...(args.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: args.body ? JSON.stringify(args.body) : undefined,
    });
  } catch (error: unknown) {
    const networkError = new Error(
      `Falha de conectividade interna ao chamar ${args.method} ${args.path}.`
    ) as Error & { details?: Record<string, unknown> };
    networkError.name = 'InternalApiError';
    networkError.details = {
      type: 'network',
      method: args.method,
      path: args.path,
      target,
      status: null,
      reason: getErrorMessage(error, 'fetch failed'),
    };
    throw networkError;
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const message = String(payload?.message || payload?.error || `Falha interna (${response.status})`);
    const apiError = new Error(
      `Falha interna ao chamar ${args.method} ${args.path} (${response.status}). ${message}`
    ) as Error & { details?: Record<string, unknown> };
    apiError.name = 'InternalApiError';
    apiError.details = {
      type: 'http',
      method: args.method,
      path: args.path,
      target,
      status: response.status,
      reason: message,
    };
    throw apiError;
  }

  return payload || {};
}

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toCentavosFromValor = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100);
};

async function ensureOfxImportEligible(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  importId: string | null;
}): Promise<void> {
  if (!isBankReconciliationOfxOnlyEnabled()) return;

  if (!args.importId) {
    throw new Error(
      'Nesta etapa, use OFX para conciliação confiável. CSV está em quarentena. Importe um OFX antes de continuar.'
    );
  }

  const { data, error } = await args.adminClient
    .from('extratos_import')
    .select('id,file_format')
    .eq('empresa_id', args.empresaId)
    .eq('conta_bancaria_id', args.contaBancariaId)
    .eq('id', args.importId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao validar importação OFX para execução: ${error.message}`);
  }

  if (!data) {
    throw new Error('Importação selecionada não encontrada para este contexto.');
  }

  const fileFormat = String(data.file_format || '').trim().toLowerCase();
  if (fileFormat !== 'ofx') {
    throw new Error(
      'Nesta etapa, use OFX para conciliação confiável. CSV está em quarentena. Selecione ou importe um OFX.'
    );
  }
}

async function loadSuggestedPlanRows(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId: string | null;
  sinceIso?: string | null;
}): Promise<SuggestedPlanRow[]> {
  let txQuery = args.adminClient
    .from('extrato_transacoes')
    .select('id,valor_centavos,data_movimento,tipo,descricao_raw,documento_ref')
    .eq('empresa_id', args.empresaId)
    .eq('conta_bancaria_id', args.contaBancariaId)
    .order('data_movimento', { ascending: true })
    .limit(5000);

  if (args.importId) {
    txQuery = txQuery.eq('extrato_import_id', args.importId);
  } else {
    txQuery = txQuery.eq('data_movimento', args.dataReferencia);
  }

  const { data: txRows, error: txError } = await txQuery;
  if (txError) {
    throw new Error(`Falha ao carregar transacoes de extrato para aplicar plano: ${txError.message}`);
  }

  const txList = (txRows || []) as Array<{
    id: string;
    valor_centavos: number;
    data_movimento: string;
    tipo: 'credit' | 'debit' | 'other';
    descricao_raw: string;
    documento_ref: string | null;
  }>;

  if (txList.length === 0) return [];

  const txMap = new Map(txList.map((row) => [row.id, row]));

  let suggestionsQuery = args.adminClient
    .from('bank_ai_suggestions')
    .select(
      'id,suggestion_action,confidence,explanation,item_financeiro_id,lancamento_caixa_id,proposed_lancamento,warnings,extrato_transacao_id,status,created_at'
    )
    .eq('empresa_id', args.empresaId)
    .eq('status', 'suggested')
    .in('extrato_transacao_id', txList.map((tx) => tx.id))
    .order('created_at', { ascending: true })
    .limit(2000);

  if (args.sinceIso) {
    suggestionsQuery = suggestionsQuery.gte('created_at', args.sinceIso);
  }

  const { data: suggestionRows, error: suggestionError } = await suggestionsQuery;

  if (suggestionError) {
    throw new Error(`Falha ao carregar sugestoes IA para aplicar plano: ${suggestionError.message}`);
  }

  return ((suggestionRows || []) as Array<{
    id: string;
    suggestion_action: SuggestedPlanRow['suggestion_action'];
    confidence: number | null;
    explanation: string | null;
    item_financeiro_id: string | null;
    lancamento_caixa_id: string | null;
    proposed_lancamento: Record<string, unknown> | null;
    warnings: unknown;
    extrato_transacao_id: string;
  }>)
    .map((row) => {
      const tx = txMap.get(row.extrato_transacao_id);
      if (!tx) return null;
      return {
        suggestion_id: row.id,
        suggestion_action: row.suggestion_action,
        confidence: row.confidence,
        explanation: row.explanation,
        item_financeiro_id: row.item_financeiro_id,
        lancamento_caixa_id: row.lancamento_caixa_id,
        proposed_lancamento: row.proposed_lancamento,
        warnings: Array.isArray(row.warnings)
          ? row.warnings.filter((item): item is string => typeof item === 'string')
          : null,
        extrato_transacao_id: row.extrato_transacao_id,
        extrato_valor_centavos: tx.valor_centavos,
        extrato_data_movimento: tx.data_movimento,
        extrato_tipo: tx.tipo,
        extrato_descricao_raw: tx.descricao_raw,
        extrato_documento_ref: tx.documento_ref,
      } satisfies SuggestedPlanRow;
    })
    .filter((row): row is SuggestedPlanRow => !!row);
}

async function loadAiAuditSignals(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  importId: string | null;
  sinceIso: string;
}): Promise<AiPollingResult['auditSignals']> {
  let query = args.adminClient
    .from('bank_reconciliation_audit_log')
    .select('action')
    .eq('empresa_id', args.empresaId)
    .gte('created_at', args.sinceIso)
    .in('action', ['ai_suggestion_created', 'ai_match_suggestion_upserted'])
    .limit(500);

  if (args.importId) {
    query = query.eq('extrato_import_id', args.importId);
  }

  const { data, error } = await query;
  if (error) {
    return { aiSuggestionCreated: 0, aiMatchSuggestionUpserted: 0 };
  }

  let aiSuggestionCreated = 0;
  let aiMatchSuggestionUpserted = 0;
  for (const row of (data || []) as Array<{ action?: string | null }>) {
    if (row.action === 'ai_suggestion_created') aiSuggestionCreated += 1;
    if (row.action === 'ai_match_suggestion_upserted') aiMatchSuggestionUpserted += 1;
  }

  return { aiSuggestionCreated, aiMatchSuggestionUpserted };
}

async function pollAiSuggestionsForChat(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId: string | null;
  hasCriticalPendencias: boolean;
}): Promise<AiPollingResult> {
  const startedAt = Date.now();
  const startedIso = new Date(startedAt).toISOString();
  let attempts = 0;
  let lastRows: SuggestedPlanRow[] = [];

  while (attempts < AI_POLL_MAX_ATTEMPTS && Date.now() - startedAt < AI_POLL_TIMEOUT_MS) {
    attempts += 1;

    lastRows = await loadSuggestedPlanRows({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      importId: args.importId,
    });

    if (lastRows.length > 0) {
      const auditSignals = await loadAiAuditSignals({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        importId: args.importId,
        sinceIso: startedIso,
      });

      return {
        rows: lastRows,
        attempts,
        elapsedMs: Date.now() - startedAt,
        outcome: 'completed',
        auditSignals,
      };
    }

    if (attempts < AI_POLL_MAX_ATTEMPTS && Date.now() - startedAt + AI_POLL_INTERVAL_MS < AI_POLL_TIMEOUT_MS) {
      await sleep(AI_POLL_INTERVAL_MS);
    }
  }

  const auditSignals = await loadAiAuditSignals({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    importId: args.importId,
    sinceIso: startedIso,
  });

  const noPending =
    !args.hasCriticalPendencias &&
    lastRows.length === 0 &&
    auditSignals.aiSuggestionCreated === 0 &&
    auditSignals.aiMatchSuggestionUpserted === 0;

  return {
    rows: lastRows,
    attempts,
    elapsedMs: Date.now() - startedAt,
    outcome: noPending ? 'no_pending' : 'timeout',
    auditSignals,
  };
}

async function markAiSuggestionAsApplied(args: {
  baseUrl: string;
  accessToken: string;
  suggestionId: string;
  explanation: string;
}): Promise<void> {
  await callInternalApi({
    baseUrl: args.baseUrl,
    accessToken: args.accessToken,
    path: '/api/bank-statement/ai/review',
    method: 'POST',
    body: {
      suggestion_id: args.suggestionId,
      status: 'applied',
      explanation: args.explanation,
    },
  });
}

function buildReviewPromptFromGuidance(guidance: ChatReviewGuidance | null | undefined): string {
  if (guidance?.queue_phase === 'pre_batch' && guidance.batch_offer) {
    const safeCount = Number(guidance.batch_offer.safe_match_count || 0);
    const divergenceCount = Number(guidance.batch_offer.auto_divergence_count || 0);
    const exceptionCount = Number(guidance.batch_offer.exceptions_count || 0);
    return `Posso aplicar ${safeCount} vínculo(s) seguro(s) em lote${divergenceCount > 0 ? ` e registrar ${divergenceCount} divergência(s)` : ''}. Depois seguimos com ${exceptionCount} item(ns) no 1x1.`;
  }

  if (guidance?.display_mode === 'guided_completed') {
    const resolved = Number(guidance.final_summary?.resolved || 0);
    return `Revisão guiada concluída. ${resolved} item(ns) resolvido(s).`;
  }

  if (!guidance?.current_case) {
    return 'Revisão guiada concluída.';
  }

  const item = guidance.current_case;
  const queueTotal = Number(guidance.queue_total_active || guidance.queue_total || guidance.queue_remaining || 0);
  const progress =
    guidance.current_position && queueTotal > 0
      ? `Item ${guidance.current_position} de ${queueTotal}.`
      : '';
  return `${progress} ${item.question}`.trim();
}

const shouldIncludeGuidedReviewCandidate = (action: string, confidence: number | null): boolean =>
  action === 'needs_review' ||
  action === 'create_new' ||
  action === 'ignore' ||
  (action === 'match_existing' && (confidence ?? 0) < 0.75);

function countGuidedReviewCandidatesFromPlan(result: Record<string, unknown>): number {
  const plan = result.reconciliation_plan;
  if (!plan || typeof plan !== 'object') return 0;
  const items = (plan as { items?: unknown[] }).items;
  if (!Array.isArray(items)) return 0;

  return items.filter((item) => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    const action = String(row.action || '');
    const confidence = row.confidence == null ? null : toNumber(row.confidence, 0);
    return shouldIncludeGuidedReviewCandidate(action, confidence);
  }).length;
}

async function logGuidedReviewAudit(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  userId: string;
  importId?: string | null;
  action:
    | 'guided_review_started'
    | 'guided_review_step_resolved'
    | 'guided_review_batch_applied'
    | 'guided_review_completed';
  message: string;
  details: Record<string, unknown>;
}): Promise<void> {
  await safeInsertBankAuditLog(args.adminClient, {
    empresa_id: args.empresaId,
    created_by: args.userId,
    extrato_import_id: args.importId || null,
    action: args.action,
    status: 'success',
    message: args.message,
    details: args.details,
  });
}

type GuidedReviewActionDecision = 'approve_match' | 'approve_ignore' | 'open_manual_review';

interface GuidedReviewActionLogRow {
  id: string;
  case_id: string | null;
  suggestion_id: string | null;
  decision: GuidedReviewActionDecision;
  conciliacao_id: string | null;
  item_financeiro_id: string | null;
  reversible: boolean;
  created_at: string;
}

const isGuidedReviewActionLogMissingError = (message: string): boolean =>
  /bank_reconciliation_chat_review_actions/i.test(message) &&
  /(does not exist|schema cache|column|relation)/i.test(message);

const extractConciliacaoIdFromApiPayload = (payload: Record<string, unknown>): string | null => {
  const direct = safeString(payload.conciliacao_id);
  if (direct) return direct;
  const data = payload.data && typeof payload.data === 'object'
    ? (payload.data as Record<string, unknown>)
    : null;
  return data ? safeString(data.conciliacao_id) || safeString(data.id) : null;
};

async function safeInsertGuidedReviewActionLog(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
  caseId?: string | null;
  suggestionId?: string | null;
  extratoTransacaoId: string;
  decision: GuidedReviewActionDecision;
  justification?: string | null;
  conciliacaoId?: string | null;
  itemFinanceiroId?: string | null;
  userId: string;
  reversible?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await args.adminClient
      .from('bank_reconciliation_chat_review_actions')
      .insert({
        empresa_id: args.empresaId,
        session_id: args.sessionId,
        case_id: args.caseId || null,
        suggestion_id: args.suggestionId || null,
        extrato_transacao_id: args.extratoTransacaoId,
        decision: args.decision,
        justification: args.justification || null,
        conciliacao_id: args.conciliacaoId || null,
        item_financeiro_id: args.itemFinanceiroId || null,
        reversible: args.reversible !== false,
        metadata: {
          ...(args.metadata || {}),
          created_by: args.userId,
        },
      });

    if (!error) return;
    if (isGuidedReviewActionLogMissingError(error.message)) return;

    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      extrato_transacao_id: args.extratoTransacaoId,
      action: 'guided_review_action_log_failed',
      status: 'warning',
      message: `Falha ao registrar ação da revisão guiada: ${error.message}`,
      created_by: args.userId,
      details: {
        session_id: args.sessionId,
        case_id: args.caseId || null,
        suggestion_id: args.suggestionId || null,
        decision: args.decision,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Erro desconhecido ao registrar ação da revisão guiada.';
    if (isGuidedReviewActionLogMissingError(message)) return;
    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      extrato_transacao_id: args.extratoTransacaoId,
      action: 'guided_review_action_log_failed',
      status: 'warning',
      message: `Falha ao registrar ação da revisão guiada: ${message}`,
      created_by: args.userId,
      details: {
        session_id: args.sessionId,
        case_id: args.caseId || null,
        suggestion_id: args.suggestionId || null,
        decision: args.decision,
      },
    });
  }
}

async function loadLastReversibleGuidedReviewAction(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
}): Promise<GuidedReviewActionLogRow | null> {
  const { data, error } = await args.adminClient
    .from('bank_reconciliation_chat_review_actions')
    .select('id,case_id,suggestion_id,decision,conciliacao_id,item_financeiro_id,reversible,created_at')
    .eq('empresa_id', args.empresaId)
    .eq('session_id', args.sessionId)
    .in('decision', ['approve_match', 'approve_ignore'])
    .eq('reversible', true)
    .is('reversed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isGuidedReviewActionLogMissingError(error.message)) return null;
    throw new Error(`Falha ao carregar última decisão reversível: ${error.message}`);
  }

  if (!data) return null;
  return {
    id: String(data.id || ''),
    case_id: safeString(data.case_id),
    suggestion_id: safeString(data.suggestion_id),
    decision: String(data.decision || 'approve_ignore') as GuidedReviewActionDecision,
    conciliacao_id: safeString(data.conciliacao_id),
    item_financeiro_id: safeString(data.item_financeiro_id),
    reversible: data.reversible !== false,
    created_at: String(data.created_at || new Date().toISOString()),
  };
}

async function markGuidedReviewActionAsReversed(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  actionLogId: string;
  userId: string;
  reason: string;
}): Promise<void> {
  const { error } = await args.adminClient
    .from('bank_reconciliation_chat_review_actions')
    .update({
      reversed_at: new Date().toISOString(),
      reversed_by: args.userId,
      metadata: {
        undo_reason: args.reason,
        undone_by: args.userId,
        undone_at: new Date().toISOString(),
      },
    })
    .eq('empresa_id', args.empresaId)
    .eq('id', args.actionLogId)
    .is('reversed_at', null);

  if (error) {
    if (isGuidedReviewActionLogMissingError(error.message)) return;
    throw new Error(`Falha ao marcar ação guiada como revertida: ${error.message}`);
  }
}

async function enrichGuidanceWithUndoState(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
  guidance: ChatReviewGuidance;
}): Promise<ChatReviewGuidance> {
  const lastAction = await loadLastReversibleGuidedReviewAction({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    sessionId: args.sessionId,
  }).catch(() => null);

  return {
    ...args.guidance,
    can_undo_last: Boolean(lastAction?.reversible),
    last_decision: lastAction
      ? {
          decision: lastAction.decision,
          applied_at: lastAction.created_at,
          reversible: lastAction.reversible,
        }
      : null,
  };
}

async function markSuggestionBackToSuggested(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  suggestionId: string;
}): Promise<void> {
  const { error } = await args.adminClient
    .from('bank_ai_suggestions')
    .update({
      status: 'suggested',
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', args.empresaId)
    .eq('id', args.suggestionId);

  if (error) {
    throw new Error(`Falha ao restaurar sugestão IA para suggested: ${error.message}`);
  }
}

async function reopenGuidedQueueCase(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  caseId: string;
}): Promise<void> {
  const { error } = await args.adminClient
    .from('bank_reconciliation_chat_review_items')
    .update({
      review_status: 'pending',
      decision: null,
      justification: null,
      resolved_by: null,
      resolved_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', args.empresaId)
    .eq('id', args.caseId);

  if (error) {
    throw new Error(`Falha ao reabrir item da revisão guiada: ${error.message}`);
  }
}

const confidenceBand = (value: number | null | undefined): ChatPlanConfidenceBand => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 0.85) return 'high';
  if (n >= 0.6) return 'medium';
  return 'low';
};

const looksEnglishExplanation = (value: string): boolean =>
  /\b(transaction|candidate|description|match|suggest(?:ed|ion)?|review|confidence|date|amount|same value|same date)\b/i.test(
    value
  );

const normalizeExplanationForChat = (
  explanation: string | null | undefined,
  fallbackPtBr: string
): string => {
  const text = String(explanation || '').trim();
  if (!text) return fallbackPtBr;
  if (looksEnglishExplanation(text)) return fallbackPtBr;
  return text;
};

function buildClarifyingQuestionFromRow(row: SuggestedPlanRow): ChatClarifyingQuestion | null {
  const valor = `R$ ${(row.extrato_valor_centavos / 100).toFixed(2)}`;
  const base = {
    id: `q:${row.suggestion_id}`,
    suggestion_id: row.suggestion_id,
    extrato_transacao_id: row.extrato_transacao_id,
    confidence_band: confidenceBand(row.confidence),
  } satisfies Omit<ChatClarifyingQuestion, 'question'>;

  if (row.suggestion_action === 'needs_review') {
    return {
      ...base,
      question: `Não consegui classificar "${row.extrato_descricao_raw}" (${valor}) em ${row.extrato_data_movimento}. Como devo tratar esse lançamento?`,
      rationale: normalizeExplanationForChat(
        row.explanation,
        'Sugestão marcada para revisão necessária.'
      ),
      suggested_actions: ['Aprovar vínculo', 'Ignorar com justificativa', 'Manter para depois'],
    };
  }

  if (row.suggestion_action === 'create_new') {
    return null;
  }

  if (row.suggestion_action === 'ignore') {
    return {
      ...base,
      question: `Deseja ignorar a transação "${row.extrato_descricao_raw}" (${valor}) com justificativa?`,
      rationale: normalizeExplanationForChat(
        row.explanation,
        'A IA sugeriu marcar como divergência após revisão.'
      ),
      suggested_actions: ['Ignorar com justificativa', 'Revisar vínculo', 'Manter pendente'],
    };
  }

  if ((row.confidence ?? 0) < 0.75) {
    return {
      ...base,
      question: `Confirma o vínculo sugerido para "${row.extrato_descricao_raw}" (${valor})? A confiança está baixa.`,
      rationale: normalizeExplanationForChat(
        row.explanation,
        'Sugestão com baixa confiança.'
      ),
      suggested_actions: ['Aprovar vínculo', 'Trocar vínculo', 'Manter para depois'],
    };
  }

  return null;
}

function buildPlanArtifactsFromSuggestedRows(args: {
  rows: SuggestedPlanRow[];
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId?: string | null;
  planId?: string | null;
}): {
  plan: ChatReconciliationPlan | null;
  pendingCases: ChatPendingCase[];
  clarifyingQuestions: ChatClarifyingQuestion[];
} {
  if (!args.rows.length) {
    return { plan: null, pendingCases: [], clarifyingQuestions: [] };
  }

  const generatedAt = new Date().toISOString();
  const planId =
    args.planId ||
    ['chat-plan', args.contaBancariaId, args.dataReferencia, args.importId || 'noimport', generatedAt].join(':');

  const items = args.rows.map((row) => ({
    id: `plan-item:${row.suggestion_id}`,
    suggestion_id: row.suggestion_id,
    extrato_transacao_id: row.extrato_transacao_id,
    action: row.suggestion_action,
    confidence: row.confidence,
    item_financeiro_id: row.item_financeiro_id,
    lancamento_caixa_id: row.lancamento_caixa_id,
    explanation: normalizeExplanationForChat(row.explanation, 'Sugestão operacional para revisão no chat.'),
    extrato_data_movimento: row.extrato_data_movimento,
    extrato_valor_centavos: row.extrato_valor_centavos,
    extrato_tipo: row.extrato_tipo,
    extrato_descricao_raw: row.extrato_descricao_raw,
    extrato_documento_ref: row.extrato_documento_ref,
    warnings: row.warnings || undefined,
    proposed_lancamento: row.proposed_lancamento || null,
  })) satisfies ChatReconciliationPlan['items'];

  const totals = {
    total: items.length,
    match_existing: items.filter((item) => item.action === 'match_existing').length,
    create_new: items.filter((item) => item.action === 'create_new').length,
    ignore: items.filter((item) => item.action === 'ignore').length,
    needs_review: items.filter((item) => item.action === 'needs_review').length,
  };

  const pendingCases: ChatPendingCase[] = args.rows
    .filter((row) => row.suggestion_action === 'needs_review' || (row.suggestion_action === 'match_existing' && (row.confidence ?? 0) < 0.75))
    .map((row) => ({
      id: `pending:${row.suggestion_id}`,
      suggestion_id: row.suggestion_id,
      extrato_transacao_id: row.extrato_transacao_id,
      action: row.suggestion_action,
      reason:
        normalizeExplanationForChat(row.explanation, '') ||
        (row.suggestion_action === 'needs_review'
          ? 'IA não conseguiu conciliar automaticamente.'
          : 'Sugestão com baixa confiança.'),
      confidence: row.confidence,
      confidence_band: confidenceBand(row.confidence),
      descricao: row.extrato_descricao_raw,
      data_movimento: row.extrato_data_movimento,
      valor_centavos: row.extrato_valor_centavos,
    }));

  const clarifyingQuestions = args.rows
    .map((row) => buildClarifyingQuestionFromRow(row))
    .filter((row): row is ChatClarifyingQuestion => !!row)
    .slice(0, 12);

  return {
    plan: {
      plan_id: planId,
      empresa_id: args.empresaId,
      conta_bancaria_id: args.contaBancariaId,
      data_referencia: args.dataReferencia,
      import_id: args.importId || null,
      generated_at: generatedAt,
      totals,
      items,
    },
    pendingCases,
    clarifyingQuestions,
  };
}

function mapActionResultToAssistantMessage(
  action: BankChatActionKind,
  result: Record<string, unknown>
): { message: string; richContent?: RichMessageContent; executionSummary?: ExecuteBankChatActionResult['execution_summary']; affectedCounts?: Record<string, number> } {
  if (action === 'matching') {
    const confirmed = Number(result.confirmed_count || 0);
    const suggested = Number(result.suggested_count || 0);
    const skipped = Number(result.skipped_count || 0);
    const affectedCounts = { confirmed, suggested, skipped };

    return {
      message: `Matching executado. Confirmados: ${confirmed}, sugeridos: ${suggested}, ignorados: ${skipped}.`,
      richContent: {
        type: 'summary',
        data: {
          title: 'Resultado do Matching',
          items: [
            { label: 'Confirmados', value: confirmed },
            { label: 'Sugeridos', value: suggested },
            { label: 'Ignorados', value: skipped },
          ],
        },
      },
      executionSummary: {
        title: 'Matching executado',
        message: `Confirmados ${confirmed}, sugeridos ${suggested}, ignorados ${skipped}.`,
        affected_counts: affectedCounts,
      },
      affectedCounts,
    };
  }

  if (action === 'trigger_ai') {
    const triggerDispatch = evaluateAiTriggerDispatch(result);
    const ok = triggerDispatch.dispatched;
    const triggerMessage = triggerDispatch.message || 'sem detalhes';
    const affectedCounts = { triggered: ok ? 1 : 0 };
    const aiStatus =
      result.ai_processing_status && typeof result.ai_processing_status === 'object'
        ? (result.ai_processing_status as Record<string, unknown>)
        : null;
    const aiState = String(aiStatus?.state || '').trim();
    const aiStatusLabel =
      aiState === 'completed'
        ? 'Concluída'
        : aiState === 'no_pending'
          ? 'Sem pendências'
          : aiState === 'failed'
            ? 'Falhou'
            : aiState === 'triggered' || aiState === 'processing' || aiState === 'timeout'
              ? 'Em processamento'
              : '—';

    return {
      message: ok
        ? (aiState === 'completed'
          ? 'Fluxo de IA disparado e concluído com atualização do plano.'
          : aiState === 'no_pending'
            ? 'Fluxo de IA disparado. Não há pendências adicionais para sugerir neste contexto.'
            : 'Fluxo de IA disparado com sucesso para gerar sugestoes.')
        : `Fluxo de IA nao foi disparado: ${triggerMessage}`,
      richContent: {
        type: 'summary',
        data: {
          title: 'Disparo IA',
          items: [
            { label: 'Status', value: ok ? 'OK' : 'Alerta' },
            { label: 'Status IA', value: aiStatusLabel },
            { label: 'Mensagem', value: triggerMessage || '—' },
          ],
        },
      },
      executionSummary: {
        title: 'Disparo IA',
        message: ok ? 'Workflow de sugestoes acionado.' : `Disparo nao realizado: ${triggerMessage}`,
        affected_counts: affectedCounts,
      },
      affectedCounts,
    };
  }

  if (action === 'refresh_summary' || action === 'daily_close' || action === 'daily_reopen') {
    const summary = result.data && typeof result.data === 'object'
      ? ((result.data as Record<string, unknown>).summary as Record<string, unknown> | undefined)
      : undefined;

    const pendencias = Number(summary?.pendencias_criticas_total || 0);
    const verificados = Number(summary?.itens_verificados || 0);
    const parciais = Number(summary?.itens_parciais || 0);
    const naoConciliados = Number(summary?.itens_nao_conciliados || 0);
    const affectedCounts = {
      pendencias_criticas_total: pendencias,
      itens_verificados: verificados,
      itens_parciais: parciais,
      itens_nao_conciliados: naoConciliados,
    };

    const title =
      action === 'daily_close'
        ? 'Fechamento diario'
        : action === 'daily_reopen'
          ? 'Reabertura diaria'
          : 'Resumo Diario';

    const message =
      action === 'daily_close'
        ? 'Fechamento diario executado com sucesso.'
        : action === 'daily_reopen'
          ? 'Dia reaberto com sucesso.'
          : 'Resumo diario atualizado com sucesso.';

    return {
      message,
      richContent: {
        type: 'summary',
        data: {
          title,
          items: [
            { label: 'Pendencias criticas', value: pendencias },
            { label: 'Itens verificados', value: verificados },
            { label: 'Itens parciais', value: parciais },
            { label: 'Itens nao conciliados', value: naoConciliados },
          ],
        },
      },
      executionSummary: { title, message, affected_counts: affectedCounts },
      affectedCounts,
    };
  }

  if (action === 'run_daily_reconciliation') {
    const matching = result.matching && typeof result.matching === 'object'
      ? (result.matching as Record<string, unknown>)
      : {};
    const triggerRoot =
      result.ai_trigger && typeof result.ai_trigger === 'object'
        ? (result.ai_trigger as Record<string, unknown>)
        : {};
    const triggerDispatch = evaluateAiTriggerDispatch({
      ...triggerRoot,
      correlation_id: safeString((triggerRoot as Record<string, unknown>).correlation_id) || result.correlation_id,
      trigger:
        triggerRoot.trigger && typeof triggerRoot.trigger === 'object'
          ? (triggerRoot.trigger as Record<string, unknown>)
          : {},
    });
    const aiTriggered = triggerDispatch.dispatched;
    const triggerMessage = triggerDispatch.message;
    const summary = result.daily_summary && typeof result.daily_summary === 'object'
      ? (result.daily_summary as Record<string, unknown>)
      : {};
    const summaryData =
      summary.data && typeof summary.data === 'object'
        ? (summary.data as Record<string, unknown>)
        : {};
    const summaryRow =
      summaryData.summary && typeof summaryData.summary === 'object'
        ? (summaryData.summary as Record<string, unknown>)
        : {};
    const plan = result.reconciliation_plan && typeof result.reconciliation_plan === 'object'
      ? (result.reconciliation_plan as Record<string, unknown>)
      : {};
    const planTotals = plan.totals && typeof plan.totals === 'object'
      ? (plan.totals as Record<string, unknown>)
      : {};
    const clarifyingQuestions = Array.isArray(result.clarifying_questions) ? result.clarifying_questions : [];
    const guidedCandidates = countGuidedReviewCandidatesFromPlan(result);
    const aiProcessingStatus =
      result.ai_processing_status && typeof result.ai_processing_status === 'object'
        ? (result.ai_processing_status as Record<string, unknown>)
        : {};
    const aiState = String(aiProcessingStatus.state || '');
    const aiStatusLabel =
      aiState === 'completed'
        ? 'Concluída'
        : aiState === 'timeout'
          ? 'Tempo de espera expirou'
          : aiState === 'polling' || aiState === 'triggered' || aiState === 'processing'
            ? 'Aguardando IA'
          : aiState === 'no_pending'
            ? 'Sem pendências'
            : aiState === 'failed'
              ? 'Falhou'
              : 'Desconhecido';

    const affectedCounts = {
      confirmed: toNumber(matching.confirmed_count),
      suggested: toNumber(matching.suggested_count),
      ai_suggestions_total: toNumber(planTotals.total),
      pending_ai: toNumber(summaryRow.pendencias_criticas_total),
      perguntas_ia: guidedCandidates || clarifyingQuestions.length,
      ai_triggered: aiTriggered ? 1 : 0,
    };
    const manualApprovalHint =
      ' As tags de conciliação só mudam após aprovação/aplicação das sugestões no plano.';
  const phaseScopeHint =
      ' Nesta fase, apenas conciliamos e revisamos divergências no extrato.';

    const message =
      !aiTriggered
        ? `Conciliação concluída, mas o disparo da IA não foi realizado.${triggerMessage ? ` Motivo: ${triggerMessage}` : ''}${manualApprovalHint}${phaseScopeHint}`
        : aiState === 'timeout' || aiState === 'polling' || aiState === 'triggered' || aiState === 'processing'
        ? `Conciliação concluída. A IA ainda está processando este contexto.${manualApprovalHint}${phaseScopeHint}`
        : aiState === 'no_pending'
          ? `Conciliação concluída. A IA não gerou sugestões neste contexto.${manualApprovalHint}${phaseScopeHint}`
          : aiState === 'failed'
            ? `Conciliação concluída, mas a etapa da IA falhou.${manualApprovalHint}${phaseScopeHint}`
            : `Conciliação concluída. Vamos revisar as pendências no chat.${manualApprovalHint}${phaseScopeHint}`;

    return {
      message,
      richContent: {
        type: 'summary',
        data: {
          title: 'Conciliação do dia',
          items: [
            { label: 'Matching confirmados', value: affectedCounts.confirmed },
            { label: 'Matching sugeridos', value: affectedCounts.suggested },
            { label: 'Sugestões IA (plano)', value: affectedCounts.ai_suggestions_total },
            { label: 'IA disparada', value: affectedCounts.ai_triggered ? 'Sim' : 'Não' },
            { label: 'Status IA', value: aiStatusLabel },
            { label: 'Pendências críticas', value: affectedCounts.pending_ai },
            { label: 'Itens para revisão guiada', value: affectedCounts.perguntas_ia },
          ],
        },
      },
      executionSummary: {
        title: 'Conciliacao do dia executada',
        message:
          !aiTriggered
            ? `Sync de itens, matching com auto-confirmação determinística e atualização do resumo concluídos, mas o disparo da IA não foi realizado.${triggerMessage ? ` Motivo: ${triggerMessage}` : ''}`
            : aiState === 'timeout'
            ? 'Sync de itens, matching com auto-confirmação determinística, disparo da IA e atualização do resumo concluídos. O tempo de espera local expirou antes da resposta final da IA.'
            : 'Sync de itens, matching com auto-confirmação determinística, disparo da IA e atualização do resumo concluídos.',
        affected_counts: affectedCounts,
      },
      affectedCounts,
    };
  }

  const affectedCounts = {
    applied: toNumber(result.applied_count),
    match_existing: toNumber(result.match_existing_applied),
    create_new: toNumber(result.create_new_applied),
    create_new_blocked: toNumber(result.blocked_create_new_count),
    ignore: toNumber(result.ignore_applied),
    needs_review: toNumber(result.needs_review_kept),
    failed: toNumber(result.failed_count),
  };
  const balanceMutationBlocked = result.balance_mutation_blocked === true;

  const appliedSuggestionIds = Array.isArray(result.applied_suggestion_ids)
    ? result.applied_suggestion_ids.length
    : 0;
  const skippedSuggestionIds = Array.isArray(result.skipped_suggestion_ids)
    ? result.skipped_suggestion_ids.length
    : 0;
  const blocked = result.blocked === true;
  const blockedMessage =
    typeof result.blocked_message === 'string'
      ? result.blocked_message
      : 'Plano bloqueado: somente itens de revisão necessária.';

  if (blocked) {
    return {
      message: blockedMessage,
      richContent: {
        type: 'summary',
        data: {
          title: 'Aplicação do Plano Bloqueada',
          items: [
            { label: 'Motivo', value: blockedMessage },
            { label: 'Total selecionado', value: toNumber(result.total_considered) },
            { label: 'Revisão necessária', value: affectedCounts.needs_review },
            { label: 'Aplicados', value: affectedCounts.applied },
            ...(affectedCounts.create_new_blocked > 0
              ? [{ label: 'Sem vínculo automático (fora da etapa)', value: affectedCounts.create_new_blocked }]
              : []),
          ],
        },
      },
      executionSummary: {
        title: 'Plano não aplicado',
        message: blockedMessage,
        affected_counts: affectedCounts,
        balance_mutation_blocked: balanceMutationBlocked,
        blocked_create_new_count: affectedCounts.create_new_blocked,
      },
      affectedCounts,
    };
  }

  const blockedCreateMessage =
    affectedCounts.create_new_blocked > 0
      ? ` ${affectedCounts.create_new_blocked} item(ns) sem vínculo automático ficaram fora desta etapa e seguirão para decisão de divergência.`
      : '';

  return {
    message: `Plano de conciliação aplicado. Sucesso: ${affectedCounts.applied}, pendências mantidas: ${affectedCounts.needs_review}, falhas: ${affectedCounts.failed}.${blockedCreateMessage}`,
    richContent: {
      type: 'summary',
      data: {
        title: 'Aplicação do plano de conciliação',
        items: [
          { label: 'Aplicados', value: affectedCounts.applied },
          { label: 'Match existente', value: affectedCounts.match_existing },
          { label: 'Sem vínculo automático', value: affectedCounts.create_new },
          ...(affectedCounts.create_new_blocked > 0
            ? [{ label: 'Fora desta etapa', value: affectedCounts.create_new_blocked }]
            : []),
          { label: 'Ignorados', value: affectedCounts.ignore },
          { label: 'Revisão necessária', value: affectedCounts.needs_review },
          { label: 'Falhas', value: affectedCounts.failed },
          ...(balanceMutationBlocked ? [{ label: 'Política ativa', value: 'Sem mutação de saldo' }] : []),
          { label: 'Itens pulados', value: skippedSuggestionIds },
          { label: 'Itens aplicados (IDs)', value: appliedSuggestionIds },
        ],
      },
    },
    executionSummary: {
      title: 'Plano aplicado',
      message: `Aplicados ${affectedCounts.applied}; falhas ${affectedCounts.failed}.${blockedCreateMessage}`,
      affected_counts: affectedCounts,
      balance_mutation_blocked: balanceMutationBlocked,
      blocked_create_new_count: affectedCounts.create_new_blocked,
    },
    affectedCounts,
  };
}

async function executeRunDailyReconciliation(args: ExecuteBankChatActionArgs): Promise<Record<string, unknown>> {
  await ensureOfxImportEligible({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    importId: args.importId,
  });

  const syncPayload = {
    payload: {
      empresa_id: args.empresaId,
      conta_bancaria_id: args.contaBancariaId,
      full_refresh: false,
    },
  };

  const { data: syncData, error: syncError } = await args.adminClient.rpc('rpc_bank_sync_conciliacao_itens', syncPayload);
  if (syncError) {
    throw new Error(`Falha ao sincronizar itens canonicos antes da conciliacao: ${syncError.message}`);
  }

  if (!args.importId) {
    throw new Error('Nao ha importacao selecionada para executar a conciliacao do dia. Anexe/processa o extrato primeiro.');
  }

  const matching = await callInternalApi({
    baseUrl: args.baseUrl,
    accessToken: args.accessToken,
    path: '/api/bank-statement/match',
    method: 'POST',
    body: {
      import_id: args.importId,
      auto_confirm: true,
    },
  });

  const aiTrigger = await callInternalApi({
    baseUrl: args.baseUrl,
    accessToken: args.accessToken,
    path: '/api/bank-statement/ai/trigger',
    method: 'POST',
    body: {
      extrato_import_id: args.importId,
      conta_bancaria_id: args.contaBancariaId,
    },
  });

  const query = new URLSearchParams({
    conta_bancaria_id: args.contaBancariaId,
    data_referencia: args.dataReferencia,
  }).toString();

  const dailySummary = await callInternalApi({
    baseUrl: args.baseUrl,
    accessToken: args.accessToken,
    path: `/api/bank-statement/daily/summary?${query}`,
    method: 'GET',
  });
  const summaryData =
    dailySummary.data && typeof dailySummary.data === 'object'
      ? (dailySummary.data as Record<string, unknown>)
      : {};
  const summaryRow =
    summaryData.summary && typeof summaryData.summary === 'object'
      ? (summaryData.summary as Record<string, unknown>)
      : {};
  const pendenciasCriticasTotal = toNumber(summaryRow.pendencias_criticas_total, 0);
  const aiTriggerRecord =
    aiTrigger.trigger && typeof aiTrigger.trigger === 'object'
      ? (aiTrigger.trigger as Record<string, unknown>)
      : {};
  const triggerDispatch = evaluateAiTriggerDispatch({
    ...aiTrigger,
    trigger: aiTriggerRecord,
  });
  const correlationId = triggerDispatch.correlationId;

  let aiPolling:
    | {
      attempts: number;
      elapsedMs: number;
      outcome: AiPollingOutcome;
      rows: SuggestedPlanRow[];
      auditSignals?: { aiSuggestionCreated: number; aiMatchSuggestionUpserted: number };
      run?: BankAiExecutionRunRow | null;
    }
    | null = null;

  if (!triggerDispatch.dispatched) {
    return {
      sync: syncData && typeof syncData === 'object' ? (syncData as Record<string, unknown>) : { ok: true },
      matching,
      ai_trigger: aiTrigger,
      correlation_id: correlationId,
      daily_summary: dailySummary,
      ai_processing_status: buildAiTriggerNotDispatchedStatus({
        reason: triggerDispatch.message,
        correlationId,
      }),
      ai_polling: {
        attempts: 0,
        elapsed_ms: 0,
        outcome: 'failed',
        audit_signals: null,
      },
      reconciliation_plan: null,
      pending_cases: null,
      clarifying_questions: null,
      trigger_diagnostics: {
        blocked: true,
        reason: triggerDispatch.message || 'Disparo da IA não realizado.',
      },
    };
  }

  if (correlationId) {
    const executionPolling = await pollAiExecutionRunForChat({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      importId: args.importId,
      correlationId,
    });

    const rows =
      executionPolling.run?.status === 'no_pending'
        ? []
        : await loadSuggestedPlanRows({
            adminClient: args.adminClient,
            empresaId: args.empresaId,
            contaBancariaId: args.contaBancariaId,
            dataReferencia: args.dataReferencia,
            importId: args.importId,
            sinceIso: executionPolling.run?.created_at || null,
          });

    aiPolling = {
      attempts: executionPolling.attempts,
      elapsedMs: executionPolling.elapsedMs,
      outcome: executionPolling.outcome,
      rows,
      run: executionPolling.run,
    };
  } else {
    const fallbackPolling = await pollAiSuggestionsForChat({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      importId: args.importId,
      hasCriticalPendencias: pendenciasCriticasTotal > 0,
    });
    aiPolling = fallbackPolling;
  }

  const artifacts = buildPlanArtifactsFromSuggestedRows({
    rows: aiPolling.rows,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    dataReferencia: args.dataReferencia,
    importId: args.importId,
  });

  const aiProcessingStatus = aiPolling.run
    ? deriveAiProcessingStatusFromRun({
      run: aiPolling.run,
      attempts: aiPolling.attempts,
      elapsedMs: aiPolling.elapsedMs,
      outcome: aiPolling.outcome,
    })
    : ({
      state:
        aiPolling.outcome === 'completed'
          ? 'completed'
          : aiPolling.outcome === 'no_pending'
            ? 'no_pending'
            : 'timeout',
      attempts: aiPolling.attempts,
      elapsed_ms: aiPolling.elapsedMs,
      outcome: aiPolling.outcome,
      message:
        aiPolling.outcome === 'completed'
          ? 'Sugestões IA carregadas no ciclo atual.'
          : aiPolling.outcome === 'no_pending'
            ? 'Sem pendências adicionais para a IA sugerir neste contexto.'
            : 'Tempo de espera local expirou; a IA pode continuar processando.',
      correlation_id: correlationId || undefined,
    } satisfies ChatAiProcessingStatus);

  return {
    sync: syncData && typeof syncData === 'object' ? (syncData as Record<string, unknown>) : { ok: true },
    matching,
    ai_trigger: aiTrigger,
    correlation_id: correlationId,
    daily_summary: dailySummary,
    ai_processing_status: aiProcessingStatus,
    ai_polling: {
      attempts: aiPolling.attempts,
      elapsed_ms: aiPolling.elapsedMs,
      outcome: aiPolling.outcome,
      audit_signals: 'auditSignals' in aiPolling ? aiPolling.auditSignals || null : null,
    },
    reconciliation_plan: aiPolling.outcome === 'no_pending' ? null : artifacts.plan,
    pending_cases: aiPolling.outcome === 'no_pending' ? [] : artifacts.pendingCases,
    clarifying_questions: aiPolling.outcome === 'no_pending' ? [] : artifacts.clarifyingQuestions,
  };
}

async function executeApplyReconciliationPlan(args: ExecuteBankChatActionArgs): Promise<Record<string, unknown>> {
  await ensureOfxImportEligible({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    importId: args.importId,
  });

  const allRows = await loadSuggestedPlanRows({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    dataReferencia: args.dataReferencia,
    importId: args.importId,
  });

  const selectionMode: ChatPlanSelectionMode = args.selectionMode || 'all';
  const includeSet = new Set((args.includeSuggestionIds || []).map(String));
  const excludeSet = new Set((args.excludeSuggestionIds || []).map(String));
  const balanceMutationBlocked = isBankReconciliationBalanceMutationDisabled();

  let rows = allRows;
  if (selectionMode === 'include_only') {
    rows = allRows.filter((row) => includeSet.has(String(row.suggestion_id)));
  } else if (selectionMode === 'exclude_some') {
    rows = allRows.filter((row) => !excludeSet.has(String(row.suggestion_id)));
  }

  const skippedSuggestionIds = allRows
    .filter((row) => !rows.some((selected) => selected.suggestion_id === row.suggestion_id))
    .map((row) => row.suggestion_id);

  const needsReviewSelected = rows.filter((row) => row.suggestion_action === 'needs_review').length;
  const rowsForExecution = rows.filter((row) => row.suggestion_action !== 'needs_review');

  const affected = {
    applied_count: 0,
    match_existing_applied: 0,
    create_new_applied: 0,
    blocked_create_new_count: 0,
    ignore_applied: 0,
    needs_review_kept: 0,
    failed_count: 0,
    total_suggested: rowsForExecution.length,
  };
  affected.needs_review_kept = needsReviewSelected;

  const failures: Array<{ suggestion_id: string; action: string; message: string }> = [];
  const appliedSuggestionIds: string[] = [];
  if (rowsForExecution.length === 0) {
    const artifacts = buildPlanArtifactsFromSuggestedRows({
      rows,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      importId: args.importId,
    });
    const blockedNeedsReviewCount = needsReviewSelected;

    return {
      ...affected,
      needs_review_kept: blockedNeedsReviewCount,
      blocked: true,
      blocked_reason: rows.length === 0 ? 'no_selected_items' : 'all_needs_review',
      blocked_message:
        rows.length === 0
          ? 'Nenhuma sugestão selecionada para aplicar.'
          : 'O plano atual contém apenas itens de revisão necessária. Revise os itens antes de aplicar.',
      balance_mutation_blocked: balanceMutationBlocked,
      plan_id: args.planId || null,
      selection_mode: selectionMode,
      total_considered: rowsForExecution.length,
      skipped_suggestion_ids: skippedSuggestionIds,
      applied_suggestion_ids: appliedSuggestionIds,
      failures,
      reconciliation_plan: artifacts.plan,
      pending_cases: artifacts.pendingCases,
      clarifying_questions: artifacts.clarifyingQuestions,
    };
  }

  for (const row of rowsForExecution) {
    try {
      if (row.suggestion_action === 'match_existing') {
        if (!row.item_financeiro_id) {
          throw new Error('Sugestao match_existing sem item_financeiro_id.');
        }

        await callInternalApi({
          baseUrl: args.baseUrl,
          accessToken: args.accessToken,
          path: '/api/bank-statement/reconcile/link-existing',
          method: 'POST',
          body: {
            extrato_transacao_id: row.extrato_transacao_id,
            item_financeiro_id: row.item_financeiro_id,
            idempotency_key: `${args.idempotencyKey}:match:${row.suggestion_id}`,
            valor_alocado_centavos: row.extrato_valor_centavos,
            method: 'ai',
            confidence: row.confidence ?? 0,
            explanation: row.explanation || 'Plano de conciliacao aplicado via chat (match_existing).',
          },
        });

        await markAiSuggestionAsApplied({
          baseUrl: args.baseUrl,
          accessToken: args.accessToken,
          suggestionId: row.suggestion_id,
          explanation: 'Sugestao IA aplicada via plano de conciliacao no chat (match_existing).',
        });

        affected.applied_count += 1;
        affected.match_existing_applied += 1;
        appliedSuggestionIds.push(row.suggestion_id);
        continue;
      }

      if (row.suggestion_action === 'ignore') {
        await callInternalApi({
          baseUrl: args.baseUrl,
          accessToken: args.accessToken,
          path: '/api/bank-statement/reconcile/ignore',
          method: 'POST',
          body: {
            extrato_transacao_id: row.extrato_transacao_id,
            justificativa: row.explanation || 'Ignorado via plano de conciliacao aplicado no chat.',
          },
        });

        await markAiSuggestionAsApplied({
          baseUrl: args.baseUrl,
          accessToken: args.accessToken,
          suggestionId: row.suggestion_id,
          explanation: 'Sugestao IA aplicada via plano de conciliacao no chat (ignore).',
        });

        affected.applied_count += 1;
        affected.ignore_applied += 1;
        appliedSuggestionIds.push(row.suggestion_id);
        continue;
      }

      const proposed = row.proposed_lancamento && typeof row.proposed_lancamento === 'object'
        ? row.proposed_lancamento
        : {};

      if (row.suggestion_action === 'create_new' && balanceMutationBlocked) {
        affected.blocked_create_new_count += 1;
        continue;
      }

      const valorCentavos = toNumber(proposed.valor_centavos, 0) || toCentavosFromValor(proposed.valor);
      const valor = valorCentavos > 0 ? Number((valorCentavos / 100).toFixed(2)) : Number((row.extrato_valor_centavos / 100).toFixed(2));
      const tipo =
        proposed.tipo === 'entrada' || proposed.tipo === 'saida'
          ? proposed.tipo
          : row.extrato_tipo === 'credit'
            ? 'entrada'
            : 'saida';
      const data = String(proposed.data || row.extrato_data_movimento || '').slice(0, 10) || row.extrato_data_movimento;
      const historico = String(proposed.descricao || row.extrato_descricao_raw || 'Lancamento criado pelo plano de conciliacao').trim();
      const documento = row.extrato_documento_ref || null;
      const grupoContasId = typeof proposed.categoria_id === 'string' ? proposed.categoria_id : null;
      const observacoes = typeof proposed.observacao === 'string'
        ? proposed.observacao
        : row.explanation || 'Criado via plano de conciliacao aplicado no chat.';

      await callInternalApi({
        baseUrl: args.baseUrl,
        accessToken: args.accessToken,
        path: '/api/bank-statement/reconcile/create',
        method: 'POST',
        body: {
          conta_bancaria_id: args.contaBancariaId,
          extrato_transacao_id: row.extrato_transacao_id,
          idempotency_key: `${args.idempotencyKey}:create:${row.suggestion_id}`,
          tipo,
          valor,
          valor_centavos: Math.round(valor * 100),
          data,
          historico,
          descricao: historico,
          documento,
          grupo_contas_id: grupoContasId,
          observacoes,
          method: 'ai',
          explanation: row.explanation || 'Plano de conciliacao aplicado via chat (create_new).',
        },
      });

      await markAiSuggestionAsApplied({
        baseUrl: args.baseUrl,
        accessToken: args.accessToken,
        suggestionId: row.suggestion_id,
        explanation: 'Sugestao IA aplicada via plano de conciliacao no chat (create_new).',
      });

      affected.applied_count += 1;
      affected.create_new_applied += 1;
      appliedSuggestionIds.push(row.suggestion_id);
    } catch (error: unknown) {
      affected.failed_count += 1;
      failures.push({
        suggestion_id: row.suggestion_id,
        action: row.suggestion_action,
        message: error instanceof Error ? error.message : 'Falha desconhecida ao aplicar sugestao.',
      });
    }
  }

  if (balanceMutationBlocked && affected.blocked_create_new_count > 0) {
    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      extrato_import_id: args.importId || null,
      action: 'chat_apply_create_new_blocked_policy',
      status: 'warning',
      message: 'Sugestoes create_new bloqueadas por politica sem mutacao de saldo.',
      created_by: args.userId,
      details: {
        conta_bancaria_id: args.contaBancariaId,
        data_referencia: args.dataReferencia,
        blocked_create_new_count: affected.blocked_create_new_count,
        plan_id: args.planId || null,
      },
    });
  }

  const query = new URLSearchParams({
    conta_bancaria_id: args.contaBancariaId,
    data_referencia: args.dataReferencia,
  }).toString();
  const dailySummary = await callInternalApi({
    baseUrl: args.baseUrl,
    accessToken: args.accessToken,
    path: `/api/bank-statement/daily/summary?${query}`,
    method: 'GET',
  });

  const remainingRows = await loadSuggestedPlanRows({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    dataReferencia: args.dataReferencia,
    importId: args.importId,
  });
  const artifacts = buildPlanArtifactsFromSuggestedRows({
    rows: remainingRows,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    dataReferencia: args.dataReferencia,
    importId: args.importId,
  });

  return {
    ...affected,
    balance_mutation_blocked: balanceMutationBlocked,
    plan_id: args.planId || null,
    selection_mode: selectionMode,
    total_considered: rows.length,
    skipped_suggestion_ids: skippedSuggestionIds,
    applied_suggestion_ids: appliedSuggestionIds,
    failures,
    daily_summary: dailySummary,
    reconciliation_plan: artifacts.plan,
    pending_cases: artifacts.pendingCases,
    clarifying_questions: artifacts.clarifyingQuestions,
  };
}

export async function executeBankChatReviewInteraction(
  args: ExecuteBankChatReviewInteractionArgs
): Promise<ExecuteBankChatReviewInteractionResult> {
  await ensureOfxImportEligible({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    importId: args.importId,
  });

  const pilotGate = validateBankReconciliationPilotScope(args.empresaId, args.contaBancariaId);
  if (!pilotGate.allowed) {
    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      extrato_import_id: args.importId,
      action: 'chat_guided_review_blocked_scope_gate',
      status: 'warning',
      message: 'Interacao de revisao guiada bloqueada por configuracao de escopo.',
      created_by: args.userId,
      details: {
        session_id: args.sessionId,
        conta_bancaria_id: args.contaBancariaId,
        data_referencia: args.dataReferencia,
        scope_gate_enabled: pilotGate.enabled,
        reason: pilotGate.reason,
        interaction_kind: args.interaction.kind,
      },
    });

    return {
      assistant_message:
        'Revisao guiada indisponivel neste contexto por configuracao operacional.',
      rich_content: {
        type: 'summary',
        data: {
          title: 'Revisao guiada indisponivel',
          items: [
            { label: 'Motivo', value: pilotGate.reason || 'fora do escopo configurado' },
            { label: 'Conta', value: args.contaBancariaId },
            { label: 'Data', value: args.dataReferencia },
          ],
        },
      },
      review_guidance: null,
      ui_show_operational_cards: false,
      ui_show_plan_card: false,
      ui_show_guided_card: false,
    };
  }

  if (args.interaction.kind === 'review_next') {
    let guidance = await getReviewGuidanceSnapshot({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
    });

    if (guidance.current_case?.case_id) {
      await markReviewQueueItemAsked({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        caseId: guidance.current_case.case_id,
      });
      guidance = await getReviewGuidanceSnapshot({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
      });
    }

    guidance = await enrichGuidanceWithUndoState({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      guidance,
    });

    return {
      assistant_message: buildReviewPromptFromGuidance(guidance),
      rich_content: {
        type: 'summary',
        data: {
          title: 'Revisão guiada',
          items: [
            { label: 'Pendências restantes', value: guidance.queue_remaining },
            { label: 'Total ativo', value: guidance.queue_total_active ?? guidance.queue_total },
          ],
        },
      },
      review_guidance: guidance,
      ui_show_operational_cards: false,
      ui_show_plan_card: false,
      ui_show_guided_card: true,
    };
  }

  if (args.interaction.kind === 'review_batch_confirm') {
    if (args.interaction.strategy !== 'strict_date_value') {
      throw new Error('Estratégia de lote da revisão guiada inválida.');
    }

    const activeRows = await loadActiveReviewQueueRows({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
    });

    const safeCandidateCount = activeRows.filter((row) => {
      const metadata =
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>)
          : {};
      return metadata.safe_match_candidate === true;
    }).length;

    if (safeCandidateCount === 0 && activeRows.length > 0) {
      let guidance = await getReviewGuidanceSnapshot({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
      });
      guidance = await enrichGuidanceWithUndoState({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
        guidance,
      });
      return {
        assistant_message:
          'Neste contexto não há vínculos seguros para lote. Vamos seguir item a item na revisão guiada.',
        rich_content: {
          type: 'summary',
          data: {
            title: 'Revisão guiada',
            items: [
              { label: 'Vínculos seguros', value: 0 },
              { label: 'Pendências para 1x1', value: guidance.queue_remaining },
            ],
          },
        },
        review_guidance: guidance,
        ui_show_operational_cards: false,
        ui_show_plan_card: false,
        ui_show_guided_card: true,
      };
    }

    if (activeRows.length === 0) {
      let guidance = await getReviewGuidanceSnapshot({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
      });
      guidance = await enrichGuidanceWithUndoState({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
        guidance,
      });
      return {
        assistant_message: 'Não há itens ativos para aplicar decisões rápidas neste contexto.',
        rich_content: {
          type: 'summary',
          data: {
            title: 'Decisões rápidas',
            items: [
              { label: 'Aplicados', value: 0 },
              { label: 'Pendências restantes', value: guidance.queue_remaining },
            ],
          },
        },
        review_guidance: guidance,
        ui_show_operational_cards: false,
        ui_show_plan_card: false,
        ui_show_guided_card: true,
      };
    }

    const applySafeMatches = args.interaction.apply_safe_matches !== false;
    const applyAutoDivergence = args.interaction.apply_auto_divergence !== false;
    const globalJustification = String(args.interaction.global_justification || '').trim();
    const defaultBatchDivergenceJustification =
      globalJustification ||
      'Sem vínculo automático confiável nesta fase; divergência registrada para revisão financeira posterior.';

    let safeApplied = 0;
    let divergenceApplied = 0;
    let failed = 0;

    for (const row of activeRows) {
      const metadata = row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : {};
      const safeMatchCandidate = metadata.safe_match_candidate === true;
      const autoDivergenceCandidate = metadata.auto_divergence_candidate === true;

      if ((safeMatchCandidate && !applySafeMatches) || (autoDivergenceCandidate && !applyAutoDivergence)) {
        continue;
      }

      if (!safeMatchCandidate && !autoDivergenceCandidate) {
        continue;
      }

      try {
        if (safeMatchCandidate) {
          const suggestedItemFinanceiroId =
            typeof metadata.item_financeiro_id === 'string' ? metadata.item_financeiro_id : '';
          if (!suggestedItemFinanceiroId) {
            failed += 1;
            continue;
          }

          const linkExistingPayload = await callInternalApi({
            baseUrl: args.baseUrl,
            accessToken: args.accessToken,
            path: '/api/bank-statement/reconcile/link-existing',
            method: 'POST',
            body: {
              extrato_transacao_id: row.extrato_transacao_id,
              item_financeiro_id: suggestedItemFinanceiroId,
              idempotency_key: `chat-guided-batch:${args.sessionId}:match:${row.suggestion_id}:${Date.now()}`,
              valor_alocado_centavos: toNumber(metadata.valor_centavos, 0) || null,
              method: 'ai',
              confidence: toNumber(metadata.confidence, 0),
              explanation: 'Vínculo aplicado em lote na revisão guiada (valor+data compatíveis).',
            },
          });
          const conciliacaoId = extractConciliacaoIdFromApiPayload(linkExistingPayload);

          await markAiSuggestionAsApplied({
            baseUrl: args.baseUrl,
            accessToken: args.accessToken,
            suggestionId: row.suggestion_id,
            explanation: 'Sugestão aplicada em lote na revisão guiada (vínculo seguro).',
          });

          await resolveReviewQueueItem({
            adminClient: args.adminClient,
            empresaId: args.empresaId,
            caseId: row.id,
            userId: args.userId,
            status: 'resolved',
            decision: 'approve_match',
            justification: null,
            metadataPatch: {
              batch_applied_at: new Date().toISOString(),
              batch_strategy: 'strict_date_value',
              batch_decision: 'approve_match',
              applied_item_financeiro_id: suggestedItemFinanceiroId,
            },
          });
          await safeInsertGuidedReviewActionLog({
            adminClient: args.adminClient,
            empresaId: args.empresaId,
            sessionId: args.sessionId,
            caseId: row.id,
            suggestionId: row.suggestion_id,
            extratoTransacaoId: row.extrato_transacao_id,
            decision: 'approve_match',
            justification: null,
            conciliacaoId,
            itemFinanceiroId: suggestedItemFinanceiroId,
            userId: args.userId,
            reversible: Boolean(conciliacaoId),
            metadata: {
              mode: 'batch',
              strategy: 'strict_date_value',
            },
          });
          safeApplied += 1;
          continue;
        }

        const effectiveJustification =
          defaultBatchDivergenceJustification ||
          `Sem vínculo automático confiável para "${String(metadata.descricao || row.extrato_transacao_id)}" na revisão desta fase.`;

        const ignorePayload = await callInternalApi({
          baseUrl: args.baseUrl,
          accessToken: args.accessToken,
          path: '/api/bank-statement/reconcile/ignore',
          method: 'POST',
          body: {
            extrato_transacao_id: row.extrato_transacao_id,
            justificativa: effectiveJustification,
          },
        });
        const conciliacaoId = extractConciliacaoIdFromApiPayload(ignorePayload);

        await markAiSuggestionAsApplied({
          baseUrl: args.baseUrl,
          accessToken: args.accessToken,
          suggestionId: row.suggestion_id,
          explanation: `Sugestão aplicada em lote na revisão guiada (divergência). Justificativa: ${effectiveJustification}`,
        });

        await resolveReviewQueueItem({
          adminClient: args.adminClient,
          empresaId: args.empresaId,
          caseId: row.id,
          userId: args.userId,
          status: 'resolved',
          decision: 'approve_ignore',
          justification: effectiveJustification,
          metadataPatch: {
            batch_applied_at: new Date().toISOString(),
            batch_strategy: 'strict_date_value',
            batch_decision: 'approve_ignore',
          },
        });
        await safeInsertGuidedReviewActionLog({
          adminClient: args.adminClient,
          empresaId: args.empresaId,
          sessionId: args.sessionId,
          caseId: row.id,
          suggestionId: row.suggestion_id,
          extratoTransacaoId: row.extrato_transacao_id,
          decision: 'approve_ignore',
          justification: effectiveJustification,
          conciliacaoId,
          itemFinanceiroId: null,
          userId: args.userId,
          reversible: Boolean(conciliacaoId),
          metadata: {
            mode: 'batch',
            strategy: 'strict_date_value',
          },
        });
        divergenceApplied += 1;
      } catch {
        failed += 1;
      }
    }

    const remainingRows = await loadSuggestedPlanRows({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      importId: args.importId,
    });
    const artifacts = buildPlanArtifactsFromSuggestedRows({
      rows: remainingRows,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      importId: args.importId,
    });

    await syncReviewQueueFromPlan({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      userId: args.userId,
      sessionId: args.sessionId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      plan: artifacts.plan,
    });

    let guidance = await getReviewGuidanceSnapshot({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      plan: artifacts.plan,
    });

    if (guidance.current_case?.case_id) {
      await markReviewQueueItemAsked({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        caseId: guidance.current_case.case_id,
      });
      guidance = await getReviewGuidanceSnapshot({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
        plan: artifacts.plan,
      });
    }
    guidance = await enrichGuidanceWithUndoState({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      guidance,
    });

    const nextPrompt = buildReviewPromptFromGuidance(guidance);
    const failureHint = failed > 0 ? ` ${failed} item(ns) falharam e seguem para revisão.` : '';
    const assistantMessage =
      `Decisões rápidas aplicadas: ${safeApplied} vínculo(s) e ${divergenceApplied} divergência(s).${failureHint} ${nextPrompt}`.trim();

    await logGuidedReviewAudit({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      userId: args.userId,
      importId: args.importId,
      action: 'guided_review_batch_applied',
      message: 'Decisões rápidas da revisão guiada aplicadas.',
      details: {
        session_id: args.sessionId,
        conta_bancaria_id: args.contaBancariaId,
        data_referencia: args.dataReferencia,
        safe_applied: safeApplied,
        divergence_applied: divergenceApplied,
        failed,
        queue_total: guidance.queue_total,
        queue_remaining: guidance.queue_remaining,
        queue_phase: guidance.queue_phase || null,
      },
    });

    if (Number(guidance.queue_remaining || 0) === 0) {
      await logGuidedReviewAudit({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        userId: args.userId,
        importId: args.importId,
        action: 'guided_review_completed',
        message: 'Revisão guiada concluída após aplicação em lote.',
        details: {
          session_id: args.sessionId,
          conta_bancaria_id: args.contaBancariaId,
          data_referencia: args.dataReferencia,
          completion_source: 'batch_confirm',
          safe_applied: safeApplied,
          divergence_applied: divergenceApplied,
        },
      });
    }

    return {
      assistant_message: assistantMessage,
      rich_content: {
        type: 'summary',
        data: {
          title: 'Decisões rápidas aplicadas',
          items: [
            { label: 'Vínculos aplicados', value: safeApplied },
            { label: 'Divergências aplicadas', value: divergenceApplied },
            { label: 'Falhas', value: failed },
            { label: 'Pendências restantes', value: guidance.queue_remaining },
          ],
        },
      },
      reconciliation_plan: artifacts.plan,
      pending_cases: artifacts.pendingCases,
      clarifying_questions: artifacts.clarifyingQuestions,
      review_guidance: guidance,
      ui_show_operational_cards: false,
      ui_show_plan_card: false,
      ui_show_guided_card: true,
    };
  }

  if (args.interaction.kind === 'review_undo_last') {
    const lastAction = await loadLastReversibleGuidedReviewAction({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
    });

    if (!lastAction) {
      const guidance = await enrichGuidanceWithUndoState({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
        guidance: await getReviewGuidanceSnapshot({
          adminClient: args.adminClient,
          empresaId: args.empresaId,
          sessionId: args.sessionId,
        }),
      });
      return {
        assistant_message: 'Não há decisão recente para desfazer neste contexto.',
        rich_content: {
          type: 'summary',
          data: {
            title: 'Desfazer decisão',
            items: [
              { label: 'Resultado', value: 'Nenhuma decisão reversível encontrada' },
              { label: 'Pendências restantes', value: guidance.queue_remaining },
            ],
          },
        },
        review_guidance: guidance,
        ui_show_operational_cards: false,
        ui_show_plan_card: false,
        ui_show_guided_card: true,
      };
    }

    const undoJustification = String(args.interaction.justification || '').trim() || 'Desfeito via revisão guiada.';

    if (lastAction.decision === 'approve_match') {
      if (!lastAction.conciliacao_id) {
        throw new Error('Não foi possível desfazer vínculo: conciliacao_id ausente no log.');
      }

      await callInternalApi({
        baseUrl: args.baseUrl,
        accessToken: args.accessToken,
        path: '/api/bank-statement/reconcile/reject',
        method: 'POST',
        body: {
          conciliacao_id: lastAction.conciliacao_id,
          explanation: `Desfeito via revisão guiada. ${undoJustification}`.trim(),
        },
      });
    } else {
      if (!lastAction.conciliacao_id) {
        throw new Error('Não foi possível desfazer divergência: conciliacao_id ausente no log.');
      }

      await callInternalApi({
        baseUrl: args.baseUrl,
        accessToken: args.accessToken,
        path: '/api/bank-statement/reconcile/unignore',
        method: 'POST',
        body: {
          conciliacao_id: lastAction.conciliacao_id,
          justificativa_undo: undoJustification,
        },
      });
    }

    if (lastAction.suggestion_id) {
      await markSuggestionBackToSuggested({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        suggestionId: lastAction.suggestion_id,
      }).catch(() => null);
    }

    if (lastAction.case_id) {
      await reopenGuidedQueueCase({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        caseId: lastAction.case_id,
      }).catch(() => null);
    }

    await markGuidedReviewActionAsReversed({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      actionLogId: lastAction.id,
      userId: args.userId,
      reason: undoJustification,
    });

    const remainingRows = await loadSuggestedPlanRows({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      importId: args.importId,
    });
    const artifacts = buildPlanArtifactsFromSuggestedRows({
      rows: remainingRows,
      empresaId: args.empresaId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      importId: args.importId,
    });

    await syncReviewQueueFromPlan({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      userId: args.userId,
      sessionId: args.sessionId,
      contaBancariaId: args.contaBancariaId,
      dataReferencia: args.dataReferencia,
      plan: artifacts.plan,
    });

    const guidance = await enrichGuidanceWithUndoState({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      guidance: await getReviewGuidanceSnapshot({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
        plan: artifacts.plan,
      }),
    });

    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      action: 'guided_review_undo_last',
      status: 'success',
      message: 'Última decisão da revisão guiada foi desfeita.',
      created_by: args.userId,
      details: {
        session_id: args.sessionId,
        decision: lastAction.decision,
        action_log_id: lastAction.id,
        conciliacao_id: lastAction.conciliacao_id,
      },
    });

    return {
      assistant_message: `Última decisão desfeita com sucesso. ${buildReviewPromptFromGuidance(guidance)}`.trim(),
      rich_content: {
        type: 'summary',
        data: {
          title: 'Desfazer decisão',
          items: [
            {
              label: 'Decisão desfeita',
              value: lastAction.decision === 'approve_match' ? 'Aprovar vínculo' : 'Marcar divergência',
            },
            { label: 'Pendências restantes', value: guidance.queue_remaining },
          ],
        },
      },
      reconciliation_plan: artifacts.plan,
      pending_cases: artifacts.pendingCases,
      clarifying_questions: artifacts.clarifyingQuestions,
      review_guidance: guidance,
      ui_show_operational_cards: false,
      ui_show_plan_card: false,
      ui_show_guided_card: true,
    };
  }

  if (args.interaction.kind !== 'review_answer') {
    throw new Error('Interacao de chat nao suportada.');
  }

  const caseId = String(args.interaction.case_id || '').trim();
  if (!caseId) {
    throw new Error('case_id e obrigatorio para revisar pendencias.');
  }

  const queueItem = await loadReviewQueueItemById({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    sessionId: args.sessionId,
    caseId,
  });

  if (!queueItem) {
    throw new Error('Caso da revisao guiada nao encontrado ou ja encerrado.');
  }

  if (queueItem.conta_bancaria_id !== args.contaBancariaId || queueItem.data_referencia !== args.dataReferencia) {
    throw new Error('Caso da revisao guiada pertence a outro contexto de conta/data.');
  }

  const justification = String(args.interaction.justification || '').trim();
  const metadata = queueItem.metadata && typeof queueItem.metadata === 'object'
    ? (queueItem.metadata as Record<string, unknown>)
    : {};
  const confidence = toNumber(metadata.confidence, 0);
  const valorCentavos = toNumber(metadata.valor_centavos, 0);
  const defaultDivergenceJustification = `Sem vínculo automático confiável para "${String(metadata.descricao || queueItem.extrato_transacao_id)}" na revisão desta fase.`;
  const suggestedItemFinanceiroId =
    typeof metadata.item_financeiro_id === 'string' ? String(metadata.item_financeiro_id) : null;
  const selectedItemFinanceiroId =
    String(args.interaction.item_financeiro_id || '').trim() || suggestedItemFinanceiroId || null;

  let decisionFeedback = '';

  if (args.interaction.decision === 'approve_ignore') {
    const effectiveJustification =
      justification ||
      (queueItem.source_action === 'create_new' ? defaultDivergenceJustification : '');

    if (!effectiveJustification) {
      await markReviewQueueItemAsked({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        caseId: queueItem.id,
      });

      const guidance = await enrichGuidanceWithUndoState({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
        guidance: await getReviewGuidanceSnapshot({
          adminClient: args.adminClient,
          empresaId: args.empresaId,
          sessionId: args.sessionId,
        }),
      });

      return {
        assistant_message:
          'Para marcar divergência, preciso da justificativa deste item.',
        rich_content: {
          type: 'summary',
          data: {
            title: 'Justificativa obrigatória',
            items: [
              { label: 'Item', value: guidance.current_case?.descricao || queueItem.extrato_transacao_id },
              { label: 'Ação', value: 'Ignorar com justificativa' },
            ],
          },
        },
        review_guidance: guidance,
        ui_show_operational_cards: false,
        ui_show_plan_card: false,
        ui_show_guided_card: true,
      };
    }

    const ignorePayload = await callInternalApi({
      baseUrl: args.baseUrl,
      accessToken: args.accessToken,
      path: '/api/bank-statement/reconcile/ignore',
      method: 'POST',
      body: {
        extrato_transacao_id: queueItem.extrato_transacao_id,
        justificativa: effectiveJustification,
      },
    });
    const conciliacaoId = extractConciliacaoIdFromApiPayload(ignorePayload);

    await markAiSuggestionAsApplied({
      baseUrl: args.baseUrl,
      accessToken: args.accessToken,
      suggestionId: queueItem.suggestion_id,
      explanation: `Sugestao aplicada via revisao guiada no chat (divergencia). Justificativa: ${effectiveJustification}`,
    });

    await resolveReviewQueueItem({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      caseId: queueItem.id,
      userId: args.userId,
      status: 'resolved',
      decision: 'approve_ignore',
      justification: effectiveJustification,
      metadataPatch: {
        applied_via: 'chat_guided_review',
        applied_at: new Date().toISOString(),
      },
    });
    await safeInsertGuidedReviewActionLog({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      caseId: queueItem.id,
      suggestionId: queueItem.suggestion_id,
      extratoTransacaoId: queueItem.extrato_transacao_id,
      decision: 'approve_ignore',
      justification: effectiveJustification,
      conciliacaoId,
      itemFinanceiroId: null,
      userId: args.userId,
      reversible: Boolean(conciliacaoId),
      metadata: {
        mode: 'guided_1x1',
        source_action: queueItem.source_action,
      },
    });

    decisionFeedback =
      queueItem.source_action === 'create_new'
        ? 'Divergência registrada com justificativa.'
        : 'Item ignorado com justificativa.';
  } else if (args.interaction.decision === 'approve_match') {
    if (!selectedItemFinanceiroId) {
      await markReviewQueueItemAsked({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        caseId: queueItem.id,
      });

      const guidance = await enrichGuidanceWithUndoState({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        sessionId: args.sessionId,
        guidance: await getReviewGuidanceSnapshot({
          adminClient: args.adminClient,
          empresaId: args.empresaId,
          sessionId: args.sessionId,
        }),
      });

      return {
        assistant_message:
          'Para aprovar o vínculo, informe o código do lançamento.',
        rich_content: {
        type: 'summary',
        data: {
          title: 'Vínculo necessário',
          items: [
            { label: 'Extrato', value: queueItem.extrato_transacao_id },
            { label: 'Próximo passo', value: 'Informar código do lançamento' },
          ],
        },
      },
        review_guidance: guidance,
        ui_show_operational_cards: false,
        ui_show_plan_card: false,
        ui_show_guided_card: true,
      };
    }

    const linkExistingPayload = await callInternalApi({
      baseUrl: args.baseUrl,
      accessToken: args.accessToken,
      path: '/api/bank-statement/reconcile/link-existing',
      method: 'POST',
      body: {
        extrato_transacao_id: queueItem.extrato_transacao_id,
        item_financeiro_id: selectedItemFinanceiroId,
        idempotency_key: `chat-guided:${args.sessionId}:match:${queueItem.suggestion_id}:${Date.now()}`,
        valor_alocado_centavos: valorCentavos > 0 ? valorCentavos : null,
        method: 'ai',
        confidence,
        explanation:
          justification || 'Sugestao aplicada via revisao guiada do chat (approve_match).',
      },
    });
    const conciliacaoId = extractConciliacaoIdFromApiPayload(linkExistingPayload);

    await markAiSuggestionAsApplied({
      baseUrl: args.baseUrl,
      accessToken: args.accessToken,
      suggestionId: queueItem.suggestion_id,
      explanation: 'Sugestao aplicada via revisao guiada no chat (match_existing).',
    });

    await resolveReviewQueueItem({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      caseId: queueItem.id,
      userId: args.userId,
      status: 'resolved',
      decision: 'approve_match',
      justification: justification || null,
      metadataPatch: {
        applied_item_financeiro_id: selectedItemFinanceiroId,
        applied_via: 'chat_guided_review',
        applied_at: new Date().toISOString(),
      },
    });
    await safeInsertGuidedReviewActionLog({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      caseId: queueItem.id,
      suggestionId: queueItem.suggestion_id,
      extratoTransacaoId: queueItem.extrato_transacao_id,
      decision: 'approve_match',
      justification: justification || null,
      conciliacaoId,
      itemFinanceiroId: selectedItemFinanceiroId,
      userId: args.userId,
      reversible: Boolean(conciliacaoId),
      metadata: {
        mode: 'guided_1x1',
        source_action: queueItem.source_action,
      },
    });

    decisionFeedback = 'Vínculo aprovado e aplicado.';
  } else if (args.interaction.decision === 'keep_pending') {
    await resolveReviewQueueItem({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      caseId: queueItem.id,
      userId: args.userId,
      status: 'deferred',
      decision: 'keep_pending',
      justification: justification || null,
      metadataPatch: {
        deferred_via: 'chat_guided_review',
        deferred_at: new Date().toISOString(),
      },
    });
    decisionFeedback = 'Item pulado por enquanto.';
  } else if (args.interaction.decision === 'open_manual_review') {
    await resolveReviewQueueItem({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      caseId: queueItem.id,
      userId: args.userId,
      status: 'resolved',
      decision: 'open_manual_review',
      justification: justification || null,
      metadataPatch: {
        manual_review_requested: true,
        manual_review_requested_at: new Date().toISOString(),
      },
    });
    await safeInsertGuidedReviewActionLog({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      caseId: queueItem.id,
      suggestionId: queueItem.suggestion_id,
      extratoTransacaoId: queueItem.extrato_transacao_id,
      decision: 'open_manual_review',
      justification: justification || null,
      conciliacaoId: null,
      itemFinanceiroId: null,
      userId: args.userId,
      reversible: false,
      metadata: {
        mode: 'guided_1x1',
        source_action: queueItem.source_action,
      },
    });
    decisionFeedback = 'Item enviado para revisão manual.';
  } else {
    throw new Error('Decisão de revisão guiada inválida.');
  }

  const remainingRows = await loadSuggestedPlanRows({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    dataReferencia: args.dataReferencia,
    importId: args.importId,
  });
  const artifacts = buildPlanArtifactsFromSuggestedRows({
    rows: remainingRows,
    empresaId: args.empresaId,
    contaBancariaId: args.contaBancariaId,
    dataReferencia: args.dataReferencia,
    importId: args.importId,
  });

  await syncReviewQueueFromPlan({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    userId: args.userId,
    sessionId: args.sessionId,
    contaBancariaId: args.contaBancariaId,
    dataReferencia: args.dataReferencia,
    plan: artifacts.plan,
  });

  let guidance = await getReviewGuidanceSnapshot({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    sessionId: args.sessionId,
    plan: artifacts.plan,
  });

  if (guidance.current_case?.case_id) {
    await markReviewQueueItemAsked({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      caseId: guidance.current_case.case_id,
    });
    guidance = await getReviewGuidanceSnapshot({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      sessionId: args.sessionId,
      plan: artifacts.plan,
    });
  }
  guidance = await enrichGuidanceWithUndoState({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    sessionId: args.sessionId,
    guidance,
  });

  const nextPrompt = buildReviewPromptFromGuidance(guidance);
  const assistantMessage = `${decisionFeedback} ${nextPrompt}`.trim();

  await logGuidedReviewAudit({
    adminClient: args.adminClient,
    empresaId: args.empresaId,
    userId: args.userId,
    importId: args.importId,
    action: 'guided_review_step_resolved',
    message: 'Passo da revisão guiada resolvido.',
    details: {
      session_id: args.sessionId,
      conta_bancaria_id: args.contaBancariaId,
      data_referencia: args.dataReferencia,
      case_id: queueItem.id,
      suggestion_id: queueItem.suggestion_id,
      extrato_transacao_id: queueItem.extrato_transacao_id,
      source_action: queueItem.source_action,
      decision: args.interaction.decision,
      queue_total: guidance.queue_total,
      queue_remaining: guidance.queue_remaining,
      queue_phase: guidance.queue_phase || null,
    },
  });

  if (Number(guidance.queue_remaining || 0) === 0) {
    await logGuidedReviewAudit({
      adminClient: args.adminClient,
      empresaId: args.empresaId,
      userId: args.userId,
      importId: args.importId,
      action: 'guided_review_completed',
      message: 'Revisão guiada concluída após resolução item a item.',
      details: {
        session_id: args.sessionId,
        conta_bancaria_id: args.contaBancariaId,
        data_referencia: args.dataReferencia,
        completion_source: 'review_answer',
        final_decision: args.interaction.decision,
      },
    });
  }

  return {
    assistant_message: assistantMessage,
    rich_content: {
      type: 'summary',
      data: {
        title: 'Revisão guiada',
        items: [
          { label: 'Resultado', value: decisionFeedback },
          { label: 'Pendências restantes', value: guidance.queue_remaining },
          { label: 'Total da fila', value: guidance.queue_total_active ?? guidance.queue_total },
        ],
      },
    },
    reconciliation_plan: artifacts.plan,
    pending_cases: artifacts.pendingCases,
    clarifying_questions: artifacts.clarifyingQuestions,
    review_guidance: guidance,
    ui_show_operational_cards: false,
    ui_show_plan_card: false,
    ui_show_guided_card: true,
  };
}

export async function executeBankChatAction(
  args: ExecuteBankChatActionArgs
): Promise<ExecuteBankChatActionResult> {
  const {
    adminClient,
    baseUrl,
    accessToken,
    empresaId,
    userId,
    contaBancariaId,
    dataReferencia,
    importId,
    sessionId,
    action,
    idempotencyKey,
    planId,
  } = args;
  const guidedReviewPilotGate = validateBankReconciliationPilotScope(empresaId, contaBancariaId);
  const isLegacyAlias = action === 'matching' || action === 'trigger_ai';
  const effectiveAction: BankChatActionKind = isLegacyAlias ? 'run_daily_reconciliation' : action;

  const { data: existing, error: existingError } = await adminClient
    .from('bank_reconciliation_chat_action_idempotency')
    .select('result_json')
    .eq('empresa_id', empresaId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Falha ao validar idempotencia da acao de chat: ${existingError.message}`);
  }

  if (existing?.result_json && typeof existing.result_json === 'object') {
    return {
      ...(existing.result_json as ExecuteBankChatActionResult),
      reused: true,
    };
  }

  let payload: Record<string, unknown>;

  if (isLegacyAlias) {
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: importId || null,
      action: 'chat_legacy_action_alias_used',
      status: 'info',
      message: 'Ação legada de chat roteada para conciliação canônica.',
      created_by: userId,
      details: {
        requested_action: action,
        effective_action: effectiveAction,
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
      },
    }).catch(() => null);
  }

  if (effectiveAction === 'refresh_summary') {
    const query = new URLSearchParams({
      conta_bancaria_id: contaBancariaId,
      data_referencia: dataReferencia,
    }).toString();

    payload = await callInternalApi({
      baseUrl,
      accessToken,
      path: `/api/bank-statement/daily/summary?${query}`,
      method: 'GET',
    });
  } else if (effectiveAction === 'run_daily_reconciliation') {
    payload = await executeRunDailyReconciliation(args);
  } else if (effectiveAction === 'apply_reconciliation_plan') {
    payload = await executeApplyReconciliationPlan(args);
  } else if (effectiveAction === 'daily_close' || effectiveAction === 'daily_reopen') {
    const path = effectiveAction === 'daily_close'
      ? '/api/bank-statement/daily/close'
      : '/api/bank-statement/daily/reopen';

    const operationPayload = await callInternalApi({
      baseUrl,
      accessToken,
      path,
      method: 'POST',
      body: {
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
      },
    });

    const query = new URLSearchParams({
      conta_bancaria_id: contaBancariaId,
      data_referencia: dataReferencia,
    }).toString();
    const summaryPayload = await callInternalApi({
      baseUrl,
      accessToken,
      path: `/api/bank-statement/daily/summary?${query}`,
      method: 'GET',
    });

    payload = {
      ...operationPayload,
      daily_operation: operationPayload,
      data:
        summaryPayload.data && typeof summaryPayload.data === 'object'
          ? (summaryPayload.data as Record<string, unknown>)
          : null,
      summary_response: summaryPayload,
    };
  } else {
    throw new Error(`Acao de chat nao suportada: ${String(effectiveAction)}`);
  }

  let mapped = mapActionResultToAssistantMessage(effectiveAction, payload);
  const reconciliationPlan =
    payload.reconciliation_plan && typeof payload.reconciliation_plan === 'object'
      ? (payload.reconciliation_plan as ChatReconciliationPlan)
      : null;
  const clarifyingQuestions = Array.isArray(payload.clarifying_questions)
    ? (payload.clarifying_questions as ChatClarifyingQuestion[])
    : null;
  const pendingCases = Array.isArray(payload.pending_cases)
    ? (payload.pending_cases as ChatPendingCase[])
    : null;
  const aiProcessingStatus =
    payload.ai_processing_status && typeof payload.ai_processing_status === 'object'
      ? (payload.ai_processing_status as ChatAiProcessingStatus)
      : null;
  const aiPolling =
    payload.ai_polling && typeof payload.ai_polling === 'object'
      ? ({
        attempts: toNumber((payload.ai_polling as Record<string, unknown>).attempts),
        elapsed_ms: toNumber((payload.ai_polling as Record<string, unknown>).elapsed_ms),
        outcome: String((payload.ai_polling as Record<string, unknown>).outcome || 'failed') as
          | 'completed'
          | 'timeout'
          | 'no_pending'
          | 'failed',
      })
      : null;
  const correlationId = safeString(payload.correlation_id);
  const appliedSuggestionIds = Array.isArray(payload.applied_suggestion_ids)
    ? payload.applied_suggestion_ids.map(String)
    : undefined;
  const skippedSuggestionIds = Array.isArray(payload.skipped_suggestion_ids)
    ? payload.skipped_suggestion_ids.map(String)
    : undefined;
  const failedItems = Array.isArray(payload.failures)
    ? payload.failures
      .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      .map((item) => ({
        suggestion_id: typeof item.suggestion_id === 'string' ? item.suggestion_id : undefined,
        action: typeof item.action === 'string' ? item.action : undefined,
        message: String(item.message || 'Falha ao aplicar sugestão.'),
      }))
    : undefined;

  let reviewGuidance: ChatReviewGuidance | null = null;
  if ((effectiveAction === 'run_daily_reconciliation' || effectiveAction === 'apply_reconciliation_plan') && sessionId) {
    if (guidedReviewPilotGate.allowed) {
      await syncReviewQueueFromPlan({
        adminClient,
        empresaId,
        userId,
        sessionId,
        contaBancariaId,
        dataReferencia,
        plan: reconciliationPlan,
      }).catch(() => null);

      reviewGuidance = await getReviewGuidanceSnapshot({
        adminClient,
        empresaId,
        sessionId,
        plan: reconciliationPlan,
      }).catch(() => null);

      if (reviewGuidance?.current_case?.case_id) {
        await markReviewQueueItemAsked({
          adminClient,
          empresaId,
          caseId: reviewGuidance.current_case.case_id,
        }).catch(() => null);
        reviewGuidance = await getReviewGuidanceSnapshot({
          adminClient,
          empresaId,
          sessionId,
          plan: reconciliationPlan,
        }).catch(() => reviewGuidance);
      }
      if (
        effectiveAction === 'run_daily_reconciliation' &&
        (reviewGuidance?.current_case || reviewGuidance?.queue_phase === 'pre_batch')
      ) {
        mapped = {
          ...mapped,
          message: `${mapped.message} ${buildReviewPromptFromGuidance(reviewGuidance)}`.trim(),
        };
      }
    } else {
      await safeInsertBankAuditLog(adminClient, {
        empresa_id: empresaId,
        extrato_import_id: importId,
        action: 'chat_guided_review_blocked_scope_gate',
        status: 'warning',
        message: 'Revisao guiada nao sincronizada para esta execucao por configuracao de escopo.',
        created_by: userId,
        details: {
          session_id: sessionId,
          conta_bancaria_id: contaBancariaId,
          data_referencia: dataReferencia,
          action: effectiveAction,
          scope_gate_enabled: guidedReviewPilotGate.enabled,
          reason: guidedReviewPilotGate.reason,
        },
      });
    }
  }

  if (effectiveAction === 'run_daily_reconciliation' && reviewGuidance) {
    const queueRemaining = Number(reviewGuidance.queue_remaining || 0);
    if (mapped.affectedCounts) {
      mapped = {
        ...mapped,
        affectedCounts: {
          ...mapped.affectedCounts,
          perguntas_ia: queueRemaining,
        },
      };
    }

    if (mapped.richContent?.type === 'summary' && mapped.richContent.data && typeof mapped.richContent.data === 'object') {
      const richData = mapped.richContent.data as Record<string, unknown>;
      const items = Array.isArray(richData.items) ? richData.items : [];
      if (items.length > 0) {
        const nextItems = items.map((item) => {
          if (!item || typeof item !== 'object') return item;
          const row = item as Record<string, unknown>;
          if (String(row.label || '').toLowerCase() !== 'itens para revisão guiada') return item;
          return {
            ...row,
            value: queueRemaining,
          };
        });
        mapped = {
          ...mapped,
          richContent: {
            ...mapped.richContent,
            data: {
              ...richData,
              items: nextItems,
            },
          },
        };
      }
    }

    if (queueRemaining > 0) {
      await logGuidedReviewAudit({
        adminClient,
        empresaId,
        userId,
        importId,
        action: 'guided_review_started',
        message: 'Revisão guiada iniciada para o contexto da execução diária.',
        details: {
          session_id: sessionId || null,
          conta_bancaria_id: contaBancariaId,
          data_referencia: dataReferencia,
          queue_total: reviewGuidance.queue_total,
          queue_remaining: reviewGuidance.queue_remaining,
          queue_phase: reviewGuidance.queue_phase || null,
        },
      });
    }
  }

  const hasGuidedCard =
    Boolean(reviewGuidance) &&
    (Number(reviewGuidance?.queue_total || 0) > 0 || reviewGuidance?.display_mode === 'guided_completed');
  const planTotal = Number(reconciliationPlan?.totals?.total || 0);
  const shouldShowPlanCard = Boolean(reconciliationPlan) && planTotal > 0 && !hasGuidedCard;

  const result: ExecuteBankChatActionResult = {
    ok: true,
    action: effectiveAction,
    idempotency_key: idempotencyKey,
    executed_at: new Date().toISOString(),
    result: payload,
    assistant_message: mapped.message,
    ...(mapped.richContent ? { rich_content: mapped.richContent } : {}),
    ...(mapped.executionSummary ? { execution_summary: mapped.executionSummary } : {}),
    ...(mapped.affectedCounts ? { affected_counts: mapped.affectedCounts } : {}),
    ...(reconciliationPlan ? { reconciliation_plan: reconciliationPlan } : {}),
    ...(clarifyingQuestions ? { clarifying_questions: clarifyingQuestions } : {}),
    ...(pendingCases ? { pending_cases: pendingCases } : {}),
    ...(aiProcessingStatus ? { ai_processing_status: aiProcessingStatus } : {}),
    ...(aiPolling ? { ai_polling: aiPolling } : {}),
    ...(correlationId ? { correlation_id: correlationId } : {}),
    ...(appliedSuggestionIds ? { applied_suggestion_ids: appliedSuggestionIds } : {}),
    ...(skippedSuggestionIds ? { skipped_suggestion_ids: skippedSuggestionIds } : {}),
    ...(failedItems ? { failed_items: failedItems } : {}),
    ...(reviewGuidance ? { review_guidance: reviewGuidance } : {}),
    ui_show_operational_cards: false,
    ui_show_plan_card: shouldShowPlanCard,
    ui_show_guided_card: hasGuidedCard,
  };

  const { error: insertError } = await adminClient
    .from('bank_reconciliation_chat_action_idempotency')
    .insert({
      empresa_id: empresaId,
      user_id: userId,
      idempotency_key: idempotencyKey,
      action: effectiveAction,
      result_json: result,
    });

  if (insertError && insertError.code !== '23505') {
    throw new Error(`Falha ao salvar idempotencia da acao de chat: ${insertError.message}`);
  }

  if (insertError?.code === '23505') {
    const { data: duplicateRow } = await adminClient
      .from('bank_reconciliation_chat_action_idempotency')
      .select('result_json')
      .eq('empresa_id', empresaId)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (duplicateRow?.result_json && typeof duplicateRow.result_json === 'object') {
      return {
        ...(duplicateRow.result_json as ExecuteBankChatActionResult),
        reused: true,
      };
    }
  }

  return result;
}
