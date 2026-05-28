import type { BankCreateReconcileRequest } from '../../../src/types/bank-reconciliation.js';
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

  let body: BankCreateReconcileRequest;
  try {
    body = (parseJsonBody(req) || {}) as BankCreateReconcileRequest;
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
        action: 'reconcile_create_blocked_policy',
        status: 'warning',
        message: 'Criação de lançamento bloqueada por política de conciliação sem mutação de saldo.',
        created_by: auth.userId,
        details: {
          conta_bancaria_id: contaBancariaId,
          idempotency_key: idempotencyKey,
          policy: 'BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION',
        },
      });
    }

    return res.status(409).json({
      error: 'Balance mutation blocked',
      code: 'BANK_RECONCILIATION_BALANCE_MUTATION_DISABLED',
      message:
        'Criacao de lancamento na conciliacao esta temporariamente bloqueada nesta fase. Use vinculo existente/ignorar.',
    });
  }

  const rpcPayload = {
    payload: {
      empresa_id: auth.empresaId,
      conta_bancaria_id: contaBancariaId,
      extrato_transacao_id: extratoTransacaoId,
      idempotency_key: idempotencyKey,
      tipo: body?.tipo,
      valor: body?.valor,
      valor_centavos: body?.valor_centavos,
      data: body?.data,
      historico: body?.historico || body?.descricao || null,
      descricao: body?.descricao || null,
      documento: body?.documento || null,
      observacoes: body?.observacoes || null,
      grupo_contas_id: body?.grupo_contas_id || null,
      method: body?.method || 'manual',
      explanation: body?.explanation || null,
    },
  };

  const rpcResponse = await callUserRpc(
    supabaseUrl,
    supabaseAnonKey,
    accessToken,
    'rpc_bank_create_lancamento_and_reconcile',
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
    const conciliacaoId =
      rpcResult && typeof rpcResult.conciliacao_id === 'string' ? rpcResult.conciliacao_id : null;

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_transacao_id: extratoTransacaoId,
      conciliacao_id: conciliacaoId,
      action: 'reconciliation_created_and_confirmed',
      status: 'success',
      message: 'Lancamento criado e conciliado via endpoint create.',
      created_by: auth.userId,
      details: {
        conta_bancaria_id: contaBancariaId,
        idempotency_key: idempotencyKey,
        rpc_result: rpcResponse.data,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    data: rpcResponse.data,
  });
}
