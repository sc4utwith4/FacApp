import type { SplitReconciliationRequest } from '../../../src/types/bank-reconciliation.js';
import {
  callUserRpc,
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  isBankReconciliationBalanceMutationDisabled,
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

  let body: SplitReconciliationRequest;
  try {
    body = (parseJsonBody(req) || {}) as SplitReconciliationRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const extratoTransacaoId = String(body?.extrato_transacao_id || '').trim();
  const contaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const idempotencyKey = String(body?.idempotency_key || '').trim();

  if (!extratoTransacaoId || !contaBancariaId || !idempotencyKey) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'extrato_transacao_id, conta_bancaria_id e idempotency_key sao obrigatorios.',
    });
  }

  if (!Array.isArray(body?.items) || body.items.length === 0) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'items deve conter ao menos um item de split.',
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

  if (isBankReconciliationBalanceMutationDisabled()) {
    if (serviceRoleKey) {
      const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
      await safeInsertBankAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        extrato_transacao_id: extratoTransacaoId,
        action: 'reconcile_split_blocked_policy',
        status: 'warning',
        message: 'Split com criação de lançamentos bloqueado por política de conciliação sem mutação de saldo.',
        created_by: auth.userId,
        details: {
          conta_bancaria_id: contaBancariaId,
          idempotency_key: idempotencyKey,
          split_items_count: Array.isArray(body.items) ? body.items.length : 0,
          policy: 'BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION',
        },
      });
    }

    return res.status(409).json({
      error: 'Balance mutation blocked',
      code: 'BANK_RECONCILIATION_BALANCE_MUTATION_DISABLED',
      message:
        'Split de conciliacao esta temporariamente bloqueado nesta fase para evitar alteracao de saldo.',
    });
  }

  const rpcPayload = {
    payload: {
      empresa_id: auth.empresaId,
      conta_bancaria_id: contaBancariaId,
      extrato_transacao_id: extratoTransacaoId,
      idempotency_key: idempotencyKey,
      items: body.items,
    },
  };

  const rpcResponse = await callUserRpc(
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    'rpc_bank_split_reconciliation',
    rpcPayload
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
    const conciliacaoIds = Array.isArray(rpcResult?.conciliacao_ids)
      ? (rpcResult?.conciliacao_ids as string[])
      : [];

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_transacao_id: extratoTransacaoId,
      conciliacao_id: conciliacaoIds[0] || null,
      action: 'reconciliation_split_confirmed',
      status: 'success',
      message: 'Split aplicado e conciliado manualmente.',
      created_by: auth.userId,
      details: {
        conta_bancaria_id: contaBancariaId,
        idempotency_key: idempotencyKey,
        split_items_count: body.items.length,
        rpc_result: rpcResponse.data,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    data: rpcResponse.data,
  });
}
