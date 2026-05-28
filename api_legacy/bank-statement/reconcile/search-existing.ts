import type { VercelRequest, VercelResponse } from '../../../src/server/bank-statement/_shared.js';
import {
  extractBearerToken,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  getAdminClient,
  verifyTokenAndGetEmpresaId,
} from '../../../src/server/bank-statement/_shared.js';
import { sortCandidatesForWorkspace, type WorkspaceTransactionSnapshot } from '../../../src/server/bank-statement/conciliation/workspace.js';
import type { ConciliationCandidateSearchResult, MatchingLancamentoCandidate } from '../../../src/types/bank-reconciliation.js';

const readQueryValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
};

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const normalize = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const withinDateWindow = (baseDate: string, candidateDate: string, windowDays: number): boolean => {
  const base = new Date(`${String(baseDate).slice(0, 10)}T00:00:00`);
  const candidate = new Date(`${String(candidateDate).slice(0, 10)}T00:00:00`);
  const diffMs = Math.abs(candidate.getTime() - base.getTime());
  return diffMs <= windowDays * 24 * 60 * 60 * 1000;
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
      message: 'Variáveis do Supabase não configuradas para a conciliação bancária.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Sessão expirada. Faça login novamente.',
    });
  }

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error: unknown) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Não foi possível validar a sessão.'),
    });
  }

  const extratoTransacaoId = readQueryValue(req.query?.extrato_transacao_id);
  const limit = Math.max(1, Math.min(25, Number(readQueryValue(req.query?.limit) || 8)));
  const searchQuery = normalize(readQueryValue(req.query?.query));
  const dateFrom = readQueryValue(req.query?.date_from);
  const dateTo = readQueryValue(req.query?.date_to);

  if (!extratoTransacaoId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'extrato_transacao_id é obrigatório.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: txRaw, error: txError } = await adminClient
      .from('extrato_transacoes')
      .select('id,conta_bancaria_id,data_movimento,descricao_raw,descricao_norm,valor_centavos,tipo')
      .eq('empresa_id', auth.empresaId)
      .eq('id', extratoTransacaoId)
      .maybeSingle();

    if (txError) {
      throw new Error(`Falha ao carregar transação do extrato: ${txError.message}`);
    }
    if (!txRaw) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Transação do extrato não encontrada para a empresa autenticada.',
      });
    }

    const tx: WorkspaceTransactionSnapshot = {
      id: String(txRaw.id || ''),
      conta_bancaria_id: String(txRaw.conta_bancaria_id || ''),
      data_movimento: String(txRaw.data_movimento || ''),
      descricao_raw: String(txRaw.descricao_raw || ''),
      descricao_norm: String(txRaw.descricao_norm || ''),
      valor_centavos: toNumber(txRaw.valor_centavos, 0),
      tipo: String(txRaw.tipo || 'other') as WorkspaceTransactionSnapshot['tipo'],
    };

    let itemsQuery = adminClient
      .from('conciliacao_itens_financeiros')
      .select('id,conta_bancaria_id,data,tipo,valor_centavos,descricao_exibicao,documento,origem_tipo,origem_id_uuid,origem_id_bigint')
      .eq('empresa_id', auth.empresaId)
      .eq('conta_bancaria_id', tx.conta_bancaria_id)
      .eq('ativo', true)
      .order('data', { ascending: false })
      .limit(Math.max(limit * 5, 40));

    if (dateFrom) itemsQuery = itemsQuery.gte('data', dateFrom);
    if (dateTo) itemsQuery = itemsQuery.lte('data', dateTo);

    const { data: itemRaw, error: itemError } = await itemsQuery;
    if (itemError) {
      throw new Error(`Falha ao carregar candidatos: ${itemError.message}`);
    }

    const candidates = ((itemRaw || []) as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.id || ''),
        conta_bancaria_id: String(row.conta_bancaria_id || ''),
        data: String(row.data || ''),
        tipo: String(row.tipo || 'saida') as MatchingLancamentoCandidate['tipo'],
        valor: toNumber(row.valor_centavos, 0) / 100,
        historico: row.descricao_exibicao ? String(row.descricao_exibicao) : null,
        documento: row.documento ? String(row.documento) : null,
        item_financeiro_id: String(row.id || ''),
        origem_tipo: row.origem_tipo ? (String(row.origem_tipo) as MatchingLancamentoCandidate['origem_tipo']) : undefined,
        origem_id_uuid: row.origem_id_uuid ? String(row.origem_id_uuid) : null,
        origem_id_bigint: row.origem_id_bigint == null ? null : toNumber(row.origem_id_bigint, 0),
      }) satisfies MatchingLancamentoCandidate)
      .filter((candidate) => {
        if (!withinDateWindow(tx.data_movimento, candidate.data, 15)) return false;
        if (!searchQuery) return true;
        const haystack = normalize(`${candidate.historico || ''} ${candidate.documento || ''} ${candidate.item_financeiro_id || ''}`);
        return haystack.includes(searchQuery);
      });

    const sorted = sortCandidatesForWorkspace(tx, candidates).slice(0, limit);

    return res.status(200).json({
      ok: true,
      data: {
        extrato_transacao_id: extratoTransacaoId,
        query: searchQuery || null,
        candidates: sorted as ConciliationCandidateSearchResult[],
      },
    });
  } catch (error: unknown) {
    return res.status(422).json({
      error: 'Search error',
      message: getErrorMessage(error, 'Falha ao buscar lançamentos existentes.'),
    });
  }
}
