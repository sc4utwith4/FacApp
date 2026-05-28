import type { SupabaseClient } from '@supabase/supabase-js';
import { isBankReconciliationOfxOnlyEnabled } from '../_shared.js';

export interface ChatContextInput {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId?: string | null;
}

export interface ChatStatusCounts {
  pendente: number;
  sugerido: number;
  conciliado: number;
  divergente: number;
}

export interface ChatPendingExample {
  extrato_transacao_id: string;
  descricao: string;
  valor_centavos: number;
  data_movimento: string;
}

export interface ChatContextSnapshot {
  empresa_id: string;
  conta_bancaria_id: string;
  conta_label: string | null;
  data_referencia: string;
  import_id: string | null;
  import_source: string | null;
  import_file_format: string | null;
  import_periodo_inicio?: string | null;
  import_periodo_fim?: string | null;
  ofx_required: boolean;
  ofx_required_reason: string | null;
  import_parse_status: string | null;
  import_error_message: string | null;
  status_counts: ChatStatusCounts;
  pendencias_criticas: number;
  pending_examples: ChatPendingExample[];
  daily_summary: Record<string, unknown> | null;
}

type ImportRow = {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  source: string;
  file_format: string;
  parse_status: string;
  error_message: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  created_at: string;
};

type TxRow = {
  id: string;
  data_movimento: string;
  descricao_raw: string;
  valor_centavos: number;
};

type ConciliacaoRow = {
  extrato_transacao_id: string;
  status: 'suggested' | 'confirmed' | 'rejected';
};

interface ResolveImportRowResult {
  row: ImportRow | null;
  ofxRequiredReason: string | null;
}

const toDateOnly = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, 10) : null;
};

const resolveDate = (value: string | null | undefined): string => {
  const dateOnly = toDateOnly(value);
  if (dateOnly) return dateOnly;
  return new Date().toISOString().slice(0, 10);
};

const buildStatusCounts = (txRows: TxRow[], concRows: ConciliacaoRow[]): {
  counts: ChatStatusCounts;
  pendingExamples: ChatPendingExample[];
} => {
  const statusByTx = new Map<string, Set<ConciliacaoRow['status']>>();

  for (const row of concRows) {
    if (!statusByTx.has(row.extrato_transacao_id)) {
      statusByTx.set(row.extrato_transacao_id, new Set());
    }
    statusByTx.get(row.extrato_transacao_id)?.add(row.status);
  }

  const counts: ChatStatusCounts = {
    pendente: 0,
    sugerido: 0,
    conciliado: 0,
    divergente: 0,
  };

  const pendingExamples: ChatPendingExample[] = [];

  for (const tx of txRows) {
    const statuses = statusByTx.get(tx.id) || new Set();

    if (statuses.has('confirmed')) {
      counts.conciliado += 1;
      continue;
    }

    if (statuses.has('suggested')) {
      counts.sugerido += 1;
      continue;
    }

    if (statuses.has('rejected')) {
      counts.divergente += 1;
      continue;
    }

    counts.pendente += 1;
    if (pendingExamples.length < 5) {
      pendingExamples.push({
        extrato_transacao_id: tx.id,
        descricao: tx.descricao_raw,
        valor_centavos: tx.valor_centavos,
        data_movimento: tx.data_movimento,
      });
    }
  }

  return { counts, pendingExamples };
};

