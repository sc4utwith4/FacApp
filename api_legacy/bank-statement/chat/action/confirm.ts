import type { VercelRequest, VercelResponse } from '../../../../src/server/bank-statement/_shared.js';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  resolveInternalApiBaseUrlFromRequest,
  getRuntimeBuildId,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
} from '../../../../src/server/bank-statement/_shared.js';
import { executeBankChatAction, type BankChatActionKind } from '../../../../src/server/bank-statement/chat/actionExecutor.js';
import { buildBankReconciliationChatContext } from '../../../../src/server/bank-statement/chat/contextBuilder.js';
import { ensureBankChatSession, insertBankChatMessage } from '../../../../src/server/bank-statement/chat/orchestrator.js';
import type { ChatPlanSelectionMode } from '../../../../src/types/bank-reconciliation.js';

interface ChatActionConfirmBody {
  action?: BankChatActionKind;
  conta_bancaria_id?: string;
  data_referencia?: string;
  import_id?: string;
  session_id?: string;
  plan_id?: string;
  idempotency_key?: string;
  selection_mode?: ChatPlanSelectionMode;
  include_suggestion_ids?: string[];
  exclude_suggestion_ids?: string[];
}

const VALID_ACTIONS = new Set<BankChatActionKind>([
  'matching',
  'trigger_ai',
  'refresh_summary',
  'run_daily_reconciliation',
  'apply_reconciliation_plan',
  'daily_close',
  'daily_reopen',
]);

const getInternalApiDiagnostics = (error: unknown): {
  errorCategory: 'internal_api_network' | 'internal_api_http' | 'chat_action_error';
  errorName: string | null;
  internalApi: {
    type: 'network' | 'http';
    method: 'GET' | 'POST' | null;
    path: string | null;
    target: string | null;
    status: number | null;
  } | null;
} => {
  const errorName = error instanceof Error ? error.name : null;
  type InternalApiDiagnostic = {
    type: 'network' | 'http';
    method: 'GET' | 'POST' | null;
    path: string | null;
    target: string | null;
    status: number | null;
  };
  const rawDetails =
    error && typeof error === 'object' && 'details' in error && (error as { details?: unknown }).details
      ? ((error as { details?: unknown }).details as Record<string, unknown>)
      : null;

  const rawType = typeof rawDetails?.type === 'string' ? rawDetails.type : '';
  const type: 'network' | 'http' | null =
    rawType === 'network' || rawType === 'http' ? rawType : null;
  const rawMethod = rawDetails?.method;
  const method: 'GET' | 'POST' | null =
    rawMethod === 'GET' || rawMethod === 'POST' ? rawMethod : null;
  const statusNumber = Number(rawDetails?.status);

  const internalApi: InternalApiDiagnostic | null = type
    ? {
      type,
      method,
      path: typeof rawDetails?.path === 'string' ? rawDetails.path : null,
      target: typeof rawDetails?.target === 'string' ? rawDetails.target : null,
      status: Number.isFinite(statusNumber) ? statusNumber : null,
    }
    : null;

  const errorCategory = type === 'network'
    ? 'internal_api_network'
    : type === 'http'
      ? 'internal_api_http'
      : 'chat_action_error';

  return {
    errorCategory,
    errorName,
    internalApi,
  };
};

