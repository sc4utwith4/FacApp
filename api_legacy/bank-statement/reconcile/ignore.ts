import type { IgnoreExtratoRequest } from '../../../src/types/bank-reconciliation.js';
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

  let body: IgnoreExtratoRequest;
  try {
    body = (parseJsonBody(req) || {}) as IgnoreExtratoRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const extratoTransacaoId = String(body?.extrato_transacao_id || '').trim();
  const justificativa = String(body?.justificativa || '').trim();

  if (!extratoTransacaoId || !justificativa) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'extrato_transacao_id e justificativa sao obrigatorios.',
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
    'rpc_bank_ignore_extrato',
    {
      payload: {
        empresa_id: auth.empresaId,
        extrato_transacao_id: extratoTransacaoId,
        justificativa,
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
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_transacao_id: extratoTransacaoId,
      action: 'extrato_ignored_justified',
      status: 'warning',
      message: 'Transacao de extrato ignorada com justificativa.',
      created_by: auth.userId,
      details: {
        justificativa,
        rpc_result: rpcResponse.data,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    data: rpcResponse.data,
  });
}
