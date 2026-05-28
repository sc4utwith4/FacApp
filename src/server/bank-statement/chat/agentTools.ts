import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatAgentSuggestedIntent,
  ChatAgentToolAction,
  ChatAgentToolResponse,
  ChatAiProcessingStatus,
  ChatSuggestedNextAction,
} from '../../../types/bank-reconciliation.js';
import { buildBankReconciliationChatContext } from './contextBuilder.js';
import { loadChatExecutionStateSnapshot } from './executionState.js';
import {
  buildActionPreview,
  buildCurrentReconciliationPlan,
  buildPendingDiagnosticAnswer,
} from './orchestrator.js';

type ToolInput = {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId?: string | null;
  sessionId?: string | null;
  userId?: string | null;
  message?: string | null;
};

type ToolResult = ChatAgentToolResponse['data'];

const normalize = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const normalizeForRunDailyGenericMatch = (message: string): boolean => {
  const n = normalize(message);
  const mentionsConciliacao = n.includes('concili') || n.includes('concial');
  const mentionsVerb =
    n.includes('execut') ||
    n.includes('faz') ||
    n.includes('faca') ||
    n.includes('faça') ||
    n.includes('rod') ||
    n.includes('inici') ||
    n.includes('dispar');
  return mentionsConciliacao && mentionsVerb;
};

const isAiStateInProgress = (
  aiState: ChatAiProcessingStatus['state'] | null | undefined
): boolean =>
  aiState === 'processing' ||
  aiState === 'triggered' ||
  aiState === 'timeout' ||
  aiState === 'polling' ||
  aiState === 'agent_processing';

const buildData = (args: {
  action: ChatAgentToolAction;
  contextSnapshot: Awaited<ReturnType<typeof buildBankReconciliationChatContext>>;
  executionState: Awaited<ReturnType<typeof loadChatExecutionStateSnapshot>> | null;
  plan: Awaited<ReturnType<typeof buildCurrentReconciliationPlan>>['plan'] | null;
  clarifyingQuestions: Awaited<ReturnType<typeof buildCurrentReconciliationPlan>>['clarifying_questions'];
  pendingCases: Awaited<ReturnType<typeof buildCurrentReconciliationPlan>>['pending_cases'];
  suggestedIntent?: ChatAgentSuggestedIntent | null;
  actionPreview?: ToolResult['action_preview'];
  guidance?: string | null;
}): ToolResult => ({
  action: args.action,
  context_snapshot: args.contextSnapshot,
  reconciliation_plan: args.plan || null,
  clarifying_questions: args.clarifyingQuestions || null,
  pending_cases: args.pendingCases || null,
  ai_processing_status: args.executionState?.aiProcessingStatus || null,
  last_execution_summary: args.executionState?.lastExecutionSummary || null,
  suggested_next_actions: (args.executionState?.suggestedNextActions || null) as ChatSuggestedNextAction[] | null,
  suggested_intent: args.suggestedIntent || null,
  action_preview: args.actionPreview || null,
  guidance: args.guidance || null,
});

