import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLegacyToCanonical } from '../../lib/disecurit/disecuritAdapters.js';
import type { ParsedPayloadDisecurit } from '../../types/disecurit-import.js';
import type {
  OperationIaConfirmItemPayload,
  OperationIaExtractionDiagnostic,
  OperationIaHistoryTimelineEvent,
} from '../../types/operacoes-ia.js';

export type OperationImportExtractionHistoryStatus = 'accepted' | 'flagged' | 'corrected';

export interface OperationImportExtractionHistoryInsertRow {
  empresa_id: string;
  import_file_id: string;
  line_index: number | null;
  field_name: string;
  raw_value: string | null;
  normalized_value: number | null;
  source_method: 'regex' | 'ocr' | 'heuristic' | 'manual';
  confidence: number | null;
  conflict_flag: boolean;
  status: OperationImportExtractionHistoryStatus;
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
}

const NUMERIC_TRACKED_FIELDS: Array<{
  payloadField: keyof Pick<
    OperationIaConfirmItemPayload,
    | 'face_titulos'
    | 'valor_compra'
    | 'despesas'
    | 'recompra'
    | 'ad_valorem'
    | 'iss'
    | 'iof'
    | 'iof_adicional'
    | 'amortizacao_debitos'
    | 'amortizacao_creditos'
  >;
  canonicalField:
    | 'face_value'
    | 'purchase_value'
    | 'net_value'
    | 'discount_value'
    | 'expenses'
    | 'recompra'
    | 'ad_valorem'
    | 'iss'
    | 'iof'
    | 'iof_additional'
    | 'amort_debits'
    | 'amort_credits';
  fallbackCanonicalFields?: Array<
    | 'purchase_value'
    | 'net_value'
    | 'discount_value'
    | 'expenses'
    | 'recompra'
    | 'ad_valorem'
    | 'iss'
    | 'iof'
    | 'iof_additional'
    | 'amort_debits'
    | 'amort_credits'
  >;
}> = [
  { payloadField: 'face_titulos', canonicalField: 'face_value' },
  {
    payloadField: 'valor_compra',
    canonicalField: 'purchase_value',
    fallbackCanonicalFields: ['net_value', 'discount_value'],
  },
  { payloadField: 'despesas', canonicalField: 'expenses' },
  { payloadField: 'recompra', canonicalField: 'recompra' },
  { payloadField: 'ad_valorem', canonicalField: 'ad_valorem' },
  { payloadField: 'iss', canonicalField: 'iss' },
  { payloadField: 'iof', canonicalField: 'iof' },
  { payloadField: 'iof_adicional', canonicalField: 'iof_additional' },
  { payloadField: 'amortizacao_debitos', canonicalField: 'amort_debits' },
  { payloadField: 'amortizacao_creditos', canonicalField: 'amort_credits' },
];

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return null;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    normalized = lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeHistorySourceMethod = (value: unknown): OperationImportExtractionHistoryInsertRow['source_method'] => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'regex' || normalized === 'ocr' || normalized === 'heuristic' || normalized === 'manual') {
    return normalized;
  }
  return 'heuristic';
};

const readCanonicalValue = (
  values: Record<string, unknown> | null | undefined,
  field: string,
  fallbacks?: string[]
): number | null => {
  if (!values) return null;
  const direct = toFiniteNumber(values[field]);
  if (direct !== null) return direct;

  if (!Array.isArray(fallbacks)) return null;
  for (const fallbackField of fallbacks) {
    const fallbackValue = toFiniteNumber(values[fallbackField]);
    if (fallbackValue !== null) return fallbackValue;
  }
  return null;
};

export function normalizeExtractionDiagnosticsFromPayload(
  parsedPayload?: ParsedPayloadDisecurit | Record<string, unknown> | null
): OperationIaExtractionDiagnostic[] {
  if (!parsedPayload) return [];
  const rawDiagnostics = (parsedPayload as Record<string, unknown>)?.debug as
    | { extraction_diagnostics?: unknown[] }
    | undefined;
  const diagnostics = Array.isArray(rawDiagnostics?.extraction_diagnostics)
    ? rawDiagnostics.extraction_diagnostics
    : [];
  if (!diagnostics.length) return [];

  return diagnostics
    .map((diagnostic) => {
      const diagnosticRow = (diagnostic || {}) as Record<string, unknown>;
      const fieldName = String(diagnosticRow.field_name || '').trim();
      if (!fieldName) return null;

      return {
        field_name: fieldName,
        resolved_value: toFiniteNumber(diagnosticRow.resolved_value),
        source_method: normalizeHistorySourceMethod(diagnosticRow.source_method),
        confidence: toFiniteNumber(diagnosticRow.confidence),
        conflict_flag: Boolean(diagnosticRow.conflict_flag),
        critical: Boolean(diagnosticRow.critical),
        reason: typeof diagnosticRow.reason === 'string' ? diagnosticRow.reason : null,
        compared_value: toFiniteNumber(diagnosticRow.compared_value),
        tolerance: toFiniteNumber(diagnosticRow.tolerance),
        difference: toFiniteNumber(diagnosticRow.difference),
        candidates: Array.isArray(diagnosticRow.candidates)
          ? diagnosticRow.candidates
              .map((candidateUnknown) => {
                const candidate = (candidateUnknown || {}) as Record<string, unknown>;
                return {
                  value: toFiniteNumber(candidate.value),
                  raw_value: typeof candidate.raw_value === 'string' ? candidate.raw_value : null,
                  source_method: normalizeHistorySourceMethod(candidate.source_method),
                  confidence: toFiniteNumber(candidate.confidence),
                };
              })
              .filter((candidate: { value: number | null }) => candidate.value !== null)
          : [],
      } satisfies OperationIaExtractionDiagnostic;
    })
    .filter(Boolean) as OperationIaExtractionDiagnostic[];
}

