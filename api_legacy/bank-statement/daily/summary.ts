import type { DailyReconciliationSummary } from '../../../src/types/bank-reconciliation.js';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

const readQueryValue = (
  value: string | string[] | undefined
): string => {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
};

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

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error: unknown) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
    });
  }

  const contaBancariaId = readQueryValue(req.query?.conta_bancaria_id);
  const dataReferencia = readQueryValue(req.query?.data_referencia);

  if (!contaBancariaId || !dataReferencia) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'conta_bancaria_id e data_referencia sao obrigatorios.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  const { data: contaRow, error: contaError } = await adminClient
    .from('contas_bancarias')
    .select('id,empresa_id')
    .eq('id', contaBancariaId)
    .eq('empresa_id', auth.empresaId)
    .maybeSingle();

  if (contaError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao validar conta bancaria: ${contaError.message}`,
    });
  }

  if (!contaRow) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Conta bancaria nao pertence a empresa autenticada.',
    });
  }

  const { data: summaryRaw, error: summaryError } = await adminClient.rpc('fn_bank_daily_summary', {
    p_empresa_id: auth.empresaId,
    p_conta_id: contaBancariaId,
    p_data: dataReferencia,
  });

  if (summaryError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar resumo diario: ${summaryError.message}`,
    });
  }

  const { data: fechamentoRow, error: fechamentoError } = await adminClient
    .from('conciliacao_fechamentos_diarios')
    .select('*')
    .eq('empresa_id', auth.empresaId)
    .eq('conta_bancaria_id', contaBancariaId)
    .eq('data_referencia', dataReferencia)
    .maybeSingle();

  if (fechamentoError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar fechamento diario: ${fechamentoError.message}`,
    });
  }

  return res.status(200).json({
    ok: true,
    data: {
      summary: (summaryRaw || {}) as DailyReconciliationSummary,
      fechamento: fechamentoRow || null,
    },
  });
}
