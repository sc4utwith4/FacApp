import type { VercelRequest, VercelResponse } from '../../../src/server/bank-statement/_shared.js';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  resolveInternalApiBaseUrlFromRequest,
  getRuntimeBuildId,
  isBankReconciliationOfxOnlyEnabled,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
} from '../../../src/server/bank-statement/_shared.js';
import { processBankReconciliationChatMessage } from '../../../src/server/bank-statement/chat/orchestrator.js';
import type {
  ChatAttachmentInput,
  ChatImportResult,
  ChatMessageInteraction,
} from '../../../src/types/bank-reconciliation.js';

interface ChatMessageBody {
  message?: string;
  conta_bancaria_id?: string;
  data_referencia?: string;
  import_id?: string;
  session_id?: string;
  active_extrato_transacao_id?: string;
  attachments?: ChatAttachmentInput[];
  interaction?: ChatMessageInteraction | null;
  client_build_id?: string;
  client_upload_failure_context?: Record<string, unknown> | null;
}

interface ImportApiResponse {
  ok?: boolean;
  duplicate?: boolean;
  import_row?: {
    id?: string;
    original_filename?: string | null;
  } | null;
  parse_result?: {
    parse_status?: string | null;
    errors?: string[] | null;
  } | null;
}

const normalizeAttachments = (value: unknown): ChatAttachmentInput[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatAttachmentInput => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Record<string, unknown>;
    return (
      typeof row.file_storage_bucket === 'string' &&
      typeof row.file_storage_key === 'string' &&
      typeof row.original_filename === 'string' &&
      typeof row.source === 'string' &&
      typeof row.file_format === 'string'
    );
  });
};

const normalizeInteraction = (value: unknown): ChatMessageInteraction | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = String(row.kind || '').trim();
  if (kind === 'review_answer') {
    const caseId = String(row.case_id || '').trim();
    const decision = String(row.decision || '').trim();
    const validDecision = new Set(['approve_ignore', 'approve_match', 'keep_pending', 'open_manual_review']);
    if (!caseId || !validDecision.has(decision)) {
      return null;
    }

    return {
      kind: 'review_answer',
      case_id: caseId,
      decision: decision as Extract<ChatMessageInteraction, { kind: 'review_answer' }>['decision'],
      justification:
        typeof row.justification === 'string'
          ? row.justification
          : row.justification == null
            ? null
            : String(row.justification),
      item_financeiro_id:
        typeof row.item_financeiro_id === 'string'
          ? row.item_financeiro_id
          : row.item_financeiro_id == null
            ? null
            : String(row.item_financeiro_id),
    };
  }

  if (kind === 'review_batch_confirm') {
    const strategy = String(row.strategy || '').trim();
    if (strategy !== 'strict_date_value') return null;
    return {
      kind: 'review_batch_confirm',
      strategy: 'strict_date_value',
      apply_safe_matches: row.apply_safe_matches !== false,
      apply_auto_divergence: row.apply_auto_divergence !== false,
      global_justification:
        typeof row.global_justification === 'string'
          ? row.global_justification
          : row.global_justification == null
            ? null
            : String(row.global_justification),
    };
  }

  if (kind === 'review_next') {
    return {
      kind: 'review_next',
    };
  }

  if (kind === 'review_undo_last') {
    return {
      kind: 'review_undo_last',
      justification:
        typeof row.justification === 'string'
          ? row.justification
          : row.justification == null
            ? null
            : String(row.justification),
    };
  }

  return null;
};

const normalizeUploadFailureContext = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const isValidAttachment = (attachment: ChatAttachmentInput): boolean => {
  const validSources = new Set(['bradesco', 'itau', 'ofx_generic']);
  const validFormats = new Set(['csv', 'ofx']);
  if (attachment.file_storage_bucket !== 'extratos-bancarios') return false;
  if (!validSources.has(String(attachment.source || ''))) return false;
  if (!validFormats.has(String(attachment.file_format || ''))) return false;
  return true;
};

