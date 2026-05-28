import type { BankConfirmRequest } from '../../../src/types/bank-reconciliation.js';
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

  let body: BankConfirmRequest;
  try {
    body = (parseJsonBody(req) || {}) as BankConfirmRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const conciliacaoId = String(body?.conciliacao_id || '').trim();
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
    'rpc_bank_confirm_reconciliation',
    {
      payload: {
        conciliacao_id: conciliacaoId,
        explanation: body?.explanation || null,
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
    const extratoTransacaoId =
      rpcResult && typeof rpcResult.extrato_transacao_id === 'string' ? rpcResult.extrato_transacao_id : null;

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_transacao_id: extratoTransacaoId,
      conciliacao_id: conciliacaoId,
      action: 'reconciliation_confirmed_manual',
      status: 'success',
      message: body?.explanation || 'Sugestao confirmada manualmente.',
      created_by: auth.userId,
      details: {
        rpc_result: rpcResponse.data,
      },
    });

    if (extratoTransacaoId) {
      const { data: aiUpdates, error: aiUpdateError } = await adminClient
        .from('bank_ai_suggestions')
        .update({
          status: 'applied',
          updated_at: new Date().toISOString(),
        })
        .eq('empresa_id', auth.empresaId)
        .eq('extrato_transacao_id', extratoTransacaoId)
        .eq('suggestion_action', 'match_existing')
        .eq('status', 'suggested')
        .select('id');

      if (aiUpdateError) {
        await safeInsertBankAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          extrato_transacao_id: extratoTransacaoId,
          conciliacao_id: conciliacaoId,
          action: 'ai_suggestion_apply_sync_failed',
          status: 'warning',
          message: `Falha ao sincronizar sugestao IA apos confirmacao: ${aiUpdateError.message}`,
          created_by: auth.userId,
        });
      } else if ((aiUpdates || []).length > 0) {
        await safeInsertBankAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          extrato_transacao_id: extratoTransacaoId,
          conciliacao_id: conciliacaoId,
          action: 'ai_suggestion_applied_from_confirm',
          status: 'success',
          message: 'Sugestao IA de match marcada como aplicada apos confirmacao manual.',
          created_by: auth.userId,
          details: {
            updated_count: aiUpdates?.length || 0,
          },
        });
      }
    }
  }

  return res.status(200).json({
    ok: true,
    data: rpcResponse.data,
  });
}
