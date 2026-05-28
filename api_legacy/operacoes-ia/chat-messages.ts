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
  if (req.method !== 'GET') {
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

  const sessionId = readQueryValue(req.query?.session_id) || null;
  const includeArchived = ['1', 'true', 'yes'].includes(readQueryValue(req.query?.include_archived).toLowerCase());

  if (!sessionId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Informe session_id.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
  const runtimeBuildId = getRuntimeBuildId();

  const buildSessionQuery = (withArchivedFilter: boolean) => {
    let query = adminClient
      .from('operacoes_ia_chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('empresa_id', auth.empresaId)
      .eq('user_id', auth.userId)
      .limit(1);

    if (!includeArchived && withArchivedFilter) {
      query = query.is('archived_at', null);
    }

    return query;
  };

  let { data: sessionRows, error: sessionError } = await buildSessionQuery(true);

  if (sessionError && isArchivedColumnMissingError(sessionError.message)) {
    ({ data: sessionRows, error: sessionError } = await buildSessionQuery(false));
  }

  if (sessionError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar sessao: ${sessionError.message}`,
    });
  }

  const session = (sessionRows && sessionRows[0]) || null;

  if (!session) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Sessao nao encontrada.',
    });
  }

  const { data: messages, error: messagesError } = await adminClient
    .from('operacoes_ia_chat_messages')
    .select('*')
    .eq('empresa_id', auth.empresaId)
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });

  if (messagesError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar mensagens da sessao: ${messagesError.message}`,
    });
  }

  return res.status(200).json({
    ok: true,
    runtime_build_id: runtimeBuildId,
    data: {
      session,
      messages: messages || [],
    },
  });
}
