import { calculateMatchScore } from '../../../src/lib/bank-reconciliation/matchingEngine.js';
import type {
  AiIntegrationPendingRequest,
  AiSuggestionPendingItem,
  ExtratoTransacaoRow,
  MatchingLancamentoCandidate,
} from '../../../src/types/bank-reconciliation.js';
import {
  callUserRpc,
  extractBearerToken,
  getAdminClient,
  getBankReconciliationIntegrationSecret,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isEmpresaHeaderConsistent,
  isValidIntegrationSecret,
  parseIntegrationScope,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

interface ResolvedAuthContext {
  mode: 'user' | 'integration';
  userId: string | null;
  empresaId: string;
  contaBancariaId: string | null;
}

export function applyPendingSuggestionsWindowFilter<
  T extends {
    gte: (column: string, value: string) => T;
  },
>(query: T, suggestionsSinceIso: string | null): T {
  if (!suggestionsSinceIso) return query;
  return query.gte('created_at', suggestionsSinceIso);
}

const addDays = (isoDate: string, days: number): string => {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const expectedLancamentoType = (txType: ExtratoTransacaoRow['tipo']): 'entrada' | 'saida' | 'both' => {
  if (txType === 'credit') return 'entrada';
  if (txType === 'debit') return 'saida';
  return 'both';
};

const getDaysDiff = (a: string, b: string): number => {
  const d1 = new Date(`${a}T00:00:00`).getTime();
  const d2 = new Date(`${b}T00:00:00`).getTime();
  return Math.floor(Math.abs(d1 - d2) / (24 * 60 * 60 * 1000));
};

const toCentavos = (valor: number): number => Math.round(Math.abs(Number(valor || 0)) * 100);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const integrationSecret = getBankReconciliationIntegrationSecret();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis do Supabase nao configuradas para conciliacao bancaria.',
    });
  }

  let body: Record<string, unknown>;
  try {
    body = (parseJsonBody(req) || {}) as Record<string, unknown>;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const importId = String(body?.import_id || body?.extrato_import_id || '').trim();
  const requestedContaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const correlationId = String(body?.correlation_id || '').trim() || null;
  const limit = Math.max(1, Math.min(200, Number(body?.limit || 50)));

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  const isIntegrationCall = Boolean(getHeaderValue(req, 'x-integration-secret'));

  let auth: ResolvedAuthContext;

  if (isIntegrationCall) {
    if (!integrationSecret || !isValidIntegrationSecret(req, integrationSecret)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'x-integration-secret invalido para ai/pending.',
      });
    }

    const parsedScope = parseIntegrationScope(body, { requireContaBancariaId: true, requireImportId: false });

    if (parsedScope.error || !parsedScope.scope) {
      return res.status(400).json({
        error: 'Invalid input',
        message: parsedScope.error || 'Escopo de integracao invalido.',
      });
    }

    if (!isEmpresaHeaderConsistent(req, parsedScope.scope.empresaId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'x-empresa-id inconsistente com empresa_id do payload.',
      });
    }

    auth = {
      mode: 'integration',
      userId: null,
      empresaId: parsedScope.scope.empresaId,
      contaBancariaId: parsedScope.scope.contaBancariaId,
    };
  } else {
    if (!accessToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Sessao expirada. Faca login novamente.',
      });
    }

    let userAuth;
    try {
      userAuth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
    } catch (error: unknown) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
      });
    }

    auth = {
      mode: 'user',
      userId: userAuth.userId,
      empresaId: userAuth.empresaId,
      contaBancariaId: requestedContaBancariaId || null,
    };
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  if (importId) {
    const { data: importRow, error: importError } = await adminClient
      .from('extratos_import')
      .select('id,empresa_id,conta_bancaria_id,parse_status')
      .eq('id', importId)
      .eq('empresa_id', auth.empresaId)
      .maybeSingle();

    if (importError) {
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao validar importacao: ${importError.message}`,
      });
    }

    if (!importRow) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Importacao nao encontrada para a empresa.',
      });
    }

    if (auth.contaBancariaId && importRow.conta_bancaria_id !== auth.contaBancariaId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Importacao nao pertence a conta_bancaria_id informada.',
      });
    }
  }

  let txQuery = adminClient
    .from('extrato_transacoes')
    .select('*')
    .eq('empresa_id', auth.empresaId)
    .order('data_movimento', { ascending: false })
    .order('line_number', { ascending: true })
    .limit(limit * 3);

  if (importId) txQuery = txQuery.eq('extrato_import_id', importId);
  if (auth.contaBancariaId) txQuery = txQuery.eq('conta_bancaria_id', auth.contaBancariaId);

  const { data: txRows, error: txError } = await txQuery;

  if (txError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar transacoes pendentes: ${txError.message}`,
    });
  }

  const txList = (txRows || []) as ExtratoTransacaoRow[];

  if (!txList.length) {
    return res.status(200).json({
      ok: true,
      data: [],
    });
  }

  const txIds = txList.map((tx) => tx.id);

  let suggestionsSinceIso: string | null = null;
  if (correlationId) {
    const { data: runRow, error: runError } = await adminClient
      .from('bank_ai_execution_runs')
      .select('created_at')
      .eq('empresa_id', auth.empresaId)
      .eq('correlation_id', correlationId)
      .maybeSingle();

    if (runError) {
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao carregar execução IA para correlation_id: ${runError.message}`,
      });
    }

    suggestionsSinceIso = runRow?.created_at ? String(runRow.created_at) : null;
  }

  const { data: concRows, error: concError } = await adminClient
    .from('conciliacoes_bancarias')
    .select('extrato_transacao_id,status')
    .eq('empresa_id', auth.empresaId)
    .in('extrato_transacao_id', txIds);

  if (concError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar conciliacoes: ${concError.message}`,
    });
  }

  const confirmedTxIds = new Set<string>();
  for (const row of concRows || []) {
    if (row.status === 'confirmed') confirmedTxIds.add(row.extrato_transacao_id);
  }

  let aiSuggestedQuery = adminClient
    .from('bank_ai_suggestions')
    .select('extrato_transacao_id,status')
    .eq('empresa_id', auth.empresaId)
    .eq('status', 'suggested')
    .in('extrato_transacao_id', txIds);

  aiSuggestedQuery = applyPendingSuggestionsWindowFilter(aiSuggestedQuery, suggestionsSinceIso);

  const { data: aiRows } = await aiSuggestedQuery;

  const suggestedTxIds = new Set<string>((aiRows || []).map((row) => row.extrato_transacao_id));

  const pendingTransactions = txList
    .filter((tx) => !confirmedTxIds.has(tx.id) && !suggestedTxIds.has(tx.id))
    .slice(0, limit);

  if (!pendingTransactions.length) {
    return res.status(200).json({
      ok: true,
      data: [],
    });
  }

  const contaIds = [...new Set(pendingTransactions.map((tx) => tx.conta_bancaria_id))];
  const dateValues = pendingTransactions.map((tx) => tx.data_movimento).sort();

  const { data: contaRows } = await adminClient
    .from('contas_bancarias')
    .select('id,descricao')
    .eq('empresa_id', auth.empresaId)
    .in('id', contaIds);

  const accountNameMap = new Map<string, string>();
  for (const row of contaRows || []) {
    accountNameMap.set(row.id, row.descricao || row.id);
  }

  const fromDate = addDays(dateValues[0], -7);
  const toDate = addDays(dateValues[dateValues.length - 1], 7);

  if (auth.mode === 'user' && accessToken) {
    const syncResponse = await callUserRpc(
      supabaseUrl,
      supabaseAnonKey,
      accessToken,
      'rpc_bank_sync_conciliacao_itens',
      {
        payload: {
          empresa_id: auth.empresaId,
          conta_bancaria_id: auth.contaBancariaId,
          full_refresh: false,
        },
      }
    );

    if (syncResponse.error) {
      await safeInsertBankAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        extrato_import_id: importId || null,
        action: 'ai_pending_sync_items_warning',
        status: 'warning',
        message: `Nao foi possivel sincronizar itens de conciliacao: ${syncResponse.error}`,
        created_by: auth.userId,
      });
    }
  }

  const { data: itemRows, error: itemError } = await adminClient
    .from('conciliacao_itens_financeiros')
    .select(
      'id,conta_bancaria_id,data,tipo,valor_centavos,descricao_exibicao,documento,origem_tipo,origem_id_uuid'
    )
    .eq('empresa_id', auth.empresaId)
    .eq('ativo', true)
    .in('conta_bancaria_id', contaIds)
    .gte('data', fromDate)
    .lte('data', toDate)
    .order('data', { ascending: true });

  if (itemError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar candidatos de itens financeiros: ${itemError.message}`,
    });
  }

  const lancamentos = ((itemRows || []) as Array<{
    id: string;
    conta_bancaria_id: string;
    data: string;
    tipo: 'entrada' | 'saida';
    valor_centavos: number;
    descricao_exibicao: string | null;
    documento: string | null;
    origem_tipo: 'lancamento_caixa' | 'movimentacao_estoque';
    origem_id_uuid: string | null;
  }>).map((item) => {
    return {
      id: item.id,
      data: item.data,
      tipo: item.tipo,
      valor: item.valor_centavos / 100,
      historico: item.descricao_exibicao,
      documento: item.documento,
      conta_bancaria_id: item.conta_bancaria_id,
      item_financeiro_id: item.id,
      origem_tipo: item.origem_tipo,
      origem_id_uuid: item.origem_id_uuid,
      origem_id_bigint: null,
    } as MatchingLancamentoCandidate;
  });

  const items: AiSuggestionPendingItem[] = pendingTransactions.map((tx) => {
    const expectedType = expectedLancamentoType(tx.tipo);
    const candidateRows = lancamentos
      .filter((lanc) => {
        if (lanc.conta_bancaria_id !== tx.conta_bancaria_id) return false;
        if (expectedType !== 'both' && lanc.tipo !== expectedType) return false;

        const amountDiff = Math.abs(toCentavos(lanc.valor) - tx.valor_centavos);
        const maxAmountDiff = Math.max(1, Math.round(tx.valor_centavos * 0.01));
        if (amountDiff > maxAmountDiff) return false;

        const dateDiff = getDaysDiff(tx.data_movimento, lanc.data);
        if (dateDiff > 7) return false;

        return true;
      })
      .map((lanc) => ({
        lancamento: lanc,
        score: calculateMatchScore(tx, lanc),
      }))
      .sort((a, b) => b.score.final_score - a.score.final_score)
      .slice(0, 5) // Top 5 candidates
      .map((row) => ({
        id: row.lancamento.id,
        item_financeiro_id: row.lancamento.item_financeiro_id || row.lancamento.id,
        lancamento_caixa_id:
          row.lancamento.origem_tipo === 'lancamento_caixa' ? row.lancamento.origem_id_uuid || null : null,
        data: row.lancamento.data,
        tipo: row.lancamento.tipo,
        valor_centavos: toCentavos(row.lancamento.valor),
        descricao: row.lancamento.historico || row.lancamento.documento || row.lancamento.id,
      }));

    return {
      extrato_tx: {
        id: tx.id,
        data: tx.data_movimento,
        tipo: tx.tipo,
        valor_centavos: tx.valor_centavos,
        descricao_raw: tx.descricao_raw,
        descricao_norm: tx.descricao_norm,
      },
      conta_bancaria: {
        id: tx.conta_bancaria_id,
        nome: accountNameMap.get(tx.conta_bancaria_id) || tx.conta_bancaria_id,
      },
      candidatos_lancamentos: candidateRows,
    };
  });

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    extrato_import_id: importId || null,
    action: 'ai_pending_requested',
    status: 'info',
    message: `Pendencias IA consultadas (${auth.mode}).`,
    created_by: auth.userId,
    details: {
      mode: auth.mode,
      conta_bancaria_id: auth.contaBancariaId,
      correlation_id: correlationId,
      suggestions_since_iso: suggestionsSinceIso,
      limit,
      returned_count: items.length,
    },
  });

  return res.status(200).json({
    ok: true,
    data: items,
  });
}
