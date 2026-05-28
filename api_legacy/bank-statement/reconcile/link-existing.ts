import type { LinkExistingReconciliationRequest } from '../../../src/types/bank-reconciliation.js';
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

  let body: LinkExistingReconciliationRequest;
  try {
    body = (parseJsonBody(req) || {}) as LinkExistingReconciliationRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const extratoTransacaoId = String(body?.extrato_transacao_id || '').trim();
  const itemFinanceiroId = String(body?.item_financeiro_id || '').trim();
  const idempotencyKey = String(body?.idempotency_key || '').trim();

  if (!extratoTransacaoId || !itemFinanceiroId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'extrato_transacao_id e item_financeiro_id sao obrigatorios.',
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
    'rpc_bank_link_item_and_reconcile',
    {
      payload: {
        empresa_id: auth.empresaId,
        extrato_transacao_id: extratoTransacaoId,
        item_financeiro_id: itemFinanceiroId,
        idempotency_key: idempotencyKey || null,
        valor_alocado_centavos: body?.valor_alocado_centavos ?? null,
        method: body?.method || 'manual',
        confidence: body?.confidence ?? 1,
        explanation: body?.explanation || 'Vinculado manualmente na conciliacao diaria.',
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
      extrato_transacao_id: extratoTransacaoId,
      conciliacao_id: typeof rpcResult?.conciliacao_id === 'string' ? rpcResult.conciliacao_id : null,
      action: 'reconciliation_link_existing_confirmed',
      status: 'success',
      message: 'Transacao do extrato vinculada a item financeiro existente.',
      created_by: auth.userId,
      details: {
        item_financeiro_id: itemFinanceiroId,
        idempotency_key: idempotencyKey || null,
        rpc_result: rpcResponse.data,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    data: rpcResponse.data,
  });
}
