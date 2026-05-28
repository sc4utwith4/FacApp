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
  buildInsertPayloadFromConfirmItem,
  buildOperationImportDocumentRows,
  clampPercent,
  evaluateConfirmPayloadIssues,
  evaluateDuplicateFlags,
  isConflictOverrideDuplicateTestEnabled,
  isDuplicateTestModeEnabled,
  normalizeComparableText,
  refreshSoiOriginPayloadIfNeeded,
  resolveDuplicateOriginImport,
  safeInsertIntegrationAuditLog,
  summarizeDuplicateFlags,
  toDateOnly,
  toNumber,
  type OperationIaContaBancariaRow,
  type OperationIaEstoqueRow,
  type OperationIaFornecedorRow,
  type OperationIaImportRow,
} from '../../src/server/operacoes-ia/core.js';
import {
  buildManualCorrectionRowsFromPayload,
  insertExtractionHistoryRows,
  normalizeExtractionDiagnosticsFromPayload,
  type OperationImportExtractionHistoryInsertRow,
} from '../../src/server/operacoes-ia/extractionHistory.js';
import type {
  OperationIaBatchConfirmItem,
  OperationIaBatchConfirmRequest,
  OperationIaBatchConfirmResponse,
  OperationIaBatchConfirmResultItem,
} from '../../src/types/operacoes-ia.js';

const SOURCE = 'disecurit';

const unique = <T>(values: T[]): T[] => Array.from(new Set(values));

const trimOrNull = (value?: string | null): string | null => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const resolveHybridTolerance = (...values: Array<number | null | undefined>): number => {
  const base = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce((max, current) => Math.max(max, Math.abs(current)), 0);
  return Math.max(0.5, Number((base * 0.002).toFixed(2)));
};

const resolveConflictFieldLabel = (fieldName: string): string => {
  if (fieldName === 'face_value') return 'Face dos títulos';
  if (fieldName === 'purchase_value') return 'Valor de compra';
  if (fieldName === 'net_value') return 'Líquido';
  return fieldName;
};

const toUniqueFiniteNumbers = (values: Array<number | null | undefined>): number[] => {
  const uniqueValues = new Set<number>();
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    uniqueValues.add(Number(value.toFixed(2)));
  }
  return [...uniqueValues];
};

const resolveSoiFormulaPayload = (payload: OperationIaBatchConfirmItem['payload']) => {
  const valorOriginal = toNumber(payload.soi_formula?.valor_original) ?? toNumber(payload.face_titulos) ?? null;
  const valorDesagio = toNumber(payload.soi_formula?.valor_desagio) ?? toNumber(payload.valor_compra) ?? null;
  const valorDesagioAntecipacao =
    toNumber(payload.soi_formula?.valor_desagio_antecipacao) ?? 0;
  const despesas = toNumber(payload.soi_formula?.despesas) ?? 0;
  const regresso = toNumber(payload.soi_formula?.regresso) ?? toNumber(payload.recompra) ?? 0;
  const amortizaDebitos =
    toNumber(payload.soi_formula?.amortiza_debitos) ?? 0;
  const amortizaCreditos =
    toNumber(payload.soi_formula?.amortiza_creditos) ?? toNumber(payload.amortizacao_creditos) ?? 0;
  const creditosGerados =
    toNumber(payload.soi_formula?.creditos_gerados) ?? toNumber(payload.amortizacao_debitos) ?? 0;
  const liquidoLiberado =
    toNumber(payload.soi_formula?.liquido_liberado) ?? toNumber(payload.valor_compra) ?? null;

  return {
    valor_original: valorOriginal,
    valor_desagio: valorDesagio,
    valor_desagio_antecipacao: valorDesagioAntecipacao,
    despesas,
    regresso,
    amortiza_debitos: amortizaDebitos,
    amortiza_creditos: amortizaCreditos,
    creditos_gerados: creditosGerados,
    liquido_liberado: liquidoLiberado,
  };
};

