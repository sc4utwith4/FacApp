import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatActionExecutionSummary,
  ChatAiProcessingStatus,
  ChatClarifyingQuestion,
  ChatLastExecutionSummary,
  ChatPendingActionState,
  ChatPendingCase,
  ChatReconciliationPlan,
  ChatSuggestedNextAction,
} from '../../../types/bank-reconciliation.js';
import {
  getBankAiExecutionRunByCorrelation,
  getLatestBankAiExecutionRunForContext,
  type BankAiExecutionRunRow,
} from '../aiExecutionRuns.js';

type AssistantMessageRow = {
  id: string;
  content: string;
  created_at: string;
  context: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export interface ChatExecutionStateSnapshot {
  lastAssistantExecutionMessage: AssistantMessageRow | null;
  executionSummary: ChatActionExecutionSummary | null;
  lastExecutionSummary: ChatLastExecutionSummary | null;
  affectedCounts: Record<string, number> | null;
  reconciliationPlan: ChatReconciliationPlan | null;
  pendingCases: ChatPendingCase[] | null;
  clarifyingQuestions: ChatClarifyingQuestion[] | null;
  pendingActionState: ChatPendingActionState | null;
  aiProcessingStatus: ChatAiProcessingStatus | null;
  aiExecutionRun: BankAiExecutionRunRow | null;
  suggestedNextActions: ChatSuggestedNextAction[];
}

const toDateOnly = (value: unknown): string | null => {
  const str = String(value || '').trim();
  if (!str) return null;
  return str.slice(0, 10);
};

const parseRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const parsePendingActionState = (value: unknown): ChatPendingActionState | null => {
  const row = parseRecord(value);
  if (!row) return null;
  const step = row.step;
  const action = row.action;
  if ((step !== 'preview' && step !== 'text_confirmation') || typeof action !== 'string') return null;
  return {
    step,
    action: action as ChatPendingActionState['action'],
    expires_at: typeof row.expires_at === 'string' ? row.expires_at : undefined,
  };
};

const parseAiStatus = (value: unknown): ChatAiProcessingStatus | null => {
  const row = parseRecord(value);
  if (!row || typeof row.state !== 'string') return null;
  return row as unknown as ChatAiProcessingStatus;
};

const parseExecutionSummary = (value: unknown): ChatActionExecutionSummary | null => {
  const row = parseRecord(value);
  if (!row || typeof row.title !== 'string' || typeof row.message !== 'string') return null;
  return row as unknown as ChatActionExecutionSummary;
};

const parsePlan = (value: unknown): ChatReconciliationPlan | null => {
  const row = parseRecord(value);
  if (!row || typeof row.plan_id !== 'string' || !Array.isArray(row.items)) return null;
  return row as unknown as ChatReconciliationPlan;
};

const parseArray = <T>(value: unknown): T[] | null => (Array.isArray(value) ? (value as T[]) : null);

const VALID_CHAT_ACTIONS = new Set([
  'matching',
  'trigger_ai',
  'refresh_summary',
  'run_daily_reconciliation',
  'apply_reconciliation_plan',
  'daily_close',
  'daily_reopen',
]);

function deriveChatAiProcessingStatusFromRun(run: BankAiExecutionRunRow | null): ChatAiProcessingStatus | null {
  if (!run) return null;
  return {
    state: run.status,
    message:
      run.status === 'completed'
        ? 'IA concluiu e atualizou sugestões.'
        : run.status === 'no_pending'
          ? 'IA concluiu sem gerar sugestões para este contexto.'
          : run.status === 'failed'
            ? (run.error_message || 'Workflow IA falhou.')
            : run.status === 'timeout'
              ? 'Tempo de espera local expirou; a IA pode continuar processando.'
              : 'IA em processamento.',
    correlation_id: run.correlation_id,
    execution_run_id: run.id,
    last_updated_at: run.updated_at,
    counts: {
      sugestoes_total: run.sugestoes_total,
      match_existing_count: run.match_existing_count,
      create_new_count: run.create_new_count,
      ignore_count: run.ignore_count,
      needs_review_count: run.needs_review_count,
    },
  };
}

function deriveSuggestedNextActions(args: {
  aiProcessingStatus: ChatAiProcessingStatus | null;
  reconciliationPlan: ChatReconciliationPlan | null;
}): ChatSuggestedNextAction[] {
  const state = args.aiProcessingStatus?.state || null;
  const planTotal = args.reconciliationPlan?.totals?.total || 0;

  if (planTotal > 0) {
    return [
      { action: 'apply_reconciliation_plan', label: 'Aplicar plano de conciliação', reason: 'Há sugestões pendentes.' },
      { action: 'resolve_pending_issues', label: 'Corrigir pendências', reason: 'Revisar/excluir itens antes de aplicar.' },
      { action: 'question', label: 'Ver pendências', reason: 'Entender o que ainda falta.' },
    ];
  }

  if (state === 'processing' || state === 'triggered' || state === 'timeout') {
    return [
      { action: 'update_plan_status', label: 'Atualizar plano', reason: 'IA ainda pode estar processando.' },
      { action: 'question', label: 'Quais pendências críticas?', reason: 'Diagnóstico enquanto aguarda IA.' },
    ];
  }

  if (state === 'no_pending') {
    return [
      { action: 'question', label: 'Quais pendências críticas?', reason: 'IA concluiu sem sugestões; precisa revisão guiada.' },
      { action: 'run_daily_reconciliation', label: 'Conciliar', reason: 'Reexecutar fluxo após novos ajustes.' },
    ];
  }

  if (state === 'failed') {
    return [
      { action: 'run_daily_reconciliation', label: 'Conciliar', reason: 'Reexecutar após falha da IA.' },
      { action: 'question', label: 'Quais pendências críticas?', reason: 'Seguir diagnóstico/manual enquanto isso.' },
    ];
  }

  return [];
}

function hasTriggerDispatchFailure(args: {
  aiProcessingStatus: ChatAiProcessingStatus | null;
  lastExecutionAction: ChatLastExecutionSummary['action'] | null;
  affectedCounts: Record<string, number> | null;
}): boolean {
  if (args.aiProcessingStatus?.state !== 'failed') return false;
  if (args.lastExecutionAction === 'trigger_ai') {
    return Number(args.affectedCounts?.triggered || 0) === 0;
  }
  if (args.lastExecutionAction === 'run_daily_reconciliation') {
    return Number(args.affectedCounts?.ai_triggered || 0) === 0;
  }
  return false;
}

function hasNoPendingTerminalRun(args: {
  aiProcessingStatus: ChatAiProcessingStatus | null;
  aiExecutionRun: BankAiExecutionRunRow | null;
}): boolean {
  if (args.aiExecutionRun?.status === 'no_pending') return true;
  return args.aiProcessingStatus?.state === 'no_pending';
}

export async function loadChatExecutionStateSnapshot(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  sessionId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId?: string | null;
}): Promise<ChatExecutionStateSnapshot> {
  const { data, error } = await args.adminClient
    .from('bank_reconciliation_chat_messages')
    .select('id,content,created_at,context,metadata')
    .eq('empresa_id', args.empresaId)
    .eq('session_id', args.sessionId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(`Falha ao carregar memória operacional do chat: ${error.message}`);
  }

  const rows = ((data || []) as AssistantMessageRow[]).filter((row) => {
    const context = parseRecord(row.context);
    if (!context) return false;
    const conta = String(context.conta_bancaria_id || '').trim();
    const dataRef = toDateOnly(context.data_referencia);
    if (!conta || !dataRef) return false;
    if (conta !== args.contaBancariaId) return false;
    if (dataRef !== toDateOnly(args.dataReferencia)) return false;
    if (args.importId) {
      const importId = String(context.import_id || '').trim();
      if (importId && importId !== args.importId) return false;
    }
    return true;
  });

  let lastAssistantExecutionMessage: AssistantMessageRow | null = null;
  let executionSummary: ChatActionExecutionSummary | null = null;
  let affectedCounts: Record<string, number> | null = null;
  let reconciliationPlan: ChatReconciliationPlan | null = null;
  let pendingCases: ChatPendingCase[] | null = null;
  let clarifyingQuestions: ChatClarifyingQuestion[] | null = null;
  let pendingActionState: ChatPendingActionState | null = null;
  let aiProcessingStatusFromMessage: ChatAiProcessingStatus | null = null;
  let correlationId: string | null = null;
  let executionAction: ChatLastExecutionSummary['action'] | null = null;

  for (const row of rows) {
    const metadata = parseRecord(row.metadata) || {};

    if (!pendingActionState) {
      pendingActionState = parsePendingActionState(metadata.pending_action_state);
    }
    if (!aiProcessingStatusFromMessage) {
      aiProcessingStatusFromMessage = parseAiStatus(metadata.ai_processing_status);
    }
    if (!reconciliationPlan) {
      reconciliationPlan = parsePlan(metadata.reconciliation_plan);
    }
    if (!pendingCases) {
      pendingCases = parseArray<ChatPendingCase>(metadata.pending_cases);
    }
    if (!clarifyingQuestions) {
      clarifyingQuestions = parseArray<ChatClarifyingQuestion>(metadata.clarifying_questions);
    }
    if (!correlationId && typeof metadata.correlation_id === 'string') {
      correlationId = metadata.correlation_id;
    }

    const currentExecutionSummary = parseExecutionSummary(metadata.execution_summary);
    const executionResult = parseRecord(metadata.execution_result);
    if (!lastAssistantExecutionMessage && (currentExecutionSummary || executionResult)) {
      lastAssistantExecutionMessage = row;
      executionSummary = currentExecutionSummary;
      affectedCounts =
        metadata.affected_counts && typeof metadata.affected_counts === 'object'
          ? (metadata.affected_counts as Record<string, number>)
          : null;
      if (!aiProcessingStatusFromMessage) {
        aiProcessingStatusFromMessage = parseAiStatus(metadata.ai_processing_status);
      }
      if (!correlationId && typeof metadata.correlation_id === 'string') {
        correlationId = metadata.correlation_id;
      }
      if (!correlationId && executionResult && typeof executionResult.correlation_id === 'string') {
        correlationId = executionResult.correlation_id;
      }
      executionAction =
        typeof metadata.action === 'string'
          ? (metadata.action as ChatLastExecutionSummary['action'])
          : executionResult && typeof executionResult.action === 'string'
            ? (executionResult.action as ChatLastExecutionSummary['action'])
            : null;
    }
  }

  const aiExecutionRun = correlationId
    ? await getBankAiExecutionRunByCorrelation({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        correlationId,
      })
    : await getLatestBankAiExecutionRunForContext({
        adminClient: args.adminClient,
        empresaId: args.empresaId,
        contaBancariaId: args.contaBancariaId,
        extratoImportId: args.importId || null,
      });

  const aiProcessingStatus = deriveChatAiProcessingStatusFromRun(aiExecutionRun) || aiProcessingStatusFromMessage;
  const resolvedExecutionAction =
    executionAction && VALID_CHAT_ACTIONS.has(executionAction)
      ? executionAction
      : null;

  const staleReason =
    aiProcessingStatus &&
    aiProcessingStatusFromMessage &&
    aiProcessingStatus.state !== aiProcessingStatusFromMessage.state
      ? `O polling local expirou antes, mas o status da IA foi consolidado depois pelo callback (${aiProcessingStatus.state}).`
      : undefined;

  const lastExecutionSummary: ChatLastExecutionSummary | null =
    lastAssistantExecutionMessage && resolvedExecutionAction
      ? {
        action: resolvedExecutionAction,
        executed_at: lastAssistantExecutionMessage.created_at,
        status:
          aiProcessingStatus?.state === 'failed'
            ? 'error'
            : aiProcessingStatus?.state === 'timeout'
              ? 'warning'
            : aiProcessingStatus?.state === 'processing' ||
                aiProcessingStatus?.state === 'triggered'
              ? 'processing'
              : 'ok',
        summary:
          (aiProcessingStatus?.state === 'timeout'
            ? 'Tempo de espera expirou; a IA pode continuar processando e atualizar o status em seguida.'
            : undefined) ||
          executionSummary?.message ||
          (lastAssistantExecutionMessage.content ? lastAssistantExecutionMessage.content.slice(0, 300) : undefined),
        correlation_id: aiExecutionRun?.correlation_id || correlationId || undefined,
        execution_status_snapshot_at: aiExecutionRun?.updated_at || undefined,
        stale_reason: staleReason,
        ai_processing_status: aiProcessingStatus,
        affected_counts: affectedCounts,
      }
      : null;

  if (
    hasTriggerDispatchFailure({
      aiProcessingStatus,
      lastExecutionAction: resolvedExecutionAction,
      affectedCounts,
    })
  ) {
    reconciliationPlan = null;
    pendingCases = null;
    clarifyingQuestions = null;
  }

  if (
    hasNoPendingTerminalRun({
      aiProcessingStatus,
      aiExecutionRun,
    })
  ) {
    reconciliationPlan = null;
    pendingCases = null;
    clarifyingQuestions = null;
  }

  const suggestedNextActions = deriveSuggestedNextActions({
    aiProcessingStatus,
    reconciliationPlan,
  });

  return {
    lastAssistantExecutionMessage,
    executionSummary,
    lastExecutionSummary,
    affectedCounts,
    reconciliationPlan,
    pendingCases,
    clarifyingQuestions,
    pendingActionState,
    aiProcessingStatus,
    aiExecutionRun,
    suggestedNextActions,
  };
}
