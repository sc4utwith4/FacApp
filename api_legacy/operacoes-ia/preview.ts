import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../src/server/bank-statement/_shared.js';
import {
  buildDraftItemFromImport,
  isConflictOverrideDuplicateTestEnabled,
  isDuplicateTestModeEnabled,
  refreshSoiOriginPayloadIfNeeded,
  resolveDuplicateOriginImport,
  type OperationIaContaBancariaRow,
  safeInsertIntegrationAuditLog,
  type OperationIaEstoqueRow,
  type OperationIaFornecedorRow,
  type OperationIaImportRow,
} from '../../src/server/operacoes-ia/core.js';
import {
  buildHistoryRowsFromDiagnostics,
  groupHistoryTimelineByImport,
  insertExtractionHistoryRows,
  normalizeExtractionDiagnosticsFromPayload,
} from '../../src/server/operacoes-ia/extractionHistory.js';
import type {
  OperationIaBatchPreviewRequest,
  OperationIaBatchPreviewResponse,
} from '../../src/types/operacoes-ia.js';

const SOURCE = 'disecurit';

const uniqueIds = (values: string[]): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    ordered.push(normalized);
  }
  return ordered;
};

const normalizeReferenceDateInput = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
};

const normalizeText = (value?: string | null): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

const summarize = (items: OperationIaBatchPreviewResponse['items']) => {
  const summary = {
    total: items.length,
    ready: 0,
    review: 0,
    error: 0,
    linked: 0,
    auto_supplier_suggested: 0,
  };

  for (const item of items) {
    if (item.status === 'ready') summary.ready += 1;
    if (item.status === 'review') summary.review += 1;
    if (item.status === 'error') summary.error += 1;
    if (item.linked_operacao_id) summary.linked += 1;
    if (item.fornecedor_match_method === 'cnpj' || item.fornecedor_match_method === 'name_fuzzy') {
      summary.auto_supplier_suggested += 1;
    }
  }

  return summary;
};

