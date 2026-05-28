import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatAiProcessingStatus,
  ChatClarifyingQuestion,
  ChatActionPreviewPayload,
  ChatLastExecutionSummary,
  ChatMessageInteraction,
  ChatPendingActionState,
  ChatPendingCase,
  ChatPlanConfidenceBand,
  ChatReconciliationPlan,
  ChatReviewGuidance,
  ChatSuggestedNextAction,
  RichMessageContent,
} from '../../../types/bank-reconciliation.js';
import {
  getBankReconciliationAgentWebhookUrl,
  isBankReconciliationBalanceMutationDisabled,
  getBankReconciliationChatAgentMode,
  getBankReconciliationChatIntegrationSecret,
  getBankReconciliationChatTimeoutMs,
  getBankReconciliationChatWebhookUrl,
  safeInsertBankAuditLog,
  validateBankReconciliationPilotScope,
} from '../_shared.js';
import {
  buildBankReconciliationChatContext,
  type ChatContextSnapshot,
} from './contextBuilder.js';
import { routeBankChatIntent } from './intentRouter.js';
import {
  executeBankChatAction,
  executeBankChatReviewInteraction,
  type BankChatActionKind,
} from './actionExecutor.js';
import { BankReconciliationAgent, type AgentContext } from './agent.js';
import { loadChatExecutionStateSnapshot, type ChatExecutionStateSnapshot } from './executionState.js';
import { getReviewGuidanceSnapshot, syncReviewQueueFromPlan } from './reviewQueue.js';

type ChatRole = 'user' | 'assistant';

export interface ChatSessionRow {
  id: string;
  empresa_id: string;
  user_id: string;
  conta_bancaria_id: string | null;
  data_referencia: string | null;
  session_key: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  archived_at?: string | null;
  archived_by?: string | null;
  archived_reason?: string | null;
}

export interface ChatMessageRow {
  id: string;
  session_id: string;
  empresa_id: string;
  role: ChatRole;
  content: string;
  rich_content: RichMessageContent | null;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChatMessageOrchestratorInput {
  adminClient: SupabaseClient;
  empresaId: string;
  userId: string;
  accessToken?: string;
  baseUrl?: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId?: string | null;
  message: string;
  sessionId?: string | null;
  activeExtratoTransacaoId?: string | null;
  importBootstrap?: {
    originalFilenames: string[];
  } | null;
  interaction?: ChatMessageInteraction | null;
}

export interface ChatMessageOrchestratorResult {
  session: ChatSessionRow;
  user_message: ChatMessageRow;
  assistant_message: ChatMessageRow;
  action_preview?: ChatActionPreviewPayload;
  context_snapshot: ChatContextSnapshot;
  reconciliation_plan?: ChatReconciliationPlan | null;
  clarifying_questions?: ChatClarifyingQuestion[] | null;
  pending_cases?: ChatPendingCase[] | null;
  pending_action_state?: ChatPendingActionState | null;
  ai_processing_status?: ChatAiProcessingStatus | null;
  last_execution_summary?: ChatLastExecutionSummary | null;
  suggested_next_actions?: ChatSuggestedNextAction[] | null;
  review_guidance?: ChatReviewGuidance | null;
  ui_show_operational_cards?: boolean;
  ui_show_plan_card?: boolean;
  ui_show_guided_card?: boolean;
}

const toDateOnly = (value: string | null | undefined): string => {
  const normalized = String(value || '').trim();
  if (!normalized) return new Date().toISOString().slice(0, 10);
  return normalized.slice(0, 10);
};

const buildSessionKey = (contaId: string, dataReferencia: string): string => {
  return `bank-reconciliation:${contaId}:${toDateOnly(dataReferencia)}:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2, 10)}`;
};

const formatDateLabel = (date: string): string => {
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
};

const normalizeMessage = (text: string): string => String(text || '').trim();
const normalizeForMatch = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
const TEXT_CONFIRM_TTL_MS = 5 * 60 * 1000;
const isArchivedColumnMissingError = (message: string): boolean =>
  /archived_at/i.test(message) && /(column|schema cache)/i.test(message);

const ASSIST_AGENT_INTENTS = new Set<string>([
  'question',
  'execution_status_query',
  'execution_details_query',
  'update_plan_status',
]);

const GUIDED_REVIEW_SUMMARY_LABELS = new Set([
  'itens em revisão guiada',
  'itens para revisão guiada',
]);

function patchGuidedReviewCountInRichContent(
  richContent: RichMessageContent | undefined,
  queueRemaining: number
): RichMessageContent | undefined {
  if (!richContent || richContent.type !== 'summary' || !richContent.data || typeof richContent.data !== 'object') {
    return richContent;
  }
  const richData = richContent.data as Record<string, unknown>;
  const items = Array.isArray(richData.items) ? richData.items : [];
  if (items.length === 0) return richContent;

  let changed = false;
  const nextItems = items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const row = item as Record<string, unknown>;
    const label = String(row.label || '').trim().toLowerCase();
    if (!GUIDED_REVIEW_SUMMARY_LABELS.has(label)) return item;
    changed = true;
    return {
      ...row,
      value: queueRemaining,
    };
  });

  if (!changed) return richContent;
  return {
    ...richContent,
    data: {
      ...richData,
      items: nextItems,
    },
  };
}

const LOCAL_OPERATIONAL_INTENTS = new Set<string>([
  'confirm_pending_action',
  'cancel_pending_action',
  'matching',
  'trigger_ai',
  'refresh_summary',
  'run_daily_reconciliation',
  'apply_reconciliation_plan',
  'resolve_pending_issues',
  'daily_close',
  'daily_reopen',
]);

type RunDailyStatefulRerouteDecision =
  | 'apply_reconciliation_plan'
  | 'show_processing_status'
  | 'allow_preview';

export function resolveRunDailyStatefulReroute(args: {
  shouldApplyStatefulReroute: boolean;
  latestPlanTotal: number;
  shouldTreatAsIaStillProcessing: boolean;
  allowProcessingShortcutWithoutPlan?: boolean;
}): RunDailyStatefulRerouteDecision {
  if (!args.shouldApplyStatefulReroute) return 'allow_preview';
  if (args.latestPlanTotal > 0) return 'apply_reconciliation_plan';

  // P0: pedido explícito de conciliação diária não deve ser bloqueado por estado antigo
  // de processing/timeout quando ainda não há plano pendente.
  const allowProcessingShortcutWithoutPlan = args.allowProcessingShortcutWithoutPlan === true;
  if (args.shouldTreatAsIaStillProcessing && allowProcessingShortcutWithoutPlan) {
    return 'show_processing_status';
  }

  return 'allow_preview';
}

function hasFailedTriggerWithoutDispatch(
  snapshot: ChatExecutionStateSnapshot | null | undefined
): boolean {
  if (!snapshot) return false;
  if (snapshot.aiProcessingStatus?.state !== 'failed') return false;

  const lastAction = snapshot.lastExecutionSummary?.action;
  const affectedCounts = snapshot.lastExecutionSummary?.affected_counts || snapshot.affectedCounts || {};

  if (lastAction === 'trigger_ai') {
    return Number(affectedCounts.triggered || 0) === 0;
  }
  if (lastAction === 'run_daily_reconciliation') {
    return Number(affectedCounts.ai_triggered || 0) === 0;
  }
  return false;
}

const GUIDED_REVIEW_CONTINUE_PHRASES = [
  'continuar revisao guiada',
  'continuar revisão guiada',
  'continuar revisao',
  'continuar revisão',
  'proximo item',
  'próximo item',
];

function isContinueGuidedReviewRequest(normalizedMessage: string): boolean {
  return GUIDED_REVIEW_CONTINUE_PHRASES.some((phrase) => normalizedMessage.includes(phrase));
}

function buildGuidedReviewAnswer(guidance: ChatReviewGuidance): { content: string; richContent: RichMessageContent } {
  if (guidance.display_mode === 'guided_completed' || guidance.queue_phase === 'completed' || guidance.queue_remaining === 0) {
    const resolved = Number(guidance.final_summary?.resolved || 0);
    return {
      content: `Revisão guiada concluída. ${resolved} item(ns) resolvido(s).`,
      richContent: {
        type: 'summary',
        data: {
          title: 'Revisão guiada concluída',
          items: [
            { label: 'Itens resolvidos', value: resolved },
            { label: 'Pendências restantes', value: Number(guidance.final_summary?.unresolved || 0) },
          ],
        },
      },
    };
  }

  if (guidance.queue_phase === 'pre_batch' && guidance.batch_offer) {
    return {
      content:
        `Posso aplicar ${guidance.batch_offer.safe_match_count} vínculo(s) seguro(s) em lote` +
        `${guidance.batch_offer.auto_divergence_count > 0 ? ` e registrar ${guidance.batch_offer.auto_divergence_count} divergência(s)` : ''}.`,
      richContent: {
        type: 'summary',
        data: {
          title: 'Decisões rápidas disponíveis',
          items: [
            { label: 'Vínculos seguros', value: guidance.batch_offer.safe_match_count },
            { label: 'Divergências', value: guidance.batch_offer.auto_divergence_count },
            { label: 'Exceções 1x1', value: guidance.batch_offer.exceptions_count },
          ],
        },
      },
    };
  }

  if (guidance.current_case) {
    return {
      content:
        `Item ${Number(guidance.current_position || 1)} de ${Number(guidance.queue_total || guidance.queue_remaining || 1)}. ` +
        `${guidance.current_case.question}`,
      richContent: {
        type: 'summary',
        data: {
          title: 'Revisão guiada',
          items: [
            { label: 'Pendências restantes', value: guidance.queue_remaining },
            { label: 'Descrição', value: guidance.current_case.descricao || guidance.current_case.extrato_transacao_id },
            { label: 'Valor', value: guidance.current_case.valor_centavos != null ? `R$ ${(guidance.current_case.valor_centavos / 100).toFixed(2)}` : '—' },
            { label: 'Data', value: guidance.current_case.data_movimento || '—' },
          ],
        },
      },
    };
  }

  return {
    content: 'Não há itens ativos na revisão guiada neste contexto.',
    richContent: {
      type: 'summary',
      data: {
        title: 'Revisão guiada',
        items: [{ label: 'Pendências restantes', value: guidance.queue_remaining }],
      },
    },
  };
}

