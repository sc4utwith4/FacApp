import type {
  DisecuritParseResult,
  DisecuritParsedDocument,
  DisecuritProgram,
  OperationImportFile,
  OperationImportDocument,
  ParsedPayloadDisecurit,
} from '../../types/disecurit-import.js';

const normalizeProgram = (value?: string | null): DisecuritProgram | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SPPRO' || normalized === 'SOI') return normalized;
  return null;
};

const toNumberOrNull = (value: unknown): number | null => {
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

const normalizeDateLike = (value?: string | null): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
};

function looksCanonical(payload: ParsedPayloadDisecurit): boolean {
  return Boolean(payload.program && payload.values && payload.document && payload.raw);
}

function toCanonicalDocuments(payload: ParsedPayloadDisecurit): DisecuritParsedDocument[] {
  const docs = Array.isArray(payload.documents) ? payload.documents : [];

  return docs.map((doc) => {
    const source = doc as OperationImportDocument & DisecuritParsedDocument;

    return {
      debtor_name: source.debtor_name ?? source.sacado_nome ?? null,
      debtor_doc: source.debtor_doc ?? source.sacado_cnpj ?? null,
      document: source.document ?? source.documento ?? null,
      due_date: normalizeDateLike(source.due_date ?? source.vencimento ?? null),
      value: toNumberOrNull(source.value ?? source.valor),
      discount: toNumberOrNull(source.discount ?? source.desagio),
      net: toNumberOrNull(source.net ?? source.liquido),
      doc_type: source.doc_type ?? source.tipo_doc ?? null,
    };
  });
}

function guessProgramFromLegacy(payload: ParsedPayloadDisecurit): DisecuritProgram {
  const explicit = normalizeProgram(payload.program);
  if (explicit) return explicit;
  if (payload.document?.bordero_number) return 'SPPRO';
  if (payload.document?.operation_number || payload.operation_number || payload.dt_pagamento) return 'SOI';
  return 'SOI';
}

export function normalizeLegacyToCanonical(payload?: ParsedPayloadDisecurit | null): DisecuritParseResult | null {
  if (!payload) return null;

  if (looksCanonical(payload)) {
    const canonicalProgram = normalizeProgram(payload.program) || guessProgramFromLegacy(payload);
    return {
      source: 'disecurit',
      program: canonicalProgram,
      detected_by: payload.detected_by || 'fallback',
      confidence: typeof payload.confidence === 'number' ? payload.confidence : 0.5,
      document: {
        operation_number: payload.document?.operation_number || payload.operation_number || null,
        bordero_number: payload.document?.bordero_number || null,
        date: normalizeDateLike(payload.document?.date || payload.dt_pagamento || null),
        payment_date: normalizeDateLike(payload.document?.payment_date || payload.dt_pagamento || null),
      },
      parties: {
        seller_name: payload.parties?.seller_name || null,
        buyer_name: payload.parties?.buyer_name || null,
        client_name: payload.parties?.client_name || payload.client?.name || null,
        client_doc: payload.parties?.client_doc || payload.client?.cnpj || null,
      },
      values: {
        face_value: toNumberOrNull(payload.values?.face_value ?? payload.totals?.valor),
        purchase_value: toNumberOrNull(payload.values?.purchase_value),
        ad_valorem: toNumberOrNull(payload.values?.ad_valorem),
        iss: toNumberOrNull(payload.values?.iss),
        iof: toNumberOrNull(payload.values?.iof),
        iof_additional: toNumberOrNull(payload.values?.iof_additional),
        expenses: toNumberOrNull(payload.values?.expenses),
        recompra: toNumberOrNull(payload.values?.recompra),
        amort_debits: toNumberOrNull(payload.values?.amort_debits),
        amort_credits: toNumberOrNull(payload.values?.amort_credits),
        discount_value: toNumberOrNull(payload.values?.discount_value ?? payload.totals?.desagio),
        net_value: toNumberOrNull(payload.values?.net_value ?? payload.totals?.liquido),
      },
      documents: toCanonicalDocuments(payload),
      raw: {
        text_hash: payload.raw?.text_hash || '',
        text_excerpt: payload.raw?.text_excerpt || '',
      },
      debug: {
        regex_matches: payload.debug?.regex_matches || {},
        warnings: payload.debug?.warnings || [],
        missing_critical: payload.debug?.missing_critical || [],
        extraction_diagnostics: payload.debug?.extraction_diagnostics || [],
        has_critical_conflict: Boolean(payload.debug?.has_critical_conflict),
        soi_formula: payload.debug?.soi_formula || undefined,
        soi_formula_v2: payload.debug?.soi_formula_v2 || payload.debug?.soi_formula || undefined,
        sppro_formula: payload.debug?.sppro_formula || undefined,
      },
    };
  }

  const program = guessProgramFromLegacy(payload);

  return {
    source: 'disecurit',
    program,
    detected_by: 'fallback',
    confidence: 0.4,
    document: {
      operation_number: payload.operation_number || null,
      bordero_number: null,
      date: normalizeDateLike(payload.dt_pagamento || null),
      payment_date: normalizeDateLike(payload.dt_pagamento || null),
    },
    parties: {
      seller_name: null,
      buyer_name: null,
      client_name: payload.client?.name || null,
      client_doc: payload.client?.cnpj || null,
    },
    values: {
      face_value: toNumberOrNull(payload.totals?.valor),
      purchase_value: null,
      ad_valorem: null,
      iss: null,
      iof: null,
      iof_additional: null,
      expenses: null,
      recompra: null,
      amort_debits: null,
      amort_credits: null,
      discount_value: toNumberOrNull(payload.totals?.desagio),
      net_value: toNumberOrNull(payload.totals?.liquido),
    },
    documents: toCanonicalDocuments(payload),
    raw: {
      text_hash: payload.raw?.text_hash || '',
      text_excerpt: payload.raw?.text_excerpt || '',
    },
    debug: {
      regex_matches: {},
      warnings: ['Payload legado convertido para schema canônico em runtime.'],
      missing_critical: [],
      extraction_diagnostics: [],
      has_critical_conflict: false,
      soi_formula: undefined,
      soi_formula_v2: undefined,
      sppro_formula: undefined,
    },
  };
}

