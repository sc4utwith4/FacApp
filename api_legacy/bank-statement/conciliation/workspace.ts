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
  isBankReconciliationBalanceMutationDisabled,
} from '../../../src/server/bank-statement/_shared.js';
import {
  classifyWorkspacePattern,
  sortCandidatesForWorkspace,
  type WorkspaceTransactionSnapshot,
} from '../../../src/server/bank-statement/conciliation/workspace.js';
import type {
  ConciliationWorkspaceGroup,
  ConciliationWorkspaceResponse,
  ConciliationWorkspaceRow,
  ConciliationWorkspaceRowState,
  MatchingLancamentoCandidate,
} from '../../../src/types/bank-reconciliation.js';

const readQueryValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
};

const toNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const toOptionalNumber = (value: unknown): number | null => {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const normalizeImportRow = (row: Record<string, unknown>): ImportRow => ({
  id: String(row.id || ''),
  conta_bancaria_id: String(row.conta_bancaria_id || ''),
  parse_status: row.parse_status == null ? null : String(row.parse_status),
  file_format: row.file_format == null ? null : String(row.file_format),
  original_filename: row.original_filename == null ? null : String(row.original_filename),
  periodo_inicio: row.periodo_inicio == null ? null : String(row.periodo_inicio),
  periodo_fim: row.periodo_fim == null ? null : String(row.periodo_fim),
  file_sha256: row.file_sha256 == null ? null : String(row.file_sha256),
  saldo_final_centavos: toOptionalNumber(row.saldo_final_centavos),
  saldo_final: toOptionalNumber(row.saldo_final),
});

type ImportRow = {
  id: string;
  conta_bancaria_id: string;
  parse_status: string | null;
  file_format: string | null;
  original_filename: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  file_sha256: string | null;
  saldo_final_centavos: number | null;
  saldo_final: number | null;
};

type ConciliationRow = {
  id: string;
  extrato_transacao_id: string;
  status: 'suggested' | 'confirmed' | 'rejected';
  method: 'manual' | 'deterministic' | 'rule' | 'ai';
  explanation: string | null;
  item_financeiro_id: string | null;
  lancamento_caixa_id: string | null;
  confirmed_at: string | null;
  created_at: string | null;
};

type SuggestionRow = {
  id: string;
  extrato_transacao_id: string;
  suggestion_action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
  status: 'suggested' | 'approved' | 'rejected' | 'applied';
  confidence: number | null;
  explanation: string | null;
  item_financeiro_id: string | null;
  lancamento_caixa_id: string | null;
  created_at: string | null;
};

const resolveSaldoFinalCentavos = (importRow: ImportRow): number | null => {
  if (importRow.saldo_final_centavos != null) {
    return importRow.saldo_final_centavos;
  }

  if (importRow.saldo_final != null) {
    return Math.round(importRow.saldo_final * 100);
  }

  return null;
};

const pickBestConciliation = (rows: ConciliationRow[]): ConciliationRow | null => {
  if (!rows.length) return null;
  const priority = (row: ConciliationRow): number => {
    if (row.status === 'confirmed') return 0;
    if (row.status === 'suggested') return 1;
    if (row.status === 'rejected') return 2;
    return 3;
  };
  return [...rows].sort((a, b) => {
    const diff = priority(a) - priority(b);
    if (diff !== 0) return diff;
    return String(b.confirmed_at || b.created_at || '').localeCompare(String(a.confirmed_at || a.created_at || ''));
  })[0] || null;
};

const pickBestSuggestion = (rows: SuggestionRow[]): SuggestionRow | null => {
  if (!rows.length) return null;
  const statusPriority = (row: SuggestionRow): number => {
    if (row.status === 'suggested') return 0;
    if (row.status === 'approved') return 1;
    if (row.status === 'applied') return 2;
    return 3;
  };
  return [...rows].sort((a, b) => {
    const statusDiff = statusPriority(a) - statusPriority(b);
    if (statusDiff !== 0) return statusDiff;
    const confidenceDiff = toNumber(b.confidence, 0) - toNumber(a.confidence, 0);
    if (confidenceDiff !== 0) return confidenceDiff;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  })[0] || null;
};

const resolveRowState = (
  conciliation: ConciliationRow | null,
  suggestion: SuggestionRow | null
): ConciliationWorkspaceRowState => {
  if (conciliation?.status === 'confirmed') return 'conciliado';
  if (conciliation?.status === 'rejected') return 'divergente';
  if (conciliation?.status === 'suggested') return 'em_revisao';
  if (suggestion) return 'em_revisao';
  return 'pendente';
};

const resolveActionsAllowed = (args: {
  state: ConciliationWorkspaceRowState;
  hasCandidate: boolean;
  hasLancamento: boolean;
  hasConciliation: boolean;
  manualCreationAllowed: boolean;
}): ConciliationWorkspaceRow['actions_allowed'] => {
  const actions: ConciliationWorkspaceRow['actions_allowed'] = [];

  if (args.state !== 'conciliado' && args.state !== 'divergente') {
    if (args.hasCandidate) actions.push('conciliar');
    actions.push('buscar');
    actions.push('ignorar');
    if (args.manualCreationAllowed) actions.push('adicionar');
  }

  if (args.hasLancamento) actions.push('editar');
  if (args.hasConciliation) actions.push('desfazer');

  return Array.from(new Set(actions));
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

  const contaBancariaId = readQueryValue(req.query?.conta_bancaria_id);
  const importId = readQueryValue(req.query?.import_id);

  if (!contaBancariaId || !importId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'conta_bancaria_id e import_id são obrigatórios.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: contaRow, error: contaError } = await adminClient
      .from('contas_bancarias')
      .select('id,descricao')
      .eq('empresa_id', auth.empresaId)
      .eq('id', contaBancariaId)
      .maybeSingle();

    if (contaError) {
      throw new Error(`Falha ao carregar conta bancária: ${contaError.message}`);
    }
    if (!contaRow) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Conta bancária não encontrada para a empresa autenticada.',
      });
    }

    const { data: importRaw, error: importError } = await adminClient
      .from('extratos_import')
      .select('*')
      .eq('empresa_id', auth.empresaId)
      .eq('conta_bancaria_id', contaBancariaId)
      .eq('id', importId)
      .maybeSingle();

    if (importError) {
      throw new Error(`Falha ao carregar importação: ${importError.message}`);
    }
    if (!importRaw) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Importação não encontrada para a conta selecionada.',
      });
    }

    const importRow = normalizeImportRow((importRaw || {}) as Record<string, unknown>);

    const { data: txRaw, error: txError } = await adminClient
      .from('extrato_transacoes')
      .select('id,extrato_import_id,conta_bancaria_id,line_number,data_movimento,descricao_raw,descricao_norm,valor_centavos,tipo,documento_ref')
      .eq('empresa_id', auth.empresaId)
      .eq('conta_bancaria_id', contaBancariaId)
      .eq('extrato_import_id', importId)
      .order('data_movimento', { ascending: true })
      .order('line_number', { ascending: true });

    if (txError) {
      throw new Error(`Falha ao carregar transações do extrato: ${txError.message}`);
    }

    const transactions = ((txRaw || []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id || ''),
      extrato_import_id: String(row.extrato_import_id || ''),
      conta_bancaria_id: String(row.conta_bancaria_id || ''),
      line_number: toNumber(row.line_number, 0),
      data_movimento: String(row.data_movimento || ''),
      descricao_raw: String(row.descricao_raw || ''),
      descricao_norm: String(row.descricao_norm || ''),
      valor_centavos: toNumber(row.valor_centavos, 0),
      tipo: String(row.tipo || 'other') as WorkspaceTransactionSnapshot['tipo'],
      documento_ref: row.documento_ref ? String(row.documento_ref) : null,
    }));

    const extratoIds = transactions.map((row) => row.id);

    let conciliationByTx = new Map<string, ConciliationRow[]>();
    let suggestionByTx = new Map<string, SuggestionRow[]>();

    if (extratoIds.length > 0) {
      const { data: conciliationRaw, error: conciliationError } = await adminClient
        .from('conciliacoes_bancarias')
        .select('id,extrato_transacao_id,status,method,explanation,item_financeiro_id,lancamento_caixa_id,confirmed_at,created_at')
        .eq('empresa_id', auth.empresaId)
        .in('extrato_transacao_id', extratoIds);

      if (conciliationError) {
        throw new Error(`Falha ao carregar conciliações: ${conciliationError.message}`);
      }

      conciliationByTx = new Map<string, ConciliationRow[]>();
      for (const row of (conciliationRaw || []) as Array<Record<string, unknown>>) {
        const txId = String(row.extrato_transacao_id || '');
        const current = conciliationByTx.get(txId) || [];
        current.push({
          id: String(row.id || ''),
          extrato_transacao_id: txId,
          status: String(row.status || 'suggested') as ConciliationRow['status'],
          method: String(row.method || 'manual') as ConciliationRow['method'],
          explanation: row.explanation ? String(row.explanation) : null,
          item_financeiro_id: row.item_financeiro_id ? String(row.item_financeiro_id) : null,
          lancamento_caixa_id: row.lancamento_caixa_id ? String(row.lancamento_caixa_id) : null,
          confirmed_at: row.confirmed_at ? String(row.confirmed_at) : null,
          created_at: row.created_at ? String(row.created_at) : null,
        });
        conciliationByTx.set(txId, current);
      }

      const { data: suggestionRaw, error: suggestionError } = await adminClient
        .from('bank_ai_suggestions')
        .select('id,extrato_transacao_id,suggestion_action,status,confidence,explanation,item_financeiro_id,lancamento_caixa_id,created_at')
        .eq('empresa_id', auth.empresaId)
        .in('extrato_transacao_id', extratoIds);

      if (suggestionError) {
        throw new Error(`Falha ao carregar sugestões de IA: ${suggestionError.message}`);
      }

      suggestionByTx = new Map<string, SuggestionRow[]>();
      for (const row of (suggestionRaw || []) as Array<Record<string, unknown>>) {
        const txId = String(row.extrato_transacao_id || '');
        const current = suggestionByTx.get(txId) || [];
        current.push({
          id: String(row.id || ''),
          extrato_transacao_id: txId,
          suggestion_action: String(row.suggestion_action || 'needs_review') as SuggestionRow['suggestion_action'],
          status: String(row.status || 'suggested') as SuggestionRow['status'],
          confidence: row.confidence == null ? null : toNumber(row.confidence, 0),
          explanation: row.explanation ? String(row.explanation) : null,
          item_financeiro_id: row.item_financeiro_id ? String(row.item_financeiro_id) : null,
          lancamento_caixa_id: row.lancamento_caixa_id ? String(row.lancamento_caixa_id) : null,
          created_at: row.created_at ? String(row.created_at) : null,
        });
        suggestionByTx.set(txId, current);
      }
    }

    const suggestedItemIds = Array.from(
      new Set(
        transactions.flatMap((tx) => {
          const suggestion = pickBestSuggestion(suggestionByTx.get(tx.id) || []);
          const conciliation = pickBestConciliation(conciliationByTx.get(tx.id) || []);
          return [suggestion?.item_financeiro_id || '', conciliation?.item_financeiro_id || ''].filter(Boolean);
        })
      )
    );

    let itemsById = new Map<string, MatchingLancamentoCandidate>();
    if (suggestedItemIds.length > 0) {
      const { data: itemRaw, error: itemError } = await adminClient
        .from('conciliacao_itens_financeiros')
        .select('id,conta_bancaria_id,data,tipo,valor_centavos,descricao_exibicao,documento,origem_tipo,origem_id_uuid,origem_id_bigint')
        .eq('empresa_id', auth.empresaId)
        .eq('ativo', true)
        .in('id', suggestedItemIds);

      if (itemError) {
        throw new Error(`Falha ao carregar itens financeiros sugeridos: ${itemError.message}`);
      }

      itemsById = new Map(
        ((itemRaw || []) as Array<Record<string, unknown>>).map((row) => [
          String(row.id || ''),
          {
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
          } satisfies MatchingLancamentoCandidate,
        ])
      );
    }

    const { data: aiRunRaw } = await adminClient
      .from('bank_ai_execution_runs')
      .select('status')
      .eq('empresa_id', auth.empresaId)
      .eq('conta_bancaria_id', contaBancariaId)
      .eq('extrato_import_id', importId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let duplicateSuspect = false;
    if (importRow.file_sha256 && importRow.periodo_inicio && importRow.periodo_fim) {
      const { data: duplicateRaw } = await adminClient
        .from('extratos_import')
        .select('id')
        .eq('empresa_id', auth.empresaId)
        .eq('conta_bancaria_id', contaBancariaId)
        .eq('file_sha256', importRow.file_sha256)
        .eq('periodo_inicio', importRow.periodo_inicio)
        .eq('periodo_fim', importRow.periodo_fim);

      duplicateSuspect = ((duplicateRaw || []) as unknown[]).length > 1;
    }

    const manualCreationAllowed = !isBankReconciliationBalanceMutationDisabled();

    const hasPostConciliationArtifacts =
      conciliationByTx.size > 0 ||
      suggestionByTx.size > 0 ||
      Boolean(aiRunRaw?.status);
    const presentationMode: ConciliationWorkspaceResponse['summary']['presentation_mode'] =
      hasPostConciliationArtifacts ? 'post_conciliation' : 'pre_conciliation';

    const rows: ConciliationWorkspaceRow[] = transactions.map((tx) => {
      const suggestion = pickBestSuggestion(suggestionByTx.get(tx.id) || []);
      const conciliation = pickBestConciliation(conciliationByTx.get(tx.id) || []);
      const targetItemId = suggestion?.item_financeiro_id || conciliation?.item_financeiro_id || null;
      const candidate = targetItemId ? itemsById.get(targetItemId) || null : null;
      const candidateSummary =
        candidate
          ? sortCandidatesForWorkspace(tx, [candidate])[0] || null
          : null;
      const state = resolveRowState(conciliation, suggestion);
      const pattern = classifyWorkspacePattern(tx.descricao_raw);
      const hasLancamento = Boolean(
        conciliation?.lancamento_caixa_id ||
          candidateSummary?.lancamento_caixa_id ||
          suggestion?.lancamento_caixa_id
      );

      return {
        extrato_transacao_id: tx.id,
        extrato_import_id: tx.extrato_import_id,
        line_number: tx.line_number,
        data_movimento: tx.data_movimento,
        descricao: tx.descricao_raw,
        documento_ref: tx.documento_ref,
        valor_centavos: tx.valor_centavos,
        tipo: tx.tipo,
        state,
        group_key: `${state}:${pattern.key}`,
        group_label: pattern.label,
        actions_allowed: resolveActionsAllowed({
          state,
          hasCandidate: Boolean(candidateSummary),
          hasLancamento,
          hasConciliation: Boolean(conciliation?.id),
          manualCreationAllowed,
        }),
        candidate_count: candidateSummary ? 1 : 0,
        safe_auto_match: Boolean(candidateSummary?.strict_value_date_direction_match),
        conciliation: conciliation
          ? {
              id: conciliation.id,
              status: conciliation.status,
              method: conciliation.method,
              explanation: conciliation.explanation,
              item_financeiro_id: conciliation.item_financeiro_id,
              lancamento_caixa_id: conciliation.lancamento_caixa_id,
              confirmed_at: conciliation.confirmed_at,
              created_at: conciliation.created_at,
            }
          : null,
        ai_suggestion: suggestion
          ? {
              id: suggestion.id,
              action: suggestion.suggestion_action,
              status: suggestion.status,
              confidence: suggestion.confidence,
              explanation: suggestion.explanation,
              item_financeiro_id: suggestion.item_financeiro_id,
              lancamento_caixa_id: suggestion.lancamento_caixa_id,
            }
          : null,
        suggested_candidate: candidateSummary,
      };
    });

    const stateOrder: ConciliationWorkspaceRowState[] = [
      'em_revisao',
      'pendente',
      'divergente',
      'ignorado',
      'conciliado',
    ];

    const groupMap = new Map<string, ConciliationWorkspaceGroup>();
    for (const row of rows) {
      const key = row.group_key;
      const current = groupMap.get(key);
      if (current) {
        current.row_ids.push(row.extrato_transacao_id);
        current.total += 1;
        continue;
      }
      groupMap.set(key, {
        id: key,
        label:
          row.state === 'em_revisao' || row.state === 'pendente'
            ? row.group_label
            : row.state === 'conciliado'
              ? 'Itens conciliados'
              : row.state === 'divergente'
                ? 'Divergências registradas'
                : 'Itens ignorados',
        state: row.state,
        total: 1,
        row_ids: [row.extrato_transacao_id],
      });
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => {
      const stateDiff = stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state);
      if (stateDiff !== 0) return stateDiff;
      return a.label.localeCompare(b.label);
    });

    const counters = rows.reduce(
      (acc, row) => {
        if (row.state === 'pendente') acc.pendente += 1;
        if (row.state === 'em_revisao') acc.em_revisao += 1;
        if (row.state === 'conciliado') acc.conciliado += 1;
        if (row.state === 'divergente') acc.divergente += 1;
        if (row.state === 'ignorado') acc.ignorado += 1;
        if (row.safe_auto_match) acc.safe_match += 1;
        if (!row.suggested_candidate) acc.sem_vinculo += 1;
        return acc;
      },
      {
        pendente: 0,
        em_revisao: 0,
        conciliado: 0,
        divergente: 0,
        ignorado: 0,
        safe_match: 0,
        sem_vinculo: 0,
      }
    );

    const defaultRow =
      rows.find((row) => row.state === 'em_revisao') ||
      rows.find((row) => row.state === 'pendente') ||
      rows[0] ||
      null;

    const responseData: ConciliationWorkspaceResponse = {
      summary: {
        conta_bancaria_id: contaBancariaId,
        conta_label: contaRow.descricao ? String(contaRow.descricao) : null,
        import_id: importId,
        presentation_mode: presentationMode,
        import_parse_status: importRow.parse_status,
        import_file_format: importRow.file_format,
        original_filename: importRow.original_filename,
        periodo_inicio: importRow.periodo_inicio,
        periodo_fim: importRow.periodo_fim,
        saldo_final_centavos: resolveSaldoFinalCentavos(importRow),
        duplicate_suspect: duplicateSuspect,
        ai_status: aiRunRaw?.status ? String(aiRunRaw.status) : null,
        manual_creation_allowed: manualCreationAllowed,
        total_rows: rows.length,
      },
      counters,
      groups,
      rows,
      default_row_id: defaultRow?.extrato_transacao_id || null,
    };

    return res.status(200).json({
      ok: true,
      data: responseData,
    });
  } catch (error: unknown) {
    console.error('[bank-reconciliation][workspace]', error);
    return res.status(422).json({
      error: 'Workspace error',
      message: 'Falha ao carregar a importação selecionada para a lista de conciliação.',
    });
  }
}
