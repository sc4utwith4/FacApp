import type {
  ChatAgentToolAction,
  ChatAgentToolRequest,
  ChatAgentToolResponse,
} from '../../../../src/types/bank-reconciliation.js';
import {
  getAdminClient,
  getBankReconciliationAgentIntegrationSecret,
  getErrorMessage,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isEmpresaHeaderConsistent,
  isValidIntegrationSecret,
  parseJsonBody,
  safeInsertBankAuditLog,
  type VercelRequest,
  type VercelResponse,
} from '../../../../src/server/bank-statement/_shared.js';
import { executeBankChatAgentTool } from '../../../../src/server/bank-statement/chat/agentTools.js';

const VALID_ACTIONS = new Set<ChatAgentToolAction>([
  'fetch_state',
  'prepare_run_daily',
  'prepare_apply_plan',
  'refresh_plan',
]);

const readAction = (req: VercelRequest): ChatAgentToolAction | null => {
  const raw = req.query?.action;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_ACTIONS.has(normalized as ChatAgentToolAction)
    ? (normalized as ChatAgentToolAction)
    : null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = readAction(req);
  if (!action) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Agent tool inválida para conciliação bancária.',
    });
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const integrationSecret = getBankReconciliationAgentIntegrationSecret();
  if (!supabaseUrl || !serviceRoleKey || !integrationSecret) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Supabase/segredo do agente não configurados para chat/agent-tools.',
    });
  }

  if (!isValidIntegrationSecret(req, integrationSecret)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'x-integration-secret inválido para chat/agent-tools.',
    });
  }

  let body: ChatAgentToolRequest;
  try {
    body = (parseJsonBody(req) || {}) as ChatAgentToolRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo inválido.' });
  }

  const empresaId = String(body?.empresa_id || '').trim();
  const contaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const dataReferencia = String(body?.data_referencia || '').trim();
  const importId = String(body?.import_id || '').trim() || null;
  const sessionId = String(body?.session_id || '').trim() || null;
  const userId = String(body?.user_id || '').trim() || null;
  const message = typeof (body as { message?: unknown }).message === 'string'
    ? String((body as { message?: string }).message)
    : null;

  if (!empresaId || !contaBancariaId || !dataReferencia) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'empresa_id, conta_bancaria_id e data_referencia são obrigatórios.',
    });
  }

  if (!isEmpresaHeaderConsistent(req, empresaId)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'x-empresa-id inconsistente com empresa_id do payload.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  try {
    const data = await executeBankChatAgentTool(action, {
      adminClient,
      empresaId,
      contaBancariaId,
      dataReferencia,
      importId,
      sessionId,
      userId,
      message,
    });

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: data.context_snapshot.import_id || null,
      action: 'chat_agent_tool_called',
      status: 'info',
      message: `Agent tool executada: ${action}`,
      details: {
        tool_action: action,
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
        session_id: sessionId,
        suggested_intent: data.suggested_intent || null,
        has_action_preview: Boolean(data.action_preview),
      },
      created_by: userId,
    });

    const response: ChatAgentToolResponse = {
      ok: true,
      data,
    };

    return res.status(200).json(response);
  } catch (error: unknown) {
    const messageError = getErrorMessage(error, 'Falha ao executar tool do agente.');
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      action: 'chat_agent_tool_failed',
      status: 'error',
      message: messageError,
      details: {
        tool_action: action,
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
        session_id: sessionId,
      },
      created_by: userId,
    });
    return res.status(500).json({
      error: 'Internal server error',
      message: messageError,
    });
  }
}