async function fetchContaLabel(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
}): Promise<string | null> {
  const { data, error } = await args.adminClient
    .from('contas_bancarias')
    .select('id,descricao,empresa_id')
    .eq('id', args.contaBancariaId)
    .eq('empresa_id', args.empresaId)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao validar conta bancaria: ${error.message}`);
  }

  if (!data) {
    throw new Error('Conta bancaria nao encontrada para a empresa.');
  }

  return data.descricao || null;
}

async function resolveImportRow(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId?: string | null;
}): Promise<ResolveImportRowResult> {
  const { adminClient, empresaId, contaBancariaId, dataReferencia, importId } = args;
  const ofxOnlyEnabled = isBankReconciliationOfxOnlyEnabled();

  if (importId) {
    const { data, error } = await adminClient
      .from('extratos_import')
      .select('id,empresa_id,conta_bancaria_id,source,file_format,parse_status,error_message,periodo_inicio,periodo_fim,created_at')
      .eq('id', importId)
      .eq('empresa_id', empresaId)
      .eq('conta_bancaria_id', contaBancariaId)
      .maybeSingle();

    if (error) {
      throw new Error(`Falha ao validar importacao: ${error.message}`);
    }

    if (data) {
      const importRow = data as ImportRow;
      if (ofxOnlyEnabled && String(importRow.file_format || '').toLowerCase() !== 'ofx') {
        return {
          row: null,
          ofxRequiredReason: 'selected_import_not_ofx',
        };
      }

      return {
        row: importRow,
        ofxRequiredReason: null,
      };
    }
  }

  let periodQuery = adminClient
    .from('extratos_import')
    .select('id,empresa_id,conta_bancaria_id,source,file_format,parse_status,error_message,periodo_inicio,periodo_fim,created_at')
    .eq('empresa_id', empresaId)
    .eq('conta_bancaria_id', contaBancariaId)
    .eq('parse_status', 'parsed')
    .lte('periodo_inicio', dataReferencia)
    .gte('periodo_fim', dataReferencia)
    .order('created_at', { ascending: false })
    .limit(1);

  if (ofxOnlyEnabled) {
    periodQuery = periodQuery.eq('file_format', 'ofx');
  }

  const { data: periodRows, error: periodError } = await periodQuery;

  if (periodError) {
    throw new Error(`Falha ao buscar importacao por periodo: ${periodError.message}`);
  }

  if (periodRows && periodRows.length > 0) {
    return {
      row: periodRows[0] as ImportRow,
      ofxRequiredReason: null,
    };
  }

  let createdQuery = adminClient
    .from('extratos_import')
    .select('id,empresa_id,conta_bancaria_id,source,file_format,parse_status,error_message,periodo_inicio,periodo_fim,created_at')
    .eq('empresa_id', empresaId)
    .eq('conta_bancaria_id', contaBancariaId)
    .gte('created_at', `${dataReferencia}T00:00:00`)
    .lt('created_at', `${dataReferencia}T23:59:59.999`)
    .order('created_at', { ascending: false })
    .limit(1);

  if (ofxOnlyEnabled) {
    createdQuery = createdQuery.eq('file_format', 'ofx');
  }

  const { data: createdRows, error: createdError } = await createdQuery;

  if (createdError) {
    throw new Error(`Falha ao buscar importacao do dia: ${createdError.message}`);
  }

  if (createdRows && createdRows.length > 0) {
    return {
      row: createdRows[0] as ImportRow,
      ofxRequiredReason: null,
    };
  }

  let fallbackQuery = adminClient
    .from('extratos_import')
    .select('id,empresa_id,conta_bancaria_id,source,file_format,parse_status,error_message,periodo_inicio,periodo_fim,created_at')
    .eq('empresa_id', empresaId)
    .eq('conta_bancaria_id', contaBancariaId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (ofxOnlyEnabled) {
    fallbackQuery = fallbackQuery.eq('file_format', 'ofx');
  }

  const { data: fallbackRows, error: fallbackError } = await fallbackQuery;

  if (fallbackError) {
    throw new Error(`Falha ao buscar ultimo import: ${fallbackError.message}`);
  }

  if (fallbackRows && fallbackRows[0]) {
    return {
      row: fallbackRows[0] as ImportRow,
      ofxRequiredReason: null,
    };
  }

  return {
    row: null,
    ofxRequiredReason: ofxOnlyEnabled ? 'no_ofx_import_available' : null,
  };
}

async function loadTransactionsAndCounts(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
  importId: string | null;
}): Promise<{ counts: ChatStatusCounts; pendingExamples: ChatPendingExample[] }> {
  const { adminClient, empresaId, contaBancariaId, dataReferencia, importId } = args;

  let txQuery = adminClient
    .from('extrato_transacoes')
    .select('id,data_movimento,descricao_raw,valor_centavos')
    .eq('empresa_id', empresaId)
    .eq('conta_bancaria_id', contaBancariaId)
    .order('data_movimento', { ascending: true })
    .order('line_number', { ascending: true })
    .limit(3000);

  if (importId) {
    txQuery = txQuery.eq('extrato_import_id', importId);
  } else {
    txQuery = txQuery.eq('data_movimento', dataReferencia);
  }

  const { data: txRowsRaw, error: txError } = await txQuery;

  if (txError) {
    throw new Error(`Falha ao carregar transacoes de extrato: ${txError.message}`);
  }

  const txRows = (txRowsRaw || []) as TxRow[];

  if (!txRows.length) {
    return {
      counts: { pendente: 0, sugerido: 0, conciliado: 0, divergente: 0 },
      pendingExamples: [],
    };
  }

  const txIds = txRows.map((tx) => tx.id);

  const { data: concRowsRaw, error: concError } = await adminClient
    .from('conciliacoes_bancarias')
    .select('extrato_transacao_id,status')
    .eq('empresa_id', empresaId)
    .in('extrato_transacao_id', txIds);

  if (concError) {
    throw new Error(`Falha ao carregar conciliacoes: ${concError.message}`);
  }

  return buildStatusCounts(txRows, (concRowsRaw || []) as ConciliacaoRow[]);
}

async function loadDailySummary(args: {
  adminClient: SupabaseClient;
  empresaId: string;
  contaBancariaId: string;
  dataReferencia: string;
}): Promise<Record<string, unknown> | null> {
  const { data, error } = await args.adminClient.rpc('fn_bank_daily_summary', {
    p_empresa_id: args.empresaId,
    p_conta_id: args.contaBancariaId,
    p_data: args.dataReferencia,
  });

  if (error) {
    throw new Error(`Falha ao montar resumo diario: ${error.message}`);
  }

  if (!data || typeof data !== 'object') return null;
  return data as Record<string, unknown>;
}

export async function buildBankReconciliationChatContext(
  input: ChatContextInput
): Promise<ChatContextSnapshot> {
  const { adminClient, empresaId, contaBancariaId } = input;
  const dataReferencia = resolveDate(input.dataReferencia);

  const contaLabel = await fetchContaLabel({
    adminClient,
    empresaId,
    contaBancariaId,
  });

  const importResolution = await resolveImportRow({
    adminClient,
    empresaId,
    contaBancariaId,
    dataReferencia,
    importId: input.importId || null,
  });
  const importRow = importResolution.row;
  const ofxRequiredReason = importResolution.ofxRequiredReason;
  const ofxRequired = Boolean(ofxRequiredReason);

  const countsData = ofxRequired
    ? {
        counts: { pendente: 0, sugerido: 0, conciliado: 0, divergente: 0 } as ChatStatusCounts,
        pendingExamples: [] as ChatPendingExample[],
      }
    : await loadTransactionsAndCounts({
        adminClient,
        empresaId,
        contaBancariaId,
        dataReferencia,
        importId: importRow?.id || null,
      });

  const dailySummary = await loadDailySummary({
    adminClient,
    empresaId,
    contaBancariaId,
    dataReferencia,
  });

  const pendenciasCriticas = Number(dailySummary?.pendencias_criticas_total || 0);

  return {
    empresa_id: empresaId,
    conta_bancaria_id: contaBancariaId,
    conta_label: contaLabel,
    data_referencia: dataReferencia,
    import_id: importRow?.id || null,
    import_source: importRow?.source || null,
    import_file_format: importRow?.file_format || null,
    import_periodo_inicio: importRow?.periodo_inicio || null,
    import_periodo_fim: importRow?.periodo_fim || null,
    ofx_required: ofxRequired,
    ofx_required_reason: ofxRequiredReason,
    import_parse_status: importRow?.parse_status || null,
    import_error_message: importRow?.error_message || null,
    status_counts: countsData.counts,
    pendencias_criticas: Number.isFinite(pendenciasCriticas) ? pendenciasCriticas : 0,
    pending_examples: countsData.pendingExamples,
    daily_summary: dailySummary,
  };
}
