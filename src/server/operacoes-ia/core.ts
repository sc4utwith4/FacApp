import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeLegacyToCanonical, toOperationImportDocuments } from '../../lib/disecurit/disecuritAdapters.js';
import { parseDisecuritPdfText } from '../../lib/disecurit/disecuritParser.js';
import { mapToUiSOI, mapToUiSPPRO } from '../../lib/disecurit/disecuritMappers.js';
import { calcularLiquidoSOI, calcularLiquidoSPPRO } from '../../types/estoque.js';
import type {
  OperationIaBatchConfirmItem,
  OperationIaConfirmItemPayload,
  OperationIaDraftItem,
  OperationIaExtractionDiagnostic,
  OperationIaFornecedorMatchMethod,
  OperationIaProgram,
  OperationIaRawSnapshotField,
  OperationIaSpproFormula,
  OperationIaSoiFormula,
} from '../../types/operacoes-ia.js';

export interface OperationIaImportRow {
  id: string;
  empresa_id: string;
  source: string;
  parse_status: string;
  parsed_payload: Record<string, unknown> | null;
  linked_operacao_id: number | null;
  operation_number: string | null;
  original_filename: string | null;
  file_sha256: string | null;
  program_hint: OperationIaProgram | null;
  created_at: string;
  raw_text?: string | null;
}

export interface OperationIaFornecedorRow {
  id: string;
  razao_social: string;
  nome_fantasia: string | null;
  cnpj: string | null;
  status: boolean | null;
}

export interface OperationIaEstoqueRow {
  id: number;
  tipo: string;
  descricao: string | null;
  ativo: boolean | null;
}

export interface OperationIaContaBancariaRow {
  id: string;
  descricao: string | null;
  status: boolean | null;
}

export interface OperationIaDuplicateFlags {
  importAlreadyLinked: boolean;
  hashAlreadyLinked: boolean;
  operationNumberAlreadyExists: boolean;
}

export interface OperationIaDuplicateOriginResolution {
  duplicate_origin_import_file_id: string | null;
  duplicate_hydration_status: 'hydrated' | 'missing';
  duplicate_hydration_resolution_method:
    | 'self_payload'
    | 'audit'
    | 'hash'
    | 'operation_number'
    | 'auto_reparse'
    | 'none';
  source_import_row: OperationIaImportRow | null;
  resolution_method: 'self_payload' | 'audit' | 'hash' | 'operation_number' | 'auto_reparse' | 'none';
}

const isTruthyEnvValue = (value: string): boolean =>
  ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());

export const isDuplicateTestModeEnabled = (): boolean => {
  const envFlag = isTruthyEnvValue(String(process.env.OPERACOES_IA_ALLOW_DUPLICATE_TEST || ''));
  if (!envFlag) return false;

  const vercelEnv = String(process.env.VERCEL_ENV || '').trim().toLowerCase();
  if (vercelEnv !== 'production') return true;

  return isTruthyEnvValue(String(process.env.OPERACOES_IA_ALLOW_DUPLICATE_TEST_PROD_OVERRIDE || ''));
};

export const isConflictOverrideDuplicateTestEnabled = (): boolean =>
  isTruthyEnvValue(String(process.env.OPERACOES_IA_ALLOW_CONFLICT_OVERRIDE_DUPLICATE_TEST || ''));

const OPERATION_IA_IMPORT_ROW_SELECT =
  'id,empresa_id,source,parse_status,parsed_payload,linked_operacao_id,operation_number,original_filename,file_sha256,program_hint,created_at,raw_text';

const hasHydratableParsedPayload = (payload: unknown): payload is Record<string, unknown> =>
  Boolean(payload && typeof payload === 'object' && Object.keys(payload as Record<string, unknown>).length > 0);

const getDuplicateOriginStatusPriority = (status?: string | null): number => {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'parsed') return 0;
  if (normalized === 'parse_partial') return 1;
  if (normalized === 'duplicate') return 2;
  if (normalized === 'failed') return 3;
  if (normalized === 'processing') return 4;
  if (normalized === 'received') return 5;
  return 10;
};

const normalizeImportRow = (value: unknown): OperationIaImportRow | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const id = String(row.id || '').trim();
  if (!id) return null;

  return {
    id,
    empresa_id: String(row.empresa_id || ''),
    source: String(row.source || ''),
    parse_status: String(row.parse_status || ''),
    parsed_payload:
      row.parsed_payload && typeof row.parsed_payload === 'object'
        ? (row.parsed_payload as Record<string, unknown>)
        : null,
    linked_operacao_id:
      typeof row.linked_operacao_id === 'number' && Number.isFinite(row.linked_operacao_id)
        ? row.linked_operacao_id
        : null,
    operation_number: typeof row.operation_number === 'string' ? row.operation_number : null,
    original_filename: typeof row.original_filename === 'string' ? row.original_filename : null,
    file_sha256: typeof row.file_sha256 === 'string' ? row.file_sha256 : null,
    program_hint: normalizeProgram(typeof row.program_hint === 'string' ? row.program_hint : null),
    created_at: typeof row.created_at === 'string' ? row.created_at : new Date(0).toISOString(),
    raw_text: typeof row.raw_text === 'string' ? row.raw_text : null,
  };
};

const isHydratableDuplicateOriginRow = (
  row: OperationIaImportRow | null,
  duplicateImportId: string
): row is OperationIaImportRow => {
  if (!row) return false;
  if (row.id === duplicateImportId) return false;
  if (!hasHydratableParsedPayload(row.parsed_payload)) return false;
  return true;
};

const hasSoiFormulaV2Payload = (payload: Record<string, unknown> | null): boolean => {
  const canonical = normalizeLegacyToCanonical((payload || null) as never);
  if (!canonical || typeof canonical !== 'object') return false;
  const debug = ((canonical.debug || {}) as Record<string, unknown>) || {};
  const formula = debug.soi_formula_v2;
  if (!formula || typeof formula !== 'object') return false;
  const required = ['valor_original', 'valor_desagio', 'despesas', 'liquido_liberado'];
  return required.every((key) => {
    const raw = (formula as Record<string, unknown>)[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return true;
    if (!raw || typeof raw !== 'object') return false;
    const nested = toNumber((raw as Record<string, unknown>).value);
    return nested !== null;
  });
};

const pickBestDuplicateOriginCandidate = (
  rows: OperationIaImportRow[],
  duplicateImportRow: OperationIaImportRow
): OperationIaImportRow | null => {
  const candidates = rows.filter((row) => isHydratableDuplicateOriginRow(row, duplicateImportRow.id));
  if (!candidates.length) return null;

  const duplicateCanonical = normalizeLegacyToCanonical((duplicateImportRow.parsed_payload || null) as never);
  const targetProgram =
    normalizeProgram(duplicateCanonical?.program) || normalizeProgram(duplicateImportRow.program_hint);
  const duplicateSource = String(duplicateImportRow.source || '').toLowerCase();
  const score = (row: OperationIaImportRow) => ({
    formulaPenalty:
      targetProgram === 'SOI' && !hasSoiFormulaV2Payload(row.parsed_payload || null)
        ? 1
        : 0,
    statusPriority: getDuplicateOriginStatusPriority(row.parse_status),
    sourcePenalty: String(row.source || '').toLowerCase() === duplicateSource ? 0 : 1,
    createdAt: Number.isFinite(Date.parse(String(row.created_at || '')))
      ? Date.parse(String(row.created_at || ''))
      : 0,
  });

  return [...candidates].sort((left, right) => {
    const l = score(left);
    const r = score(right);
    if (l.formulaPenalty !== r.formulaPenalty) return l.formulaPenalty - r.formulaPenalty;
    if (l.statusPriority !== r.statusPriority) return l.statusPriority - r.statusPriority;
    if (l.sourcePenalty !== r.sourcePenalty) return l.sourcePenalty - r.sourcePenalty;
    return r.createdAt - l.createdAt;
  })[0];
};

const toCandidateImportId = (value: unknown): string | null => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const IMPORT_ID_KEY_HINTS = [
  /import[_-]?file[_-]?id/i,
  /existing[_-]?import[_-]?id/i,
  /duplicate[_-]?import[_-]?id/i,
  /origin(?:al)?[_-]?import[_-]?id/i,
  /source[_-]?import[_-]?id/i,
];

const isLikelyImportIdKey = (key: string): boolean =>
  IMPORT_ID_KEY_HINTS.some((pattern) => pattern.test(String(key || '')));

const collectDuplicateOriginCandidateIds = (
  value: unknown,
  collector: Set<string>,
  depth = 0
): void => {
  if (depth > 5 || value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDuplicateOriginCandidateIds(entry, collector, depth + 1);
    }
    return;
  }

  if (typeof value !== 'object') return;

  const row = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(row)) {
    if (isLikelyImportIdKey(key)) {
      const candidate = toCandidateImportId(entry);
      if (candidate) {
        collector.add(candidate);
      }
    }
    if (entry && typeof entry === 'object') {
      collectDuplicateOriginCandidateIds(entry, collector, depth + 1);
    }
  }
};