export async function executeBankChatAgentTool(
  action: ChatAgentToolAction,
  input: ToolInput
): Promise<ToolResult> {
  const contextSnapshot = await buildBankReconciliationChatContext({
    adminClient: input.adminClient,
    empresaId: input.empresaId,
    contaBancariaId: input.contaBancariaId,
    dataReferencia: input.dataReferencia,
    importId: input.importId || null,
  });

  const executionState =
    input.sessionId
      ? await loadChatExecutionStateSnapshot({
          adminClient: input.adminClient,
          empresaId: input.empresaId,
          sessionId: input.sessionId,
          contaBancariaId: contextSnapshot.conta_bancaria_id,
          dataReferencia: contextSnapshot.data_referencia,
          importId: contextSnapshot.import_id,
        }).catch(() => null)
      : null;

  const currentPlan =
    action === 'refresh_plan' || action === 'prepare_apply_plan' || action === 'prepare_run_daily'
      ? await buildCurrentReconciliationPlan({
          adminClient: input.adminClient,
          contextSnapshot,
        })
      : {
          plan: executionState?.reconciliationPlan || null,
          clarifying_questions: executionState?.clarifyingQuestions || [],
          pending_cases: executionState?.pendingCases || [],
        };

  if (action === 'fetch_state' || action === 'refresh_plan') {
    const diagnostic = buildPendingDiagnosticAnswer({
      contextSnapshot,
      planArtifacts: currentPlan,
      aiProcessingStatus: executionState?.aiProcessingStatus || null,
      suggestedNextActions: executionState?.suggestedNextActions || null,
    });

    return buildData({
      action,
      contextSnapshot,
      executionState,
      plan: currentPlan.plan,
      clarifyingQuestions: currentPlan.clarifying_questions,
      pendingCases: currentPlan.pending_cases,
      suggestedIntent: action === 'refresh_plan' ? 'update_plan_status' : 'question',
      guidance: diagnostic.content,
    });
  }

  if (action === 'prepare_apply_plan') {
    if (currentPlan.plan && currentPlan.plan.totals.total > 0) {
      return buildData({
        action,
        contextSnapshot,
        executionState,
        plan: currentPlan.plan,
        clarifyingQuestions: currentPlan.clarifying_questions,
        pendingCases: currentPlan.pending_cases,
        suggestedIntent: 'apply_reconciliation_plan',
        actionPreview: buildActionPreview({
          kind: 'apply_reconciliation_plan',
          contextSnapshot,
          userId: input.userId || 'n8n-agent',
          planId: currentPlan.plan.plan_id,
        }),
        guidance: `Encontrei ${currentPlan.plan.totals.total} sugestão(ões) para revisão/aplicação neste contexto.`,
      });
    }

    const diagnostic = buildPendingDiagnosticAnswer({
      contextSnapshot,
      planArtifacts: currentPlan,
      aiProcessingStatus: executionState?.aiProcessingStatus || null,
      suggestedNextActions: executionState?.suggestedNextActions || null,
    });
    return buildData({
      action,
      contextSnapshot,
      executionState,
      plan: currentPlan.plan,
      clarifyingQuestions: currentPlan.clarifying_questions,
      pendingCases: currentPlan.pending_cases,
      suggestedIntent: 'question',
      guidance: diagnostic.content,
    });
  }

  // prepare_run_daily
  const aiState = executionState?.aiProcessingStatus?.state || null;
  const latestPlanTotal =
    currentPlan.plan?.totals.total || executionState?.reconciliationPlan?.totals?.total || 0;
  const lastExecution = executionState?.lastExecutionSummary || null;
  const hasRecentRunWarningOrProcessing =
    lastExecution?.action === 'run_daily_reconciliation' &&
    (lastExecution.status === 'processing' || lastExecution.status === 'warning');
  const shouldTreatAsProcessing = isAiStateInProgress(aiState) || (!aiState && hasRecentRunWarningOrProcessing);
  const explicitGenericRunMessage = normalizeForRunDailyGenericMatch(input.message || '');

  if (latestPlanTotal > 0) {
    const plan = currentPlan.plan || executionState?.reconciliationPlan || null;
    return buildData({
      action,
      contextSnapshot,
      executionState,
      plan,
      clarifyingQuestions: currentPlan.clarifying_questions,
      pendingCases: currentPlan.pending_cases,
      suggestedIntent: 'apply_reconciliation_plan',
      actionPreview: plan
        ? buildActionPreview({
            kind: 'apply_reconciliation_plan',
            contextSnapshot,
            userId: input.userId || 'n8n-agent',
            planId: plan.plan_id,
          })
        : null,
      guidance:
        explicitGenericRunMessage
          ? 'Já existe um plano pendente para este contexto. O próximo passo é revisar/aplicar o plano.'
          : 'Há um plano pendente disponível para revisão/aplicação.',
    });
  }

  if (shouldTreatAsProcessing) {
    const statusMessage =
      executionState?.aiProcessingStatus?.message ||
      lastExecution?.summary ||
      'A IA ainda está processando este contexto.';
    return buildData({
      action,
      contextSnapshot,
      executionState,
      plan: currentPlan.plan,
      clarifyingQuestions: currentPlan.clarifying_questions,
      pendingCases: currentPlan.pending_cases,
      suggestedIntent: 'update_plan_status',
      guidance: `${statusMessage} Use "Atualizar plano" em alguns segundos.`,
    });
  }

  if (contextSnapshot.import_parse_status !== 'parsed') {
    return buildData({
      action,
      contextSnapshot,
      executionState,
      plan: currentPlan.plan,
      clarifyingQuestions: currentPlan.clarifying_questions,
      pendingCases: currentPlan.pending_cases,
      suggestedIntent: 'question',
      guidance: contextSnapshot.import_id
        ? `A importação ${contextSnapshot.import_id} ainda não está pronta (status ${contextSnapshot.import_parse_status || 'desconhecido'}).`
        : 'Nenhum extrato processado (parsed) foi encontrado para a conta/data selecionadas.',
    });
  }

  return buildData({
    action,
    contextSnapshot,
    executionState,
    plan: currentPlan.plan,
    clarifyingQuestions: currentPlan.clarifying_questions,
    pendingCases: currentPlan.pending_cases,
    suggestedIntent: 'run_daily_reconciliation',
    actionPreview: buildActionPreview({
      kind: 'run_daily_reconciliation',
      contextSnapshot,
      userId: input.userId || 'n8n-agent',
    }),
    guidance: 'Posso preparar a execução da conciliação do dia neste contexto (com confirmação humana).',
  });
}

