import type { DailyReopenRequest } from '../../../src/types/bank-reconciliation.js';
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

  let body: DailyReopenRequest;
  try {
    body = (parseJsonBody(req) || {}) as DailyReopenRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const contaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const dataReferencia = String(body?.data_referencia || '').trim();

  if (!contaBancariaId || !dataReferencia) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'conta_bancaria_id e data_referencia sao obrigatorios.',
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
    'rpc_bank_daily_reopen',
    {
      payload: {
        empresa_id: auth.empresaId,
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
        observacoes: body?.observacoes || null,
      },
    }
  );

  if (rpcResponse.error) {
    const status = rpcResponse.status >= 400 ? rpcResponse.status : 422;
    return res.status(status).json({
      error: 'RPC error',
      message: rpcResponse.error,
    });
  }

  if (serviceRoleKey) {
    const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      action: 'daily_reopen_confirmed',
      status: 'warning',
      message: 'Fechamento diario reaberto.',
      created_by: auth.userId,
      details: {
        conta_bancaria_id: contaBancariaId,
        data_referencia: dataReferencia,
        rpc_result: rpcResponse.data,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    data: rpcResponse.data,
  });
}