async function callImportEndpoint(args: {
  req: VercelRequest;
  accessToken: string;
  attachment: ChatAttachmentInput;
  contaBancariaId: string;
}): Promise<ImportApiResponse> {
  const baseUrl = resolveInternalApiBaseUrlFromRequest(args.req);
  const response = await fetch(`${baseUrl}/api/bank-statement/import`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      conta_bancaria_id: args.contaBancariaId,
      file_storage_bucket: args.attachment.file_storage_bucket,
      file_storage_key: args.attachment.file_storage_key,
      original_filename: args.attachment.original_filename,
      source: args.attachment.source,
      file_format: args.attachment.file_format,
    }),
  });

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(String(payload?.message || payload?.error || `Falha ao importar anexo (${response.status}).`));
  }

  return (payload || {}) as unknown as ImportApiResponse;
}

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

  let body: ChatMessageBody;
  try {
    body = (parseJsonBody(req) || {}) as ChatMessageBody;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const message = String(body?.message || '').trim();
  const contaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const dataReferencia = String(body?.data_referencia || '').trim() || new Date().toISOString().slice(0, 10);
  const importId = String(body?.import_id || '').trim() || null;
  const sessionId = String(body?.session_id || '').trim() || null;
  const activeExtratoTransacaoId = String(body?.active_extrato_transacao_id || '').trim() || null;
  const attachments = normalizeAttachments(body?.attachments);
  const interaction = normalizeInteraction(body?.interaction);
  const clientBuildId = String(body?.client_build_id || '').trim() || null;
  const clientUploadFailureContext = normalizeUploadFailureContext(body?.client_upload_failure_context);
  const runtimeBuildId = getRuntimeBuildId();

  if ((!message && attachments.length === 0 && !interaction) || !contaBancariaId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'conta_bancaria_id e obrigatorio e informe message, attachments ou interaction.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  try {
    if (isBankReconciliationOfxOnlyEnabled()) {
      const csvAttachment = attachments.find((item) => String(item.file_format || '').toLowerCase() === 'csv');
      if (csvAttachment) {
        await safeInsertBankAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          action: 'chat_attachment_blocked_by_ofx_policy',
          status: 'warning',
          message: 'Anexo CSV bloqueado pela política OFX-only no chat.',
          created_by: auth.userId,
          details: {
            conta_bancaria_id: contaBancariaId,
            original_filename: csvAttachment.original_filename,
            file_storage_bucket: csvAttachment.file_storage_bucket,
            file_storage_key: csvAttachment.file_storage_key,
            file_format: csvAttachment.file_format,
            source: csvAttachment.source,
          },
        });
        return res.status(409).json({
          error: 'Attachment blocked by policy',
          message: 'Nesta etapa, use OFX para conciliação confiável. CSV está em quarentena.',
          attachment: {
            original_filename: csvAttachment.original_filename,
            file_format: csvAttachment.file_format,
          },
          ofx_required: true,
          ofx_required_reason: 'chat_attachment_ofx_only_policy',
          runtime_build_id: runtimeBuildId,
        });
      }
    }

    let resolvedImportId = importId;
    let importResult: ChatImportResult | null = null;

    if (attachments.length > 0) {
      const aggregate: ChatImportResult = {
        imported_count: 0,
        parsed_count: 0,
        failed_count: 0,
        duplicate_count: 0,
        selected_import_id: resolvedImportId,
        items: [],
      };

      for (const attachment of attachments) {
        if (!isValidAttachment(attachment)) {
          throw new Error('Anexo invalido no chat. Nesta etapa, use apenas OFX no bucket extratos-bancarios.');
        }

        const importResponse = await callImportEndpoint({
          req,
          accessToken,
          attachment,
          contaBancariaId,
        });

        const importRow = importResponse.import_row || null;
        const parseResult = importResponse.parse_result || null;
        const parseStatus = String(parseResult?.parse_status || '').trim() || null;
        const importRowId = String(importRow?.id || '').trim() || null;
        const duplicate = Boolean(importResponse.duplicate);

        if (importRowId) {
          resolvedImportId = importRowId;
          aggregate.selected_import_id = importRowId;
        }

        aggregate.imported_count += duplicate ? 0 : 1;
        aggregate.duplicate_count += duplicate ? 1 : 0;
        if (parseStatus === 'parsed') aggregate.parsed_count += 1;
        if (parseStatus === 'failed') aggregate.failed_count += 1;

        aggregate.items.push({
          import_id: importRowId,
          original_filename: importRow?.original_filename || attachment.original_filename || null,
          parse_status: parseStatus,
          duplicate,
          parse_errors: Array.isArray(parseResult?.errors)
            ? parseResult?.errors.filter((item): item is string => typeof item === 'string')
            : [],
        });
      }

      importResult = aggregate;
    }

    const normalizedMessage =
      message ||
      (interaction
        ? interaction.kind === 'review_batch_confirm'
          ? 'Revisão guiada: aplicar decisões rápidas'
          : interaction.kind === 'review_next'
            ? 'Revisão guiada: próximo item'
            : interaction.kind === 'review_undo_last'
              ? 'Revisão guiada: desfazer última decisão'
              : `Revisao guiada: ${interaction.decision}`
        : 'OFX anexado para abrir o contexto do extrato.');
    const result = await processBankReconciliationChatMessage({
      adminClient,
      empresaId: auth.empresaId,
      userId: auth.userId,
      accessToken,
      baseUrl: resolveInternalApiBaseUrlFromRequest(req, {
        missingHostMessage: 'Nao foi possivel resolver host para processar mensagem de chat.',
      }),
      contaBancariaId,
      dataReferencia,
      importId: resolvedImportId,
      message: normalizedMessage,
      sessionId: attachments.length > 0 ? null : sessionId,
      activeExtratoTransacaoId,
      importBootstrap:
        attachments.length > 0
          ? {
              originalFilenames: attachments.map((item) => item.original_filename).filter(Boolean),
            }
          : null,
      interaction,
    });

    if (importResult) {
      const userMetadata = result.user_message.metadata && typeof result.user_message.metadata === 'object'
        ? (result.user_message.metadata as Record<string, unknown>)
        : {};
      const assistantMetadata = result.assistant_message.metadata && typeof result.assistant_message.metadata === 'object'
        ? (result.assistant_message.metadata as Record<string, unknown>)
        : {};
      const attachmentRows = attachments.map((item) => ({
        file_storage_bucket: item.file_storage_bucket,
        file_storage_key: item.file_storage_key,
        original_filename: item.original_filename,
        source: item.source,
        file_format: item.file_format,
      }));

      const importMeta = {
        import_result: importResult,
        attachment_files: attachmentRows,
      };

      await Promise.all([
        adminClient
          .from('bank_reconciliation_chat_messages')
          .update({
            metadata: {
              ...userMetadata,
              ...importMeta,
            },
          })
          .eq('id', result.user_message.id)
          .eq('empresa_id', auth.empresaId),
        adminClient
          .from('bank_reconciliation_chat_messages')
          .update({
            metadata: {
              ...assistantMetadata,
              ...importMeta,
            },
          })
          .eq('id', result.assistant_message.id)
          .eq('empresa_id', auth.empresaId),
      ]);
    }

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_import_id: result.context_snapshot.import_id,
      action: 'chat_message_processed',
      status: 'success',
      message: 'Mensagem processada no chat operacional de conciliacao.',
      created_by: auth.userId,
      details: {
        session_id: result.session.id,
        conta_bancaria_id: contaBancariaId,
        data_referencia: result.context_snapshot.data_referencia,
        action_preview: result.action_preview?.action || null,
        attachments_count: attachments.length,
        attachments_overview: attachments.slice(0, 10).map((item) => ({
          file_storage_bucket: item.file_storage_bucket,
          file_storage_key: item.file_storage_key,
          file_format: item.file_format,
          source: item.source,
        })),
        import_result: importResult,
        reconciliation_plan_total: result.reconciliation_plan?.totals?.total || 0,
        clarifying_questions_count: result.clarifying_questions?.length || 0,
        pending_cases_count: result.pending_cases?.length || 0,
        interaction_kind: interaction?.kind || null,
        active_extrato_transacao_id: activeExtratoTransacaoId,
        client_build_id: clientBuildId,
        upload_failure_context: clientUploadFailureContext,
        pending_action_state: result.pending_action_state || null,
        ai_processing_status: result.ai_processing_status || null,
        last_execution_summary: result.last_execution_summary || null,
        suggested_next_actions: result.suggested_next_actions || null,
        review_guidance: result.review_guidance || null,
        ui_show_operational_cards: result.ui_show_operational_cards ?? false,
        ui_show_plan_card: result.ui_show_plan_card ?? false,
        ui_show_guided_card: result.ui_show_guided_card ?? false,
      },
    });

    return res.status(200).json({
      ok: true,
      runtime_build_id: runtimeBuildId,
      data: {
        ...result,
        import_result: importResult,
        clarifying_questions: result.clarifying_questions || null,
        pending_cases: result.pending_cases || null,
        pending_action_state: result.pending_action_state || null,
        ai_processing_status: result.ai_processing_status || null,
        last_execution_summary: result.last_execution_summary || null,
        suggested_next_actions: result.suggested_next_actions || null,
        review_guidance: result.review_guidance || null,
      },
    });
  } catch (error: unknown) {
    const messageError = getErrorMessage(error, 'Falha ao processar mensagem de chat.');

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      action: 'chat_message_failed',
      status: 'error',
      message: messageError,
      created_by: auth.userId,
      details: {
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
        active_extrato_transacao_id: activeExtratoTransacaoId,
        client_build_id: clientBuildId,
        upload_failure_context: clientUploadFailureContext,
      },
    });

    return res.status(422).json({
      error: 'Chat processing error',
      message: messageError,
      runtime_build_id: runtimeBuildId,
    });
  }
}
