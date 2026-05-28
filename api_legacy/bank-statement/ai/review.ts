import type {
  AiSuggestionReviewAction,
  AiSuggestionReviewRequest,
} from '../../../src/types/bank-reconciliation.js';
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

const VALID_STATUSES = new Set<AiSuggestionReviewAction>(['approved', 'rejected', 'applied']);

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

  let body: AiSuggestionReviewRequest;
  try {
    body = (parseJsonBody(req) || {}) as AiSuggestionReviewRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const suggestionId = String(body?.suggestion_id || '').trim();
  const status = String(body?.status || '').trim() as AiSuggestionReviewAction;

  if (!suggestionId || !VALID_STATUSES.has(status)) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'suggestion_id e status (approved|rejected|applied) sao obrigatorios.',
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
    .from('bank_ai_suggestions')
    .update({
      status,
      explanation: body?.explanation || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', suggestionId)
    .eq('empresa_id', auth.empresaId)
    .select('*')
    .maybeSingle();

  if (updateError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao revisar sugestao IA: ${updateError.message}`,
    });
  }

  if (!updated) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Sugestao IA nao encontrada para a empresa.',
    });
  }

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    extrato_transacao_id: updated.extrato_transacao_id,
    action: 'ai_suggestion_reviewed',
    status: status === 'rejected' ? 'warning' : 'success',
    message: body?.explanation || `Sugestao IA marcada como ${status}.`,
    created_by: auth.userId,
    details: {
      ai_suggestion_id: updated.id,
      status,
      suggestion_action: updated.suggestion_action,
    },
  });

  return res.status(200).json({
    ok: true,
    data: updated,
  });
}