const extractDuplicateOriginCandidateIds = (details: unknown): string[] => {
  if (!details || typeof details !== 'object') return [];
  const collector = new Set<string>();
  collectDuplicateOriginCandidateIds(details, collector);

  const obj = details as Record<string, unknown>;
  const nestedDuplicateRow =
    obj.duplicate_row && typeof obj.duplicate_row === 'object'
      ? (obj.duplicate_row as Record<string, unknown>)
      : obj.duplicateRow && typeof obj.duplicateRow === 'object'
        ? (obj.duplicateRow as Record<string, unknown>)
        : null;
  const nestedDuplicateRowId = toCandidateImportId(nestedDuplicateRow?.id);
  if (nestedDuplicateRowId) collector.add(nestedDuplicateRowId);

  return Array.from(collector);
};

const normalizeOperationNumberComparable = (value: unknown): string =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();

const extractOperationNumberCandidates = (row: OperationIaImportRow): string[] => {
  const candidates = new Set<string>();

  const direct = String(row.operation_number || '').trim();
  if (direct) {
    candidates.add(direct);
  }

  const extractNumericChunks = (value: string): void => {
    const matches = value.match(/\d{3,}/g) || [];
    for (const match of matches) {
      const normalized = String(match || '').trim();
      if (normalized) candidates.add(normalized);
    }
  };

  if (direct) extractNumericChunks(direct);

  const originalFilename = String(row.original_filename || '').trim();
  if (originalFilename) {
    const withoutExtension = originalFilename.replace(/\.[^.]+$/, '');
    extractNumericChunks(withoutExtension);
  }

  return Array.from(candidates);
};

const matchOperationNumberCandidate = (
  rows: OperationIaImportRow[],
  candidate: string
): OperationIaImportRow[] => {
  const normalizedCandidate = normalizeOperationNumberComparable(candidate);
  if (!normalizedCandidate) return rows;

  const exact = rows.filter((row) => {
    const normalizedRow = normalizeOperationNumberComparable(row.operation_number || '');
    return normalizedRow === normalizedCandidate;
  });
  if (exact.length) return exact;

  const inclusive = rows.filter((row) => {
    const normalizedRow = normalizeOperationNumberComparable(row.operation_number || '');
    if (!normalizedRow) return false;
    return normalizedRow.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedRow);
  });
  if (inclusive.length) return inclusive;

  return rows;
};

export const resolveDuplicateOriginImport = async (
  adminClient: SupabaseClient,
  empresaId: string,
  duplicateImportRow: OperationIaImportRow,
  source = 'disecurit'
): Promise<OperationIaDuplicateOriginResolution> => {
  const duplicateImportForRanking: OperationIaImportRow = {
    ...duplicateImportRow,
    source: duplicateImportRow.source || source,
  };
  const defaultMissing: OperationIaDuplicateOriginResolution = {
    duplicate_origin_import_file_id: null,
    duplicate_hydration_status: 'missing',
    duplicate_hydration_resolution_method: 'none',
    source_import_row: null,
    resolution_method: 'none',
  };

  if (duplicateImportRow.parse_status !== 'duplicate') {
    return defaultMissing;
  }

  const duplicateCanonical = normalizeLegacyToCanonical((duplicateImportRow.parsed_payload || null) as never);
  const targetProgram = normalizeProgram(duplicateCanonical?.program) || normalizeProgram(duplicateImportRow.program_hint);
  if (
    hasHydratableParsedPayload(duplicateImportRow.parsed_payload) &&
    (targetProgram !== 'SOI' || hasSoiFormulaV2Payload(duplicateImportRow.parsed_payload))
  ) {
    return {
      duplicate_origin_import_file_id: duplicateImportRow.id,
      duplicate_hydration_status: 'hydrated',
      duplicate_hydration_resolution_method: 'self_payload',
      source_import_row: duplicateImportRow,
      resolution_method: 'self_payload',
    };
  }

  const loadImportById = async (importId: string): Promise<OperationIaImportRow | null> => {
    const normalizedId = String(importId || '').trim();
    if (!normalizedId) return null;
    const { data, error } = await adminClient
      .from('operation_import_files')
      .select(OPERATION_IA_IMPORT_ROW_SELECT)
      .eq('empresa_id', empresaId)
      .eq('id', normalizedId)
      .limit(1);
    if (error) return null;
    const row = normalizeImportRow(Array.isArray(data) ? data[0] : null);
    return isHydratableDuplicateOriginRow(row, duplicateImportRow.id) ? row : null;
  };

  const { data: auditData } = await adminClient
    .from('integration_audit_log')
    .select('details,created_at')
    .eq('empresa_id', empresaId)
    .eq('import_file_id', duplicateImportRow.id)
    .order('created_at', { ascending: false })
    .limit(25);

  const auditCandidateIds = Array.from(
    new Set(
      (Array.isArray(auditData) ? auditData : [])
        .flatMap((entry) =>
          extractDuplicateOriginCandidateIds(
            entry && typeof entry === 'object' ? (entry as Record<string, unknown>).details : null
          )
        )
        .filter((value): value is string => Boolean(value && value !== duplicateImportRow.id))
    )
  );

  const auditCandidates: OperationIaImportRow[] = [];
  for (const candidateId of auditCandidateIds) {
    const origin = await loadImportById(candidateId);
    if (!origin) continue;
    auditCandidates.push(origin);
  }
  const bestAuditCandidate = pickBestDuplicateOriginCandidate(auditCandidates, duplicateImportForRanking);
  if (bestAuditCandidate) {
    return {
      duplicate_origin_import_file_id: bestAuditCandidate.id,
      duplicate_hydration_status: 'hydrated',
      duplicate_hydration_resolution_method: 'audit',
      source_import_row: bestAuditCandidate,
      resolution_method: 'audit',
    };
  }

  const fileHash = String(duplicateImportRow.file_sha256 || '').trim();
  if (fileHash) {
    const { data } = await adminClient
      .from('operation_import_files')
      .select(OPERATION_IA_IMPORT_ROW_SELECT)
      .eq('empresa_id', empresaId)
      .eq('file_sha256', fileHash)
      .neq('id', duplicateImportRow.id)
      .order('created_at', { ascending: false })
      .limit(25);
    const candidate = pickBestDuplicateOriginCandidate(
      (Array.isArray(data) ? data : [])
      .map((row) => normalizeImportRow(row))
      .filter((row): row is OperationIaImportRow => Boolean(row)),
      duplicateImportForRanking
    );
    if (candidate) {
      return {
        duplicate_origin_import_file_id: candidate.id,
        duplicate_hydration_status: 'hydrated',
        duplicate_hydration_resolution_method: 'hash',
        source_import_row: candidate,
        resolution_method: 'hash',
      };
    }
  }

  const operationNumberCandidates = extractOperationNumberCandidates(duplicateImportRow);
  for (const operationNumberCandidate of operationNumberCandidates) {
    const { data } = await adminClient
      .from('operation_import_files')
      .select(OPERATION_IA_IMPORT_ROW_SELECT)
      .eq('empresa_id', empresaId)
      .ilike('operation_number', `%${operationNumberCandidate}%`)
      .neq('id', duplicateImportRow.id)
      .order('created_at', { ascending: false })
      .limit(50);
    const normalizedRows = (Array.isArray(data) ? data : [])
      .map((row) => normalizeImportRow(row))
      .filter((row): row is OperationIaImportRow => Boolean(row));
    const candidate = pickBestDuplicateOriginCandidate(
      matchOperationNumberCandidate(normalizedRows, operationNumberCandidate),
      duplicateImportForRanking
    );
    if (candidate) {
      return {
        duplicate_origin_import_file_id: candidate.id,
        duplicate_hydration_status: 'hydrated',
        duplicate_hydration_resolution_method: 'operation_number',
        source_import_row: candidate,
        resolution_method: 'operation_number',
      };
    }
  }

  return defaultMissing;
};

interface FornecedorSuggestion {
  fornecedorId: string | null;
  method: OperationIaFornecedorMatchMethod;
  confidence: number | null;
  ambiguousByName: boolean;
}

export const FORNECEDOR_NAME_THRESHOLD = 0.92;

export const normalizeProgram = (value?: string | null): OperationIaProgram | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SPPRO' || normalized === 'SOI') return normalized;
  return null;
};

export const normalizeCnpj = (value?: string | null): string =>
  String(value || '')
    .replace(/\D/g, '')
    .trim();

const normalizeText = (value?: string | null): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeComparableText = (value?: string | null): string => normalizeText(value);

const tokenize = (value?: string | null): Set<string> =>
  new Set(
    normalizeText(value)
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
  );

const jaccardSimilarity = (left?: string | null, right?: string | null): number => {
  const a = tokenize(left);
  const b = tokenize(right);

  if (!a.size || !b.size) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  if (!union) return 0;

  return intersection / union;
};

export const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
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