const buildIdempotencyKey = (body: ChatActionConfirmBody, userId: string): string => {
  const action = String(body.action || '').trim();
  const conta = String(body.conta_bancaria_id || '').trim();
  const date = String(body.data_referencia || '').slice(0, 10);
  const importId = String(body.import_id || '').trim() || 'none';
  const planId = String(body.plan_id || '').trim() || 'none';
  const selectionMode = String(body.selection_mode || 'all').trim();
  const includeIds = Array.isArray(body.include_suggestion_ids) ? [...body.include_suggestion_ids].map(String).sort().join(',') : '';
  const excludeIds = Array.isArray(body.exclude_suggestion_ids) ? [...body.exclude_suggestion_ids].map(String).sort().join(',') : '';
  return `chat-confirm:${action}:${conta}:${date}:${importId}:${planId}:${selectionMode}:${includeIds}:${excludeIds}:${userId}`;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis de ambiente do Supabase nao configuradas.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Sessao expirada. Faca login novamente.',
    });
  }

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error: unknown) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
    });
  }

  let body: ChatActionConfirmBody;
  try {
    body = (parseJsonBody(req) || {}) as ChatActionConfirmBody;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const action = String(body?.action || '').trim() as BankChatActionKind;
  const contaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const dataReferencia = String(body?.data_referencia || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const importId = String(body?.import_id || '').trim() || null;
  const planId = String(body?.plan_id || '').trim() || null;
  const selectionMode = (String(body?.selection_mode || 'all').trim() || 'all') as ChatPlanSelectionMode;
  const includeSuggestionIds = Array.isArray(body?.include_suggestion_ids)
    ? body.include_suggestion_ids.map(String).map((v) => v.trim()).filter(Boolean)
    : [];
  const excludeSuggestionIds = Array.isArray(body?.exclude_suggestion_ids)
    ? body.exclude_suggestion_ids.map(String).map((v) => v.trim()).filter(Boolean)
    : [];
  const idempotencyKey = String(body?.idempotency_key || '').trim() || buildIdempotencyKey(body, auth.userId);

  if (!VALID_ACTIONS.has(action) || !contaBancariaId) {
    return res.status(400).json({
      error: 'Invalid input',
      message:
        'action valido (run_daily_reconciliation|apply_reconciliation_plan|refresh_summary|daily_close|daily_reopen; matching/trigger_ai como alias legado) e conta_bancaria_id sao obrigatorios.',
    });
  }

  if (!['all', 'include_only', 'exclude_some'].includes(selectionMode)) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'selection_mode invalido. Use all, include_only ou exclude_some.',
    });
  }

  if (selectionMode === 'include_only' && includeSuggestionIds.length === 0) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'include_suggestion_ids e obrigatorio quando selection_mode=include_only.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
  const runtimeBuildId = getRuntimeBuildId();
  let internalBaseUrl: string | null = null;

  try {
    const contextSnapshot = await buildBankReconciliationChatContext({
      adminClient,
      empresaId: auth.empresaId,
      contaBancariaId,
      dataReferencia,
      importId,
    });

    const ofxRequiredActions = new Set<BankChatActionKind>([
      'matching',
      'trigger_ai',
      'run_daily_reconciliation',
      'apply_reconciliation_plan',
    ]);
    if (contextSnapshot.ofx_required && ofxRequiredActions.has(action)) {
      return res.status(409).json({
        error: 'Action blocked by policy',
        message: 'Nesta etapa, use OFX para conciliação confiável. CSV está em quarentena.',
        ofx_required: true,
        ofx_required_reason: contextSnapshot.ofx_required_reason || 'no_ofx_import_available',
        runtime_build_id: runtimeBuildId,
        data: {
          context_snapshot: contextSnapshot,
        },
      });
    }

    const session = await ensureBankChatSession({
      adminClient,
      empresaId: auth.empresaId,
      userId: auth.userId,
      contaBancariaId,
      contaLabel: contextSnapshot.conta_label,
      dataReferencia: contextSnapshot.data_referencia,
      sessionId: String(body.session_id || '').trim() || null,
    });

    internalBaseUrl = resolveInternalApiBaseUrlFromRequest(req, {
      missingHostMessage: 'Nao foi possivel resolver host da requisicao para executar acao.',
    });

    const execution = await executeBankChatAction({
      adminClient,
      baseUrl: internalBaseUrl,
      accessToken,
      empresaId: auth.empresaId,
      userId: auth.userId,
      contaBancariaId,
      dataReferencia: contextSnapshot.data_referencia,
      importId: contextSnapshot.import_id,
      sessionId: session.id,
      action,
      idempotencyKey,
      planId,
      selectionMode,
      includeSuggestionIds,
      excludeSuggestionIds,
    });

    const userMessage = await insertBankChatMessage({
      adminClient,
      session,
      role: 'user',
      content: `Confirmar ação: ${action}`,
      context: {
        conta_bancaria_id: contextSnapshot.conta_bancaria_id,
        data_referencia: contextSnapshot.data_referencia,
        import_id: contextSnapshot.import_id,
      },
      metadata: {
        source: 'bank_reconciliation_chat',
        action,
        idempotency_key: idempotencyKey,
      },
    });

    const assistantMessage = await insertBankChatMessage({
      adminClient,
      session,
      role: 'assistant',
      content: execution.assistant_message,
      richContent: execution.rich_content || null,
      context: {
        conta_bancaria_id: contextSnapshot.conta_bancaria_id,
        data_referencia: contextSnapshot.data_referencia,
        import_id: contextSnapshot.import_id,
      },
      metadata: {
        source: 'bank_reconciliation_chat',
        action,
        idempotency_key: idempotencyKey,
        execution_result: execution.result,
        execution_summary: execution.execution_summary || null,
        affected_counts: execution.affected_counts || null,
        reconciliation_plan: execution.reconciliation_plan || null,
        clarifying_questions: execution.clarifying_questions || null,
        pending_cases: execution.pending_cases || null,
        ai_processing_status: execution.ai_processing_status || null,
        ai_polling: execution.ai_polling || null,
        correlation_id: execution.correlation_id || null,
        review_guidance: execution.review_guidance || null,
        ui_show_operational_cards: execution.ui_show_operational_cards ?? false,
        ui_show_plan_card: execution.ui_show_plan_card ?? false,
        ui_show_guided_card: execution.ui_show_guided_card ?? false,
        applied_suggestion_ids: execution.applied_suggestion_ids || null,
        skipped_suggestion_ids: execution.skipped_suggestion_ids || null,
        failed_items: execution.failed_items || null,
      },
    });

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_import_id: contextSnapshot.import_id,
      action: 'chat_action_confirmed',
      status: 'success',
      message: `Ação ${action} confirmada via chat.`,
      created_by: auth.userId,
      details: {
        action,
        idempotency_key: idempotencyKey,
        reused: execution.reused || false,
        session_id: session.id,
        plan_id: planId,
        selection_mode: selectionMode,
        include_suggestion_ids: includeSuggestionIds,
        exclude_suggestion_ids: excludeSuggestionIds,
        ai_processing_status: execution.ai_processing_status || null,
      },
    });

    return res.status(200).json({
      ok: true,
      runtime_build_id: runtimeBuildId,
      data: {
        execution,
        execution_summary: execution.execution_summary || null,
        affected_counts: execution.affected_counts || null,
        applied_suggestion_ids: execution.applied_suggestion_ids || [],
        skipped_suggestion_ids: execution.skipped_suggestion_ids || [],
        failed_items: execution.failed_items || [],
        reconciliation_plan: execution.reconciliation_plan || null,
        clarifying_questions: execution.clarifying_questions || null,
        pending_cases: execution.pending_cases || null,
        ai_processing_status: execution.ai_processing_status || null,
        correlation_id: execution.correlation_id || null,
        ai_polling: execution.ai_polling || null,
        review_guidance: execution.review_guidance || null,
        ui_show_operational_cards: execution.ui_show_operational_cards ?? false,
        ui_show_plan_card: execution.ui_show_plan_card ?? false,
        ui_show_guided_card: execution.ui_show_guided_card ?? false,
        session,
        user_message: userMessage,
        assistant_message: assistantMessage,
      },
    });
  } catch (error: unknown) {
    const errorMessage = getErrorMessage(error, 'Falha ao confirmar ação via chat.');
    const diagnostics = getInternalApiDiagnostics(error);

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      action: 'chat_action_failed',
      status: 'error',
      message: errorMessage,
      created_by: auth.userId,
      details: {
        action,
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
        resolved_internal_base_url: internalBaseUrl,
        error_category: diagnostics.errorCategory,
        error_name: diagnostics.errorName,
        internal_api: diagnostics.internalApi,
      },
    });

    return res.status(422).json({
      error: 'Chat action error',
      message: errorMessage,
      runtime_build_id: runtimeBuildId,
    });
  }
}
