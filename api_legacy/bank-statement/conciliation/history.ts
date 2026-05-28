import type { VercelRequest, VercelResponse } from '../../../src/server/bank-statement/_shared.js';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  verifyTokenAndGetEmpresaId,
} from '../../../src/server/bank-statement/_shared.js';
import type {
  ConciliationHistoryDecisionEntry,
  ConciliationHistoryImportEntry,
  ConciliationHistoryReconciliationEntry,
  ConciliationHistoryResponse,
} from '../../../src/types/bank-reconciliation.js';

const readQueryValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
};

const toIsoStart = (date: string): string => `${String(date).slice(0, 10)}T00:00:00.000Z`;
const toIsoEnd = (date: string): string => `${String(date).slice(0, 10)}T23:59:59.999Z`;

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

  const contaBancariaId = readQueryValue(req.query?.conta_bancaria_id);
  const dataInicio = readQueryValue(req.query?.data_inicio);
  const dataFim = readQueryValue(req.query?.data_fim);
  const cursor = readQueryValue(req.query?.cursor);
  const limit = Math.max(1, Math.min(100, Number(readQueryValue(req.query?.limit) || 30)));

  if (!contaBancariaId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'conta_bancaria_id e obrigatorio.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  try {
    let importsQuery = adminClient
      .from('extratos_import')
      .select('id,conta_bancaria_id,parse_status,file_format,original_filename,periodo_inicio,periodo_fim,created_at,file_sha256')
      .eq('empresa_id', auth.empresaId)
      .eq('conta_bancaria_id', contaBancariaId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (dataInicio) importsQuery = importsQuery.gte('created_at', toIsoStart(dataInicio));
    if (dataFim) importsQuery = importsQuery.lte('created_at', toIsoEnd(dataFim));
    if (cursor) importsQuery = importsQuery.lt('created_at', cursor);

    const { data: importsRaw, error: importsError } = await importsQuery;
    if (importsError) {
      throw new Error(`Falha ao carregar histórico de imports: ${importsError.message}`);
    }

    const importRows = (importsRaw || []) as Array<Record<string, unknown>>;
    const uniqueHashes = Array.from(
      new Set(importRows.map((row) => String(row.file_sha256 || '')).filter(Boolean))
    );

    let duplicateKeys = new Set<string>();
    if (uniqueHashes.length > 0) {
      const { data: duplicateRaw, error: duplicateError } = await adminClient
        .from('extratos_import')
        .select('file_sha256,periodo_inicio,periodo_fim')
        .eq('empresa_id', auth.empresaId)
        .eq('conta_bancaria_id', contaBancariaId)
        .in('file_sha256', uniqueHashes);

      if (duplicateError) {
        throw new Error(`Falha ao avaliar suspeita de duplicidade: ${duplicateError.message}`);
      }

      const countByKey = new Map<string, number>();
      for (const row of (duplicateRaw || []) as Array<Record<string, unknown>>) {
        const key = [
          String(row.file_sha256 || ''),
          String(row.periodo_inicio || ''),
          String(row.periodo_fim || ''),
        ].join(':');
        countByKey.set(key, (countByKey.get(key) || 0) + 1);
      }

      duplicateKeys = new Set(
        Array.from(countByKey.entries())
          .filter(([, count]) => count > 1)
          .map(([key]) => key)
      );
    }

    let conciliacoesQuery = adminClient
      .from('conciliacoes_bancarias')
      .select(
        'id,extrato_transacao_id,status,method,explanation,item_financeiro_id,lancamento_caixa_id,confirmed_at,created_at,extrato_transacoes!inner(conta_bancaria_id)'
      )
      .eq('empresa_id', auth.empresaId)
      .eq('extrato_transacoes.conta_bancaria_id', contaBancariaId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (cursor) conciliacoesQuery = conciliacoesQuery.lt('created_at', cursor);
    if (dataInicio) conciliacoesQuery = conciliacoesQuery.gte('created_at', toIsoStart(dataInicio));
    if (dataFim) conciliacoesQuery = conciliacoesQuery.lte('created_at', toIsoEnd(dataFim));

    const { data: conciliacoesRaw, error: conciliacoesError } = await conciliacoesQuery;
    if (conciliacoesError) {
      throw new Error(`Falha ao carregar histórico de conciliações: ${conciliacoesError.message}`);
    }

    let decisionsQuery = adminClient
      .from('bank_reconciliation_chat_review_actions')
      .select(
        'id,session_id,case_id,suggestion_id,extrato_transacao_id,decision,justification,conciliacao_id,item_financeiro_id,reversible,reversed_at,created_at,extrato_transacoes!inner(conta_bancaria_id)'
      )
      .eq('empresa_id', auth.empresaId)
      .eq('extrato_transacoes.conta_bancaria_id', contaBancariaId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (cursor) decisionsQuery = decisionsQuery.lt('created_at', cursor);
    if (dataInicio) decisionsQuery = decisionsQuery.gte('created_at', toIsoStart(dataInicio));
    if (dataFim) decisionsQuery = decisionsQuery.lte('created_at', toIsoEnd(dataFim));

    const { data: decisionsRaw, error: decisionsError } = await decisionsQuery;
    if (decisionsError) {
      throw new Error(`Falha ao carregar histórico de decisões guiadas: ${decisionsError.message}`);
    }

    const imports: ConciliationHistoryImportEntry[] = importRows.map((row) => {
      const duplicateKey = [
        String(row.file_sha256 || ''),
        String(row.periodo_inicio || ''),
        String(row.periodo_fim || ''),
      ].join(':');
      return {
        id: String(row.id || ''),
        conta_bancaria_id: String(row.conta_bancaria_id || ''),
        parse_status: String(row.parse_status || ''),
        file_format: row.file_format ? String(row.file_format) : null,
        original_filename: row.original_filename ? String(row.original_filename) : null,
        periodo_inicio: row.periodo_inicio ? String(row.periodo_inicio) : null,
        periodo_fim: row.periodo_fim ? String(row.periodo_fim) : null,
        created_at: String(row.created_at || ''),
        duplicate_suspect: duplicateKeys.has(duplicateKey),
      };
    });

    const conciliacoes: ConciliationHistoryReconciliationEntry[] = ((conciliacoesRaw || []) as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id || ''),
        extrato_transacao_id: String(row.extrato_transacao_id || ''),
        status: String(row.status || 'suggested') as ConciliationHistoryReconciliationEntry['status'],
        method: String(row.method || 'manual') as ConciliationHistoryReconciliationEntry['method'],
        explanation: row.explanation ? String(row.explanation) : null,
        item_financeiro_id: row.item_financeiro_id ? String(row.item_financeiro_id) : null,
        lancamento_caixa_id: row.lancamento_caixa_id ? String(row.lancamento_caixa_id) : null,
        confirmed_at: row.confirmed_at ? String(row.confirmed_at) : null,
        created_at: row.created_at ? String(row.created_at) : null,
      })
    );

    const guidedDecisions: ConciliationHistoryDecisionEntry[] = ((decisionsRaw || []) as Array<Record<string, unknown>>).map(
      (row) => ({
        id: String(row.id || ''),
        session_id: String(row.session_id || ''),
        case_id: row.case_id ? String(row.case_id) : null,
        suggestion_id: row.suggestion_id ? String(row.suggestion_id) : null,
        extrato_transacao_id: String(row.extrato_transacao_id || ''),
        decision: String(row.decision || 'keep_pending') as ConciliationHistoryDecisionEntry['decision'],
        justification: row.justification ? String(row.justification) : null,
        conciliacao_id: row.conciliacao_id ? String(row.conciliacao_id) : null,
        item_financeiro_id: row.item_financeiro_id ? String(row.item_financeiro_id) : null,
        reversible: row.reversible !== false,
        reversed_at: row.reversed_at ? String(row.reversed_at) : null,
        created_at: String(row.created_at || ''),
      })
    );

    const cursorCandidates = [
      imports[imports.length - 1]?.created_at || null,
      conciliacoes[conciliacoes.length - 1]?.created_at || null,
      guidedDecisions[guidedDecisions.length - 1]?.created_at || null,
    ].filter((value): value is string => Boolean(value));

    const nextCursor =
      cursorCandidates.length > 0
        ? cursorCandidates.sort((a, b) => a.localeCompare(b))[0]
        : null;

    const responseData: ConciliationHistoryResponse = {
      imports,
      conciliacoes,
      guided_decisions: guidedDecisions,
      next_cursor: nextCursor,
    };

    return res.status(200).json({
      ok: true,
      data: responseData,
    });
  } catch (error: unknown) {
    return res.status(422).json({
      error: 'History error',
      message: getErrorMessage(error, 'Falha ao carregar histórico da conciliação.'),
    });
  }
}
