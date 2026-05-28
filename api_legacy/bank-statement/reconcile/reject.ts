import type { BankRejectRequest } from '../../../src/types/bank-reconciliation.js';
import {
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

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
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

  let body: BankRejectRequest;
  try {
    body = (parseJsonBody(req) || {}) as BankRejectRequest;
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

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  const { data: updated, error: updateError } = await adminClient
    .from('conciliacoes_bancarias')
    .update({
      status: 'rejected',
      explanation: body?.explanation || 'Sugestao rejeitada manualmente na tela de conciliacao bancaria.',
      confirmed_by: null,
      confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conciliacaoId)
    .eq('empresa_id', auth.empresaId)
    .select('*')
    .maybeSingle();

  if (updateError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao rejeitar conciliacao: ${updateError.message}`,
    });
  }

  if (!updated) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Conciliacao nao encontrada para a empresa.',
    });
  }

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    extrato_transacao_id: updated.extrato_transacao_id,
    conciliacao_id: updated.id,
    action: 'reconciliation_rejected',
    status: 'warning',
    message: updated.explanation,
    created_by: auth.userId,
    details: {
      conciliacao_id: updated.id,
      lancamento_caixa_id: updated.lancamento_caixa_id,
    },
  });

  const { data: aiUpdates, error: aiUpdateError } = await adminClient
    .from('bank_ai_suggestions')
    .update({
      status: 'rejected',
      updated_at: new Date().toISOString(),
    })
    .eq('empresa_id', auth.empresaId)
    .eq('extrato_transacao_id', updated.extrato_transacao_id)
    .eq('suggestion_action', 'match_existing')
    .eq('status', 'suggested')
    .select('id');

  if (aiUpdateError) {
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_transacao_id: updated.extrato_transacao_id,
      conciliacao_id: updated.id,
      action: 'ai_suggestion_reject_sync_failed',
      status: 'warning',
      message: `Falha ao sincronizar rejeicao da sugestao IA: ${aiUpdateError.message}`,
      created_by: auth.userId,
    });
  } else if ((aiUpdates || []).length > 0) {
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_transacao_id: updated.extrato_transacao_id,
      conciliacao_id: updated.id,
      action: 'ai_suggestion_rejected_from_reconciliation',
      status: 'warning',
      message: 'Sugestao IA de match marcada como rejeitada apos rejeicao manual da conciliacao.',
      created_by: auth.userId,
      details: {
        updated_count: aiUpdates?.length || 0,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    data: updated,
  });
}
