import type { VercelRequest, VercelResponse } from '../../src/server/bank-statement/_shared.js';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getRuntimeBuildId,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  verifyTokenAndGetEmpresaId,
} from '../../src/server/bank-statement/_shared.js';

const readQueryValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
};

const isArchivedColumnMissingError = (message: string): boolean =>
  /archived_at/i.test(message) && /(column|schema cache)/i.test(message);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis de ambiente do Supabase nao configuradas.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Sessao expirada. Faca login novamente.',
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

  const includeArchived = ['1', 'true', 'yes'].includes(readQueryValue(req.query?.include_archived).toLowerCase());
  const limit = Math.max(1, Math.min(100, Number(readQueryValue(req.query?.limit) || 50)));
  const sessionId = readQueryValue(req.query?.session_id) || null;

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
  const runtimeBuildId = getRuntimeBuildId();

  if (req.method === 'DELETE') {
    if (!sessionId) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'session_id e obrigatorio para excluir sessao.',
      });
    }

    const { data: updated, error: updateError } = await adminClient
      .from('operacoes_ia_chat_sessions')
      .update({
        archived_at: new Date().toISOString(),
        archived_by: auth.userId,
        archived_reason: 'user_delete',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('empresa_id', auth.empresaId)
      .eq('user_id', auth.userId)
      .is('archived_at', null)
      .select('id')
      .maybeSingle();

    if (updateError && isArchivedColumnMissingError(updateError.message)) {
      return res.status(409).json({
        error: 'Migration required',
        message: 'A migration de soft delete do historico de chat ainda nao foi aplicada (archived_at).',
      });
    }

    if (updateError) {
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao arquivar sessao de chat: ${updateError.message}`,
      });
    }

    if (!updated) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Sessao nao encontrada (ou ja arquivada).',
      });
    }

    return res.status(200).json({
      ok: true,
      runtime_build_id: runtimeBuildId,
      data: { id: sessionId, archived: true },
    });
  }

  const buildQuery = (withArchivedFilter: boolean) => {
    let query = adminClient
      .from('operacoes_ia_chat_sessions')
      .select('*')
      .eq('empresa_id', auth.empresaId)
      .eq('user_id', auth.userId)
      .order('last_message_at', { ascending: false })
      .limit(limit);

    if (!includeArchived && withArchivedFilter) query = query.is('archived_at', null);
    return query;
  };

  let { data, error } = await buildQuery(true);

  if (error && isArchivedColumnMissingError(error.message)) {
    ({ data, error } = await buildQuery(false));
  }

  if (error) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar sessoes de chat: ${error.message}`,
    });
  }

  return res.status(200).json({
    ok: true,
    runtime_build_id: runtimeBuildId,
    data: data || [],
  });
}
