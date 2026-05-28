import type { VercelRequest, VercelResponse } from '../../../src/server/bank-statement/_shared.js';
import {
  getAdminClient,
  getHeaderValue,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  getBankReconciliationAgentIntegrationSecret,
} from '../../../src/server/bank-statement/_shared.js';
import type { ChatSessionRow } from '../../../src/server/bank-statement/chat/orchestrator.js';
import { insertBankChatMessage } from '../../../src/server/bank-statement/chat/orchestrator.js';
import { executeBankChatAgentTool } from '../../../src/server/bank-statement/chat/agentTools.js';
import type {
  ChatActionPreviewPayload,
  ChatWebhookCallbackPayload,
  RichMessageContent,
} from '../../../src/types/bank-reconciliation.js';

interface WebhookBody extends Omit<ChatWebhookCallbackPayload, 'rich_content'> {
  import_id?: string;
  extrato_import_id?: string;
  rich_content?: unknown;
}

const VALID_ACTIONS = new Set([
  'matching',
  'trigger_ai',
  'refresh_summary',
  'run_daily_reconciliation',
  'apply_reconciliation_plan',
  'daily_close',
  'daily_reopen',
]);

const VALID_SUGGESTED_INTENTS = new Set([
  'question',
  'update_plan_status',
  'execution_status_query',
  'execution_details_query',
  'run_daily_reconciliation',
  'apply_reconciliation_plan',
  'resolve_pending_issues',
  'trigger_ai',
  'refresh_summary',
  'matching',
  'daily_close',
  'daily_reopen',
]);

const parseRecord = (value: unknown): Record<string, unknown> | null => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }

  return null;
};

const sanitizeLastExecutionSummary = (value: unknown): Record<string, unknown> | null => {
  const row = parseRecord(value);
  if (!row) return null;
  const action = typeof row.action === 'string' ? row.action : '';
  if (!VALID_ACTIONS.has(action)) return null;
  return row;
};

const sanitizeActionPreview = (value: unknown): ChatActionPreviewPayload | null => {
  const row = parseRecord(value);
  if (!row) return null;
  const action = typeof row.action === 'string' ? row.action : '';
  const idempotencyKey = typeof row.idempotency_key === 'string' ? row.idempotency_key : '';
  const context = parseRecord(row.context);
  if (!VALID_ACTIONS.has(action) || !idempotencyKey || !context) return null;
  const contaId = typeof context.conta_bancaria_id === 'string' ? context.conta_bancaria_id : '';
  const dataReferencia = typeof context.data_referencia === 'string' ? context.data_referencia : '';
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
};

