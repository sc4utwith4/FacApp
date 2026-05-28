import type { UnignoreExtratoRequest } from '../../../src/types/bank-reconciliation.js';
import {
  callUserRpc,
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis do Supabase nao configuradas para conciliacao bancaria.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Sessao expirada. Faca login novamente.',
    });
  }

  let body: UnignoreExtratoRequest;
  try {
    body = (parseJsonBody(req) || {}) as UnignoreExtratoRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const conciliacaoId = String(body?.conciliacao_id || '').trim();
  const justificativaUndo = String(body?.justificativa_undo || '').trim();

  if (!conciliacaoId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'conciliacao_id e obrigatorio.',
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

  const rpcResponse = await callUserRpc(
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    'rpc_bank_unignore_extrato',
    {
      payload: {
        empresa_id: auth.empresaId,
        conciliacao_id: conciliacaoId,
        justificativa_undo: justificativaUndo || null,
      },
    }
  );

  if (rpcResponse.error) {
    return res.status(rpcResponse.status >= 400 ? rpcResponse.status : 422).json({
      error: 'RPC error',
      message: rpcResponse.error,
    });
  }

  if (serviceRoleKey) {
    const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
    const rpcResult =
      rpcResponse.data && typeof rpcResponse.data === 'object'
        ? (rpcResponse.data as Record<string, unknown>)
        : null;
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_transacao_id:
        typeof rpcResult?.extrato_transacao_id === 'string'
          ? rpcResult.extrato_transacao_id
          : null,
      action: 'extrato_unignore_undo',
      status: 'success',
      message: 'Ignore do extrato desfeito na revisão guiada.',
      created_by: auth.userId,
      details: {
        conciliacao_id: conciliacaoId,
        justificativa_undo: justificativaUndo || null,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    data: rpcResponse.data,
  });
}