export function buildHistoryRowsFromDiagnostics(input: {
  empresaId: string;
  importFileId: string;
  diagnostics: OperationIaExtractionDiagnostic[];
  phase: 'parse' | 'reprocess' | 'preview';
  actorUserId?: string | null;
}): OperationImportExtractionHistoryInsertRow[] {
  return input.diagnostics.map((diagnostic) => ({
    empresa_id: input.empresaId,
    import_file_id: input.importFileId,
    line_index: null,
    field_name: diagnostic.field_name,
    raw_value:
      diagnostic.candidates?.find((candidate) => candidate.value === diagnostic.resolved_value)?.raw_value || null,
    normalized_value: diagnostic.resolved_value,
    source_method: normalizeHistorySourceMethod(diagnostic.source_method),
    confidence: diagnostic.confidence,
    conflict_flag: diagnostic.conflict_flag,
    status: diagnostic.conflict_flag ? 'flagged' : 'accepted',
    actor_user_id: input.actorUserId || null,
    metadata: {
      phase: input.phase,
      event_type: diagnostic.conflict_flag ? 'extraction_conflict_detected' : 'extraction_value_accepted',
      critical: diagnostic.critical,
      reason: diagnostic.reason,
      compared_value: diagnostic.compared_value,
      tolerance: diagnostic.tolerance,
      difference: diagnostic.difference,
      candidates_count: diagnostic.candidates?.length || 0,
    },
  }));
}

export function buildManualCorrectionRowsFromPayload(input: {
  empresaId: string;
  importFileId: string;
  payload: OperationIaConfirmItemPayload;
  parsedPayload?: ParsedPayloadDisecurit | Record<string, unknown> | null;
  actorUserId?: string | null;
  phase: 'save' | 'confirm';
  itemId?: string | null;
}): OperationImportExtractionHistoryInsertRow[] {
  const canonical = normalizeLegacyToCanonical((input.parsedPayload || null) as ParsedPayloadDisecurit | null);
  const canonicalValues = (canonical?.values || {}) as Record<string, unknown>;
  const rows: OperationImportExtractionHistoryInsertRow[] = [];

  for (const field of NUMERIC_TRACKED_FIELDS) {
    const currentValue = toFiniteNumber(input.payload[field.payloadField]);
    const originalValue = readCanonicalValue(canonicalValues, field.canonicalField, field.fallbackCanonicalFields);

    if (currentValue === null && originalValue === null) continue;

    const changed =
      currentValue === null ||
      originalValue === null ||
      Math.abs(Number(currentValue) - Number(originalValue)) > 0.005;
    if (!changed) continue;

    rows.push({
      empresa_id: input.empresaId,
      import_file_id: input.importFileId,
      line_index: null,
      field_name: String(field.payloadField),
      raw_value: originalValue === null ? null : String(originalValue),
      normalized_value: currentValue,
      source_method: 'manual',
      confidence: null,
      conflict_flag: false,
      status: 'corrected',
      actor_user_id: input.actorUserId || null,
      metadata: {
        phase: input.phase,
        event_type: 'manual_field_corrected',
        item_id: input.itemId || null,
        previous_value: originalValue,
        new_value: currentValue,
      },
    });
  }

  if (input.payload.program === 'SOI' && input.payload.soi_formula) {
    const soiFormulaFields: Array<{ field_name: string; value: unknown }> = [
      { field_name: 'soi_valor_original', value: input.payload.soi_formula.valor_original },
      { field_name: 'soi_valor_desagio', value: input.payload.soi_formula.valor_desagio },
      { field_name: 'soi_valor_desagio_antecipacao', value: input.payload.soi_formula.valor_desagio_antecipacao },
      { field_name: 'soi_despesas', value: input.payload.soi_formula.despesas },
      { field_name: 'soi_regresso', value: input.payload.soi_formula.regresso },
      { field_name: 'soi_amortiza_debitos', value: input.payload.soi_formula.amortiza_debitos },
      { field_name: 'soi_amortiza_creditos', value: input.payload.soi_formula.amortiza_creditos },
      { field_name: 'soi_creditos_gerados', value: input.payload.soi_formula.creditos_gerados },
      { field_name: 'soi_liquido_liberado', value: input.payload.soi_formula.liquido_liberado },
    ];

    for (const field of soiFormulaFields) {
      rows.push({
        empresa_id: input.empresaId,
        import_file_id: input.importFileId,
        line_index: null,
        field_name: field.field_name,
        raw_value: null,
        normalized_value: toFiniteNumber(field.value),
        source_method: 'manual',
        confidence: null,
        conflict_flag: false,
        status: 'corrected',
        actor_user_id: input.actorUserId || null,
        metadata: {
          phase: input.phase,
          event_type: 'manual_field_corrected',
          item_id: input.itemId || null,
        },
      });
    }
  }

  if (input.payload.program === 'SPPRO' && input.payload.sppro_formula) {
    const spproFormulaFields: Array<{ field_name: string; value: unknown }> = [
      { field_name: 'sppro_quantidade_titulos', value: input.payload.sppro_formula.quantidade_titulos },
      { field_name: 'sppro_valor_face', value: input.payload.sppro_formula.valor_face },
      { field_name: 'sppro_valor_compra', value: input.payload.sppro_formula.valor_compra },
      { field_name: 'sppro_ad_valorem', value: input.payload.sppro_formula.ad_valorem },
      { field_name: 'sppro_iss', value: input.payload.sppro_formula.iss },
      { field_name: 'sppro_despesas', value: input.payload.sppro_formula.despesas },
      { field_name: 'sppro_iof', value: input.payload.sppro_formula.iof },
      { field_name: 'sppro_iof_adicional', value: input.payload.sppro_formula.iof_adicional },
      { field_name: 'sppro_recompra', value: input.payload.sppro_formula.recompra },
      { field_name: 'sppro_liquido_operacao', value: input.payload.sppro_formula.liquido_operacao },
    ];

    for (const field of spproFormulaFields) {
      rows.push({
        empresa_id: input.empresaId,
        import_file_id: input.importFileId,
        line_index: null,
        field_name: field.field_name,
        raw_value: null,
        normalized_value: toFiniteNumber(field.value),
        source_method: 'manual',
        confidence: null,
        conflict_flag: false,
        status: 'corrected',
        actor_user_id: input.actorUserId || null,
        metadata: {
          phase: input.phase,
          event_type: 'manual_field_corrected',
          item_id: input.itemId || null,
        },
      });
    }
  }

  return rows;
}