export function resolveProgramForPrefill(
  userStock?: DisecuritProgram | null,
  parsed?: DisecuritParseResult | null
): DisecuritProgram {
  const preferred = normalizeProgram(userStock || null);
  if (preferred) return preferred;

  const parsedProgram = normalizeProgram(parsed?.program || null);
  if (parsedProgram) return parsedProgram;

  return 'SOI';
}

export function getPayloadClientDocument(payload?: ParsedPayloadDisecurit | null): string | null {
  if (!payload) return null;
  return payload.parties?.client_doc || payload.client?.cnpj || null;
}

export function getPayloadClientName(payload?: ParsedPayloadDisecurit | null): string | null {
  if (!payload) return null;
  return payload.parties?.client_name || payload.client?.name || null;
}

export function getPayloadDocumentNumber(payload?: ParsedPayloadDisecurit | null): string | null {
  if (!payload) return null;
  return (
    payload.document?.operation_number ||
    payload.document?.bordero_number ||
    payload.operation_number ||
    null
  );
}

export function getPayloadProgram(payload?: ParsedPayloadDisecurit | null): DisecuritProgram | null {
  if (!payload) return null;
  const canonical = normalizeLegacyToCanonical(payload);
  return canonical?.program || null;
}

export function getImportProgram(
  importFile?: Pick<OperationImportFile, 'parsed_payload' | 'program_hint'> | null
): DisecuritProgram | null {
  if (!importFile) return null;
  return getPayloadProgram(importFile.parsed_payload) || normalizeProgram(importFile.program_hint || null);
}

export function isImportPayloadReady(
  importFile?: Pick<OperationImportFile, 'parsed_payload' | 'program_hint'> | null
): boolean {
  if (!importFile?.parsed_payload) return false;
  const canonical = normalizeLegacyToCanonical(importFile.parsed_payload);
  if (!canonical) return false;
  return Boolean(normalizeProgram(canonical.program || importFile.program_hint || null));
}

export function getPayloadDetectedBy(payload?: ParsedPayloadDisecurit | null): string | null {
  if (!payload) return null;
  if (typeof payload.detected_by === 'string' && payload.detected_by.trim()) {
    return payload.detected_by;
  }
  const canonical = normalizeLegacyToCanonical(payload);
  return canonical?.detected_by || null;
}

export function getPayloadConfidence(payload?: ParsedPayloadDisecurit | null): number | null {
  if (!payload) return null;
  if (typeof payload.confidence === 'number' && Number.isFinite(payload.confidence)) {
    return payload.confidence;
  }
  const canonical = normalizeLegacyToCanonical(payload);
  return typeof canonical?.confidence === 'number' ? canonical.confidence : null;
}

export function toOperationImportDocuments(parsed?: DisecuritParseResult | null): OperationImportDocument[] {
  if (!parsed?.documents?.length) return [];

  return parsed.documents.map((doc) => ({
    sacado_nome: doc.debtor_name || null,
    sacado_cnpj: doc.debtor_doc || null,
    documento: doc.document || null,
    vencimento: normalizeDateLike(doc.due_date || null),
    valor: toNumberOrNull(doc.value),
    desagio: toNumberOrNull(doc.discount),
    liquido: toNumberOrNull(doc.net),
    tipo_doc: doc.doc_type || null,
    flt: null,
    prz_flt: null,
    prz: null,
    carteira: null,
  }));
}