function buildImportBootstrapAnswer(args: {
  contextSnapshot: ChatContextSnapshot;
  originalFilenames: string[];
}): { content: string; richContent: RichMessageContent } {
  const context = args.contextSnapshot;
  const totalRows =
    Number(context.status_counts.conciliado || 0) +
    Number(context.status_counts.divergente || 0) +
    Number(context.status_counts.sugerido || 0) +
    Number(context.status_counts.pendente || 0);
  const fileLabel = String(args.originalFilenames[0] || '').trim() || 'OFX';
  const periodoInicio = String(context.import_periodo_inicio || '').trim();
  const periodoFim = String(context.import_periodo_fim || '').trim();
  const periodoLabel =
    periodoInicio && periodoFim
      ? `${formatDateLabel(periodoInicio)} - ${formatDateLabel(periodoFim)}`
      : periodoInicio || periodoFim
        ? formatDateLabel(periodoInicio || periodoFim)
        : formatDateLabel(context.data_referencia);

  if (context.import_parse_status !== 'parsed') {
    const status = context.import_parse_status || 'desconhecido';
    return {
      content:
        `Recebi o OFX "${fileLabel}", mas ele ainda não ficou pronto para conciliar.` +
        ` Status atual: ${status}.${context.import_error_message ? ` Motivo: ${context.import_error_message}` : ''}`,
      richContent: {
        type: 'summary',
        data: {
          title: 'Importação do OFX',
          items: [
            { label: 'Conta', value: context.conta_label || context.conta_bancaria_id },
            { label: 'Período', value: periodoLabel },
            { label: 'Status do import', value: status },
          ],
        },
      },
    };
  }

  return {
    content:
      `OFX carregado para ${context.conta_label || 'a conta selecionada'}. ` +
      `Período ${periodoLabel}. Encontrei ${totalRows} linha(s) no extrato. ` +
      'A lista já está pronta na tela; clique em Conciliar quando quiser gerar os vínculos e as exceções.',
    richContent: {
      type: 'summary',
      data: {
        title: 'OFX carregado',
        items: [
          { label: 'Conta', value: context.conta_label || context.conta_bancaria_id },
          { label: 'Período', value: periodoLabel },
          { label: 'Linhas do extrato', value: totalRows },
          { label: 'Pendências no contexto', value: context.pendencias_criticas },
        ],
      },
    },
  };
}

function buildCanonicalSuggestedNextActions(args: {
  aiProcessingStatus: ChatAiProcessingStatus | null;
  reconciliationPlan: ChatReconciliationPlan | null;
  reviewGuidance: ChatReviewGuidance | null;
  fallbackActions: ChatSuggestedNextAction[] | null;
  ofxRequired?: boolean;
}): ChatSuggestedNextAction[] {
  if (args.ofxRequired) {
    return [
      {
        action: 'import_ofx',
        label: 'Importar OFX',
        reason: 'CSV está em quarentena nesta etapa para conciliação confiável.',
      },
      {
        action: 'update_plan_status',
        label: 'Atualizar contexto',
        reason: 'Após importar OFX, recarregue o plano de conciliação.',
      },
    ];
  }

  if (args.reviewGuidance) {
    if (Number(args.reviewGuidance.queue_remaining || 0) > 0) {
      return [
        { action: 'question', label: 'Continuar revisão guiada', reason: 'Responder o próximo item da fila.' },
        { action: 'update_plan_status', label: 'Atualizar plano', reason: 'Recarregar fila e status do contexto.' },
      ];
    }

    if (args.reviewGuidance.display_mode === 'guided_completed' || args.reviewGuidance.queue_phase === 'completed') {
      return [
        { action: 'update_plan_status', label: 'Atualizar plano', reason: 'Conferir se restaram pendências no contexto.' },
        { action: 'question', label: 'Quais pendências críticas?', reason: 'Ver resumo final do contexto.' },
      ];
    }
  }

  const planTotal = Number(args.reconciliationPlan?.totals?.total || 0);
  if (planTotal > 0) {
    return [
      { action: 'apply_reconciliation_plan', label: 'Aplicar plano de conciliação', reason: 'Há sugestões pendentes.' },
      { action: 'resolve_pending_issues', label: 'Corrigir pendências', reason: 'Revisar itens antes de aplicar.' },
      { action: 'question', label: 'Quais pendências críticas?', reason: 'Entender o que ainda falta.' },
    ];
  }

  const aiState = args.aiProcessingStatus?.state || null;
  if (aiState === 'processing' || aiState === 'triggered' || aiState === 'polling' || aiState === 'timeout') {
    return [
      { action: 'update_plan_status', label: 'Atualizar plano', reason: 'A IA ainda pode estar processando.' },
      { action: 'question', label: 'Quais pendências críticas?', reason: 'Acompanhar o diagnóstico do contexto.' },
    ];
  }

  if (aiState === 'failed') {
    return [
      { action: 'run_daily_reconciliation', label: 'Conciliar', reason: 'Reexecutar a conciliação após falha da IA.' },
      { action: 'question', label: 'Quais pendências críticas?', reason: 'Seguir com diagnóstico manual.' },
    ];
  }

  const fallback = (args.fallbackActions || []).filter((action) =>
    action.action !== 'apply_reconciliation_plan' && action.action !== 'resolve_pending_issues'
  );
  if (fallback.length > 0) {
    return fallback.slice(0, 4);
  }

  return [
    { action: 'run_daily_reconciliation', label: 'Conciliar', reason: 'Executar matching + IA para o contexto atual.' },
    { action: 'update_plan_status', label: 'Atualizar plano', reason: 'Recarregar o status operacional atual.' },
  ];
}