export async function insertExtractionHistoryRows(
  adminClient: SupabaseClient,
  rows: OperationImportExtractionHistoryInsertRow[]
): Promise<void> {
  if (!rows.length) return;
  const { error } = await adminClient.from('operation_import_extraction_history').insert(rows);
  if (error) {
    console.error('[operacoes-ia][extraction-history]', error);
  }
}

export function groupHistoryTimelineByImport(rows: Array<Record<string, unknown>>): Map<string, OperationIaHistoryTimelineEvent[]> {
  const grouped = new Map<string, OperationIaHistoryTimelineEvent[]>();
  for (const row of rows) {
    const importFileId = String(row.import_file_id || '').trim();
    if (!importFileId) continue;

    const lineIndexRaw = row.line_index;
    const lineIndex = typeof lineIndexRaw === 'number' && Number.isFinite(lineIndexRaw) ? lineIndexRaw : null;
    const normalizedValue = toFiniteNumber(row.normalized_value);
    const confidence = toFiniteNumber(row.confidence);
    const metadataRaw = row.metadata;
    const metadata =
      metadataRaw && typeof metadataRaw === 'object' && !Array.isArray(metadataRaw)
        ? (metadataRaw as Record<string, unknown>)
        : {};
    const statusRaw = String(row.status || '').trim().toLowerCase();
    const status: OperationIaHistoryTimelineEvent['status'] =
      statusRaw === 'accepted' || statusRaw === 'flagged' || statusRaw === 'corrected' ? statusRaw : 'accepted';

    const event: OperationIaHistoryTimelineEvent = {
      id: String(row.id || `${importFileId}-${Date.now()}`),
      import_file_id: importFileId,
      line_index: lineIndex,
      field_name: String(row.field_name || ''),
      raw_value: typeof row.raw_value === 'string' ? row.raw_value : null,
      normalized_value: normalizedValue,
      source_method: normalizeHistorySourceMethod(row.source_method),
      confidence,
      conflict_flag: Boolean(row.conflict_flag),
      status,
      actor_user_id: typeof row.actor_user_id === 'string' ? row.actor_user_id : null,
      metadata,
      created_at: String(row.created_at || new Date().toISOString()),
    };

    const current = grouped.get(importFileId) || [];
    current.push(event);
    grouped.set(importFileId, current);
  }

  for (const [key, current] of grouped) {
    current.sort((left, right) => {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      return rightTime - leftTime;
    });
    grouped.set(key, current);
  }

  return grouped;
}