export const toDateOnly = (value?: string | null): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const hasSoiFormulaV2 = (payload: Record<string, unknown> | null): boolean => {
  if (!payload || typeof payload !== 'object') return false;
  const debug = (payload.debug || {}) as Record<string, unknown>;
  const formula =
    debug.soi_formula_v2 && typeof debug.soi_formula_v2 === 'object'
      ? (debug.soi_formula_v2 as Record<string, unknown>)
      : null;
  if (!formula) return false;

  const readValue = (key: string): number | null => {
    const raw = formula[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const value = toNumber((raw as Record<string, unknown>).value);
      if (value !== null) return value;
    }
    return null;
  };

  const formulaValues = {
    valor_original: readValue('valor_original'),
    valor_desagio: readValue('valor_desagio'),
    valor_desagio_antecipacao: readValue('valor_desagio_antecipacao'),
    despesas: readValue('despesas'),
    regresso: readValue('regresso'),
    amortiza_debitos: readValue('amortiza_debitos'),
    amortiza_creditos: readValue('amortiza_creditos'),
    creditos_gerados: readValue('creditos_gerados'),
    liquido_liberado: readValue('liquido_liberado'),
  };

  if (Object.values(formulaValues).some((value) => value === null)) {
    return false;
  }

  const computedLiquido =
    (formulaValues.valor_original as number) -
    (formulaValues.valor_desagio as number) -
    (formulaValues.valor_desagio_antecipacao as number) -
    (formulaValues.despesas as number) -
    (formulaValues.regresso as number) -
    (formulaValues.amortiza_debitos as number) +
    (formulaValues.amortiza_creditos as number) -
    (formulaValues.creditos_gerados as number);
  const targetLiquido = formulaValues.liquido_liberado as number;
  const tolerance = resolveHybridTolerance(computedLiquido, targetLiquido);

  return Math.abs(computedLiquido - targetLiquido) <= tolerance;
};

export type SoiOriginRefreshResult = {
  row: OperationIaImportRow;
  refreshed: boolean;
  status: 'ok' | 'source_stale' | 'auto_reparse_pending';
};

export const refreshSoiOriginPayloadIfNeeded = async (
  adminClient: SupabaseClient,
  row: OperationIaImportRow
): Promise<SoiOriginRefreshResult> => {
  const canonical = normalizeLegacyToCanonical((row.parsed_payload || null) as never);
  const program = normalizeProgram(canonical?.program) || normalizeProgram(row.program_hint);
  if (program !== 'SOI') {
    return { row, refreshed: false, status: 'ok' };
  }
  if (hasSoiFormulaV2(row.parsed_payload || null)) {
    return { row, refreshed: false, status: 'ok' };
  }

  const rawText = String(row.raw_text || '').trim();
  if (!rawText) {
    return { row, refreshed: false, status: 'source_stale' };
  }

  const reparsed = parseDisecuritPdfText(rawText, 'SOI', {
    hints: {
      operation_number: row.operation_number || null,
    },
  });
  const nextPayload = reparsed as unknown as Record<string, unknown>;
  const nextRow: OperationIaImportRow = {
    ...row,
    parsed_payload: nextPayload,
  };

  const formulaReady = hasSoiFormulaV2(nextPayload);
  try {
    await adminClient
      .from('operation_import_files')
      .update({
        parsed_payload: nextPayload,
      })
      .eq('empresa_id', row.empresa_id)
      .eq('id', row.id);
  } catch {
    // Non-blocking refresh: preview/confirm can continue with in-memory payload.
  }

  return {
    row: nextRow,
    refreshed: true,
    status: formulaReady ? 'ok' : 'auto_reparse_pending',
  };
};