const HISTORY_FIELDS =
  'id,import_file_id,line_index,field_name,raw_value,normalized_value,source_method,confidence,conflict_flag,status,actor_user_id,metadata,created_at';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', message: 'Use POST para gerar o preview.' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variáveis do Supabase não configuradas para Operações com IA.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Sessão expirada. Faça login novamente.' });
  }

  let body: OperationIaBatchPreviewRequest;
  try {
    body = (parseJsonBody(req) || {}) as OperationIaBatchPreviewRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo inválido.' });
  }

  const importIds = uniqueIds(Array.isArray(body.import_file_ids) ? body.import_file_ids : []);
  const referenceDate = normalizeReferenceDateInput(body.reference_date);
  if (!importIds.length) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Informe ao menos um import_file_id para gerar o preview.',
    });
  }

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Não foi possível validar a sessão.'),
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  const { data: importsData, error: importsError } = await adminClient
    .from('operation_import_files')
    .select(
      'id,empresa_id,source,parse_status,parsed_payload,linked_operacao_id,operation_number,original_filename,file_sha256,program_hint,created_at,raw_text'
    )
    .eq('empresa_id', auth.empresaId)
    .eq('source', SOURCE)
    .in('id', importIds);

  if (importsError) {
    return res.status(500).json({
      error: 'Preview error',
      message: `Falha ao carregar imports para preview: ${importsError.message}`,
    });
  }

  const importsRows = (importsData || []) as OperationIaImportRow[];
  const importsById = new Map(importsRows.map((row) => [row.id, row]));
  const duplicateTestModeEnabled = isDuplicateTestModeEnabled();
  const conflictOverrideDuplicateTestEnabled = isConflictOverrideDuplicateTestEnabled();

  const { data: fornecedoresData, error: fornecedoresError } = await adminClient
    .from('fornecedores')
    .select('id,razao_social,nome_fantasia,cnpj,status')
    .eq('empresa_id', auth.empresaId)
    .eq('status', true)
    .order('razao_social', { ascending: true });

  if (fornecedoresError) {
    return res.status(500).json({
      error: 'Preview error',
      message: `Falha ao carregar fornecedores: ${fornecedoresError.message}`,
    });
  }

  const fornecedores = (fornecedoresData || []) as OperationIaFornecedorRow[];

  const { data: estoquesData, error: estoquesError } = await adminClient
    .from('estoques')
    .select('id,tipo,descricao,ativo')
    .eq('empresa_id', auth.empresaId)
    .eq('ativo', true)
    .order('descricao', { ascending: true });

  if (estoquesError) {
    return res.status(500).json({
      error: 'Preview error',
      message: `Falha ao carregar estoques: ${estoquesError.message}`,
    });
  }

  const estoques = (estoquesData || []) as OperationIaEstoqueRow[];

  const { data: contasData, error: contasError } = await adminClient
    .from('contas_bancarias')
    .select('id,descricao,status')
    .eq('empresa_id', auth.empresaId)
    .eq('status', true)
    .order('descricao', { ascending: true });

  if (contasError) {
    return res.status(500).json({
      error: 'Preview error',
      message: `Falha ao carregar contas bancárias: ${contasError.message}`,
    });
  }

  const contasBancarias = ((contasData || []) as OperationIaContaBancariaRow[]).map((row) => ({
    id: row.id,
    descricao: row.descricao || `Conta ${row.id.slice(0, 8)}…`,
  }));

  const defaultContaBancariaId =
    contasBancarias.find((conta) => normalizeText(conta.descricao).includes('SB-S0I2'))?.id ||
    contasBancarias[0]?.id ||
    null;

  const loadHistoryMap = async () => {
    const { data, error } = await adminClient
      .from('operation_import_extraction_history')
      .select(HISTORY_FIELDS)
      .eq('empresa_id', auth.empresaId)
      .in('import_file_id', importIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(importIds.length * 25, 100));

    if (error) {
      console.error('[operacoes-ia][preview][history]', error);
      return new Map<string, OperationIaBatchPreviewResponse['items'][number]['history_timeline']>();
    }

    return groupHistoryTimelineByImport((data || []) as Array<Record<string, unknown>>);
  };

  let historyByImport = await loadHistoryMap();

  const importsWithoutHistory = importsRows.filter((row) => {
    const history = historyByImport.get(row.id) || [];
    return history.length === 0;
  });
  if (importsWithoutHistory.length > 0) {
    const baselineRows = importsWithoutHistory.flatMap((row) => {
      const diagnostics = normalizeExtractionDiagnosticsFromPayload(
        (row.parsed_payload || null) as Record<string, unknown> | null
      );
      return buildHistoryRowsFromDiagnostics({
        empresaId: auth.empresaId,
        importFileId: row.id,
        diagnostics,
        phase: 'preview',
        actorUserId: auth.userId,
      });
    });

    if (baselineRows.length > 0) {
      await insertExtractionHistoryRows(adminClient, baselineRows);
      historyByImport = await loadHistoryMap();
    }
  }

  const items: OperationIaBatchPreviewResponse['items'] = [];
  for (const importId of importIds) {
    const row = importsById.get(importId);
    const historyTimeline = historyByImport.get(importId) || [];
    if (!row) {
      items.push({
        id: `item:${importId}`,
        import_file_id: importId,
        source_type: 'disecurit_pdf',
        parse_status: 'missing',
        original_filename: null,
        operation_number: null,
        file_sha256: null,
        linked_operacao_id: null,
        program: null,
        estoque_id: null,
        fornecedor_id: null,
        fornecedor_match_method: 'none',
        fornecedor_match_confidence: null,
        conta_bancaria_id: defaultContaBancariaId,
        data_operacao: null,
        documento: null,
        historico: null,
        face_titulos: null,
        valor_compra: null,
        despesas: null,
        recompra: null,
        ad_valorem: null,
        iss: null,
        iof: null,
        iof_adicional: null,
        amortizacao_debitos: null,
        amortizacao_creditos: null,
        raw_pdf_snapshot: [],
        extraction_diagnostics: [],
        has_critical_conflict: false,
        history_timeline: historyTimeline,
        status: 'error',
        issues: ['Import não encontrado para a empresa/scope atual.'],
      } as OperationIaBatchPreviewResponse['items'][number]);
      continue;
    }

    const baseDraftResolution =
      duplicateTestModeEnabled && row.parse_status === 'duplicate'
        ? await resolveDuplicateOriginImport(adminClient, auth.empresaId, row, SOURCE)
        : null;

    let sourceImportForDraft = baseDraftResolution?.source_import_row || row;
    let duplicateHydrationStatus = baseDraftResolution?.duplicate_hydration_status || 'missing';
    let duplicateHydrationResolutionMethod =
      baseDraftResolution?.duplicate_hydration_resolution_method || baseDraftResolution?.resolution_method || 'none';
    let duplicateAutoReparseStatus: 'ok' | 'source_stale' | 'auto_reparse_pending' = 'ok';

    if (duplicateTestModeEnabled && row.parse_status === 'duplicate' && sourceImportForDraft?.id) {
      const refreshResult = await refreshSoiOriginPayloadIfNeeded(adminClient, sourceImportForDraft);
      sourceImportForDraft = refreshResult.row;
      duplicateAutoReparseStatus = refreshResult.status;
      if (refreshResult.status !== 'ok') {
        duplicateHydrationStatus = 'missing';
        if (sourceImportForDraft.id !== row.id) {
          sourceImportForDraft = row;
          duplicateHydrationResolutionMethod = 'none';
        }
      }
      if (refreshResult.refreshed) {
        duplicateHydrationResolutionMethod =
          duplicateHydrationResolutionMethod && duplicateHydrationResolutionMethod !== 'none'
            ? duplicateHydrationResolutionMethod
            : 'audit';
      }
    }

    const sourceImportForBuild = {
      ...sourceImportForDraft,
      parse_status: row.parse_status,
      linked_operacao_id: row.linked_operacao_id,
    };
    const draftItem = {
      ...buildDraftItemFromImport(sourceImportForBuild, fornecedores, estoques, {
        referenceDate,
        defaultContaBancariaId,
      }),
      id: `item:${row.id}`,
      import_file_id: row.id,
      parse_status: row.parse_status,
      original_filename: row.original_filename || sourceImportForDraft.original_filename,
      operation_number: row.operation_number || sourceImportForDraft.operation_number,
      file_sha256: row.file_sha256 || sourceImportForDraft.file_sha256,
      linked_operacao_id: row.linked_operacao_id,
      history_timeline: historyTimeline,
    };

    if (duplicateTestModeEnabled && row.parse_status === 'duplicate') {
      const filteredIssues = (draftItem.issues || []).filter(
        (issue) => !issue.includes('Import em status duplicate')
      );
      const duplicateOriginImportFileId =
        duplicateHydrationStatus === 'hydrated'
          ? baseDraftResolution?.duplicate_origin_import_file_id || sourceImportForDraft.id || null
          : null;
      const duplicateIssue =
        duplicateHydrationStatus === 'hydrated' && duplicateAutoReparseStatus === 'ok'
          ? 'Import marcado como duplicado. Modo teste ativo: confirme com force_create e justificativa.'
          : duplicateAutoReparseStatus === 'source_stale'
            ? 'Import duplicado sem origem confiável para hidratação. Reimporte/reprocesse o arquivo original antes de confirmar.'
            : duplicateAutoReparseStatus === 'auto_reparse_pending'
              ? 'Origem encontrada, mas auto-reparse não concluiu fórmula SOI V2. Reprocesse o import antes de confirmar.'
              : 'Import duplicado sem origem confiável para hidratação. Reimporte/reprocesse o arquivo original antes de confirmar.';
      const issues = Array.from(
        new Set([
          ...filteredIssues,
          duplicateIssue,
        ])
      );

      items.push({
        ...draftItem,
        status: 'review' as const,
        issues,
        duplicate_origin_import_file_id: duplicateOriginImportFileId,
        duplicate_hydration_status: duplicateHydrationStatus,
        duplicate_hydration_resolution_method: duplicateHydrationResolutionMethod,
      });
      continue;
    }

    items.push({
      ...draftItem,
      duplicate_origin_import_file_id: null,
      duplicate_hydration_status: null,
      duplicate_hydration_resolution_method: null,
    });
  }

  const response: OperationIaBatchPreviewResponse = {
    ok: true,
    batch_id: `opsia_${Date.now()}`,
    generated_at: new Date().toISOString(),
    meta: {
      duplicate_test_mode_enabled: duplicateTestModeEnabled,
      conflict_override_duplicate_test_enabled: conflictOverrideDuplicateTestEnabled,
    },
    contas_bancarias: contasBancarias,
    default_conta_bancaria_id: defaultContaBancariaId,
    summary: summarize(items),
    items,
  };

  await safeInsertIntegrationAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    source: SOURCE,
    event_type: 'operations_ia_preview_generated',
    status: 'success',
    message: `Preview gerado para ${importIds.length} import(s).`,
    details: {
      import_file_ids: importIds,
      reference_date: referenceDate,
      default_conta_bancaria_id: defaultContaBancariaId,
      duplicate_test_mode_enabled: duplicateTestModeEnabled,
      summary: response.summary,
      user_id: auth.userId,
    },
  });

  return res.status(200).json(response);
}