export async function ensureBankChatSession(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  userId: string;
  contaBancariaId: string;
  contaLabel: string | null;
  dataReferencia: string;
  sessionId?: string | null;
  titleOverride?: string | null;
}): Promise<ChatSessionRow> {
  const {
    adminClient,
    empresaId,
    userId,
    contaBancariaId,
    contaLabel,
    dataReferencia,
    sessionId,
    titleOverride,
  } = args;

  if (sessionId) {
    let sessionLookup = adminClient
      .from('bank_reconciliation_chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('empresa_id', empresaId)
      .eq('user_id', userId)
      .is('archived_at', null)
      .maybeSingle();

    let { data: row, error } = await sessionLookup;

    if (error && isArchivedColumnMissingError(error.message)) {
      sessionLookup = adminClient
        .from('bank_reconciliation_chat_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('empresa_id', empresaId)
        .eq('user_id', userId)
        .maybeSingle();
      ({ data: row, error } = await sessionLookup);
    }

    if (error) {
      throw new Error(`Falha ao validar sessão de chat: ${error.message}`);
    }

    if (row) {
      return row as ChatSessionRow;
    }
  }

  const sessionKey = buildSessionKey(contaBancariaId, dataReferencia);
  const title =
    String(titleOverride || '').trim() ||
    `Conciliação ${formatDateLabel(dataReferencia)}${contaLabel ? ` • ${contaLabel}` : ''}`;

  const { data, error } = await adminClient
    .from('bank_reconciliation_chat_sessions')
    .insert({
      empresa_id: empresaId,
      user_id: userId,
      conta_bancaria_id: contaBancariaId,
      data_referencia: dataReferencia,
      session_key: sessionKey,
      title,
      last_message_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Falha ao criar sessão de chat: ${error.message}`);
  }

  return data as ChatSessionRow;
}

export async function insertBankChatMessage(args: {
  adminClient: SupabaseClient;
  session: ChatSessionRow;
  role: ChatRole;
  content: string;
  richContent?: RichMessageContent | null;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<ChatMessageRow> {
  const { adminClient, session, role, content, richContent = null, context = {}, metadata = {} } = args;

  const { data, error } = await adminClient
    .from('bank_reconciliation_chat_messages')
    .insert({
      session_id: session.id,
      empresa_id: session.empresa_id,
      role,
      content,
      rich_content: richContent,
      context,
      metadata,
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(`Falha ao registrar mensagem do chat: ${error.message}`);
  }

  await adminClient
    .from('bank_reconciliation_chat_sessions')
    .update({
      last_message_at: data.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', session.id)
    .eq('empresa_id', session.empresa_id);

  return data as ChatMessageRow;
}

function parseActionPreview(value: unknown): ChatActionPreviewPayload | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const action = typeof row.action === 'string' ? row.action : null;
  const idempotencyKey = typeof row.idempotency_key === 'string' ? row.idempotency_key : null;
  const context = row.context && typeof row.context === 'object' ? (row.context as Record<string, unknown>) : null;
  if (!action || !idempotencyKey || !context) return null;
  const contaId = typeof context.conta_bancaria_id === 'string' ? context.conta_bancaria_id : null;
  const dataReferencia = typeof context.data_referencia === 'string' ? context.data_referencia : null;
  if (!contaId || !dataReferencia) return null;

  return {
    action: action as ChatActionPreviewPayload['action'],
    requires_confirmation: row.requires_confirmation !== false,
    title: typeof row.title === 'string' ? row.title : undefined,
    idempotency_key: idempotencyKey,
    plan_id: typeof row.plan_id === 'string' ? row.plan_id : null,
    context: {
      conta_bancaria_id: contaId,
      data_referencia: dataReferencia,
      import_id: typeof context.import_id === 'string' ? context.import_id : null,
    },
  };
}

function parsePendingActionState(value: unknown): ChatPendingActionState | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const step = row.step;
  const action = row.action;
  if ((step !== 'preview' && step !== 'text_confirmation') || typeof action !== 'string') return null;
  return {
    step,
    action: action as ChatPendingActionState['action'],
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : undefined,
  };
}

function isPendingActionExpired(state: ChatPendingActionState | null): boolean {
  if (!state?.expires_at) return false;
  const expiresAt = Date.parse(state.expires_at);
  if (!Number.isFinite(expiresAt)) return false;
  return Date.now() > expiresAt;
}

async function loadLastAssistantChatMessage(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
}): Promise<ChatMessageRow | null> {
  const { data, error } = await args.adminClient
    .from('bank_reconciliation_chat_messages')
    .select('*')
    .eq('empresa_id', args.empresaId)
    .eq('session_id', args.sessionId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao carregar última mensagem de assistant do chat: ${error.message}`);
  }

  return data ? (data as ChatMessageRow) : null;
}

function buildPendingActionSummary(args: {
  actionPreview: ChatActionPreviewPayload;
  contextSnapshot: ChatContextSnapshot;
}): { content: string; richContent: RichMessageContent; state: ChatPendingActionState } {
  const title = args.actionPreview.title || args.actionPreview.action;
  const expiresAt = new Date(Date.now() + TEXT_CONFIRM_TTL_MS).toISOString();
  return {
    content:
      `Resumo curto antes de executar "${title}": conta ${args.contextSnapshot.conta_label || args.contextSnapshot.conta_bancaria_id}, ` +
      `data ${args.contextSnapshot.data_referencia}, import ${args.contextSnapshot.import_id || '—'}, parse ${args.contextSnapshot.import_parse_status || '—'}, ` +
      `pendências críticas ${args.contextSnapshot.pendencias_criticas}. Se estiver certo, responda "Sim, executar".`,
    richContent: {
      type: 'summary',
      data: {
        title: 'Confirmacao textual (etapa 1/2)',
        items: [
          { label: 'Acao', value: title },
          { label: 'Conta', value: args.contextSnapshot.conta_label || args.contextSnapshot.conta_bancaria_id },
          { label: 'Data', value: args.contextSnapshot.data_referencia },
          { label: 'Import', value: args.contextSnapshot.import_id || '—' },
          { label: 'Status parse', value: args.contextSnapshot.import_parse_status || '—' },
          { label: 'Pendencias criticas', value: args.contextSnapshot.pendencias_criticas },
        ],
      },
    },
    state: {
      step: 'text_confirmation',
      action: args.actionPreview.action,
      expires_at: expiresAt,
    },
  };
}

export function buildPendingDiagnosticAnswer(args: {
  contextSnapshot: ChatContextSnapshot;
  planArtifacts?: {
    plan: ChatReconciliationPlan | null;
    clarifying_questions: ChatClarifyingQuestion[];
    pending_cases: ChatPendingCase[];
  } | null;
  aiProcessingStatus?: ChatAiProcessingStatus | null;
  suggestedNextActions?: ChatSuggestedNextAction[] | null;
  reviewGuidance?: ChatReviewGuidance | null;
}): { content: string; richContent: RichMessageContent } {
  const { contextSnapshot, planArtifacts } = args;
  if (contextSnapshot.ofx_required) {
    return {
      content:
        'Não encontrei um OFX elegível neste contexto. Nesta etapa, a conciliação confiável exige OFX. ' +
        'Importe um arquivo OFX e depois atualize o contexto.',
      richContent: {
        type: 'summary',
        data: {
          title: 'OFX obrigatório nesta etapa',
          items: [
            { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
            { label: 'Data', value: contextSnapshot.data_referencia },
            { label: 'Import selecionado', value: contextSnapshot.import_id || '—' },
            { label: 'Motivo', value: contextSnapshot.ofx_required_reason || 'no_ofx_import_available' },
          ],
        },
      },
    };
  }

  const dailySummary = contextSnapshot.daily_summary || {};
  const suggestedPlan = planArtifacts?.plan || null;
  const summaryRoot = dailySummary && typeof dailySummary === 'object' ? (dailySummary as Record<string, unknown>) : {};
  const summary =
    summaryRoot.summary && typeof summaryRoot.summary === 'object'
      ? (summaryRoot.summary as Record<string, unknown>)
      : summaryRoot;

  const itemPend = Number(summary.item_pendencias_criticas || 0);
  const extratoPend = Number(summary.extrato_pendencias_criticas || 0);
  const totalPend = Number(summary.pendencias_criticas_total || contextSnapshot.pendencias_criticas || 0);
  const verificados = Number(summary.itens_verificados || 0);
  const parciais = Number(summary.itens_parciais || 0);
  const naoConciliados = Number(summary.itens_nao_conciliados || 0);
  const divergentes = Number(summary.itens_divergentes || 0);

  const examples = contextSnapshot.pending_examples
    .slice(0, 5)
    .map((example) => ({
      title: `${example.descricao} • R$ ${(example.valor_centavos / 100).toFixed(2)}`,
      subtitle: example.data_movimento,
    }));

  const planTotals = suggestedPlan?.totals;
  const aiStatus = args.aiProcessingStatus || null;
  const aiState = aiStatus?.state || null;
  const aiStateLabel =
    aiState === 'completed'
      ? 'Concluída'
      : aiState === 'no_pending'
        ? 'Sem pendências'
        : aiState === 'failed'
          ? 'Falhou'
          : aiState === 'timeout'
            ? 'Tempo de espera expirou'
            : aiState === 'triggered' || aiState === 'processing' || aiState === 'polling'
              ? 'Aguardando IA'
            : '—';
  const nextActions = (args.suggestedNextActions || []).slice(0, 4);
  const guidedRemaining = Number(args.reviewGuidance?.queue_remaining || 0);
  const nextAction =
    guidedRemaining > 0
      ? 'Diga "Continuar revisão guiada" para tratar o próximo item.'
      : (planTotals?.total || 0) > 0
      ? 'Diga "Corrija essas pendências" para revisar/aplicar o plano sugerido.'
      : aiState === 'processing' || aiState === 'triggered' || aiState === 'polling' || aiState === 'timeout'
        ? 'Diga "Atualizar plano" em alguns segundos para verificar se a IA concluiu.'
        : aiState === 'failed'
          ? 'Diga "Conciliar" para tentar novamente ou revise as pendências manualmente.'
          : 'Diga "Conciliar" para gerar sugestões.';
  const aiComplement =
    aiState === 'failed' && aiStatus?.message
      ? ` Detalhe da falha da IA: ${aiStatus.message}`
      : '';

  const totalExtrato = verificados + parciais + naoConciliados + divergentes;
  const suggestionTotal = planTotals?.total || 0;

  let contentSummary = '';
  if (totalExtrato > 0 || itemPend > 0) {
    contentSummary = `Analisei o extrato e o financeiro: identifiquei ${totalExtrato} transações no extrato (com ${extratoPend} pendências) e ${itemPend} itens financeiros em aberto. `;
  } else {
    contentSummary = `Não identifiquei pendências significativas para o período selecionado. `;
  }

  const aiSummary = suggestionTotal > 0
    ? `A IA gerou ${suggestionTotal} sugestões de conciliação que aguardam sua revisão. `
    : (aiState === 'processing' || aiState === 'triggered' || aiState === 'polling'
      ? 'A IA está processando este contexto. '
      : aiState === 'timeout'
        ? 'O tempo de espera local expirou, mas a IA pode continuar processando. '
        : aiState === 'failed'
          ? 'O workflow da IA falhou na última tentativa. '
          : 'Ainda não há um plano de sugestões disponível. ');

  return {
    content: `${contentSummary}${aiSummary}${aiComplement}\n\n${nextAction}`,
    richContent: {
      type: 'summary',
      data: {
        title: 'Diagnóstico de Pendências Críticas',
        items: [
          { label: 'Pendências críticas (total)', value: totalPend },
          { label: 'Itens financeiros', value: itemPend },
          { label: 'Extrato', value: extratoPend },
          { label: 'Itens conciliados', value: verificados },
          { label: 'Itens parciais', value: parciais },
          { label: 'Itens não conciliados', value: naoConciliados },
          { label: 'Itens divergentes', value: divergentes },
          { label: 'Sugestões IA (total)', value: planTotals?.total || 0 },
          { label: 'Match existente', value: planTotals?.match_existing || 0 },
          { label: 'Sem vínculo automático', value: planTotals?.create_new || 0 },
          { label: 'Ignorar', value: planTotals?.ignore || 0 },
          { label: 'Revisão necessária', value: planTotals?.needs_review || 0 },
          {
            label: 'Itens em revisão guiada',
            value: Number(args.reviewGuidance?.queue_remaining ?? planArtifacts?.clarifying_questions?.length ?? 0),
          },
          { label: 'Status IA', value: aiStateLabel },
          ...(aiStatus?.correlation_id ? [{ label: 'Correlação IA', value: aiStatus.correlation_id }] : []),
        ],
        ...(examples.length
          ? {
            extra: {
              pending_examples: examples,
              next_actions: nextActions.map((action) => ({
                title: action.label,
                subtitle: action.reason || null,
              })),
            },
          }
          : {}),
      },
    },
  };
}

function buildDeterministicQuestionAnswer(args: {
  message: string;
  contextSnapshot: ChatContextSnapshot;
}): { content: string; richContent?: RichMessageContent } {
  const normalized = args.message.toLowerCase();
  const { contextSnapshot } = args;

  if (contextSnapshot.ofx_required) {
    return {
      content:
        'Nesta etapa, a conciliação por chat usa apenas OFX. Importe um OFX para gerar plano e revisão guiada.',
      richContent: {
        type: 'summary',
        data: {
          title: 'OFX obrigatório',
          items: [
            { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
            { label: 'Data', value: contextSnapshot.data_referencia },
            { label: 'Import selecionado', value: contextSnapshot.import_id || '—' },
            { label: 'Motivo', value: contextSnapshot.ofx_required_reason || 'no_ofx_import_available' },
          ],
        },
      },
    };
  }

  if (normalized.includes('pendente')) {
    return {
      content: 'Situação atual dos status da conciliação para o contexto selecionado:',
      richContent: {
        type: 'chart',
        data: {
          type: 'bar',
          title: 'Status da Conciliação',
          labels: ['Pendente', 'Sugerido', 'Conciliado', 'Divergente'],
          values: [
            contextSnapshot.status_counts.pendente,
            contextSnapshot.status_counts.sugerido,
            contextSnapshot.status_counts.conciliado,
            contextSnapshot.status_counts.divergente,
          ],
        },
      },
    };
  }

  if (normalized.includes('diverg')) {
    const items = contextSnapshot.pending_examples.map((example) => ({
      title: `${example.descricao} (${(example.valor_centavos / 100).toFixed(2)})`,
      subtitle: example.data_movimento,
    }));

    return {
      content: items.length
        ? 'Pendências/diferenças recentes encontradas no contexto selecionado:'
        : 'Não há divergências pendentes no contexto selecionado.',
      richContent: items.length
        ? {
          type: 'list',
          data: {
            title: 'Pendências de extrato',
            items,
          },
        }
        : undefined,
    };
  }

  return {
    content: 'Resumo operacional do contexto selecionado:',
    richContent: {
      type: 'summary',
      data: {
        title: 'Conciliação do dia',
        items: [
          { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
          { label: 'Data', value: contextSnapshot.data_referencia },
          { label: 'Import', value: contextSnapshot.import_id || '—' },
          { label: 'Status parse', value: contextSnapshot.import_parse_status || '—' },
          { label: 'Pendências críticas', value: contextSnapshot.pendencias_criticas },
        ],
      },
    },
  };
}

function buildExecutionStatusAnswer(args: {
  executionState: ChatExecutionStateSnapshot;
  contextSnapshot: ChatContextSnapshot;
}): { content: string; richContent?: RichMessageContent } {
  const { executionState, contextSnapshot } = args;
  const last = executionState.lastExecutionSummary;
  if (!last) {
    return {
      content: 'Ainda não encontrei uma execução operacional recente neste contexto (conta/data). Peça uma ação como “Conciliar”.',
    };
  }

  const ai = executionState.aiProcessingStatus;
  const statusLabel =
    last.status === 'error'
      ? 'Falha'
      : last.status === 'processing'
        ? 'Em processamento'
        : last.status === 'warning'
          ? 'Concluída com atenção'
        : 'OK';
  const executedAtLabel = last.executed_at ? new Date(last.executed_at).toLocaleString('pt-BR') : '—';

  return {
    content:
      `Última execução neste contexto: ${last.action} às ${executedAtLabel}. ` +
      `Status ${statusLabel}.${ai?.message ? ` IA: ${ai.message}` : ''}`,
    richContent: {
      type: 'summary',
      data: {
        title: 'Última execução',
        items: [
          { label: 'Ação', value: last.action },
          { label: 'Executado em', value: executedAtLabel },
          { label: 'Status', value: statusLabel },
          { label: 'Status IA', value: ai?.state || '—' },
          { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
          { label: 'Data', value: contextSnapshot.data_referencia },
        ],
        ...(executionState.suggestedNextActions.length
          ? {
            extra: {
              next_actions: executionState.suggestedNextActions.map((action) => ({
                title: action.label,
                subtitle: action.reason || null,
              })),
            },
          }
          : {}),
      },
    },
  };
}

function buildExecutionDetailsAnswer(args: {
  executionState: ChatExecutionStateSnapshot;
  contextSnapshot: ChatContextSnapshot;
}): { content: string; richContent?: RichMessageContent } {
  const { executionState, contextSnapshot } = args;
  const last = executionState.lastExecutionSummary;
  if (!last) {
    return {
      content: 'Não tenho uma execução recente para detalhar neste contexto. Execute primeiro uma ação operacional (ex.: “Conciliar”).',
    };
  }

  const ai = executionState.aiProcessingStatus;
  const counts = last.affected_counts || {};
  const summary = executionState.executionSummary;
  const plan = executionState.reconciliationPlan;
  const pending = executionState.pendingCases || [];
  const questions = executionState.clarifyingQuestions || [];

  return {
    content:
      `Resumo detalhado da última execução (${last.action}): ${summary?.message || last.summary || 'sem resumo estruturado.'} ` +
      `${ai?.message ? `Status IA: ${ai.message}` : ''}`,
    richContent: {
      type: 'summary',
      data: {
        title: 'Detalhe da última execução',
        items: [
          { label: 'Ação', value: last.action },
          { label: 'Executado em', value: last.executed_at || '—' },
          { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
          { label: 'Data', value: contextSnapshot.data_referencia },
          { label: 'Status IA', value: ai?.state || '—' },
          { label: 'Correlação IA', value: ai?.correlation_id || '—' },
          { label: 'Plano (sugestões)', value: plan?.totals?.total || 0 },
          { label: 'Pendências (casos)', value: pending.length },
          { label: 'Itens para revisão', value: questions.length },
          ...Object.entries(counts)
            .slice(0, 8)
            .map(([label, value]) => ({ label, value: Number(value) })),
        ],
      },
    },
  };
}

async function callExternalChatWebhook(args: {
  message: string;
  contextSnapshot: ChatContextSnapshot;
}): Promise<{
  content: string;
  richContent?: RichMessageContent;
  actionPreview?: ChatActionPreviewPayload;
} | null> {
  const webhookUrl = getBankReconciliationChatWebhookUrl();
  const integrationSecret = getBankReconciliationChatIntegrationSecret();
  const timeoutMs = getBankReconciliationChatTimeoutMs();

  if (!webhookUrl || !integrationSecret) return null;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-secret': integrationSecret,
        'x-empresa-id': args.contextSnapshot.empresa_id,
      },
      body: JSON.stringify({
        source: 'bank_reconciliation_chat',
        message: args.message,
        context: args.contextSnapshot,
      }),
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload) return null;

    const assistantMessage = String(payload.assistant_message || payload.message || '').trim();
    if (!assistantMessage) return null;

    const richCandidate = payload.rich_content;
    const richContent =
      richCandidate && typeof richCandidate === 'object'
        ? (richCandidate as RichMessageContent)
        : undefined;

    const actionCandidate = payload.action_preview;
    const actionPreview =
      actionCandidate && typeof actionCandidate === 'object'
        ? (actionCandidate as ChatActionPreviewPayload)
        : undefined;

    return {
      content: assistantMessage,
      ...(richContent ? { richContent } : {}),
      ...(actionPreview ? { actionPreview } : {}),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

export function buildActionPreview(args: {
  kind:
  | 'matching'
  | 'trigger_ai'
  | 'refresh_summary'
  | 'run_daily_reconciliation'
  | 'apply_reconciliation_plan'
  | 'daily_close'
  | 'daily_reopen';
  contextSnapshot: ChatContextSnapshot;
  userId: string;
  planId?: string | null;
}): ChatActionPreviewPayload {
  const now = new Date().toISOString();
  const seed = `${args.kind}:${args.contextSnapshot.import_id || 'none'}:${args.contextSnapshot.conta_bancaria_id}:${args.contextSnapshot.data_referencia}:${now}:${args.userId}`;
  const idempotencyKey = `chat-action:${seed}`;

  const titleByKind: Record<
    | 'matching'
    | 'trigger_ai'
    | 'refresh_summary'
    | 'run_daily_reconciliation'
    | 'apply_reconciliation_plan'
    | 'daily_close'
    | 'daily_reopen',
    string
  > = {
    matching: 'Conciliar',
    trigger_ai: 'Conciliar',
    refresh_summary: 'Atualizar resumo',
    run_daily_reconciliation: 'Conciliar',
    apply_reconciliation_plan: 'Aplicar plano de conciliação',
    daily_close: 'Fechar dia',
    daily_reopen: 'Reabrir dia',
  };

  return {
    action: args.kind,
    requires_confirmation: true,
    title: titleByKind[args.kind],
    idempotency_key: idempotencyKey,
    ...(args.planId ? { plan_id: args.planId } : {}),
    context: {
      conta_bancaria_id: args.contextSnapshot.conta_bancaria_id,
      data_referencia: args.contextSnapshot.data_referencia,
      import_id: args.contextSnapshot.import_id,
    },
  };
}

const confidenceBand = (value: number | null | undefined): ChatPlanConfidenceBand => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 'low';
  if (n >= 0.85) return 'high';
  if (n >= 0.6) return 'medium';
  return 'low';
};

function buildPlanQuestionsAndPendingCases(plan: ChatReconciliationPlan): {
  clarifying_questions: ChatClarifyingQuestion[];
  pending_cases: ChatPendingCase[];
} {
  const pendingCases: ChatPendingCase[] = [];
  const clarifyingQuestions: ChatClarifyingQuestion[] = [];

  for (const item of plan.items) {
    const rowBand = confidenceBand(item.confidence);
    const valor = item.extrato_valor_centavos != null ? `R$ ${(item.extrato_valor_centavos / 100).toFixed(2)}` : null;
    const descricao = item.extrato_descricao_raw || `Extrato ${item.extrato_transacao_id}`;
    const when = item.extrato_data_movimento || plan.data_referencia;

    const mustAsk =
      item.action === 'needs_review' ||
      item.action === 'ignore' ||
      (typeof item.confidence === 'number' && item.confidence < 0.75);

    if (mustAsk) {
      pendingCases.push({
        id: `pending:${item.suggestion_id || item.id}`,
        suggestion_id: item.suggestion_id || null,
        extrato_transacao_id: item.extrato_transacao_id,
        action: item.action,
        reason:
          item.explanation ||
          (item.action === 'needs_review'
            ? 'IA não conseguiu decidir automaticamente.'
            : item.action === 'ignore'
                ? 'IA sugeriu ignorar; é necessária justificativa.'
                : 'Sugestão com baixa confiança.'),
        confidence: item.confidence ?? null,
        confidence_band: rowBand,
        descricao,
        data_movimento: when,
        valor_centavos: item.extrato_valor_centavos ?? null,
      });
    }

    if (item.action === 'needs_review') {
      clarifyingQuestions.push({
        id: `q:${item.suggestion_id || item.id}`,
        suggestion_id: item.suggestion_id || null,
        extrato_transacao_id: item.extrato_transacao_id,
        question: `Nao consegui conciliar "${descricao}"${valor ? ` (${valor})` : ''} em ${when}. Como devo tratar esse item?`,
        rationale: item.explanation || 'Sugestão marcada para revisão necessária.',
        confidence_band: rowBand,
        suggested_actions: ['Aprovar vínculo', 'Ignorar com justificativa', 'Manter para depois'],
      });
      continue;
    }

    if (item.action === 'ignore') {
      clarifyingQuestions.push({
        id: `q:${item.suggestion_id || item.id}`,
        suggestion_id: item.suggestion_id || null,
        extrato_transacao_id: item.extrato_transacao_id,
        question: `Deseja ignorar "${descricao}"${valor ? ` (${valor})` : ''} com justificativa?`,
        rationale: item.explanation || 'IA sugeriu ignorar.',
        confidence_band: rowBand,
        suggested_actions: ['Ignorar com justificativa', 'Revisar vínculo', 'Manter para depois'],
      });
      continue;
    }

    if (typeof item.confidence === 'number' && item.confidence < 0.75) {
      clarifyingQuestions.push({
        id: `q:${item.suggestion_id || item.id}`,
        suggestion_id: item.suggestion_id || null,
        extrato_transacao_id: item.extrato_transacao_id,
        question: `Confirma o match sugerido para "${descricao}"${valor ? ` (${valor})` : ''}? A confianca está baixa.`,
        rationale: item.explanation || 'Sugestão de vínculo com baixa confiança.',
        confidence_band: rowBand,
        suggested_actions: ['Aprovar vínculo', 'Trocar vínculo', 'Manter para depois'],
      });
    }
  }

  return {
    clarifying_questions: clarifyingQuestions.slice(0, 12),
    pending_cases: pendingCases.slice(0, 50),
  };
}

export async function buildCurrentReconciliationPlan(args: {
  adminClient: SupabaseClient;
  contextSnapshot: ChatContextSnapshot;
  aiExecutionRun?: ChatExecutionStateSnapshot['aiExecutionRun'];
}): Promise<{
  plan: ChatReconciliationPlan | null;
  clarifying_questions: ChatClarifyingQuestion[];
  pending_cases: ChatPendingCase[];
}> {
  const { adminClient, contextSnapshot, aiExecutionRun = null } = args;

  if (contextSnapshot.ofx_required) {
    return { plan: null, clarifying_questions: [], pending_cases: [] };
  }

  if (aiExecutionRun?.status === 'no_pending') {
    return { plan: null, clarifying_questions: [], pending_cases: [] };
  }

  let txQuery = adminClient
    .from('extrato_transacoes')
    .select('id,data_movimento,valor_centavos,tipo,descricao_raw,documento_ref')
    .eq('empresa_id', contextSnapshot.empresa_id)
    .eq('conta_bancaria_id', contextSnapshot.conta_bancaria_id)
    .order('data_movimento', { ascending: true })
    .limit(3000);

  if (contextSnapshot.import_id) {
    txQuery = txQuery.eq('extrato_import_id', contextSnapshot.import_id);
  } else {
    txQuery = txQuery.eq('data_movimento', contextSnapshot.data_referencia);
  }

  const { data: txRows, error: txError } = await txQuery;
  if (txError) {
    throw new Error(`Falha ao carregar transações para plano de conciliação: ${txError.message}`);
  }

  const txList = (txRows || []) as Array<{
    id: string;
    data_movimento: string;
    valor_centavos: number;
    tipo: 'credit' | 'debit' | 'other';
    descricao_raw: string;
    documento_ref: string | null;
  }>;
  const txIds = txList.map((row) => String(row.id)).filter(Boolean);
  if (txIds.length === 0) {
    return { plan: null, clarifying_questions: [], pending_cases: [] };
  }
  const txMap = new Map(txList.map((row) => [row.id, row]));

  let suggestionsQuery = adminClient
    .from('bank_ai_suggestions')
    .select(
      'id,extrato_transacao_id,suggestion_action,confidence,item_financeiro_id,lancamento_caixa_id,explanation,proposed_lancamento,warnings,status,created_at'
    )
    .eq('empresa_id', contextSnapshot.empresa_id)
    .eq('status', 'suggested')
    .in('extrato_transacao_id', txIds)
    .order('created_at', { ascending: true })
    .limit(2000);

  if (aiExecutionRun?.created_at) {
    suggestionsQuery = suggestionsQuery.gte('created_at', aiExecutionRun.created_at);
  }

  const { data: suggestionRows, error: suggestionError } = await suggestionsQuery;

  if (suggestionError) {
    throw new Error(`Falha ao carregar sugestões IA para plano de conciliação: ${suggestionError.message}`);
  }

  const rows = (suggestionRows || []) as Array<{
    id: string;
    extrato_transacao_id: string;
    suggestion_action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
    confidence: number | null;
    item_financeiro_id: string | null;
    lancamento_caixa_id: string | null;
    explanation: string | null;
    proposed_lancamento: Record<string, unknown> | null;
    warnings: unknown;
  }>;

  if (rows.length === 0) {
    return { plan: null, clarifying_questions: [], pending_cases: [] };
  }

  const items = rows.map((row) => {
    const tx = txMap.get(row.extrato_transacao_id);
    return {
      id: `plan-item:${row.id}`,
      suggestion_id: row.id,
      extrato_transacao_id: row.extrato_transacao_id,
      action: row.suggestion_action,
      confidence: row.confidence,
      item_financeiro_id: row.item_financeiro_id,
      lancamento_caixa_id: row.lancamento_caixa_id,
      explanation: row.explanation,
      extrato_data_movimento: tx?.data_movimento,
      extrato_valor_centavos: tx?.valor_centavos,
      extrato_tipo: tx?.tipo,
      extrato_descricao_raw: tx?.descricao_raw,
      extrato_documento_ref: tx?.documento_ref,
      warnings: Array.isArray(row.warnings)
        ? row.warnings.filter((item): item is string => typeof item === 'string')
        : undefined,
      proposed_lancamento: row.proposed_lancamento || null,
    };
  }) satisfies ChatReconciliationPlan['items'];

  const totals = {
    total: items.length,
    match_existing: items.filter((item) => item.action === 'match_existing').length,
    create_new: items.filter((item) => item.action === 'create_new').length,
    ignore: items.filter((item) => item.action === 'ignore').length,
    needs_review: items.filter((item) => item.action === 'needs_review').length,
  };

  const generatedAt = new Date().toISOString();
  const planId = [
    'chat-plan',
    contextSnapshot.conta_bancaria_id,
    contextSnapshot.data_referencia,
    contextSnapshot.import_id || 'noimport',
    generatedAt,
  ].join(':');

  const plan: ChatReconciliationPlan = {
    plan_id: planId,
    empresa_id: contextSnapshot.empresa_id,
    conta_bancaria_id: contextSnapshot.conta_bancaria_id,
    data_referencia: contextSnapshot.data_referencia,
    import_id: contextSnapshot.import_id,
    generated_at: generatedAt,
    totals,
    items,
  };

  const insights = buildPlanQuestionsAndPendingCases(plan);
  return {
    plan,
    ...insights,
  };
}

export async function processBankReconciliationChatMessage(
  input: ChatMessageOrchestratorInput
): Promise<ChatMessageOrchestratorResult> {
  const normalizedMessage = normalizeMessage(input.message);
  if (!normalizedMessage) {
    throw new Error('Mensagem vazia.');
  }

  const contextSnapshot = await buildBankReconciliationChatContext({
    adminClient: input.adminClient,
    empresaId: input.empresaId,
    contaBancariaId: input.contaBancariaId,
    dataReferencia: input.dataReferencia,
    importId: input.importId || null,
  });

  const session = await ensureBankChatSession({
    adminClient: input.adminClient,
    empresaId: input.empresaId,
    userId: input.userId,
    contaBancariaId: contextSnapshot.conta_bancaria_id,
    contaLabel: contextSnapshot.conta_label,
    dataReferencia: contextSnapshot.data_referencia,
    sessionId: input.sessionId || null,
    titleOverride:
      input.importBootstrap?.originalFilenames?.[0]
        ? `${input.importBootstrap.originalFilenames[0]}${contextSnapshot.conta_label ? ` • ${contextSnapshot.conta_label}` : ''}`
        : null,
  });

  const lastAssistantMessage = await loadLastAssistantChatMessage({
    adminClient: input.adminClient,
    empresaId: input.empresaId,
    sessionId: session.id,
  });
  const executionStateSnapshot = await loadChatExecutionStateSnapshot({
    adminClient: input.adminClient,
    empresaId: input.empresaId,
    sessionId: session.id,
    contaBancariaId: contextSnapshot.conta_bancaria_id,
    dataReferencia: contextSnapshot.data_referencia,
    importId: contextSnapshot.import_id,
  }).catch(() => null);
  const lastAssistantMetadata =
    lastAssistantMessage?.metadata && typeof lastAssistantMessage.metadata === 'object'
      ? (lastAssistantMessage.metadata as Record<string, unknown>)
      : null;
  const lastAssistantActionPreview = parseActionPreview(lastAssistantMetadata?.action_preview);
  const lastPendingActionState = parsePendingActionState(lastAssistantMetadata?.pending_action_state);

  const userMessageRow = await insertBankChatMessage({
    adminClient: input.adminClient,
    session,
    role: 'user',
    content: normalizedMessage,
    context: {
      conta_bancaria_id: contextSnapshot.conta_bancaria_id,
      data_referencia: contextSnapshot.data_referencia,
      import_id: contextSnapshot.import_id,
      active_extrato_transacao_id: input.activeExtratoTransacaoId || null,
      parse_status: contextSnapshot.import_parse_status,
      status_counts: contextSnapshot.status_counts,
      pendencias_criticas: contextSnapshot.pendencias_criticas,
    },
    metadata: {
      source: 'bank_reconciliation_chat',
      import_bootstrap: Boolean(input.importBootstrap),
    },
  });

  if (input.importBootstrap && !input.interaction) {
    const bootstrap = buildImportBootstrapAnswer({
      contextSnapshot,
      originalFilenames: input.importBootstrap.originalFilenames,
    });

    const assistantMessageRow = await insertBankChatMessage({
      adminClient: input.adminClient,
      session,
      role: 'assistant',
      content: bootstrap.content,
      richContent: bootstrap.richContent,
      context: {
        conta_bancaria_id: contextSnapshot.conta_bancaria_id,
        data_referencia: contextSnapshot.data_referencia,
        import_id: contextSnapshot.import_id,
        active_extrato_transacao_id: input.activeExtratoTransacaoId || null,
        parse_status: contextSnapshot.import_parse_status,
      },
      metadata: {
        source: 'bank_reconciliation_chat',
        action: 'summary',
        import_bootstrap: true,
        suggested_next_actions: null,
        ui_show_operational_cards: false,
        ui_show_plan_card: false,
        ui_show_guided_card: false,
      },
    });

    return {
      session,
      user_message: userMessageRow,
      assistant_message: assistantMessageRow,
      context_snapshot: contextSnapshot,
      reconciliation_plan: null,
      clarifying_questions: null,
      pending_cases: null,
      pending_action_state: null,
      ai_processing_status: null,
      last_execution_summary: executionStateSnapshot?.lastExecutionSummary || null,
      suggested_next_actions: null,
      review_guidance: null,
      ui_show_operational_cards: false,
      ui_show_plan_card: false,
      ui_show_guided_card: false,
    };
  }

  const agentWebhookUrl = getBankReconciliationAgentWebhookUrl();
  const chatAgentMode = getBankReconciliationChatAgentMode();
  const balanceMutationBlocked = isBankReconciliationBalanceMutationDisabled();
  const intent = routeBankChatIntent(normalizedMessage);
  const canUseFullAgentAsync =
    !!agentWebhookUrl &&
    chatAgentMode === 'full' &&
    !input.interaction &&
    !LOCAL_OPERATIONAL_INTENTS.has(intent.kind);

  if (canUseFullAgentAsync) {
    const agent = new BankReconciliationAgent(input.adminClient);
    const history = await loadRecentChatHistory({
      adminClient: input.adminClient,
      empresaId: input.empresaId,
      sessionId: session.id,
    });
    agent.triggerAsync(normalizedMessage, {
      empresa_id: input.empresaId,
      conta_bancaria_id: contextSnapshot.conta_bancaria_id,
      data: contextSnapshot.data_referencia,
      data_referencia: contextSnapshot.data_referencia,
      import_id: contextSnapshot.import_id,
      extrato_import_id: contextSnapshot.import_id,
      session_id: session.id,
      history,
      summary: contextSnapshot.daily_summary,
      pending_items_count: contextSnapshot.pendencias_criticas,
      ai_processing_status: executionStateSnapshot?.aiProcessingStatus || null,
      last_execution_summary: executionStateSnapshot?.lastExecutionSummary || null,
      reconciliation_plan: executionStateSnapshot?.reconciliationPlan || null,
      suggested_next_actions: executionStateSnapshot?.suggestedNextActions || null,
    });

    const placeholderContent = 'IA pensando… Já vou responder aqui no chat.';
    const now = new Date().toISOString();
    const placeholderRow: ChatMessageRow = {
      id: `placeholder-${Date.now()}`,
      session_id: session.id,
      empresa_id: session.empresa_id,
      role: 'assistant',
      content: placeholderContent,
      rich_content: null,
      context: {
        conta_bancaria_id: contextSnapshot.conta_bancaria_id,
        data_referencia: contextSnapshot.data_referencia,
        import_id: contextSnapshot.import_id,
        active_extrato_transacao_id: input.activeExtratoTransacaoId || null,
        agent_processing: true,
      },
      metadata: {
        source: 'bank_reconciliation_chat',
        agent_processing: true,
        ai_processing_status: {
          state: 'agent_processing',
          message: placeholderContent,
        },
      },
      created_at: now,
    };

    return {
      session,
      user_message: userMessageRow,
      assistant_message: placeholderRow,
      context_snapshot: contextSnapshot,
      ai_processing_status: {
        state: 'agent_processing',
        message: placeholderContent,
      },
      ui_show_operational_cards: false,
      ui_show_plan_card: false,
      ui_show_guided_card: false,
    };
  }

  const agentResponse = {
    message: `intent_router_local:${chatAgentMode}`,
    confidence: 0,
    suggestedIntent: undefined,
  };

  let assistantContent = '';
  let assistantRichContent: RichMessageContent | undefined;
  let actionPreview: ChatActionPreviewPayload | undefined;
  let reconciliationPlan: ChatReconciliationPlan | null = null;
  let clarifyingQuestions: ChatClarifyingQuestion[] | null = null;
  let pendingCases: ChatPendingCase[] | null = null;
  let pendingActionState: ChatPendingActionState | null = null;
  let aiProcessingStatus: ChatAiProcessingStatus | null = null;
  let lastExecutionSummary: ChatLastExecutionSummary | null =
    executionStateSnapshot?.lastExecutionSummary || null;
  let suggestedNextActions: ChatSuggestedNextAction[] | null =
    executionStateSnapshot?.suggestedNextActions || null;
  let reviewGuidance: ChatReviewGuidance | null = null;
  let uiShowOperationalCards = intent.kind === 'execution_status_query' || intent.kind === 'execution_details_query';
  let uiShowPlanCard = false;
  let uiShowGuidedCard = false;
  const normalizedForIntent = normalizeForMatch(normalizedMessage);
  const continueGuidedReviewRequested =
    intent.kind === 'question' && isContinueGuidedReviewRequest(normalizedForIntent);
  const guidedReviewPilotGate = validateBankReconciliationPilotScope(
    input.empresaId,
    contextSnapshot.conta_bancaria_id
  );
  const previewContextMatches =
    !!lastAssistantActionPreview &&
    lastAssistantActionPreview.context.conta_bancaria_id === contextSnapshot.conta_bancaria_id &&
    toDateOnly(lastAssistantActionPreview.context.data_referencia) === toDateOnly(contextSnapshot.data_referencia);
  const previewAgeMs = lastAssistantMessage?.created_at ? Date.now() - Date.parse(lastAssistantMessage.created_at) : Infinity;
  const previewExpiredByAge = !Number.isFinite(previewAgeMs) || previewAgeMs > TEXT_CONFIRM_TTL_MS;
  const pendingActionAvailable =
    previewContextMatches &&
    !!lastAssistantActionPreview &&
    !isPendingActionExpired(lastPendingActionState) &&
    !(lastPendingActionState == null && previewExpiredByAge);
  const ofxRequired = contextSnapshot.ofx_required === true;
  const setOfxRequiredResponse = () => {
    assistantContent =
      'Nesta etapa, use OFX para conciliação confiável. CSV está em quarentena. ' +
      'Importe um OFX e depois atualize o contexto.';
    assistantRichContent = {
      type: 'summary',
      data: {
        title: 'OFX obrigatório nesta etapa',
        items: [
          { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
          { label: 'Data', value: contextSnapshot.data_referencia },
          { label: 'Import selecionado', value: contextSnapshot.import_id || '—' },
          { label: 'Motivo', value: contextSnapshot.ofx_required_reason || 'no_ofx_import_available' },
        ],
      },
    };
    reconciliationPlan = null;
    clarifyingQuestions = null;
    pendingCases = null;
    reviewGuidance = null;
    uiShowGuidedCard = false;
    uiShowPlanCard = false;
    uiShowOperationalCards = false;
    suggestedNextActions = [
      {
        action: 'import_ofx',
        label: 'Importar OFX',
        reason: 'CSV está em quarentena nesta etapa para conciliação confiável.',
      },
      {
        action: 'update_plan_status',
        label: 'Atualizar contexto',
        reason: 'Após importar OFX, recarregue o plano de conciliação.',
      },
    ];
  };

  if (
    input.interaction?.kind === 'review_answer' ||
    input.interaction?.kind === 'review_batch_confirm' ||
    input.interaction?.kind === 'review_next' ||
    input.interaction?.kind === 'review_undo_last'
  ) {
    if (ofxRequired) {
      setOfxRequiredResponse();
    } else if (!guidedReviewPilotGate.allowed) {
      assistantContent =
        'Revisao guiada indisponivel neste contexto por configuracao operacional. Continue com o fluxo padrao neste contexto.';
      assistantRichContent = {
        type: 'summary',
        data: {
          title: 'Revisao guiada indisponivel',
          items: [
            { label: 'Motivo', value: guidedReviewPilotGate.reason || 'fora do escopo configurado' },
            { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
            { label: 'Data', value: contextSnapshot.data_referencia },
          ],
        },
      };
      suggestedNextActions = [
        { action: 'update_plan_status', label: 'Atualizar plano', reason: 'Recarregar o estado operacional atual.' },
        { action: 'question', label: 'Quais pendencias criticas?', reason: 'Seguir com diagnostico manual no chat.' },
      ];
      void safeInsertBankAuditLog(input.adminClient, {
        empresa_id: input.empresaId,
        extrato_import_id: contextSnapshot.import_id,
        action: 'chat_guided_review_blocked_scope_gate',
        status: 'warning',
        message: 'Interacao de revisao guiada bloqueada por configuracao de escopo.',
        created_by: input.userId,
        details: {
          session_id: session.id,
          conta_bancaria_id: contextSnapshot.conta_bancaria_id,
          data_referencia: contextSnapshot.data_referencia,
          scope_gate_enabled: guidedReviewPilotGate.enabled,
          reason: guidedReviewPilotGate.reason,
          interaction_kind: input.interaction.kind,
        },
      });
    } else if (!input.baseUrl || !input.accessToken) {
      assistantContent = 'Nao foi possivel processar a revisao guiada neste ambiente.';
    } else {
      const review = await executeBankChatReviewInteraction({
        adminClient: input.adminClient,
        baseUrl: input.baseUrl,
        accessToken: input.accessToken,
        empresaId: input.empresaId,
        userId: input.userId,
        sessionId: session.id,
        contaBancariaId: contextSnapshot.conta_bancaria_id,
        dataReferencia: contextSnapshot.data_referencia,
        importId: contextSnapshot.import_id,
        interaction: input.interaction,
      });
      assistantContent = review.assistant_message;
      assistantRichContent = review.rich_content;
      reconciliationPlan = review.reconciliation_plan || null;
      clarifyingQuestions = review.clarifying_questions || null;
      pendingCases = review.pending_cases || null;
      reviewGuidance = review.review_guidance || null;
      aiProcessingStatus = review.ai_processing_status || executionStateSnapshot?.aiProcessingStatus || null;
      if (typeof review.ui_show_operational_cards === 'boolean') {
        uiShowOperationalCards = review.ui_show_operational_cards;
      }
      if (typeof review.ui_show_plan_card === 'boolean') {
        uiShowPlanCard = review.ui_show_plan_card;
      }
      if (typeof review.ui_show_guided_card === 'boolean') {
        uiShowGuidedCard = review.ui_show_guided_card;
      }
      suggestedNextActions = reviewGuidance?.queue_remaining
        ? [
            { action: 'question', label: 'Continuar revisão guiada', reason: 'Responder próxima pergunta da IA.' },
            { action: 'update_plan_status', label: 'Atualizar plano', reason: 'Recarregar fila e estado operacional.' },
          ]
        : [
            { action: 'update_plan_status', label: 'Atualizar plano', reason: 'Verificar pendências remanescentes.' },
            { action: 'question', label: 'Quais pendências críticas?', reason: 'Conferir diagnóstico final.' },
          ];
    }
  } else if (intent.kind === 'cancel_pending_action' && pendingActionAvailable && lastAssistantActionPreview) {
    assistantContent = `Acao "${lastAssistantActionPreview.title || lastAssistantActionPreview.action}" cancelada. Nenhuma operacao foi executada.`;
    assistantRichContent = {
      type: 'summary',
      data: {
        title: 'Ação cancelada',
        items: [
          { label: 'Acao', value: lastAssistantActionPreview.title || lastAssistantActionPreview.action },
          { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
          { label: 'Data', value: contextSnapshot.data_referencia },
        ],
      },
    };
  } else if (intent.kind === 'confirm_pending_action' && pendingActionAvailable && lastAssistantActionPreview) {
    if ((lastPendingActionState?.step || 'preview') === 'preview') {
      const summary = buildPendingActionSummary({
        actionPreview: lastAssistantActionPreview,
        contextSnapshot,
      });
      assistantContent = summary.content;
      assistantRichContent = summary.richContent;
      pendingActionState = summary.state;
      actionPreview = lastAssistantActionPreview;
    } else if (!input.baseUrl || !input.accessToken) {
      assistantContent = 'Nao foi possivel executar via confirmação textual neste ambiente. Use o botão de confirmação da ação.';
    } else {
      const execution = await executeBankChatAction({
        adminClient: input.adminClient,
        baseUrl: input.baseUrl,
        accessToken: input.accessToken,
        empresaId: input.empresaId,
        userId: input.userId,
        contaBancariaId: contextSnapshot.conta_bancaria_id,
        dataReferencia: contextSnapshot.data_referencia,
        importId: contextSnapshot.import_id,
        sessionId: session.id,
        action: lastAssistantActionPreview.action as BankChatActionKind,
        idempotencyKey: lastAssistantActionPreview.idempotency_key,
        planId: lastAssistantActionPreview.plan_id || null,
      });

      assistantContent = execution.assistant_message;
      assistantRichContent = execution.rich_content;
      reconciliationPlan = execution.reconciliation_plan || null;
      clarifyingQuestions = execution.clarifying_questions || null;
      pendingCases = execution.pending_cases || null;
      reviewGuidance = execution.review_guidance || null;
      aiProcessingStatus = execution.ai_processing_status || null;
      if (typeof execution.ui_show_operational_cards === 'boolean') {
        uiShowOperationalCards = execution.ui_show_operational_cards;
      }
      if (typeof execution.ui_show_plan_card === 'boolean') {
        uiShowPlanCard = execution.ui_show_plan_card;
      }
      if (typeof execution.ui_show_guided_card === 'boolean') {
        uiShowGuidedCard = execution.ui_show_guided_card;
      }
      lastExecutionSummary = {
        action: execution.action,
        executed_at: execution.executed_at,
        status:
          execution.ai_processing_status?.state === 'failed'
            ? 'error'
            : execution.ai_processing_status?.state === 'timeout'
              ? 'warning'
            : execution.ai_processing_status?.state === 'processing' ||
              execution.ai_processing_status?.state === 'triggered' ||
              execution.ai_processing_status?.state === 'polling'
              ? 'processing'
              : 'ok',
        summary: execution.execution_summary?.message || execution.assistant_message,
        correlation_id: execution.correlation_id || undefined,
        ai_processing_status: execution.ai_processing_status || null,
        affected_counts: execution.affected_counts || null,
      };
      suggestedNextActions =
        (reconciliationPlan?.totals?.total || 0) > 0
          ? [
            { action: 'apply_reconciliation_plan', label: 'Aplicar plano de conciliação', reason: 'Há sugestões pendentes.' },
            { action: 'resolve_pending_issues', label: 'Corrigir pendências', reason: 'Revisar/excluir itens antes de aplicar.' },
          ]
          : aiProcessingStatus?.state === 'failed'
          ? [
              { action: 'run_daily_reconciliation', label: 'Conciliar', reason: 'Reexecutar após falha de disparo.' },
              { action: 'question', label: 'Quais pendências críticas?', reason: 'Seguir diagnóstico/manual enquanto isso.' },
            ]
          : aiProcessingStatus && ['processing', 'triggered', 'timeout', 'polling'].includes(aiProcessingStatus.state)
            ? [
              { action: 'update_plan_status', label: 'Atualizar plano', reason: 'IA ainda pode estar processando.' },
              { action: 'question', label: 'Quais pendências críticas?', reason: 'Ver diagnóstico do contexto atual.' },
            ]
            : suggestedNextActions;
    }
  } else if (intent.kind === 'confirm_pending_action' || intent.kind === 'cancel_pending_action') {
    assistantContent = 'Nao encontrei uma ação pendente válida para confirmar/cancelar no contexto atual. Peça a ação novamente.';
  } else if (continueGuidedReviewRequested) {
    if (ofxRequired) {
      setOfxRequiredResponse();
    } else if (!guidedReviewPilotGate.allowed) {
      assistantContent = 'Revisao guiada indisponivel neste contexto por configuracao operacional.';
      assistantRichContent = {
        type: 'summary',
        data: {
          title: 'Revisão guiada indisponível',
          items: [
            { label: 'Motivo', value: guidedReviewPilotGate.reason || 'fora do escopo configurado' },
            { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
            { label: 'Data', value: contextSnapshot.data_referencia },
          ],
        },
      };
    } else {
      const guidancePlan = reconciliationPlan || executionStateSnapshot?.reconciliationPlan || null;
      const guidanceSnapshot = await getReviewGuidanceSnapshot({
        adminClient: input.adminClient,
        empresaId: input.empresaId,
        sessionId: session.id,
        plan: guidancePlan,
      }).catch(() => null);

      if (guidanceSnapshot) {
        reviewGuidance = guidanceSnapshot;
        clarifyingQuestions = null;
        pendingCases = null;
        const guidedAnswer = buildGuidedReviewAnswer(guidanceSnapshot);
        assistantContent = guidedAnswer.content;
        assistantRichContent = guidedAnswer.richContent;
        uiShowGuidedCard = true;
        uiShowPlanCard = false;
      } else {
        assistantContent = 'Não consegui carregar a fila da revisão guiada agora. Tente novamente em instantes.';
      }
    }
  } else if (intent.kind === 'execution_status_query') {
    if (ofxRequired) {
      setOfxRequiredResponse();
    } else {
      const answer = buildExecutionStatusAnswer({
        executionState: executionStateSnapshot || {
          lastAssistantExecutionMessage: null,
          executionSummary: null,
          lastExecutionSummary: null,
          affectedCounts: null,
          reconciliationPlan: null,
          pendingCases: null,
          clarifyingQuestions: null,
          pendingActionState: null,
          aiProcessingStatus: null,
          aiExecutionRun: null,
          suggestedNextActions: [],
        },
        contextSnapshot,
      });
      assistantContent = answer.content;
      assistantRichContent = answer.richContent;
      aiProcessingStatus = executionStateSnapshot?.aiProcessingStatus || null;
      reconciliationPlan = executionStateSnapshot?.reconciliationPlan || null;
      clarifyingQuestions = executionStateSnapshot?.clarifyingQuestions || null;
      pendingCases = executionStateSnapshot?.pendingCases || null;
    }
  } else if (intent.kind === 'execution_details_query') {
    if (ofxRequired) {
      setOfxRequiredResponse();
    } else {
      const answer = buildExecutionDetailsAnswer({
        executionState: executionStateSnapshot || {
          lastAssistantExecutionMessage: null,
          executionSummary: null,
          lastExecutionSummary: null,
          affectedCounts: null,
          reconciliationPlan: null,
          pendingCases: null,
          clarifyingQuestions: null,
          pendingActionState: null,
          aiProcessingStatus: null,
          aiExecutionRun: null,
          suggestedNextActions: [],
        },
        contextSnapshot,
      });
      assistantContent = answer.content;
      assistantRichContent = answer.richContent;
      aiProcessingStatus = executionStateSnapshot?.aiProcessingStatus || null;
      reconciliationPlan = executionStateSnapshot?.reconciliationPlan || null;
      clarifyingQuestions = executionStateSnapshot?.clarifyingQuestions || null;
      pendingCases = executionStateSnapshot?.pendingCases || null;
    }
  } else if (intent.kind === 'update_plan_status') {
    if (ofxRequired) {
      setOfxRequiredResponse();
    } else {
      const planArtifacts = await buildCurrentReconciliationPlan({
        adminClient: input.adminClient,
        contextSnapshot,
        aiExecutionRun: executionStateSnapshot?.aiExecutionRun || null,
      });
      reconciliationPlan = planArtifacts.plan;
      clarifyingQuestions = planArtifacts.clarifying_questions;
      pendingCases = planArtifacts.pending_cases;
      aiProcessingStatus = executionStateSnapshot?.aiProcessingStatus || null;
      const diagnostic = buildPendingDiagnosticAnswer({
        contextSnapshot,
        planArtifacts,
        aiProcessingStatus,
        suggestedNextActions: executionStateSnapshot?.suggestedNextActions || null,
        reviewGuidance: reviewGuidance || null,
      });
      assistantContent = diagnostic.content;
      assistantRichContent = diagnostic.richContent;
    }
  } else if (
    intent.kind === 'matching' ||
    intent.kind === 'trigger_ai' ||
    intent.kind === 'refresh_summary' ||
    intent.kind === 'run_daily_reconciliation' ||
    intent.kind === 'daily_close' ||
    intent.kind === 'daily_reopen'
  ) {
    let effectiveIntentKind:
      | 'matching'
      | 'trigger_ai'
      | 'refresh_summary'
      | 'run_daily_reconciliation'
      | 'daily_close'
      | 'daily_reopen'
      | 'apply_reconciliation_plan' = intent.kind;

    if (intent.kind === 'run_daily_reconciliation' && executionStateSnapshot) {
      const latestPlanTotalRaw = executionStateSnapshot.reconciliationPlan?.totals?.total || 0;
      const latestPlanTotal = hasFailedTriggerWithoutDispatch(executionStateSnapshot) ? 0 : latestPlanTotalRaw;
      const aiState = executionStateSnapshot.aiProcessingStatus?.state || null;
      const lastExecution = executionStateSnapshot.lastExecutionSummary;
      const explicitRerunRequested =
        normalizedForIntent.includes('novamente') ||
        normalizedForIntent.includes('de novo') ||
        normalizedForIntent.includes('reexecut') ||
        normalizedForIntent.includes('rerun') ||
        normalizedForIntent.includes('rodar novamente');
      const genericExecuteConciliation =
        (normalizedForIntent.includes('execut') ||
          normalizedForIntent.includes('faz') ||
          normalizedForIntent.includes('faca') ||
          normalizedForIntent.includes('faça') ||
          normalizedForIntent.includes('rod') ||
          normalizedForIntent.includes('inici') ||
          normalizedForIntent.includes('dispar')) &&
        (normalizedForIntent.includes('concili') || normalizedForIntent.includes('concial'));

      const shouldApplyStatefulReroute =
        !explicitRerunRequested &&
        (genericExecuteConciliation || normalizedForIntent.includes('concili') || normalizedForIntent.includes('concial'));

      const hasRecentRunInProgressOrWarning =
        lastExecution?.action === 'run_daily_reconciliation' &&
        (lastExecution.status === 'processing' || lastExecution.status === 'warning');
      const shouldTreatAsIaStillProcessing =
        aiState === 'processing' ||
        aiState === 'triggered' ||
        aiState === 'timeout' ||
        aiState === 'polling' ||
        (!aiState && hasRecentRunInProgressOrWarning);

      const rerouteDecision = resolveRunDailyStatefulReroute({
        shouldApplyStatefulReroute,
        latestPlanTotal,
        shouldTreatAsIaStillProcessing,
      });

      if (rerouteDecision === 'apply_reconciliation_plan') {
        effectiveIntentKind = 'apply_reconciliation_plan';
        reconciliationPlan = executionStateSnapshot.reconciliationPlan || null;
        clarifyingQuestions = executionStateSnapshot.clarifyingQuestions || null;
        pendingCases = executionStateSnapshot.pendingCases || null;
      } else if (rerouteDecision === 'show_processing_status') {
        const displayAiState =
          aiState === 'processing' || aiState === 'triggered' || aiState === 'polling'
            ? 'Aguardando IA'
            : aiState === 'timeout' || (!aiState && hasRecentRunInProgressOrWarning)
              ? 'Tempo de espera expirou'
              : aiState || 'Aguardando IA';
        assistantContent =
          executionStateSnapshot.aiProcessingStatus?.message ||
          lastExecution?.summary ||
          'A IA ainda está processando este contexto. Use "Atualizar plano" em alguns segundos.';
        assistantRichContent = {
          type: 'summary',
          data: {
            title: 'IA em processamento',
            items: [
              { label: 'Status IA', value: displayAiState },
              { label: 'Conta', value: contextSnapshot.conta_label || contextSnapshot.conta_bancaria_id },
              { label: 'Data', value: contextSnapshot.data_referencia },
            ],
          },
        };
        aiProcessingStatus = executionStateSnapshot.aiProcessingStatus || null;
        suggestedNextActions = executionStateSnapshot.suggestedNextActions || suggestedNextActions;
      }
    }

    if (
      !assistantContent &&
      ofxRequired &&
      (effectiveIntentKind === 'matching' ||
        effectiveIntentKind === 'trigger_ai' ||
        effectiveIntentKind === 'run_daily_reconciliation')
    ) {
      setOfxRequiredResponse();
    }

    const requiresParsedImport =
      effectiveIntentKind === 'matching' ||
      effectiveIntentKind === 'trigger_ai' ||
      effectiveIntentKind === 'run_daily_reconciliation';

    if (!assistantContent && requiresParsedImport && contextSnapshot.import_parse_status !== 'parsed') {
      assistantContent = contextSnapshot.import_id
        ? `Nao posso executar essa acao agora porque a importacao ${contextSnapshot.import_id} esta em status ${contextSnapshot.import_parse_status || 'desconhecido'}.${contextSnapshot.import_error_message ? ` Erro: ${contextSnapshot.import_error_message}` : ''
        }`
        : 'Nao encontrei uma importacao processada (parsed) para a conta/data selecionadas. Anexe e processe o extrato primeiro.';
    } else if (!assistantContent) {
      actionPreview = buildActionPreview({
        kind: effectiveIntentKind as
          | 'matching'
          | 'trigger_ai'
          | 'refresh_summary'
          | 'run_daily_reconciliation'
          | 'apply_reconciliation_plan'
          | 'daily_close'
          | 'daily_reopen',
        contextSnapshot,
        userId: input.userId,
        ...(effectiveIntentKind === 'apply_reconciliation_plan'
          ? { planId: (reconciliationPlan || executionStateSnapshot?.reconciliationPlan || null)?.plan_id || null }
          : {}),
      });

      assistantContent = `Entendi. Posso executar "${actionPreview.title}" para conta/data selecionadas. Confirme para continuar.`;
    }
  } else if (intent.kind === 'apply_reconciliation_plan' || intent.kind === 'resolve_pending_issues') {
    if (ofxRequired) {
      setOfxRequiredResponse();
    } else if (hasFailedTriggerWithoutDispatch(executionStateSnapshot)) {
      assistantContent =
        'O último disparo da IA falhou antes de iniciar. Para evitar aplicar um plano desatualizado, o plano foi ocultado. Tente "Conciliar" novamente.';
      assistantRichContent = {
        type: 'summary',
        data: {
          title: 'Plano ocultado por falha de disparo',
          items: [
            { label: 'Status IA', value: 'Falha no disparo' },
            { label: 'Próximo passo', value: 'Conciliar' },
          ],
        },
      };
      aiProcessingStatus = executionStateSnapshot?.aiProcessingStatus || null;
      suggestedNextActions = [
        { action: 'run_daily_reconciliation', label: 'Conciliar', reason: 'Reexecutar após falha de disparo.' },
        { action: 'question', label: 'Quais pendências críticas?', reason: 'Seguir diagnóstico/manual enquanto isso.' },
      ];
    } else {
    const planArtifacts = await buildCurrentReconciliationPlan({
      adminClient: input.adminClient,
      contextSnapshot,
      aiExecutionRun: executionStateSnapshot?.aiExecutionRun || null,
    });
    reconciliationPlan = planArtifacts.plan;
    clarifyingQuestions = planArtifacts.clarifying_questions;
    pendingCases = planArtifacts.pending_cases;

    if (reconciliationPlan && reconciliationPlan.totals.total > 0) {
      actionPreview = buildActionPreview({
        kind: 'apply_reconciliation_plan',
        contextSnapshot,
        userId: input.userId,
        planId: reconciliationPlan.plan_id,
      });

      const blockedCreateNewCount =
        balanceMutationBlocked && reconciliationPlan.totals.create_new > 0
          ? reconciliationPlan.totals.create_new
          : 0;
      const balanceMutationNote =
        blockedCreateNewCount > 0
          ? ` Nesta fase, ${blockedCreateNewCount} item(ns) sem vínculo automático ficam fora da aplicação em lote e seguem para decisão de divergência na revisão guiada.`
          : '';

      assistantContent = `Encontrei um plano pendente com ${reconciliationPlan.totals.total} sugestão(ões) para aplicar. Posso executar "${actionPreview.title}" após sua confirmação.${balanceMutationNote} Nesta fase, este chat só atualiza conciliação e tags do extrato.`;
      assistantRichContent = {
        type: 'summary',
        data: {
          title: 'Plano de conciliação pendente',
          items: [
            { label: 'Total', value: reconciliationPlan.totals.total },
            { label: 'Vínculo existente', value: reconciliationPlan.totals.match_existing },
            { label: 'Sem vínculo automático', value: reconciliationPlan.totals.create_new },
            ...(blockedCreateNewCount > 0 ? [{ label: 'Criação bloqueada', value: blockedCreateNewCount }] : []),
            { label: 'Ignorar', value: reconciliationPlan.totals.ignore },
            { label: 'Revisão necessária', value: reconciliationPlan.totals.needs_review },
            { label: 'Itens em revisão guiada', value: clarifyingQuestions?.length || 0 },
          ],
        },
      };
    } else {
      const diagnostic = buildPendingDiagnosticAnswer({
        contextSnapshot,
        planArtifacts,
        aiProcessingStatus: executionStateSnapshot?.aiProcessingStatus || null,
        suggestedNextActions: executionStateSnapshot?.suggestedNextActions || null,
        reviewGuidance: reviewGuidance || null,
      });
      const lastAiState = executionStateSnapshot?.aiProcessingStatus?.state || null;
      assistantContent =
        intent.kind === 'resolve_pending_issues'
          ? (lastAiState === 'timeout' ||
            lastAiState === 'polling' ||
            lastAiState === 'triggered' ||
            lastAiState === 'processing'
            ? `Ainda estou aguardando a IA concluir o processamento. ${diagnostic.content} Diga "Atualizar plano" em alguns segundos.`
            : lastAiState === 'no_pending'
              ? `A IA concluiu sem sugestões para este contexto. ${diagnostic.content}`
              : lastAiState === 'failed'
                ? `O workflow da IA falhou na última execução. ${diagnostic.content} Você pode dizer "Conciliar" para tentar novamente.`
                : `Ainda nao encontrei plano pendente para aplicar. ${diagnostic.content}`)
          : 'Não encontrei plano de conciliação pendente (sugestões IA com status suggested) para a conta/data selecionadas.';
      if (intent.kind === 'resolve_pending_issues') {
        assistantRichContent = diagnostic.richContent;
        aiProcessingStatus = executionStateSnapshot?.aiProcessingStatus || null;
      }
    }
    }
  } else {
    const external = await callExternalChatWebhook({
      message: normalizedMessage,
      contextSnapshot,
    });

    if (external) {
      assistantContent = external.content;
      assistantRichContent = external.richContent;
      actionPreview = external.actionPreview;
    } else {
      const asksPendingDetails =
        normalizedForIntent.includes('pendenc') || normalizedForIntent.includes('divergenc');

      if (asksPendingDetails) {
        try {
          const planArtifacts = await buildCurrentReconciliationPlan({
            adminClient: input.adminClient,
            contextSnapshot,
            aiExecutionRun: executionStateSnapshot?.aiExecutionRun || null,
          });
          reconciliationPlan = planArtifacts.plan;
          clarifyingQuestions = planArtifacts.clarifying_questions;
          pendingCases = planArtifacts.pending_cases;
          const diagnostic = buildPendingDiagnosticAnswer({
            contextSnapshot,
            planArtifacts,
            aiProcessingStatus: executionStateSnapshot?.aiProcessingStatus || null,
            suggestedNextActions: executionStateSnapshot?.suggestedNextActions || null,
            reviewGuidance: reviewGuidance || null,
          });
          assistantContent = diagnostic.content;
          assistantRichContent = diagnostic.richContent;
          aiProcessingStatus = executionStateSnapshot?.aiProcessingStatus || null;
        } catch {
          const deterministic = buildDeterministicQuestionAnswer({
            message: normalizedMessage,
            contextSnapshot,
          });
          assistantContent = deterministic.content;
          assistantRichContent = deterministic.richContent;
        }
      } else {
        const deterministic = buildDeterministicQuestionAnswer({
          message: normalizedMessage,
          contextSnapshot,
        });
        assistantContent = deterministic.content;
        assistantRichContent = deterministic.richContent;

        if (contextSnapshot.pendencias_criticas > 0) {
          try {
            const planArtifacts = await buildCurrentReconciliationPlan({
              adminClient: input.adminClient,
              contextSnapshot,
              aiExecutionRun: executionStateSnapshot?.aiExecutionRun || null,
            });
            if (planArtifacts.plan) {
              reconciliationPlan = planArtifacts.plan;
              clarifyingQuestions = planArtifacts.clarifying_questions;
              pendingCases = planArtifacts.pending_cases;
            }
          } catch {
            // não bloquear resposta analítica por falha ao montar plano
          }
        }
      }
    }
  }

  const shouldHideGuidanceForRunPreview =
    actionPreview?.action === 'run_daily_reconciliation' && (pendingActionState?.step || 'preview') === 'preview';

  if (guidedReviewPilotGate.allowed && !shouldHideGuidanceForRunPreview && !ofxRequired) {
    const guidancePlan = reconciliationPlan || executionStateSnapshot?.reconciliationPlan || null;
    const shouldSyncGuidedQueue =
      !input.interaction &&
      Boolean(reconciliationPlan) &&
      (intent.kind === 'run_daily_reconciliation' || intent.kind === 'apply_reconciliation_plan');

    if (guidancePlan && shouldSyncGuidedQueue) {
      await syncReviewQueueFromPlan({
        adminClient: input.adminClient,
        empresaId: input.empresaId,
        userId: input.userId,
        sessionId: session.id,
        contaBancariaId: contextSnapshot.conta_bancaria_id,
        dataReferencia: contextSnapshot.data_referencia,
        plan: guidancePlan,
      }).catch(() => null);
    }

    const guidanceSnapshot = await getReviewGuidanceSnapshot({
      adminClient: input.adminClient,
      empresaId: input.empresaId,
      sessionId: session.id,
      plan: guidancePlan,
    }).catch(() => null);

    if (guidanceSnapshot) {
      reviewGuidance = guidanceSnapshot;
      clarifyingQuestions = null;
      pendingCases = null;
      uiShowGuidedCard = true;
      uiShowPlanCard = false;
      assistantRichContent = patchGuidedReviewCountInRichContent(
        assistantRichContent || undefined,
        Number(reviewGuidance.queue_remaining || 0)
      ) || null;
    }
  }

  if (actionPreview && !pendingActionState) {
    pendingActionState = {
      step: 'preview',
      action: actionPreview.action,
      expires_at: new Date(Date.now() + TEXT_CONFIRM_TTL_MS).toISOString(),
    };
  }

  const resolvedAiProcessingStatus = aiProcessingStatus || executionStateSnapshot?.aiProcessingStatus || null;
  const resolvedSuggestedNextActions = buildCanonicalSuggestedNextActions({
    aiProcessingStatus: resolvedAiProcessingStatus,
    reconciliationPlan,
    reviewGuidance,
    fallbackActions: suggestedNextActions || null,
    ofxRequired,
  });
  suggestedNextActions = resolvedSuggestedNextActions;
  aiProcessingStatus = resolvedAiProcessingStatus;

  const hasActiveGuidedCard =
    Boolean(reviewGuidance) &&
    !shouldHideGuidanceForRunPreview &&
    (Number(reviewGuidance?.queue_total || 0) > 0 ||
      Number(reviewGuidance?.queue_remaining || 0) > 0 ||
      Boolean(reviewGuidance?.current_case) ||
      Boolean(reviewGuidance?.batch_offer) ||
      reviewGuidance?.display_mode === 'guided_completed');
  const planTotal = Number(reconciliationPlan?.totals?.total || 0);
  uiShowGuidedCard = hasActiveGuidedCard;
  if (!hasActiveGuidedCard) {
    uiShowPlanCard = planTotal > 0;
  } else {
    uiShowPlanCard = false;
  }

  const assistantMessageRow = await insertBankChatMessage({
    adminClient: input.adminClient,
    session,
    role: 'assistant',
    content: assistantContent,
    richContent: assistantRichContent,
    context: {
      conta_bancaria_id: contextSnapshot.conta_bancaria_id,
      data_referencia: contextSnapshot.data_referencia,
      import_id: contextSnapshot.import_id,
      active_extrato_transacao_id: input.activeExtratoTransacaoId || null,
      parse_status: contextSnapshot.import_parse_status,
    },
    metadata: {
      source: 'bank_reconciliation_chat',
      intent: intent.kind,
      intent_confidence: intent.confidence,
      intent_reason: intent.reason,
      action_preview: actionPreview || null,
      pending_action_state: pendingActionState || null,
      reconciliation_plan: reconciliationPlan || null,
      clarifying_questions: clarifyingQuestions || null,
      pending_cases: pendingCases || null,
      ai_processing_status: aiProcessingStatus || null,
      last_execution_summary: lastExecutionSummary || null,
      suggested_next_actions: suggestedNextActions || null,
      review_guidance: reviewGuidance || null,
      ui_show_operational_cards: uiShowOperationalCards,
      ui_show_plan_card: uiShowPlanCard,
      ui_show_guided_card: uiShowGuidedCard,
      agent_reasoning: agentResponse.message,
      agent_mode: chatAgentMode,
    },
  });

  const shouldDispatchAssistAgent =
    chatAgentMode === 'assist' &&
    !!agentWebhookUrl &&
    !input.interaction &&
    !actionPreview &&
    ASSIST_AGENT_INTENTS.has(intent.kind);

  if (shouldDispatchAssistAgent) {
    void loadRecentChatHistory({
      adminClient: input.adminClient,
      empresaId: input.empresaId,
      sessionId: session.id,
    })
      .then((history) => {
        const agent = new BankReconciliationAgent(input.adminClient);
        agent.triggerAsync(normalizedMessage, {
          empresa_id: input.empresaId,
          conta_bancaria_id: contextSnapshot.conta_bancaria_id,
          data: contextSnapshot.data_referencia,
          data_referencia: contextSnapshot.data_referencia,
          import_id: contextSnapshot.import_id,
          extrato_import_id: contextSnapshot.import_id,
          session_id: session.id,
          history,
          summary: contextSnapshot.daily_summary,
          pending_items_count: contextSnapshot.pendencias_criticas,
          ai_processing_status: executionStateSnapshot?.aiProcessingStatus || null,
          last_execution_summary: executionStateSnapshot?.lastExecutionSummary || null,
          reconciliation_plan: executionStateSnapshot?.reconciliationPlan || null,
          suggested_next_actions: executionStateSnapshot?.suggestedNextActions || null,
        });
      })
      .catch(() => {
        // não bloquear resposta do chat por falha ao disparar agente assistivo
      });
  }

  return {
    session,
    user_message: userMessageRow,
    assistant_message: assistantMessageRow,
    ...(actionPreview ? { action_preview: actionPreview } : {}),
    context_snapshot: contextSnapshot,
    reconciliation_plan: reconciliationPlan,
    clarifying_questions: clarifyingQuestions,
    pending_cases: pendingCases,
    pending_action_state: pendingActionState,
    ai_processing_status: aiProcessingStatus,
    last_execution_summary: lastExecutionSummary,
    suggested_next_actions: suggestedNextActions,
    review_guidance: reviewGuidance,
    ui_show_operational_cards: uiShowOperationalCards,
    ui_show_plan_card: uiShowPlanCard,
    ui_show_guided_card: uiShowGuidedCard,
  };
}

async function loadRecentChatHistory(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
}): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const { data, error } = await args.adminClient
    .from('bank_reconciliation_chat_messages')
    .select('role,content')
    .eq('empresa_id', args.empresaId)
    .eq('session_id', args.sessionId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data) return [];
  return data.reverse() as Array<{ role: 'user' | 'assistant'; content: string }>;
}