const resolveFornecedorSuggestion = (
  parsedClientDoc: string | null,
  parsedClientName: string | null,
  fornecedores: OperationIaFornecedorRow[]
): FornecedorSuggestion => {
  const normalizedClientDoc = normalizeCnpj(parsedClientDoc);
  if (normalizedClientDoc) {
    const byCnpj = fornecedores.find((fornecedor) => normalizeCnpj(fornecedor.cnpj) === normalizedClientDoc);
    if (byCnpj) {
      return {
        fornecedorId: byCnpj.id,
        method: 'cnpj',
        confidence: 1,
        ambiguousByName: false,
      };
    }
  }

  const normalizedClientName = normalizeText(parsedClientName);
  if (!normalizedClientName) {
    return {
      fornecedorId: null,
      method: 'none',
      confidence: null,
      ambiguousByName: false,
    };
  }

  const scored = fornecedores
    .map((fornecedor) => {
      const razaoScore = jaccardSimilarity(normalizedClientName, fornecedor.razao_social);
      const fantasiaScore = jaccardSimilarity(normalizedClientName, fornecedor.nome_fantasia);
      const score = Math.max(razaoScore, fantasiaScore);
      return {
        fornecedor,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const second = scored[1];

  if (!best || best.score < FORNECEDOR_NAME_THRESHOLD) {
    return {
      fornecedorId: null,
      method: 'none',
      confidence: null,
      ambiguousByName: false,
    };
  }

  const ambiguousByName = Boolean(second && Math.abs(best.score - second.score) < 0.02);
  if (ambiguousByName) {
    return {
      fornecedorId: null,
      method: 'none',
      confidence: best.score,
      ambiguousByName: true,
    };
  }

  return {
    fornecedorId: best.fornecedor.id,
    method: 'name_fuzzy',
    confidence: best.score,
    ambiguousByName: false,
  };
};

const resolveDefaultEstoqueId = (program: OperationIaProgram | null, estoques: OperationIaEstoqueRow[]): number | null => {
  if (!program) return null;

  const normalizedProgram = program.toUpperCase();
  const candidate = estoques
    .filter((estoque) => normalizeProgram(estoque.tipo) === normalizedProgram)
    .sort((a, b) => String(a.descricao || '').localeCompare(String(b.descricao || '')))[0];

  return candidate?.id ?? null;
};

const pickValorCompra = (program: OperationIaProgram | null, values: Record<string, unknown>): number | null => {
  const purchase = toNumber(values.purchase_value);
  const discount = toNumber(values.discount_value);
  const net = toNumber(values.net_value);

  if (program === 'SPPRO') {
    return purchase ?? discount ?? net;
  }

  if (program === 'SOI') {
    return discount ?? purchase ?? net;
  }

  return purchase ?? net ?? discount;
};

const toNonNegative = (value: number | null): number | null => {
  if (value === null) return null;
  return value < 0 ? 0 : value;
};

const resolveHybridTolerance = (...values: Array<number | null | undefined>): number => {
  const base = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce((max, current) => Math.max(max, Math.abs(current)), 0);
  return Math.max(0.5, Number((base * 0.002).toFixed(2)));
};

const resolveSoiFormula = (canonical: unknown): OperationIaSoiFormula => {
  const canonicalRecord =
    canonical && typeof canonical === 'object' ? (canonical as Record<string, unknown>) : {};
  const values = ((canonicalRecord.values || {}) as Record<string, unknown>) || {};
  const debug = ((canonicalRecord.debug || {}) as Record<string, unknown>) || {};
  const soiFormulaRaw =
    ((debug.soi_formula_v2 && typeof debug.soi_formula_v2 === 'object'
      ? debug.soi_formula_v2
      : debug.soi_formula) &&
    typeof (debug.soi_formula_v2 || debug.soi_formula) === 'object')
      ? ((debug.soi_formula_v2 || debug.soi_formula) as Record<string, unknown>)
      : null;

  const readFormulaField = (fieldName: keyof OperationIaSoiFormula, fallback: number | null): number | null => {
    if (!soiFormulaRaw) return fallback;
    const field = soiFormulaRaw[fieldName];
    if (typeof field === 'number') return toNonNegative(toNumber(field));
    if (field && typeof field === 'object') {
      const value = toNumber((field as Record<string, unknown>).value);
      if (value !== null) return toNonNegative(value);
    }
    if (fieldName === 'valor_desagio_antecipacao') {
      const legacyField = soiFormulaRaw.desagio_antecipacao;
      if (legacyField && typeof legacyField === 'object') {
        const legacyValue = toNumber((legacyField as Record<string, unknown>).value);
        if (legacyValue !== null) return toNonNegative(legacyValue);
      }
      if (typeof legacyField === 'number' && Number.isFinite(legacyField)) {
        return toNonNegative(legacyField);
      }
    }
    return fallback;
  };

  const valorDesagioAntecipacao = readFormulaField(
    'valor_desagio_antecipacao',
    toNonNegative(toNumber(values.expenses) ?? 0)
  );
  const despesas = readFormulaField('despesas', 0);
  const amortizaDebitos = readFormulaField('amortiza_debitos', 0);
  const creditosGerados = readFormulaField(
    'creditos_gerados',
    toNonNegative(toNumber(values.amort_debits) ?? 0)
  );
  const aggregatedAmortDebits = toNonNegative(toNumber(values.amort_debits) ?? 0) ?? 0;

  return {
    valor_original: readFormulaField('valor_original', toNonNegative(toNumber(values.face_value))),
    valor_desagio: readFormulaField(
      'valor_desagio',
      toNonNegative(toNumber(values.discount_value) ?? toNumber(values.purchase_value))
    ),
    valor_desagio_antecipacao: valorDesagioAntecipacao,
    despesas:
      despesas !== null && despesas > 0
        ? despesas
        : Math.max(0, (toNonNegative(toNumber(values.expenses) ?? 0) ?? 0) - (valorDesagioAntecipacao ?? 0)),
    regresso: readFormulaField('regresso', toNonNegative(toNumber(values.recompra) ?? 0)),
    amortiza_debitos:
      amortizaDebitos !== null && amortizaDebitos > 0
        ? amortizaDebitos
        : Math.max(0, aggregatedAmortDebits - (creditosGerados ?? 0)),
    amortiza_creditos: readFormulaField('amortiza_creditos', toNonNegative(toNumber(values.amort_credits) ?? 0)),
    creditos_gerados: creditosGerados,
    liquido_liberado: readFormulaField('liquido_liberado', toNonNegative(toNumber(values.net_value))),
  };
};

const resolveSpproFormula = (canonical: unknown): OperationIaSpproFormula => {
  const canonicalRecord =
    canonical && typeof canonical === 'object' ? (canonical as Record<string, unknown>) : {};
  const values = ((canonicalRecord.values || {}) as Record<string, unknown>) || {};
  const debug = ((canonicalRecord.debug || {}) as Record<string, unknown>) || {};
  const spproFormulaRaw =
    debug.sppro_formula && typeof debug.sppro_formula === 'object'
      ? (debug.sppro_formula as Record<string, unknown>)
      : null;

  const readFormulaField = (
    fieldName: keyof OperationIaSpproFormula,
    fallback: number | null
  ): number | null => {
    if (!spproFormulaRaw) return fallback;
    const field = spproFormulaRaw[fieldName];
    if (typeof field === 'number') return toNonNegative(toNumber(field));
    if (field && typeof field === 'object') {
      const value = toNumber((field as Record<string, unknown>).value);
      if (value !== null) return toNonNegative(value);
    }
    return fallback;
  };

  return {
    quantidade_titulos: readFormulaField('quantidade_titulos', null),
    valor_face: readFormulaField('valor_face', toNonNegative(toNumber(values.face_value))),
    valor_compra: readFormulaField(
      'valor_compra',
      toNonNegative(toNumber(values.purchase_value) ?? toNumber(values.discount_value) ?? toNumber(values.net_value))
    ),
    ad_valorem: readFormulaField('ad_valorem', toNonNegative(toNumber(values.ad_valorem) ?? 0)),
    iss: readFormulaField('iss', toNonNegative(toNumber(values.iss) ?? 0)),
    despesas: readFormulaField('despesas', toNonNegative(toNumber(values.expenses) ?? 0)),
    iof: readFormulaField('iof', toNonNegative(toNumber(values.iof) ?? 0)),
    iof_adicional: readFormulaField('iof_adicional', toNonNegative(toNumber(values.iof_additional) ?? 0)),
    recompra: readFormulaField('recompra', toNonNegative(toNumber(values.recompra) ?? 0)),
    liquido_operacao: readFormulaField('liquido_operacao', toNonNegative(toNumber(values.net_value))),
  };
};

const pickHistorico = (program: OperationIaProgram | null, canonicalPayload: Record<string, unknown>): string | null => {
  if (program === 'SPPRO') {
    const mapped = mapToUiSPPRO(canonicalPayload as never);
    if (mapped?.documento) {
      return `Importado via DISECURIT SPPRO (${mapped.documento})`;
    }
    return 'Importado via DISECURIT SPPRO';
  }

  if (program === 'SOI') {
    const mapped = mapToUiSOI(canonicalPayload as never);
    return mapped?.historico || 'Importado via DISECURIT SOI';
  }

  return 'Importado via DISECURIT';
};

const formatCurrencyBr = (value: number): string =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export const evaluateDraftIssues = (item: {
  parse_status: string;
  linked_operacao_id: number | null;
  program: OperationIaProgram | null;
  soi_formula?: OperationIaSoiFormula | null;
  sppro_formula?: OperationIaSpproFormula | null;
  estoque_id: number | null;
  fornecedor_id: string | null;
  conta_bancaria_id: string | null;
  data_operacao: string | null;
  face_titulos: number | null;
  valor_compra: number | null;
  fornecedor_name_ambiguous?: boolean;
  has_critical_conflict?: boolean;
}): string[] => {
  const issues: string[] = [];

  if (item.parse_status !== 'parsed' && item.parse_status !== 'parse_partial') {
    issues.push(`Import em status ${item.parse_status}. Reprocesse antes de confirmar.`);
  }

  if (item.linked_operacao_id) {
    issues.push(`Import já vinculado à operação #${item.linked_operacao_id}.`);
  }

  if (!item.program) {
    issues.push('Programa (SPPRO/SOI) é obrigatório.');
  }

  if (!item.estoque_id) {
    issues.push('Estoque é obrigatório para criação da operação.');
  }

  if (!item.fornecedor_id) {
    issues.push('Fornecedor não identificado. Item deve permanecer em revisão.');
  }

  if (!item.conta_bancaria_id) {
    issues.push('Conta bancária é obrigatória para criar operação de entrada.');
  }

  if (item.fornecedor_name_ambiguous) {
    issues.push('Fornecedor ambíguo por nome. Escolha manual obrigatória.');
  }

  if (!item.data_operacao) {
    issues.push('Data da operação é obrigatória.');
  }

  if (!item.face_titulos || item.face_titulos <= 0) {
    issues.push('Valor face dos títulos deve ser maior que zero.');
  }

  if (!item.valor_compra || item.valor_compra <= 0) {
    issues.push(item.program === 'SOI' ? 'Valor de Deságio deve ser maior que zero.' : 'Valor de compra/líquido deve ser maior que zero.');
  }

  if (item.program === 'SOI') {
    const formula = item.soi_formula;
    const liquidoLiberado = toNumber(formula?.liquido_liberado);
    if (!liquidoLiberado || liquidoLiberado <= 0) {
      issues.push('Líquido Liberado deve ser maior que zero.');
    }

    const numericFields: Array<{ label: string; value: number | null }> = [
      { label: 'Valor Original', value: toNumber(formula?.valor_original) },
      { label: 'Valor de Deságio', value: toNumber(formula?.valor_desagio) },
      { label: 'Valor de Deságio Antecipação', value: toNumber(formula?.valor_desagio_antecipacao) },
      { label: 'Despesas', value: toNumber(formula?.despesas) },
      { label: 'Regresso', value: toNumber(formula?.regresso) },
      { label: 'Amortiza débitos', value: toNumber(formula?.amortiza_debitos) },
      { label: 'Amortiza créditos', value: toNumber(formula?.amortiza_creditos) },
      { label: 'Créditos gerados', value: toNumber(formula?.creditos_gerados) },
      { label: 'Líquido Liberado', value: liquidoLiberado },
    ];
    for (const field of numericFields) {
      if (field.value !== null && field.value < 0) {
        issues.push(`${field.label} não pode ser negativo.`);
      }
    }

    const valorOriginal = toNumber(formula?.valor_original);
    const valorDesagio = toNumber(formula?.valor_desagio);
    if (valorOriginal !== null && valorDesagio !== null && liquidoLiberado !== null) {
      const computedLiquido =
        valorOriginal -
        valorDesagio -
        (toNumber(formula?.valor_desagio_antecipacao) || 0) -
        (toNumber(formula?.despesas) || 0) -
        (toNumber(formula?.regresso) || 0) -
        (toNumber(formula?.amortiza_debitos) || 0) +
        (toNumber(formula?.amortiza_creditos) || 0) -
        (toNumber(formula?.creditos_gerados) || 0);
      const tolerance = resolveHybridTolerance(computedLiquido, liquidoLiberado);
      if (Math.abs(computedLiquido - liquidoLiberado) > tolerance) {
        issues.push('Fórmula SOI inconsistente: revise os campos antes de confirmar.');
      }
    }
  }

  if (item.program === 'SPPRO') {
    const formula = item.sppro_formula;
    const liquidoOperacao = toNumber(formula?.liquido_operacao) ?? toNumber(item.valor_compra);
    if (!liquidoOperacao || liquidoOperacao <= 0) {
      issues.push('Valor Líquido da Operação deve ser maior que zero.');
    }

    if (formula) {
      const numericFields: Array<{ label: string; value: number | null }> = [
        { label: 'Valor de Face dos Títulos', value: toNumber(formula.valor_face) },
        { label: 'Valor de Compra', value: toNumber(formula.valor_compra) },
        { label: 'Valor de Ad-valorem', value: toNumber(formula.ad_valorem) },
        { label: 'Valor de ISS', value: toNumber(formula.iss) },
        { label: 'Valor de Despesas', value: toNumber(formula.despesas) },
        { label: 'Valor de IOF', value: toNumber(formula.iof) },
        { label: 'Valor de IOF Adicional', value: toNumber(formula.iof_adicional) },
        { label: 'Valor de Recompra', value: toNumber(formula.recompra) },
      ];
      for (const field of numericFields) {
        if (field.value !== null && field.value < 0) {
          issues.push(`${field.label} não pode ser negativo.`);
        }
      }

      const valorFace = toNumber(formula.valor_face);
      const valorCompra = toNumber(formula.valor_compra);
      if (valorFace !== null && valorCompra !== null && liquidoOperacao !== null) {
        const computedLiquido =
          valorFace -
          valorCompra -
          (toNumber(formula.ad_valorem) || 0) -
          (toNumber(formula.iss) || 0) -
          (toNumber(formula.despesas) || 0) -
          (toNumber(formula.iof) || 0) -
          (toNumber(formula.iof_adicional) || 0) -
          (toNumber(formula.recompra) || 0);
        const tolerance = resolveHybridTolerance(computedLiquido, liquidoOperacao);
        if (Math.abs(computedLiquido - liquidoOperacao) > tolerance) {
          issues.push('Fórmula SPPRO inconsistente: revise os campos antes de confirmar.');
        }
      }
    }
  }

  if (item.has_critical_conflict) {
    issues.push('Conflito crítico de extração numérica. Revise os campos antes de confirmar.');
  }

  return issues;
};

export const resolveDraftStatus = (issues: string[]): OperationIaDraftItem['status'] => {
  if (!issues.length) return 'ready';

  const hardError = issues.some((issue) =>
    issue.includes('Import em status') || issue.includes('já vinculado')
  );

  if (hardError) return 'error';
  return 'review';
};

export type BuildDraftItemFromImportOptions = {
  /** Fallback quando `canonical.document.date` / `payment_date` estiverem ausentes. */
  referenceDate?: string | null;
  /** Conta bancária padrão para inicializar o draft do lote. */
  defaultContaBancariaId?: string | null;
};

export const buildDraftItemFromImport = (
  importRow: OperationIaImportRow,
  fornecedores: OperationIaFornecedorRow[],
  estoques: OperationIaEstoqueRow[],
  options?: BuildDraftItemFromImportOptions
): OperationIaDraftItem => {
  const canonical = normalizeLegacyToCanonical(importRow.parsed_payload as never);

  const normalizeExtractionDiagnostics = (raw: unknown): OperationIaExtractionDiagnostic[] => {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((item) => {
        const row = (item || {}) as Record<string, unknown>;
        const fieldNameRaw = row.field_name;
        if (typeof fieldNameRaw !== 'string' || !fieldNameRaw.trim()) return null;
        const resolvedValueRaw = row.resolved_value;
        const resolvedValue =
          typeof resolvedValueRaw === 'number' && Number.isFinite(resolvedValueRaw) ? resolvedValueRaw : null;
        const confidenceRaw = row.confidence;
        const confidence =
          typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw) ? confidenceRaw : null;
        const comparedValueRaw = row.compared_value;
        const comparedValue =
          typeof comparedValueRaw === 'number' && Number.isFinite(comparedValueRaw) ? comparedValueRaw : null;
        const toleranceRaw = row.tolerance;
        const tolerance = typeof toleranceRaw === 'number' && Number.isFinite(toleranceRaw) ? toleranceRaw : null;
        const differenceRaw = row.difference;
        const difference = typeof differenceRaw === 'number' && Number.isFinite(differenceRaw) ? differenceRaw : null;
        const sourceRaw = String(row.source_method || '').trim().toLowerCase();
        const sourceMethod =
          sourceRaw === 'regex' || sourceRaw === 'ocr' || sourceRaw === 'heuristic' || sourceRaw === 'manual'
            ? sourceRaw
            : 'heuristic';
        const candidatesRaw = Array.isArray(row.candidates) ? row.candidates : [];
        const candidates = candidatesRaw
          .map((candidate) => {
            const candidateRow = (candidate || {}) as Record<string, unknown>;
            const valueRaw = candidateRow.value;
            const value = typeof valueRaw === 'number' && Number.isFinite(valueRaw) ? valueRaw : null;
            const rawValueRaw = candidateRow.raw_value;
            const rawValue = typeof rawValueRaw === 'string' ? rawValueRaw : null;
            const candidateSourceRaw = String(candidateRow.source_method || '').trim().toLowerCase();
            const candidateSource =
              candidateSourceRaw === 'regex' ||
              candidateSourceRaw === 'ocr' ||
              candidateSourceRaw === 'heuristic' ||
              candidateSourceRaw === 'manual'
                ? candidateSourceRaw
                : sourceMethod;
            const candidateConfidenceRaw = candidateRow.confidence;
            const candidateConfidence =
              typeof candidateConfidenceRaw === 'number' && Number.isFinite(candidateConfidenceRaw)
                ? candidateConfidenceRaw
                : null;
            return {
              value,
              raw_value: rawValue,
              source_method: candidateSource,
              confidence: candidateConfidence,
            };
          })
          .filter((candidate) => candidate.value !== null);

        return {
          field_name: fieldNameRaw,
          resolved_value: resolvedValue,
          source_method: sourceMethod,
          confidence,
          conflict_flag: Boolean(row.conflict_flag),
          critical: Boolean(row.critical),
          reason: typeof row.reason === 'string' ? row.reason : null,
          compared_value: comparedValue,
          tolerance,
          difference,
          candidates,
        } as OperationIaExtractionDiagnostic;
      })
      .filter((row): row is OperationIaExtractionDiagnostic => Boolean(row));
  };

  if (!canonical) {
    const issues = ['Payload de importação inválido. Reprocesse este arquivo.'];
    return {
      id: `item:${importRow.id}`,
      import_file_id: importRow.id,
      source_type: 'disecurit_pdf',
      parse_status: importRow.parse_status,
      original_filename: importRow.original_filename,
      operation_number: importRow.operation_number,
      file_sha256: importRow.file_sha256,
      linked_operacao_id: importRow.linked_operacao_id,
      program: normalizeProgram(importRow.program_hint),
      estoque_id: null,
      fornecedor_id: null,
      fornecedor_match_method: 'none',
      fornecedor_match_confidence: null,
      conta_bancaria_id: options?.defaultContaBancariaId || null,
      data_operacao: null,
      documento: importRow.operation_number,
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
      history_timeline: [],
      status: 'error',
      issues,
    };
  }

  const extractionDiagnostics = normalizeExtractionDiagnostics(canonical.debug?.extraction_diagnostics || []);
  const hasCriticalConflict =
    Boolean(canonical.debug?.has_critical_conflict) ||
    extractionDiagnostics.some((diagnostic) => diagnostic.critical && diagnostic.conflict_flag);

  const program = normalizeProgram(canonical.program) || normalizeProgram(importRow.program_hint);
  const soiFormula = program === 'SOI' ? resolveSoiFormula(canonical) : null;
  const spproFormula = program === 'SPPRO' ? resolveSpproFormula(canonical) : null;
  const fornecedorSuggestion = resolveFornecedorSuggestion(
    canonical.parties?.client_doc || null,
    canonical.parties?.client_name || null,
    fornecedores
  );
  const estoqueId = resolveDefaultEstoqueId(program, estoques);

  const parsedDate = toDateOnly(canonical.document?.date || canonical.document?.payment_date || null);
  const referenceFallback = toDateOnly(options?.referenceDate || null);
  const dataOperacao = parsedDate || referenceFallback;

  const item: OperationIaDraftItem = {
    id: `item:${importRow.id}`,
    import_file_id: importRow.id,
    source_type: 'disecurit_pdf',
    parse_status: importRow.parse_status,
    original_filename: importRow.original_filename,
    operation_number: importRow.operation_number,
    file_sha256: importRow.file_sha256,
    linked_operacao_id: importRow.linked_operacao_id,
    program,
    soi_formula: soiFormula,
    sppro_formula: spproFormula,
    estoque_id: estoqueId,
    fornecedor_id: fornecedorSuggestion.fornecedorId,
    fornecedor_match_method: fornecedorSuggestion.method,
    fornecedor_match_confidence: fornecedorSuggestion.confidence,
    conta_bancaria_id: options?.defaultContaBancariaId || null,
    data_operacao: dataOperacao,
    documento: canonical.document?.operation_number || canonical.document?.bordero_number || importRow.operation_number,
    historico: pickHistorico(program, canonical as never),
    face_titulos:
      program === 'SOI'
        ? soiFormula?.valor_original ?? toNumber(canonical.values?.face_value)
        : spproFormula?.valor_face ?? toNumber(canonical.values?.face_value),
    valor_compra:
      program === 'SOI'
        ? soiFormula?.valor_desagio ?? pickValorCompra(program, (canonical.values || {}) as Record<string, unknown>)
        : spproFormula?.valor_compra ?? pickValorCompra(program, (canonical.values || {}) as Record<string, unknown>),
    despesas:
      program === 'SOI'
        ? (soiFormula?.despesas ?? 0) + (soiFormula?.valor_desagio_antecipacao ?? 0)
        : spproFormula?.despesas ?? toNumber(canonical.values?.expenses) ?? 0,
    recompra:
      program === 'SOI'
        ? soiFormula?.regresso ?? toNumber(canonical.values?.recompra) ?? 0
        : spproFormula?.recompra ?? toNumber(canonical.values?.recompra) ?? 0,
    ad_valorem: spproFormula?.ad_valorem ?? toNumber(canonical.values?.ad_valorem) ?? 0,
    iss: spproFormula?.iss ?? toNumber(canonical.values?.iss) ?? 0,
    iof: spproFormula?.iof ?? toNumber(canonical.values?.iof) ?? 0,
    iof_adicional: spproFormula?.iof_adicional ?? toNumber(canonical.values?.iof_additional) ?? 0,
    amortizacao_debitos:
      program === 'SOI'
        ? (soiFormula?.amortiza_debitos ?? 0) + (soiFormula?.creditos_gerados ?? 0)
        : toNumber(canonical.values?.amort_debits) ?? 0,
    amortizacao_creditos: soiFormula?.amortiza_creditos ?? toNumber(canonical.values?.amort_credits) ?? 0,
    raw_pdf_snapshot: resolveRawSnapshot({
      program,
      canonical,
      extractionDiagnostics,
    }),
    extraction_diagnostics: extractionDiagnostics,
    has_critical_conflict: hasCriticalConflict,
    history_timeline: [],
    status: 'pending',
    issues: [],
  };

  const issues = evaluateDraftIssues({
    parse_status: item.parse_status,
    linked_operacao_id: item.linked_operacao_id,
    program: item.program,
    sppro_formula: item.sppro_formula,
    estoque_id: item.estoque_id,
    fornecedor_id: item.fornecedor_id,
    conta_bancaria_id: item.conta_bancaria_id,
    data_operacao: item.data_operacao,
    face_titulos: item.face_titulos,
    valor_compra: item.valor_compra,
    soi_formula: item.soi_formula,
    fornecedor_name_ambiguous: fornecedorSuggestion.ambiguousByName,
    has_critical_conflict: item.has_critical_conflict,
  });

  return {
    ...item,
    issues,
    status: resolveDraftStatus(issues),
  };
};

export const evaluateConfirmPayloadIssues = (
  payload: OperationIaConfirmItemPayload,
  importStatus: string,
  importLinkedOperationId: number | null,
  estoqueRow: OperationIaEstoqueRow | null,
  fornecedorRow: OperationIaFornecedorRow | null,
  contaRow: OperationIaContaBancariaRow | null
): string[] => {
  const issues = evaluateDraftIssues({
    parse_status: importStatus,
    linked_operacao_id: importLinkedOperationId,
    program: payload.program,
    soi_formula: payload.soi_formula || null,
    sppro_formula: payload.sppro_formula || null,
    estoque_id: payload.estoque_id,
    fornecedor_id: payload.fornecedor_id,
    conta_bancaria_id: payload.conta_bancaria_id,
    data_operacao: toDateOnly(payload.data_operacao),
    face_titulos: toNumber(payload.face_titulos),
    valor_compra: toNumber(payload.valor_compra),
    fornecedor_name_ambiguous: false,
  });

  if (payload.estoque_id && !estoqueRow) {
    issues.push('Estoque informado não foi encontrado para a empresa.');
  }

  if (payload.program && estoqueRow) {
    const estoqueProgram = normalizeProgram(estoqueRow.tipo);
    if (!estoqueProgram || estoqueProgram !== payload.program) {
      issues.push('Estoque incompatível com o programa selecionado.');
    }
  }

  if (payload.fornecedor_id && !fornecedorRow) {
    issues.push('Fornecedor informado não foi encontrado/ativo para a empresa.');
  }

  if (payload.conta_bancaria_id && !contaRow) {
    issues.push('Conta bancária informada não foi encontrada/ativa para a empresa.');
  }

  const numberFields: Array<{ key: string; value: unknown; label: string }> = [
    { key: 'despesas', value: payload.despesas, label: 'Despesas' },
    { key: 'recompra', value: payload.recompra, label: 'Recompra' },
    { key: 'ad_valorem', value: payload.ad_valorem, label: 'Ad-Valorem' },
    { key: 'iss', value: payload.iss, label: 'ISS' },
    { key: 'iof', value: payload.iof, label: 'IOF' },
    { key: 'iof_adicional', value: payload.iof_adicional, label: 'IOF adicional' },
    { key: 'amortizacao_debitos', value: payload.amortizacao_debitos, label: 'Amortização de débitos' },
    { key: 'amortizacao_creditos', value: payload.amortizacao_creditos, label: 'Amortização de créditos' },
  ];

  for (const field of numberFields) {
    const parsed = toNumber(field.value);
    if (parsed !== null && parsed < 0) {
      issues.push(`${field.label} não pode ser negativo.`);
    }
  }

  if (payload.program === 'SOI') {
    const liquidoLiberado = toNumber(payload.soi_formula?.liquido_liberado);
    if (!liquidoLiberado || liquidoLiberado <= 0) {
      issues.push('Líquido Liberado deve ser maior que zero.');
    }
  }

  return issues;
};

export const buildInsertPayloadFromConfirmItem = (
  empresaId: string,
  userId: string,
  item: OperationIaBatchConfirmItem
): Record<string, unknown> => {
  const payload = item.payload;

  const program = payload.program as OperationIaProgram;
  const soiFormula = payload.soi_formula || null;
  const spproFormula = payload.sppro_formula || null;
  const hasSoiFormulaPayload = Boolean(soiFormula && typeof soiFormula === 'object');
  const faceTitulos =
    program === 'SOI'
      ? toNumber(soiFormula?.valor_original) ?? toNumber(payload.face_titulos) ?? 0
      : toNumber(spproFormula?.valor_face) ?? toNumber(payload.face_titulos) ?? 0;
  const valorCompra =
    program === 'SOI'
      ? toNumber(soiFormula?.valor_desagio) ?? toNumber(payload.valor_compra) ?? 0
      : toNumber(spproFormula?.valor_compra) ?? toNumber(payload.valor_compra) ?? 0;
  const soiDespesasAggregate =
    (toNumber(soiFormula?.despesas) ?? 0) + (toNumber(soiFormula?.valor_desagio_antecipacao) ?? 0);
  const despesas =
    program === 'SOI'
      ? hasSoiFormulaPayload
        ? soiDespesasAggregate
        : toNumber(payload.despesas) ?? 0
      : toNumber(spproFormula?.despesas) ?? toNumber(payload.despesas) ?? 0;
  const recompra =
    program === 'SOI'
      ? toNumber(soiFormula?.regresso) ?? toNumber(payload.recompra) ?? 0
      : toNumber(spproFormula?.recompra) ?? toNumber(payload.recompra) ?? 0;
  const adValorem = toNumber(spproFormula?.ad_valorem) ?? toNumber(payload.ad_valorem) ?? 0;
  const iss = toNumber(spproFormula?.iss) ?? toNumber(payload.iss) ?? 0;
  const iof = toNumber(spproFormula?.iof) ?? toNumber(payload.iof) ?? 0;
  const iofAdicional = toNumber(spproFormula?.iof_adicional) ?? toNumber(payload.iof_adicional) ?? 0;
  const soiAmortDebitosAggregate =
    (toNumber(soiFormula?.amortiza_debitos) ?? 0) + (toNumber(soiFormula?.creditos_gerados) ?? 0);
  const amortDebitos =
    program === 'SOI'
      ? hasSoiFormulaPayload
        ? soiAmortDebitosAggregate
        : toNumber(payload.amortizacao_debitos) ?? 0
      : toNumber(payload.amortizacao_debitos) ?? 0;
  const amortCreditos =
    program === 'SOI'
      ? toNumber(soiFormula?.amortiza_creditos) ?? toNumber(payload.amortizacao_creditos) ?? 0
      : toNumber(payload.amortizacao_creditos) ?? 0;

  const liquidoOperacaoRaw =
    program === 'SPPRO'
      ? toNumber(spproFormula?.liquido_operacao) ??
        calcularLiquidoSPPRO({
          face_titulos: faceTitulos,
          valor_compra: valorCompra,
          ad_valorem: adValorem,
          iss,
          iof,
          iof_adicional: iofAdicional,
          despesas,
          recompra,
          amortizacao_debitos: amortDebitos,
          amortizacao_creditos: amortCreditos,
        })
      : toNumber(soiFormula?.liquido_liberado) ??
        calcularLiquidoSOI({
          face_titulos: faceTitulos,
          valor_compra: valorCompra,
          despesas,
          recompra,
          amortizacao_debitos: amortDebitos,
          amortizacao_creditos: amortCreditos,
        });
  const liquidoOperacao = Math.max(0, liquidoOperacaoRaw || 0);

  const operationCode = String(payload.documento || '').trim() || '-';
  const defaultHistorico =
    program === 'SPPRO'
      ? `DISECURIT/SPPRO Operação ${operationCode} — Face ${formatCurrencyBr(faceTitulos)} — Compra ${formatCurrencyBr(valorCompra)} — Líquido ${formatCurrencyBr(liquidoOperacao)}`
      : `DISECURIT/SOI Operação ${operationCode} — Face ${formatCurrencyBr(faceTitulos)} — Líquido ${formatCurrencyBr(liquidoOperacao)}`;
  const baseHistorico = String(payload.historico || '').trim();
  const historicoFinal =
    baseHistorico && !baseHistorico.includes('Face ') && !baseHistorico.includes('Líquido ')
      ? `${baseHistorico} — Face ${formatCurrencyBr(faceTitulos)} — Líquido ${formatCurrencyBr(liquidoOperacao)}`
      : baseHistorico || defaultHistorico;

  const insertPayload: Record<string, unknown> = {
    empresa_id: empresaId,
    estoque_id: payload.estoque_id,
    fornecedor_id: payload.fornecedor_id,
    tipo_operacao: 'entrada',
    data: toDateOnly(payload.data_operacao),
    face_titulos: faceTitulos,
    valor_compra: valorCompra,
    despesas,
    recompra,
    liquido_operacao: liquidoOperacao,
    historico: historicoFinal,
    documento: payload.documento || null,
    observacoes: 'Criado automaticamente via workspace Operações com IA (MVP).',
    conta_bancaria_id: payload.conta_bancaria_id || null,
    created_by: userId,
  };

  if (program === 'SPPRO') {
    insertPayload.ad_valorem = adValorem;
    insertPayload.iss = iss;
    insertPayload.iof = iof;
    insertPayload.amortizacao_debitos = amortDebitos;
    insertPayload.amortizacao_creditos = amortCreditos;
  } else {
    insertPayload.ad_valorem = null;
    insertPayload.iss = null;
    insertPayload.iof = null;
    insertPayload.amortizacao_debitos = amortDebitos;
    insertPayload.amortizacao_creditos = amortCreditos;
  }

  return insertPayload;
};

export const buildOperationImportDocumentRows = (
  empresaId: string,
  importRow: OperationIaImportRow,
  operacaoEstoqueId: number
): Array<Record<string, unknown>> => {
  const canonical = normalizeLegacyToCanonical(importRow.parsed_payload as never);
  if (!canonical) return [];

  const docs = toOperationImportDocuments(canonical);
  if (!docs.length) return [];

  return docs.map((doc, index) => ({
    empresa_id: empresaId,
    operacao_estoque_id: operacaoEstoqueId,
    import_file_id: importRow.id,
    line_index: index,
    sacado_nome: doc.sacado_nome || null,
    sacado_cnpj: doc.sacado_cnpj || null,
    documento: doc.documento || null,
    vencimento: toDateOnly(doc.vencimento || null),
    flt: toNumber(doc.flt),
    prz_flt: toNumber(doc.prz_flt),
    valor: toNumber(doc.valor),
    desagio: toNumber(doc.desagio),
    liquido: toNumber(doc.liquido),
    prz: toNumber(doc.prz),
    carteira: doc.carteira === null || doc.carteira === undefined ? null : String(doc.carteira),
    tipo_doc: doc.tipo_doc || null,
  }));
};

export const evaluateDuplicateFlags = (
  importRow: OperationIaImportRow,
  payloadDocument: string | null,
  hashAlreadyLinked: Set<string>,
  documentAlreadyUsed: Set<string>
): OperationIaDuplicateFlags => {
  const normalizedDocument = normalizeText(payloadDocument);

  return {
    importAlreadyLinked: Boolean(importRow.linked_operacao_id),
    hashAlreadyLinked: Boolean(importRow.file_sha256 && hashAlreadyLinked.has(importRow.file_sha256)),
    operationNumberAlreadyExists: Boolean(normalizedDocument && documentAlreadyUsed.has(normalizedDocument)),
  };
};

export const summarizeDuplicateFlags = (flags: OperationIaDuplicateFlags): string[] => {
  const messages: string[] = [];
  if (flags.importAlreadyLinked) {
    messages.push('Import já vinculado a outra operação.');
  }
  if (flags.hashAlreadyLinked) {
    messages.push('Arquivo com mesmo hash já foi vinculado anteriormente.');
  }
  if (flags.operationNumberAlreadyExists) {
    messages.push('Número/documento da operação já existe em operações criadas.');
  }
  return messages;
};

export async function safeInsertIntegrationAuditLog(
  adminClient: SupabaseClient,
  input: {
    empresa_id: string;
    import_file_id?: string | null;
    source: string;
    event_type: string;
    status: 'success' | 'warning' | 'error' | 'info';
    message: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await adminClient.from('integration_audit_log').insert({
      empresa_id: input.empresa_id,
      import_file_id: input.import_file_id || null,
      source: input.source,
      event_type: input.event_type,
      status: input.status,
      message: input.message,
      details: input.details || {},
    });
  } catch (error) {
    console.error('[operacoes-ia][audit-log]', error);
  }
}

export const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
};

const resolveRawFieldLabel = (key: string): string => {
  if (key === 'program') return 'Programa';
  if (key === 'documento') return 'Documento (operação)';
  if (key === 'data_operacao') return 'Data da operação';
  if (key === 'fornecedor_nome') return 'Fornecedor (nome no PDF)';
  if (key === 'fornecedor_documento') return 'Fornecedor (documento no PDF)';
  if (key === 'face_titulos') return 'Face dos títulos';
  if (key === 'valor_compra') return 'Valor compra/líquido';
  if (key === 'despesas') return 'Despesas';
  if (key === 'recompra') return 'Recompra';
  if (key === 'ad_valorem') return 'Ad-Valorem';
  if (key === 'iss') return 'ISS';
  if (key === 'iof') return 'IOF';
  if (key === 'iof_adicional') return 'IOF adicional';
  if (key === 'amortizacao_debitos') return 'Amortização de débitos';
  if (key === 'amortizacao_creditos') return 'Amortização de créditos';
  if (key === 'sppro_quantidade_titulos') return 'Quantidade de Títulos';
  if (key === 'sppro_valor_face') return '(+ ) Valor de Face dos Títulos';
  if (key === 'sppro_valor_compra') return '(- ) Valor de Compra';
  if (key === 'sppro_ad_valorem') return '(- ) Valor de Ad-valorem';
  if (key === 'sppro_iss') return '(- ) Valor de ISS';
  if (key === 'sppro_despesas') return '(- ) Valor de Despesas';
  if (key === 'sppro_iof') return '(- ) Valor de IOF';
  if (key === 'sppro_iof_adicional') return '(- ) Valor de IOF Adicional';
  if (key === 'sppro_recompra') return '(- ) Valor de Recompra';
  if (key === 'sppro_liquido_operacao') return '(= ) Valor Líquido da Operação';
  if (key === 'soi_valor_original') return '(+ ) Valor Original';
  if (key === 'soi_valor_desagio') return '(- ) Valor de Deságio';
  if (key === 'soi_valor_desagio_antecipacao') return '(- ) Valor de Deságio Antecipação';
  if (key === 'soi_despesas') return '(* ) Despesas';
  if (key === 'soi_regresso') return '(- ) Regresso';
  if (key === 'soi_amortiza_debitos') return '(- ) Amortiza débitos';
  if (key === 'soi_amortiza_creditos') return '(+ ) Amortiza créditos';
  if (key === 'soi_creditos_gerados') return '(- ) Créditos gerados';
  if (key === 'soi_liquido_liberado') return '(= ) Líquido Liberado';
  if (key === 'soi_desagio_antecipacao') return '(- ) Valor de Deságio Antecipação';
  return key;
};

const resolveRawSnapshot = (input: {
  program: OperationIaProgram | null;
  canonical: unknown;
  extractionDiagnostics: OperationIaExtractionDiagnostic[];
}): OperationIaRawSnapshotField[] => {
  const canonical =
    input.canonical && typeof input.canonical === 'object'
      ? (input.canonical as Record<string, unknown>)
      : {};
  const document = (canonical.document || {}) as Record<string, unknown>;
  const parties = (canonical.parties || {}) as Record<string, unknown>;
  const values = (canonical.values || {}) as Record<string, unknown>;
  const debug = (canonical.debug || {}) as Record<string, unknown>;
  const diagnosticsByField = new Map(
    (input.extractionDiagnostics || []).map((diagnostic) => [diagnostic.field_name, diagnostic])
  );

  const pickCandidateRaw = (fieldName: string): string | null => {
    const diagnostic = diagnosticsByField.get(fieldName);
    if (!diagnostic) return null;
    const exact = diagnostic.candidates?.find((candidate) => candidate.value === diagnostic.resolved_value);
    if (exact?.raw_value) return exact.raw_value;
    return diagnostic.candidates?.[0]?.raw_value || null;
  };

  const fromDiagnostic = (
    key: string,
    fieldName: string,
    normalizedValue: number | string | null
  ): OperationIaRawSnapshotField => {
    const diagnostic = diagnosticsByField.get(fieldName);
    return {
      key,
      label: resolveRawFieldLabel(key),
      raw_value: pickCandidateRaw(fieldName),
      normalized_value: normalizedValue,
      source_method: diagnostic?.source_method || 'payload',
      confidence: diagnostic?.confidence ?? null,
      conflict_flag: Boolean(diagnostic?.conflict_flag),
      reason: diagnostic?.reason || null,
    };
  };

  const valueForPurchase =
    input.program === 'SPPRO'
      ? toNumber(values.purchase_value) ?? toNumber(values.discount_value) ?? toNumber(values.net_value)
      : toNumber(values.discount_value) ?? toNumber(values.purchase_value) ?? toNumber(values.net_value);
  const purchaseFieldName = input.program === 'SPPRO' ? 'purchase_value' : 'discount_value';

  const snapshot: OperationIaRawSnapshotField[] = [
    {
      key: 'program',
      label: resolveRawFieldLabel('program'),
      raw_value: null,
      normalized_value: input.program,
      source_method: 'payload',
      confidence: null,
      conflict_flag: false,
      reason: null,
    },
    {
      key: 'documento',
      label: resolveRawFieldLabel('documento'),
      raw_value: null,
      normalized_value:
        String(document.operation_number || document.bordero_number || '').trim() || null,
      source_method: 'payload',
      confidence: null,
      conflict_flag: false,
      reason: null,
    },
    {
      key: 'data_operacao',
      label: resolveRawFieldLabel('data_operacao'),
      raw_value: null,
      normalized_value:
        toDateOnly(String(document.date || document.payment_date || '').trim()) || null,
      source_method: 'payload',
      confidence: null,
      conflict_flag: false,
      reason: null,
    },
    {
      key: 'fornecedor_nome',
      label: resolveRawFieldLabel('fornecedor_nome'),
      raw_value: null,
      normalized_value: String(parties.client_name || '').trim() || null,
      source_method: 'payload',
      confidence: null,
      conflict_flag: false,
      reason: null,
    },
    {
      key: 'fornecedor_documento',
      label: resolveRawFieldLabel('fornecedor_documento'),
      raw_value: null,
      normalized_value: String(parties.client_doc || '').trim() || null,
      source_method: 'payload',
      confidence: null,
      conflict_flag: false,
      reason: null,
    },
    fromDiagnostic('face_titulos', 'face_value', toNumber(values.face_value)),
    fromDiagnostic('despesas', 'expenses', toNumber(values.expenses) ?? 0),
    fromDiagnostic('recompra', 'recompra', toNumber(values.recompra) ?? 0),
    fromDiagnostic('amortizacao_debitos', 'amort_debits', toNumber(values.amort_debits) ?? 0),
    fromDiagnostic('amortizacao_creditos', 'amort_credits', toNumber(values.amort_credits) ?? 0),
  ];

  if (input.program !== 'SOI') {
    snapshot.splice(6, 0, fromDiagnostic('valor_compra', purchaseFieldName, valueForPurchase));
  }

  if (input.program === 'SPPRO') {
    const spproFormula =
      debug.sppro_formula && typeof debug.sppro_formula === 'object'
        ? (debug.sppro_formula as Record<string, unknown>)
        : {};
    const quantidadeTitulosRaw =
      spproFormula.quantidade_titulos && typeof spproFormula.quantidade_titulos === 'object'
        ? (spproFormula.quantidade_titulos as Record<string, unknown>)
        : {};

    snapshot.push(
      fromDiagnostic('ad_valorem', 'ad_valorem', toNumber(values.ad_valorem) ?? 0),
      fromDiagnostic('iss', 'iss', toNumber(values.iss) ?? 0),
      fromDiagnostic('iof', 'iof', toNumber(values.iof) ?? 0),
      fromDiagnostic('iof_adicional', 'iof_additional', toNumber(values.iof_additional) ?? 0),
      {
        key: 'sppro_quantidade_titulos',
        label: resolveRawFieldLabel('sppro_quantidade_titulos'),
        raw_value: typeof quantidadeTitulosRaw.raw_value === 'string' ? quantidadeTitulosRaw.raw_value : null,
        normalized_value: toNumber(quantidadeTitulosRaw.value),
        source_method: ['regex', 'ocr', 'heuristic', 'manual'].includes(
          String(quantidadeTitulosRaw.source_method || '').toLowerCase()
        )
          ? (String(quantidadeTitulosRaw.source_method || '').toLowerCase() as OperationIaRawSnapshotField['source_method'])
          : 'payload',
        confidence: toNumber(quantidadeTitulosRaw.confidence),
        conflict_flag: false,
        reason: null,
      },
      fromDiagnostic('sppro_valor_face', 'face_value', toNumber(values.face_value)),
      fromDiagnostic(
        'sppro_valor_compra',
        'purchase_value',
        toNumber(values.purchase_value) ?? toNumber(values.discount_value)
      ),
      fromDiagnostic('sppro_ad_valorem', 'ad_valorem', toNumber(values.ad_valorem) ?? 0),
      fromDiagnostic('sppro_iss', 'iss', toNumber(values.iss) ?? 0),
      fromDiagnostic('sppro_despesas', 'expenses', toNumber(values.expenses) ?? 0),
      fromDiagnostic('sppro_iof', 'iof', toNumber(values.iof) ?? 0),
      fromDiagnostic('sppro_iof_adicional', 'iof_additional', toNumber(values.iof_additional) ?? 0),
      fromDiagnostic('sppro_recompra', 'recompra', toNumber(values.recompra) ?? 0),
      fromDiagnostic('sppro_liquido_operacao', 'net_value', toNumber(values.net_value))
    );
  }

  if (input.program === 'SOI') {
    const soiFormulaRaw =
      debug.soi_formula_v2 && typeof debug.soi_formula_v2 === 'object'
        ? (debug.soi_formula_v2 as Record<string, unknown>)
        : debug.soi_formula && typeof debug.soi_formula === 'object'
          ? (debug.soi_formula as Record<string, unknown>)
          : {};
    const formulaField = (
      key: string,
      formulaKey: string,
      fallback: number | null,
      diagnosticField?: string
    ): OperationIaRawSnapshotField => {
      const rawField = soiFormulaRaw[formulaKey];
      const sourceRow = rawField && typeof rawField === 'object' ? (rawField as Record<string, unknown>) : {};
      const normalized =
        toNumber(sourceRow.value) ??
        (typeof rawField === 'number' && Number.isFinite(rawField) ? rawField : fallback);
      const diagnostic = diagnosticField ? diagnosticsByField.get(diagnosticField) : undefined;
      const sourceMethodRaw = String(sourceRow.source_method || '').toLowerCase();
      const sourceMethod =
        sourceMethodRaw === 'regex' ||
        sourceMethodRaw === 'ocr' ||
        sourceMethodRaw === 'heuristic' ||
        sourceMethodRaw === 'manual'
          ? (sourceMethodRaw as OperationIaRawSnapshotField['source_method'])
          : diagnostic?.source_method || 'payload';

      return {
        key,
        label: resolveRawFieldLabel(key),
        raw_value:
          typeof sourceRow.raw_value === 'string'
            ? sourceRow.raw_value
            : pickCandidateRaw(diagnosticField || '') || null,
        normalized_value: normalized,
        source_method: sourceMethod,
        confidence: toNumber(sourceRow.confidence) ?? diagnostic?.confidence ?? null,
        conflict_flag: Boolean(sourceRow.conflict_flag) || Boolean(diagnostic?.conflict_flag),
        reason: (typeof sourceRow.reason === 'string' ? sourceRow.reason : null) || diagnostic?.reason || null,
      };
    };

    snapshot.push(
      formulaField('soi_valor_original', 'valor_original', toNumber(values.face_value), 'face_value'),
      formulaField(
        'soi_valor_desagio',
        'valor_desagio',
        toNumber(values.discount_value) ?? toNumber(values.purchase_value),
        'discount_value'
      ),
      formulaField(
        'soi_valor_desagio_antecipacao',
        'valor_desagio_antecipacao',
        toNumber(soiFormulaRaw.valor_desagio_antecipacao),
        'soi_valor_desagio_antecipacao'
      ),
      formulaField('soi_despesas', 'despesas', toNumber(soiFormulaRaw.despesas), 'soi_despesas'),
      formulaField('soi_regresso', 'regresso', toNumber(soiFormulaRaw.regresso), 'recompra'),
      formulaField(
        'soi_amortiza_debitos',
        'amortiza_debitos',
        toNumber(soiFormulaRaw.amortiza_debitos),
        'soi_amortiza_debitos'
      ),
      formulaField('soi_amortiza_creditos', 'amortiza_creditos', toNumber(values.amort_credits) ?? 0, 'amort_credits'),
      formulaField('soi_creditos_gerados', 'creditos_gerados', toNumber(soiFormulaRaw.creditos_gerados), 'amort_debits'),
      formulaField('soi_liquido_liberado', 'liquido_liberado', toNumber(values.net_value), 'net_value')
    );
  }

  return snapshot;
};