const resolveSpproFormulaPayload = (payload: OperationIaBatchConfirmItem['payload']) => {
  const quantidadeTitulos = toNumber(payload.sppro_formula?.quantidade_titulos) ?? null;
  const valorFace = toNumber(payload.sppro_formula?.valor_face) ?? toNumber(payload.face_titulos) ?? null;
  const valorCompra = toNumber(payload.sppro_formula?.valor_compra) ?? toNumber(payload.valor_compra) ?? null;
  const adValorem = toNumber(payload.sppro_formula?.ad_valorem) ?? toNumber(payload.ad_valorem) ?? 0;
  const iss = toNumber(payload.sppro_formula?.iss) ?? toNumber(payload.iss) ?? 0;
  const despesas = toNumber(payload.sppro_formula?.despesas) ?? toNumber(payload.despesas) ?? 0;
  const iof = toNumber(payload.sppro_formula?.iof) ?? toNumber(payload.iof) ?? 0;
  const iofAdicional = toNumber(payload.sppro_formula?.iof_adicional) ?? toNumber(payload.iof_adicional) ?? 0;
  const recompra = toNumber(payload.sppro_formula?.recompra) ?? toNumber(payload.recompra) ?? 0;
  const liquidoOperacao =
    toNumber(payload.sppro_formula?.liquido_operacao) ??
    toNumber(payload.valor_compra) ??
    null;

  return {
    quantidade_titulos: quantidadeTitulos,
    valor_face: valorFace,
    valor_compra: valorCompra,
    ad_valorem: adValorem,
    iss,
    despesas,
    iof,
    iof_adicional: iofAdicional,
    recompra,
    liquido_operacao: liquidoOperacao,
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', message: 'Use POST para confirmar o lote.' });
  }

  const startedAt = Date.now();

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

  let body: OperationIaBatchConfirmRequest;
  try {
    body = (parseJsonBody(req) || {}) as OperationIaBatchConfirmRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo inválido.' });
  }

  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Informe ao menos um item para confirmação do lote.',
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

  const importIds = unique(items.map((item) => String(item.import_file_id || '').trim()).filter(Boolean));
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
      error: 'Confirm error',
      message: `Falha ao carregar imports para confirmação: ${importsError.message}`,
    });
  }

  const importsRows = (importsData || []) as OperationIaImportRow[];
  const importsById = new Map(importsRows.map((row) => [row.id, row]));

  const fornecedorIds = unique(
    items
      .map((item) => trimOrNull(item.payload?.fornecedor_id || null))
      .filter((value): value is string => Boolean(value))
  );

  let fornecedoresById = new Map<string, OperationIaFornecedorRow>();
  if (fornecedorIds.length) {
    const { data: fornecedoresData, error: fornecedoresError } = await adminClient
      .from('fornecedores')
      .select('id,razao_social,nome_fantasia,cnpj,status')
      .eq('empresa_id', auth.empresaId)
      .eq('status', true)
      .in('id', fornecedorIds);

    if (fornecedoresError) {
      return res.status(500).json({
        error: 'Confirm error',
        message: `Falha ao carregar fornecedores do lote: ${fornecedoresError.message}`,
      });
    }

    fornecedoresById = new Map(
      ((fornecedoresData || []) as OperationIaFornecedorRow[]).map((row) => [row.id, row])
    );
  }

  const contaIds = unique(
    items
      .map((item) => trimOrNull(item.payload?.conta_bancaria_id || null))
      .filter((value): value is string => Boolean(value))
  );

  let contasById = new Map<string, OperationIaContaBancariaRow>();
  if (contaIds.length) {
    const { data: contasData, error: contasError } = await adminClient
      .from('contas_bancarias')
      .select('id,descricao,status')
      .eq('empresa_id', auth.empresaId)
      .eq('status', true)
      .in('id', contaIds);

    if (contasError) {
      return res.status(500).json({
        error: 'Confirm error',
        message: `Falha ao carregar contas bancárias do lote: ${contasError.message}`,
      });
    }

    contasById = new Map(
      ((contasData || []) as OperationIaContaBancariaRow[]).map((row) => [row.id, row])
    );
  }

  const estoqueIds = unique(
    items
      .map((item) => Number(item.payload?.estoque_id || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
  );

  let estoquesById = new Map<number, OperationIaEstoqueRow>();
  if (estoqueIds.length) {
    const { data: estoquesData, error: estoquesError } = await adminClient
      .from('estoques')
      .select('id,tipo,descricao,ativo')
      .eq('empresa_id', auth.empresaId)
      .eq('ativo', true)
      .in('id', estoqueIds);

    if (estoquesError) {
      return res.status(500).json({
        error: 'Confirm error',
        message: `Falha ao carregar estoques do lote: ${estoquesError.message}`,
      });
    }

    estoquesById = new Map(((estoquesData || []) as OperationIaEstoqueRow[]).map((row) => [row.id, row]));
  }

  const fileHashes = unique(
    importsRows.map((row) => trimOrNull(row.file_sha256)).filter((value): value is string => Boolean(value))
  );
  const hashAlreadyLinked = new Set<string>();
  if (fileHashes.length) {
    const { data: dupHashData, error: dupHashError } = await adminClient
      .from('operation_import_files')
      .select('id,file_sha256,linked_operacao_id')
      .eq('empresa_id', auth.empresaId)
      .in('file_sha256', fileHashes)
      .not('linked_operacao_id', 'is', null);

    if (dupHashError) {
      return res.status(500).json({
        error: 'Confirm error',
        message: `Falha ao validar duplicidade por hash: ${dupHashError.message}`,
      });
    }

    for (const row of dupHashData || []) {
      const hash = trimOrNull((row as { file_sha256?: string | null }).file_sha256);
      if (!hash) continue;
      hashAlreadyLinked.add(hash);
    }
  }

  const documentValues = unique(
    items
      .map((item) => trimOrNull(item.payload?.documento || null))
      .filter((value): value is string => Boolean(value))
  );
  const documentAlreadyUsed = new Set<string>();
  if (documentValues.length) {
    const { data: existingOperations, error: existingOperationsError } = await adminClient
      .from('operacoes_estoque')
      .select('id,documento')
      .eq('empresa_id', auth.empresaId)
      .in('documento', documentValues);

    if (existingOperationsError) {
      return res.status(500).json({
        error: 'Confirm error',
        message: `Falha ao validar duplicidade por documento: ${existingOperationsError.message}`,
      });
    }

    for (const row of existingOperations || []) {
      const normalized = normalizeComparableText((row as { documento?: string | null }).documento);
      if (!normalized) continue;
      documentAlreadyUsed.add(normalized);
    }
  }

  const batchDocumentsCreated = new Set<string>();
  const results: OperationIaBatchConfirmResultItem[] = [];

  let createdCount = 0;
  let ignoredCount = 0;
  let failedCount = 0;
  let totalCreatedValue = 0;
  let createdWithAutoSupplier = 0;
  const duplicateTestModeEnabled = isDuplicateTestModeEnabled();
  const conflictOverrideDuplicateTestEnabled = isConflictOverrideDuplicateTestEnabled();

  for (const item of items) {
    const safeItemId = String(item.item_id || `item:${item.import_file_id || 'unknown'}`);
    const importId = String(item.import_file_id || '').trim();

    const pushFailure = (message: string, duplicateDetected = false) => {
      failedCount += 1;
      results.push({
        item_id: safeItemId,
        import_file_id: importId,
        status: 'failed',
        duplicate_detected: duplicateDetected || undefined,
        message,
      });
    };

    if (!importId) {
      pushFailure('import_file_id inválido para o item.');
      continue;
    }

    if (item.decision === 'ignore') {
      const reason = trimOrNull(item.ignore_reason);
      if (!reason) {
        pushFailure('Ignorar item exige justificativa obrigatória.');
        continue;
      }

      ignoredCount += 1;
      results.push({
        item_id: safeItemId,
        import_file_id: importId,
        status: 'ignored',
        message: `Item ignorado: ${reason}`,
      });

      await safeInsertIntegrationAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        import_file_id: importId,
        source: SOURCE,
        event_type: 'operations_ia_item_ignored',
        status: 'info',
        message: `Item ignorado com justificativa: ${reason}`,
        details: {
          item_id: safeItemId,
          reason,
          user_id: auth.userId,
        },
      });

      continue;
    }

    const importRow = importsById.get(importId);
    if (!importRow) {
      pushFailure('Import não encontrado para a empresa/scope atual.');
      continue;
    }

    if (importRow.source !== SOURCE) {
      pushFailure('Import fora do escopo DISECURIT desta fase.');
      continue;
    }

    const forceCreate = item.force_create === true;
    const isDuplicateImport = importRow.parse_status === 'duplicate';
    const duplicateAllowedInThisItem = duplicateTestModeEnabled && isDuplicateImport;
    const forceReasonInput = trimOrNull(item.force_create_reason);
    const forceReason =
      duplicateAllowedInThisItem && forceCreate
        ? forceReasonInput || `auto_force_create_duplicate_test:${importId}`
        : forceReasonInput;
    const conflictOverrideAllowedInThisItem =
      conflictOverrideDuplicateTestEnabled && duplicateAllowedInThisItem && forceCreate;

    if (isDuplicateImport && !duplicateAllowedInThisItem) {
      const autoIgnoreReason = trimOrNull(item.ignore_reason) || `auto_ignore_duplicate_prod:${importId}`;
      ignoredCount += 1;
      results.push({
        item_id: safeItemId,
        import_file_id: importId,
        status: 'ignored',
        message: `Item duplicado ignorado automaticamente em produção. (${autoIgnoreReason})`,
      });

      await safeInsertIntegrationAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        import_file_id: importRow.id,
        source: SOURCE,
        event_type: 'operations_ia_duplicate_auto_ignored_production',
        status: 'info',
        message: 'Item duplicado ignorado automaticamente em produção.',
        details: {
          item_id: safeItemId,
          parse_status: importRow.parse_status,
          duplicate_test_mode_enabled: duplicateTestModeEnabled,
          force_create: forceCreate,
          ignore_reason: autoIgnoreReason,
          user_id: auth.userId,
        },
      });
      continue;
    }

    const payload = item.payload;
    if (!payload) {
      pushFailure('Payload do item não informado.');
      continue;
    }

    if (duplicateAllowedInThisItem && !forceCreate) {
      await safeInsertIntegrationAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        import_file_id: importRow.id,
        source: SOURCE,
        event_type: 'operations_ia_duplicate_test_missing_reason',
        status: 'warning',
        message: 'Em modo teste, ative force_create para confirmar duplicados.',
        details: {
          item_id: safeItemId,
          parse_status: importRow.parse_status,
          force_create: forceCreate,
        },
      });
      pushFailure('Em modo teste, ative force_create para confirmar duplicados.');
      continue;
    }

    let duplicateOriginImportId: string | null = null;
    let duplicateOriginResolutionMethod:
      | 'self_payload'
      | 'audit'
      | 'hash'
      | 'operation_number'
      | 'none'
      | 'auto_reparse' = 'none';
    let payloadSourceImportRow: OperationIaImportRow = importRow;
    if (duplicateAllowedInThisItem) {
      const duplicateOrigin = await resolveDuplicateOriginImport(
        adminClient,
        auth.empresaId,
        importRow,
        SOURCE
      );
      duplicateOriginImportId = duplicateOrigin.duplicate_origin_import_file_id;
      duplicateOriginResolutionMethod = duplicateOrigin.resolution_method;
      if (duplicateOrigin.duplicate_hydration_status !== 'hydrated' || !duplicateOrigin.source_import_row) {
        await safeInsertIntegrationAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          import_file_id: importRow.id,
          source: SOURCE,
          event_type: 'operations_ia_duplicate_origin_blocked',
          status: 'warning',
          message: 'Origem de duplicado ausente; confirmação bloqueada até hidratação confiável.',
          details: {
            item_id: safeItemId,
            parse_status: importRow.parse_status,
            duplicate_hydration_status: duplicateOrigin.duplicate_hydration_status,
            resolution_method: duplicateOrigin.resolution_method,
            force_create_reason: forceReason,
          },
        });
        pushFailure('Import duplicado sem origem confiável para hidratação. Reimporte/reprocesse o arquivo original antes de confirmar.', true);
        continue;
      } else {
        const refreshedOrigin = await refreshSoiOriginPayloadIfNeeded(
          adminClient,
          duplicateOrigin.source_import_row
        );
        payloadSourceImportRow = refreshedOrigin.row;
        if (refreshedOrigin.refreshed) {
          duplicateOriginResolutionMethod = 'auto_reparse';
        }
        if (refreshedOrigin.status !== 'ok') {
          const isSourceStale = refreshedOrigin.status === 'source_stale';
          await safeInsertIntegrationAuditLog(adminClient, {
            empresa_id: auth.empresaId,
            import_file_id: importRow.id,
            source: SOURCE,
            event_type: 'operations_ia_duplicate_origin_blocked',
            status: 'warning',
            message: isSourceStale
              ? 'Origem duplicada sem raw_text para auto-reparse; confirmação bloqueada.'
              : 'Auto-reparse da origem não concluiu fórmula SOI V2; confirmação bloqueada.',
            details: {
              item_id: safeItemId,
              duplicate_origin_import_file_id: duplicateOriginImportId,
              resolution_method: duplicateOriginResolutionMethod,
              refresh_status: refreshedOrigin.status,
              force_create_reason: forceReason,
            },
          });
          pushFailure(
            isSourceStale
              ? 'Import duplicado sem origem confiável para hidratação. Reimporte/reprocesse o arquivo original antes de confirmar.'
              : 'Origem encontrada, mas auto-reparse não concluiu fórmula SOI V2. Reprocesse o import antes de confirmar.',
            true
          );
          continue;
        }
      }
    }

    const estoqueRow = payload.estoque_id ? estoquesById.get(Number(payload.estoque_id)) || null : null;
    const fornecedorRow = payload.fornecedor_id
      ? fornecedoresById.get(String(payload.fornecedor_id)) || null
      : null;
    const contaRow = payload.conta_bancaria_id
      ? contasById.get(String(payload.conta_bancaria_id)) || null
      : null;

    const validationIssues = evaluateConfirmPayloadIssues(
      payload,
      duplicateAllowedInThisItem ? 'parsed' : importRow.parse_status,
      importRow.linked_operacao_id,
      estoqueRow,
      fornecedorRow,
      contaRow
    );

    if (validationIssues.length) {
      pushFailure(validationIssues.join(' '));
      continue;
    }

    const duplicateFlags = evaluateDuplicateFlags(
      importRow,
      payload.documento || null,
      hashAlreadyLinked,
      new Set([...documentAlreadyUsed, ...batchDocumentsCreated])
    );
    const duplicateMessages = summarizeDuplicateFlags(duplicateFlags);
    const hasHardDuplicate = duplicateFlags.importAlreadyLinked;
    const hasOverridableDuplicate = duplicateFlags.hashAlreadyLinked || duplicateFlags.operationNumberAlreadyExists;

    if (hasHardDuplicate) {
      pushFailure(duplicateMessages.join(' '), true);
      continue;
    }

    if (hasOverridableDuplicate && !forceCreate) {
      pushFailure(`${duplicateMessages.join(' ')} Use force_create com justificativa para prosseguir.`, true);
      continue;
    }

    if (forceCreate && !forceReason) {
      pushFailure('force_create exige justificativa obrigatória.');
      continue;
    }

    if (duplicateAllowedInThisItem) {
      await insertExtractionHistoryRows(adminClient, [
        {
          empresa_id: auth.empresaId,
          import_file_id: importRow.id,
          line_index: null,
          field_name: 'duplicate_status',
          raw_value: 'parse_status=duplicate',
          normalized_value: null,
          source_method: 'manual',
          confidence: null,
          conflict_flag: false,
          status: 'corrected',
          actor_user_id: auth.userId,
          metadata: {
            phase: 'confirm',
            event_type: 'duplicate_test_mode_allowed',
            item_id: safeItemId,
            force_create: forceCreate,
            force_create_reason: forceReason,
            duplicate_origin_import_file_id: duplicateOriginImportId,
            duplicate_hydration_resolution_method: duplicateOriginResolutionMethod,
          },
        },
      ]);

      await safeInsertIntegrationAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        import_file_id: importRow.id,
        source: SOURCE,
        event_type: 'operations_ia_duplicate_test_allowed',
        status: 'info',
        message: 'Item duplicado liberado por modo teste com force_create.',
        details: {
          item_id: safeItemId,
          parse_status: importRow.parse_status,
          force_create_reason: forceReason,
          duplicate_origin_import_file_id: duplicateOriginImportId,
          duplicate_hydration_resolution_method: duplicateOriginResolutionMethod,
        },
      });
    }

    const insertPayload = buildInsertPayloadFromConfirmItem(auth.empresaId, auth.userId, item as OperationIaBatchConfirmItem);
    const faceTitulos = toNumber(payload.face_titulos) || 0;
    const liquidoOperacao = Math.max(0, toNumber(insertPayload.liquido_operacao) || 0);
    const operationDate = toDateOnly(payload.data_operacao) || new Date().toISOString().slice(0, 10);

    const extractionDiagnostics = normalizeExtractionDiagnosticsFromPayload(
      (payloadSourceImportRow.parsed_payload || null) as Record<string, unknown> | null
    );
    const criticalConflicts = extractionDiagnostics.filter(
      (diagnostic) => diagnostic.critical && diagnostic.conflict_flag
    );
    const payloadDebug =
      ((payloadSourceImportRow.parsed_payload as Record<string, unknown> | null)?.debug as
        | Record<string, unknown>
        | undefined) || null;
    const hasCriticalConflict =
      Boolean(payloadDebug?.has_critical_conflict) || criticalConflicts.length > 0;

    if (hasCriticalConflict && criticalConflicts.length === 0) {
      if (conflictOverrideAllowedInThisItem) {
        await safeInsertIntegrationAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          import_file_id: importRow.id,
          source: SOURCE,
          event_type: 'operations_ia_confirm_conflict_overridden',
          status: 'warning',
          message:
            'Conflito crítico sem diagnóstico detalhado foi sobreposto em modo teste para duplicado.',
          details: {
            item_id: safeItemId,
            duplicate_test_mode_enabled: duplicateTestModeEnabled,
            force_create: forceCreate,
            force_create_reason: forceReason,
            has_critical_conflict: true,
            diagnostics_count: extractionDiagnostics.length,
          },
        });
      } else {
      await safeInsertIntegrationAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        import_file_id: importRow.id,
        source: SOURCE,
        event_type: 'operations_ia_confirm_blocked_conflict',
        status: 'warning',
        message:
          'Confirmação bloqueada por conflito crítico de extração sem diagnóstico detalhado. Revalide o import antes de confirmar.',
        details: {
          item_id: safeItemId,
          has_critical_conflict: true,
          diagnostics_count: extractionDiagnostics.length,
        },
      });

      pushFailure(
        'Conflito crítico de extração detectado no import. Revalide os campos antes de confirmar.'
      );
      continue;
      }
    }

    if (hasCriticalConflict && criticalConflicts.length > 0) {
      const unresolved = criticalConflicts
        .map((diagnostic) => {
          const referenceValues = toUniqueFiniteNumbers([
            diagnostic.compared_value,
            diagnostic.resolved_value,
            ...(diagnostic.candidates || []).map((candidate) => candidate.value),
          ]);

          const targetValue =
            diagnostic.field_name === 'face_value'
              ? toNumber(payload.face_titulos)
              : diagnostic.field_name === 'purchase_value'
                ? toNumber(payload.valor_compra)
                : diagnostic.field_name === 'net_value'
                  ? payload.program === 'SPPRO'
                    ? toNumber(payload.sppro_formula?.liquido_operacao) ?? liquidoOperacao
                    : toNumber(payload.soi_formula?.liquido_liberado) ?? toNumber(payload.valor_compra)
                  : null;

          if (targetValue === null) {
            return {
              field_name: diagnostic.field_name,
              label: resolveConflictFieldLabel(diagnostic.field_name),
              reason: 'Campo obrigatório não preenchido para resolver o conflito.',
              target_value: null as number | null,
              references: referenceValues,
              tolerance: diagnostic.tolerance,
            };
          }

          if (!referenceValues.length) return null;

          const tolerance =
            typeof diagnostic.tolerance === 'number' && Number.isFinite(diagnostic.tolerance)
              ? diagnostic.tolerance
              : resolveHybridTolerance(targetValue, ...referenceValues);

          const coherent = referenceValues.some((reference) => Math.abs(reference - targetValue) <= tolerance);
          if (coherent) return null;

          return {
            field_name: diagnostic.field_name,
            label: resolveConflictFieldLabel(diagnostic.field_name),
            reason: diagnostic.reason || 'Valor informado não está coerente com referências do PDF/documentos.',
            target_value: targetValue,
            references: referenceValues,
            tolerance,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (unresolved.length > 0) {
        const conflictRows: OperationImportExtractionHistoryInsertRow[] = unresolved.map((row) => ({
          empresa_id: auth.empresaId,
          import_file_id: importRow.id,
          line_index: null,
          field_name: row.field_name,
          raw_value: row.reason,
          normalized_value: row.target_value,
          source_method: 'manual',
          confidence: null,
          conflict_flag: true,
          status: 'flagged',
          actor_user_id: auth.userId,
          metadata: {
            phase: 'confirm',
            event_type: 'confirm_blocked_conflict',
            item_id: safeItemId,
            references: row.references,
            tolerance: row.tolerance,
            override_applied: conflictOverrideAllowedInThisItem,
            force_create_reason: forceReason,
          },
        }));
        await insertExtractionHistoryRows(adminClient, conflictRows);

        if (conflictOverrideAllowedInThisItem) {
          await safeInsertIntegrationAuditLog(adminClient, {
            empresa_id: auth.empresaId,
            import_file_id: importRow.id,
            source: SOURCE,
            event_type: 'operations_ia_confirm_conflict_overridden',
            status: 'warning',
            message: `Conflito crítico sobreposto em modo teste: ${unresolved
              .map((row) => row.label)
              .join(', ')}`,
            details: {
              item_id: safeItemId,
              force_create_reason: forceReason,
              fields: unresolved.map((row) => ({
                field_name: row.field_name,
                target_value: row.target_value,
                references: row.references,
                tolerance: row.tolerance,
                reason: row.reason,
              })),
            },
          });
        } else {
          await safeInsertIntegrationAuditLog(adminClient, {
            empresa_id: auth.empresaId,
            import_file_id: importRow.id,
            source: SOURCE,
            event_type: 'operations_ia_confirm_blocked_conflict',
            status: 'warning',
            message: `Confirmação bloqueada por conflito crítico: ${unresolved.map((row) => row.label).join(', ')}`,
            details: {
              item_id: safeItemId,
              fields: unresolved.map((row) => ({
                field_name: row.field_name,
                target_value: row.target_value,
                references: row.references,
                tolerance: row.tolerance,
                reason: row.reason,
              })),
            },
          });

          pushFailure(
            `Conflito crítico de extração não resolvido (${unresolved
              .map((row) => row.label)
              .join(', ')}). Revise/revalide os campos antes de confirmar.`
          );
          continue;
        }
      }
    }

    const hasSoiFormulaPayload =
      payload.program === 'SOI' &&
      Boolean(payload.soi_formula && typeof payload.soi_formula === 'object');

    if (hasSoiFormulaPayload) {
      const soiFormula = resolveSoiFormulaPayload(payload);
      if (
        soiFormula.valor_original === null ||
        soiFormula.valor_desagio === null ||
        soiFormula.liquido_liberado === null
      ) {
        pushFailure('SOI exige fórmula completa: Valor Original, Valor de Deságio e Líquido Liberado.');
        continue;
      }

      const calculatedLiquido =
        soiFormula.valor_original -
        soiFormula.valor_desagio -
        soiFormula.valor_desagio_antecipacao -
        soiFormula.despesas -
        soiFormula.regresso -
        soiFormula.amortiza_debitos +
        soiFormula.amortiza_creditos -
        soiFormula.creditos_gerados;
      const formulaTolerance = resolveHybridTolerance(calculatedLiquido, soiFormula.liquido_liberado);
      const formulaDiff = Number(Math.abs(calculatedLiquido - soiFormula.liquido_liberado).toFixed(2));

      if (formulaDiff > formulaTolerance) {
        if (conflictOverrideAllowedInThisItem) {
          await safeInsertIntegrationAuditLog(adminClient, {
            empresa_id: auth.empresaId,
            import_file_id: importRow.id,
            source: SOURCE,
            event_type: 'operations_ia_confirm_conflict_overridden',
            status: 'warning',
            message: 'Fórmula SOI inconsistente sobreposta em modo teste para duplicado.',
            details: {
              item_id: safeItemId,
              force_create_reason: forceReason,
              formula: soiFormula,
              calculated_liquido: Number(calculatedLiquido.toFixed(2)),
              informado_liquido: soiFormula.liquido_liberado,
              tolerance: formulaTolerance,
              difference: formulaDiff,
            },
          });
        } else {
        await insertExtractionHistoryRows(adminClient, [
          {
            empresa_id: auth.empresaId,
            import_file_id: importRow.id,
            line_index: null,
            field_name: 'soi_formula',
            raw_value: 'Fórmula SOI inconsistente no confirm.',
            normalized_value: soiFormula.liquido_liberado,
            source_method: 'manual',
            confidence: null,
            conflict_flag: true,
            status: 'flagged',
            actor_user_id: auth.userId,
            metadata: {
              phase: 'confirm',
              event_type: 'confirm_blocked_conflict',
              item_id: safeItemId,
              formula_tolerance: formulaTolerance,
              formula_difference: formulaDiff,
              calculated_liquido: Number(calculatedLiquido.toFixed(2)),
              informado_liquido: soiFormula.liquido_liberado,
            },
          },
        ]);

        await safeInsertIntegrationAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          import_file_id: importRow.id,
          source: SOURCE,
          event_type: 'operations_ia_confirm_blocked_conflict',
          status: 'warning',
          message: 'Confirmação bloqueada por inconsistência da fórmula SOI.',
          details: {
            item_id: safeItemId,
            formula: soiFormula,
            calculated_liquido: Number(calculatedLiquido.toFixed(2)),
            informado_liquido: soiFormula.liquido_liberado,
            tolerance: formulaTolerance,
            difference: formulaDiff,
          },
        });

        pushFailure(
          'Conflito crítico de fórmula SOI: Líquido Liberado inconsistente com os campos da fórmula. Revise antes de confirmar.'
        );
        continue;
        }
      }
    }

    const hasSpproFormulaPayload =
      payload.program === 'SPPRO' &&
      Boolean(payload.sppro_formula && typeof payload.sppro_formula === 'object');

    if (hasSpproFormulaPayload) {
      const spproFormula = resolveSpproFormulaPayload(payload);
      if (
        spproFormula.valor_face === null ||
        spproFormula.valor_compra === null ||
        spproFormula.liquido_operacao === null
      ) {
        pushFailure(
          'SPPRO exige fórmula completa: Valor de Face dos Títulos, Valor de Compra e Valor Líquido da Operação.'
        );
        continue;
      }

      const calculatedLiquido =
        spproFormula.valor_face -
        spproFormula.valor_compra -
        spproFormula.ad_valorem -
        spproFormula.iss -
        spproFormula.despesas -
        spproFormula.iof -
        spproFormula.iof_adicional -
        spproFormula.recompra;
      const formulaTolerance = resolveHybridTolerance(calculatedLiquido, spproFormula.liquido_operacao);
      const formulaDiff = Number(Math.abs(calculatedLiquido - spproFormula.liquido_operacao).toFixed(2));

      if (formulaDiff > formulaTolerance) {
        if (conflictOverrideAllowedInThisItem) {
          await safeInsertIntegrationAuditLog(adminClient, {
            empresa_id: auth.empresaId,
            import_file_id: importRow.id,
            source: SOURCE,
            event_type: 'operations_ia_confirm_conflict_overridden',
            status: 'warning',
            message: 'Fórmula SPPRO inconsistente sobreposta em modo teste para duplicado.',
            details: {
              item_id: safeItemId,
              force_create_reason: forceReason,
              formula: spproFormula,
              calculated_liquido: Number(calculatedLiquido.toFixed(2)),
              informado_liquido: spproFormula.liquido_operacao,
              tolerance: formulaTolerance,
              difference: formulaDiff,
            },
          });
        } else {
        await insertExtractionHistoryRows(adminClient, [
          {
            empresa_id: auth.empresaId,
            import_file_id: importRow.id,
            line_index: null,
            field_name: 'sppro_formula',
            raw_value: 'Fórmula SPPRO inconsistente no confirm.',
            normalized_value: spproFormula.liquido_operacao,
            source_method: 'manual',
            confidence: null,
            conflict_flag: true,
            status: 'flagged',
            actor_user_id: auth.userId,
            metadata: {
              phase: 'confirm',
              event_type: 'confirm_blocked_conflict',
              item_id: safeItemId,
              formula_tolerance: formulaTolerance,
              formula_difference: formulaDiff,
              calculated_liquido: Number(calculatedLiquido.toFixed(2)),
              informado_liquido: spproFormula.liquido_operacao,
              quantidade_titulos: spproFormula.quantidade_titulos,
            },
          },
        ]);

        await safeInsertIntegrationAuditLog(adminClient, {
          empresa_id: auth.empresaId,
          import_file_id: importRow.id,
          source: SOURCE,
          event_type: 'operations_ia_confirm_blocked_conflict',
          status: 'warning',
          message: 'Confirmação bloqueada por inconsistência da fórmula SPPRO.',
          details: {
            item_id: safeItemId,
            formula: spproFormula,
            calculated_liquido: Number(calculatedLiquido.toFixed(2)),
            informado_liquido: spproFormula.liquido_operacao,
            tolerance: formulaTolerance,
            difference: formulaDiff,
          },
        });

        pushFailure(
          'Conflito crítico de fórmula SPPRO: Valor Líquido da Operação inconsistente com os campos da fórmula. Revise antes de confirmar.'
        );
        continue;
        }
      }
    }

    let operationId: number | null = null;
    let lancamentoCaixaId: string | null = null;
    let importLinked = false;
    let estoqueAdjusted = false;
    let rollbackExecuted = false;

    const adjustEstoqueSaldo = async (
      amount: number,
      phase: 'apply' | 'rollback'
    ): Promise<{ ok: boolean; warning: string | null }> => {
      if (!payload.estoque_id || amount === 0) {
        return { ok: true, warning: null };
      }

      const estoqueId = Number(payload.estoque_id);
      if (!Number.isFinite(estoqueId) || estoqueId <= 0) {
        return { ok: false, warning: 'Estoque inválido para ajuste de saldo.' };
      }

      const { error: rpcError } = await adminClient.rpc('increment_bigint', {
        table_name: 'estoques',
        id_column: 'id',
        id_value: estoqueId,
        amount_column: 'saldo_atual',
        amount,
      });

      if (!rpcError) return { ok: true, warning: null };

      const { data: estoqueRow, error: loadError } = await adminClient
        .from('estoques')
        .select('id,saldo_atual')
        .eq('empresa_id', auth.empresaId)
        .eq('id', estoqueId)
        .single();

      if (loadError || !estoqueRow) {
        return {
          ok: false,
          warning: `Falha RPC e fallback ao carregar estoque: ${rpcError.message}${
            loadError?.message ? ` | ${loadError.message}` : ''
          }`,
        };
      }

      const saldoAtual = toNumber((estoqueRow as Record<string, unknown>).saldo_atual) || 0;
      const novoSaldo = saldoAtual + amount;

      const { error: updateError } = await adminClient
        .from('estoques')
        .update({ saldo_atual: novoSaldo })
        .eq('empresa_id', auth.empresaId)
        .eq('id', estoqueId);

      if (updateError) {
        return {
          ok: false,
          warning: `Falha RPC e fallback ao atualizar estoque: ${rpcError.message} | ${updateError.message}`,
        };
      }

      await safeInsertIntegrationAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        import_file_id: importRow.id,
        source: SOURCE,
        event_type: 'operations_ia_increment_bigint_fallback',
        status: 'warning',
        message: `Fallback manual aplicado no saldo de estoque (${phase}).`,
        details: {
          item_id: safeItemId,
          estoque_id: estoqueId,
          amount,
          rpc_error: rpcError.message,
        },
      });

      return {
        ok: true,
        warning: `Fallback aplicado após falha RPC (${rpcError.message}).`,
      };
    };

    const rollbackCreatedArtifacts = async (): Promise<string[]> => {
      if (rollbackExecuted) return [];
      rollbackExecuted = true;

      const rollbackWarnings: string[] = [];

      if (importLinked) {
        const { error: unlinkError } = await adminClient
          .from('operation_import_files')
          .update({
            linked_operacao_id: null,
            linked_at: null,
          })
          .eq('id', importRow.id)
          .eq('empresa_id', auth.empresaId);
        if (unlinkError) {
          rollbackWarnings.push(`Falha ao desfazer vínculo do import: ${unlinkError.message}`);
        }
      }

      if (lancamentoCaixaId) {
        const { error: deleteLancamentoError } = await adminClient
          .from('lancamentos_caixa')
          .delete()
          .eq('id', lancamentoCaixaId)
          .eq('empresa_id', auth.empresaId);
        if (deleteLancamentoError) {
          rollbackWarnings.push(`Falha ao remover lançamento de caixa: ${deleteLancamentoError.message}`);
        }
      }

      if (estoqueAdjusted && payload.estoque_id && faceTitulos > 0) {
        const rollbackAdjustment = await adjustEstoqueSaldo(-faceTitulos, 'rollback');
        if (!rollbackAdjustment.ok) {
          rollbackWarnings.push(
            `Falha ao reverter saldo de estoque: ${rollbackAdjustment.warning || 'erro desconhecido'}`
          );
        } else if (rollbackAdjustment.warning) {
          rollbackWarnings.push(rollbackAdjustment.warning);
        }
      }

      if (operationId) {
        const { error: deleteOperationError } = await adminClient
          .from('operacoes_estoque')
          .delete()
          .eq('id', operationId)
          .eq('empresa_id', auth.empresaId);
        if (deleteOperationError) {
          rollbackWarnings.push(`Falha ao remover operação criada: ${deleteOperationError.message}`);
        }
      }

      return rollbackWarnings;
    };

    const { data: createdOperation, error: createError } = await adminClient
      .from('operacoes_estoque')
      .insert(insertPayload)
      .select('id')
      .single();

    if (createError || !createdOperation?.id) {
      pushFailure(`Falha ao criar operação: ${createError?.message || 'erro desconhecido'}`);
      continue;
    }

    operationId = Number(createdOperation.id);

    if (payload.estoque_id && faceTitulos > 0) {
      const applyAdjustment = await adjustEstoqueSaldo(faceTitulos, 'apply');
      if (!applyAdjustment.ok) {
        const rollbackWarnings = await rollbackCreatedArtifacts();
        pushFailure(
          `Falha ao atualizar saldo do estoque: ${applyAdjustment.warning || 'erro desconhecido'}${
            rollbackWarnings.length ? ` Rollback com alertas: ${rollbackWarnings.join(' ')}` : ''
          }`
        );
        continue;
      }

      estoqueAdjusted = true;
    }

    const historicoBase = trimOrNull(String(insertPayload.historico || ''));
    const historicoLancamento = historicoBase
      ? `Operação ${payload.program || 'ESTOQUE'} #${operationId} - ${historicoBase}`
      : `Operação ${payload.program || 'ESTOQUE'} #${operationId}`;

    const { data: createdLancamento, error: lancamentoError } = await adminClient
      .from('lancamentos_caixa')
      .insert({
        empresa_id: auth.empresaId,
        conta_bancaria_id: payload.conta_bancaria_id,
        grupo_contas_id: null,
        data: operationDate,
        historico: historicoLancamento,
        tipo: 'saida',
        valor: liquidoOperacao,
        documento: payload.documento || null,
        observacoes: `Operação de estoque ${payload.program || 'SOI'} - Líquido: R$ ${liquidoOperacao.toFixed(2)}`,
      })
      .select('id')
      .single();

    if (lancamentoError || !createdLancamento?.id) {
      const rollbackWarnings = await rollbackCreatedArtifacts();
      pushFailure(
        `Falha ao criar lançamento de caixa: ${lancamentoError?.message || 'erro desconhecido'}${
          rollbackWarnings.length ? ` Rollback com alertas: ${rollbackWarnings.join(' ')}` : ''
        }`
      );
      continue;
    }

    lancamentoCaixaId = String(createdLancamento.id);

    const { error: linkError } = await adminClient
      .from('operation_import_files')
      .update({
        linked_operacao_id: operationId,
        linked_at: new Date().toISOString(),
      })
      .eq('id', importRow.id)
      .eq('empresa_id', auth.empresaId);

    if (linkError) {
      const rollbackWarnings = await rollbackCreatedArtifacts();
      pushFailure(
        `Falha ao vincular import à operação: ${linkError.message}${
          rollbackWarnings.length ? ` Rollback com alertas: ${rollbackWarnings.join(' ')}` : ''
        }`
      );
      continue;
    }
    importLinked = true;

    const importRowForDocuments =
      payloadSourceImportRow.id === importRow.id
        ? payloadSourceImportRow
        : {
            ...payloadSourceImportRow,
            id: importRow.id,
          };
    const docRows = buildOperationImportDocumentRows(auth.empresaId, importRowForDocuments, operationId);
    if (docRows.length) {
      const { error: docsInsertError } = await adminClient.from('operation_import_documents').insert(docRows);
      if (docsInsertError) {
        const rollbackWarnings = await rollbackCreatedArtifacts();
        pushFailure(
          `Falha ao persistir documentos importados: ${docsInsertError.message}${
            rollbackWarnings.length ? ` Rollback com alertas: ${rollbackWarnings.join(' ')}` : ''
          }`
        );
        continue;
      }
    }

    const correctionRows = buildManualCorrectionRowsFromPayload({
      empresaId: auth.empresaId,
      importFileId: importId,
      payload,
      parsedPayload: (payloadSourceImportRow.parsed_payload || null) as Record<string, unknown> | null,
      actorUserId: auth.userId,
      phase: 'confirm',
      itemId: safeItemId,
    });
    await insertExtractionHistoryRows(adminClient, correctionRows);

    await insertExtractionHistoryRows(adminClient, [
      {
        empresa_id: auth.empresaId,
        import_file_id: importId,
        line_index: null,
        field_name: 'confirm',
        raw_value: null,
        normalized_value: liquidoOperacao,
        source_method: 'manual',
        confidence: null,
        conflict_flag: false,
        status: 'accepted',
        actor_user_id: auth.userId,
        metadata: {
          phase: 'confirm',
          event_type: 'confirm_created_success',
          item_id: safeItemId,
          operation_id: operationId,
          conta_bancaria_id: payload.conta_bancaria_id || null,
          liquido_operacao: liquidoOperacao,
          soi_formula: payload.program === 'SOI' ? payload.soi_formula || null : null,
          sppro_formula: payload.program === 'SPPRO' ? payload.sppro_formula || null : null,
        },
      },
    ]);

    const normalizedDocument = normalizeComparableText(payload.documento || null);
    if (normalizedDocument) {
      batchDocumentsCreated.add(normalizedDocument);
      documentAlreadyUsed.add(normalizedDocument);
    }

    const valorCriado = toNumber(payload.valor_compra) || 0;
    totalCreatedValue += valorCriado;
    createdCount += 1;

    const fornecedorMatchMethod = payload.fornecedor_match_method || 'manual';
    if (fornecedorMatchMethod === 'cnpj' || fornecedorMatchMethod === 'name_fuzzy') {
      createdWithAutoSupplier += 1;
    }

    results.push({
      item_id: safeItemId,
      import_file_id: importId,
      status: 'created',
      operation_id: operationId,
      message: 'Operação criada com sucesso.',
    });

    await safeInsertIntegrationAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      import_file_id: importId,
      source: SOURCE,
      event_type: hasOverridableDuplicate && forceCreate ? 'operations_ia_item_created_force' : 'operations_ia_item_created',
      status: 'success',
      message: `Operação #${operationId} criada via Operações com IA.`,
      details: {
        item_id: safeItemId,
        operation_id: operationId,
        conta_bancaria_id: payload.conta_bancaria_id,
        liquido_operacao: liquidoOperacao,
        face_titulos: faceTitulos,
        lancamento_caixa_id: lancamentoCaixaId,
        estoque_adjusted: estoqueAdjusted,
        soi_formula: payload.program === 'SOI' ? payload.soi_formula || null : null,
        sppro_formula: payload.program === 'SPPRO' ? payload.sppro_formula || null : null,
        force_create: forceCreate,
        force_create_reason: forceReason,
        duplicate_messages: duplicateMessages,
        corrections_recorded: correctionRows.length,
        user_id: auth.userId,
      },
    });
  }

  for (const result of results) {
    if (result.status !== 'failed') continue;
    await safeInsertIntegrationAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      import_file_id: result.import_file_id,
      source: SOURCE,
      event_type: result.duplicate_detected ? 'operations_ia_item_duplicate_blocked' : 'operations_ia_item_failed',
      status: result.duplicate_detected ? 'warning' : 'error',
      message: result.message || 'Falha ao processar item do lote.',
      details: {
        item_id: result.item_id,
        duplicate_detected: result.duplicate_detected || false,
        user_id: auth.userId,
      },
    });
  }

  failedCount = results.filter((item) => item.status === 'failed').length;
  ignoredCount = results.filter((item) => item.status === 'ignored').length;
  createdCount = results.filter((item) => item.status === 'created').length;

  const summary: OperationIaBatchConfirmResponse['summary'] = {
    total: results.length,
    created: createdCount,
    ignored: ignoredCount,
    failed: failedCount,
    pending_review: failedCount,
    value_total_created: Number(totalCreatedValue.toFixed(2)),
    auto_supplier_rate: Number(clampPercent(createdWithAutoSupplier / Math.max(createdCount, 1)).toFixed(4)),
    processing_time_ms: Date.now() - startedAt,
  };

  await safeInsertIntegrationAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    source: SOURCE,
    event_type: 'operations_ia_batch_confirm',
    status: failedCount > 0 ? 'warning' : 'success',
    message: `Lote Operações IA finalizado: ${createdCount} criado(s), ${ignoredCount} ignorado(s), ${failedCount} falha(s).`,
    details: {
      summary,
      total_items_received: items.length,
      user_id: auth.userId,
    },
  });

  const response: OperationIaBatchConfirmResponse = {
    ok: true,
    summary,
    results,
  };

  return res.status(200).json(response);
}