const sanitizeWebhookMetadata = (body: WebhookBody): Record<string, unknown> => {
  const metadata = parseRecord(body.metadata) || {};

  const aiProcessingStatus = parseRecord(body.ai_processing_status);
  if (aiProcessingStatus) metadata.ai_processing_status = aiProcessingStatus;

  const executionSummary = parseRecord(body.execution_summary);
  if (executionSummary) metadata.execution_summary = executionSummary;

  const lastExecutionSummary = sanitizeLastExecutionSummary(body.last_execution_summary);
  if (lastExecutionSummary) metadata.last_execution_summary = lastExecutionSummary;
  else if ('last_execution_summary' in metadata) {
    const parsed = sanitizeLastExecutionSummary(metadata.last_execution_summary);
    if (parsed) metadata.last_execution_summary = parsed;
    else delete metadata.last_execution_summary;
  }

  const reconciliationPlan = parseRecord(body.reconciliation_plan);
  if (reconciliationPlan) metadata.reconciliation_plan = reconciliationPlan;
  const pendingCases = Array.isArray(body.pending_cases) ? body.pending_cases : null;
  if (pendingCases) metadata.pending_cases = pendingCases;
  const clarifyingQuestions = Array.isArray(body.clarifying_questions) ? body.clarifying_questions : null;
  if (clarifyingQuestions) metadata.clarifying_questions = clarifyingQuestions;

  const suggestedNextActions = Array.isArray(body.suggested_next_actions) ? body.suggested_next_actions : null;
  if (suggestedNextActions) metadata.suggested_next_actions = suggestedNextActions;

  const legacySuggestedIntent =
    typeof metadata.suggestedIntent === 'string' ? String(metadata.suggestedIntent).trim() : '';
  if (legacySuggestedIntent && VALID_SUGGESTED_INTENTS.has(legacySuggestedIntent)) {
    metadata.suggested_intent = legacySuggestedIntent;
  }

  if (
    !metadata.suggested_parameters &&
    metadata.suggestedParameters &&
    typeof metadata.suggestedParameters === 'object' &&
    !Array.isArray(metadata.suggestedParameters)
  ) {
    metadata.suggested_parameters = metadata.suggestedParameters as Record<string, unknown>;
  }

  const suggestedIntent = typeof body.suggested_intent === 'string' ? body.suggested_intent.trim() : '';
  if (suggestedIntent && VALID_SUGGESTED_INTENTS.has(suggestedIntent)) {
    metadata.suggested_intent = suggestedIntent;
  }

  if (body.suggested_parameters && typeof body.suggested_parameters === 'object' && !Array.isArray(body.suggested_parameters)) {
    metadata.suggested_parameters = body.suggested_parameters as Record<string, unknown>;
  }

  const actionPreview = sanitizeActionPreview(body.action_preview);
  if (actionPreview) metadata.action_preview = actionPreview;

  if (typeof body.correlation_id === 'string' && body.correlation_id.trim()) {
    metadata.correlation_id = body.correlation_id.trim();
  }

  metadata.source = 'n8n_agent_callback';
  return metadata;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = getHeaderValue(req, 'x-integration-secret');
  const expectedSecret = getBankReconciliationAgentIntegrationSecret();

  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing x-integration-secret.',
    });
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Supabase nao configurado.',
    });
  }

  let body: WebhookBody;
  try {
    body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body) || {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const sessionId = String(body?.session_id || '').trim();
  const content = String(body?.content || body?.assistant_message || '').trim();
  const metadata = sanitizeWebhookMetadata(body);
  const richContent =
    body?.rich_content && typeof body.rich_content === 'object' && !Array.isArray(body.rich_content)
      ? (body.rich_content as RichMessageContent)
      : null;

  if (!sessionId || !content) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'session_id e content sao obrigatorios.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  const { data: sessionRow, error: sessionError } = await adminClient
    .from('bank_reconciliation_chat_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError || !sessionRow) {
    return res.status(404).json({
      error: 'Session not found',
      message: 'Sessao nao encontrada ou invalida.',
    });
  }

  try {
    const suggestedIntent = typeof metadata.suggested_intent === 'string'
      ? metadata.suggested_intent
      : null;
    const shouldPrepareRunDaily = suggestedIntent === 'run_daily_reconciliation';
    const shouldPrepareApplyPlan =
      suggestedIntent === 'apply_reconciliation_plan' || suggestedIntent === 'resolve_pending_issues';
    const shouldRefreshPlan = suggestedIntent === 'update_plan_status';

    if (!metadata.action_preview && (shouldPrepareRunDaily || shouldPrepareApplyPlan || shouldRefreshPlan)) {
      try {
        const toolAction = shouldPrepareRunDaily
          ? 'prepare_run_daily'
          : shouldPrepareApplyPlan
            ? 'prepare_apply_plan'
            : 'refresh_plan';
        const toolResult = await executeBankChatAgentTool(toolAction, {
          adminClient,
          empresaId: String(sessionRow.empresa_id),
          contaBancariaId: String(body.conta_bancaria_id || sessionRow.conta_bancaria_id || '').trim(),
          dataReferencia: String(body.data_referencia || sessionRow.data_referencia || '').trim(),
          importId: String(body.import_id || body.extrato_import_id || '').trim() || null,
          sessionId,
          userId: String(sessionRow.user_id || '').trim() || null,
          message: content,
        });

        if (toolResult.action_preview) metadata.action_preview = toolResult.action_preview;
        if (toolResult.reconciliation_plan) metadata.reconciliation_plan = toolResult.reconciliation_plan;
        if (toolResult.clarifying_questions) metadata.clarifying_questions = toolResult.clarifying_questions;
        if (toolResult.pending_cases) metadata.pending_cases = toolResult.pending_cases;
        if (toolResult.ai_processing_status) metadata.ai_processing_status = toolResult.ai_processing_status;
        if (toolResult.last_execution_summary) metadata.last_execution_summary = toolResult.last_execution_summary;
        if (toolResult.suggested_next_actions) metadata.suggested_next_actions = toolResult.suggested_next_actions;
        if (toolResult.suggested_intent) metadata.suggested_intent = toolResult.suggested_intent;
      } catch (toolError) {
        metadata.agent_tool_enrichment_error =
          toolError instanceof Error ? toolError.message : 'Falha ao enriquecer callback do agente';
      }
    }

    const messageRow = await insertBankChatMessage({
      adminClient,
      session: sessionRow as ChatSessionRow,
      role: 'assistant',
      content,
      richContent,
      context: {
        conta_bancaria_id: body.conta_bancaria_id || sessionRow.conta_bancaria_id,
        data_referencia: body.data_referencia || sessionRow.data_referencia,
        import_id: body.import_id || body.extrato_import_id || null,
        source: 'n8n_agent_callback',
      },
      metadata,
    });

    return res.status(200).json({
      ok: true,
      message_id: messageRow.id,
    });
  } catch (err) {
    console.error('Webhook insert error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Falha ao persistir mensagem.',
    });
  }
}
