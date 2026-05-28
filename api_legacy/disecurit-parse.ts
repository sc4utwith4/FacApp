import { normalizeProgramHint, parseDisecuritPdfText } from '../src/lib/disecurit/disecuritParser.js';
import type {
  DisecuritExtractionDiagnostic,
  DisecuritParseResult,
  ImportParseStatus,
} from '../src/types/disecurit-import.js';

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: any) => void;
}

function getHeaderValue(req: VercelRequest, headerName: string): string | null {
  const direct = req.headers[headerName];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct[0] ?? null;

  const lowered = headerName.toLowerCase();
  const foundKey = Object.keys(req.headers).find((k) => k.toLowerCase() === lowered);
  if (!foundKey) return null;

  const value = req.headers[foundKey];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function getParseSecret(): string {
  return (
    process.env.DISECURIT_PARSE_SECRET ||
    process.env.N8N_DISECURIT_PARSE_SECRET ||
    process.env.N8N_DISECURIT_INTEGRATION_SECRET ||
    ''
  );
}

function scoreTextStructuralQuality(text: string): number {
  const raw = String(text || '').trim();
  if (!raw) return 0;

  const moneyTokens = raw.match(/\d{1,3}(?:\.\d{3})*,\d{2}/g) || [];
  const markerHits = [
    /Opera[çc][aã]o\s*:\s*\d+/i.test(raw),
    /Dt\.?\s*Pag\.?\s*:/i.test(raw),
    /L[íi]quido\s+Liberado/i.test(raw),
    /Valor\s+de\s+Face/i.test(raw),
    /DOCUMENTOS\s+DA\s+OPERA[ÇC][AÃ]O/i.test(raw),
    /DEMONSTRATIVO\s+DE\s+OPERA[ÇC][AÃ]O/i.test(raw),
  ].filter(Boolean).length;

  return markerHits * 2 + Math.min(moneyTokens.length, 12);
}

function hasNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function resolveHybridTolerance(...values: Array<number | null | undefined>): number {
  const base = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce((max, current) => Math.max(max, Math.abs(current)), 0);
  const tolerance = Math.max(0.5, base * 0.002);
  return Number(tolerance.toFixed(2));
}

function mapMatchTypeToSourceMethod(
  matchType: unknown,
  options?: { ocrUsed?: boolean }
): 'regex' | 'ocr' | 'heuristic' | 'manual' {
  const normalized = String(matchType || '').trim().toLowerCase();
  if (options?.ocrUsed) return 'ocr';
  if (normalized === 'hint_fallback' || normalized === 'header_sequence') return 'heuristic';
  if (normalized) return 'regex';
  return 'heuristic';
}

function computeTotalsChecks(parsed: DisecuritParseResult) {
  const docs = parsed.documents || [];
  const sumValue = docs.reduce((acc, doc) => acc + (Number(doc.value) || 0), 0);
  const sumNet = docs.reduce((acc, doc) => acc + (Number(doc.net) || 0), 0);

  const face = parsed.values?.face_value;
  const net = parsed.values?.net_value;

  const valueTolerance = hasNumber(face) ? resolveHybridTolerance(sumValue, Number(face)) : null;
  const netTolerance = hasNumber(net) ? resolveHybridTolerance(sumNet, Number(net)) : null;
  const valueOk =
    hasNumber(face) && docs.length > 0 && valueTolerance !== null
      ? Math.abs(sumValue - Number(face)) <= valueTolerance
      : null;
  const netOk =
    hasNumber(net) && docs.length > 0 && netTolerance !== null
      ? Math.abs(sumNet - Number(net)) <= netTolerance
      : null;

  return {
    docs_count: docs.length,
    sum_valor: Number(sumValue.toFixed(2)),
    sum_liquido: Number(sumNet.toFixed(2)),
    total_valor: hasNumber(face) ? Number(face) : null,
    total_liquido: hasNumber(net) ? Number(net) : null,
    valor_ok: valueOk,
    liquido_ok: netOk,
    valor_diff: hasNumber(face) && docs.length > 0 ? Number(Math.abs(sumValue - Number(face)).toFixed(2)) : null,
    liquido_diff: hasNumber(net) && docs.length > 0 ? Number(Math.abs(sumNet - Number(net)).toFixed(2)) : null,
    valor_tolerance: valueTolerance,
    liquido_tolerance: netTolerance,
  };
}

type ParsedCandidateRow = {
  value: number;
  raw_value: string | null;
  match_type: string | null;
  confidence: number | null;
  source_method: 'regex' | 'ocr' | 'heuristic' | 'manual' | null;
};

function readCandidateList(parsed: DisecuritParseResult, fieldName: string): ParsedCandidateRow[] {
  const regexMatches = parsed.debug?.regex_matches || {};
  const soiFieldMapping: Record<string, string> = {
    face_value: 'valor_original',
    discount_value: 'valor_desagio',
    amort_credits: 'amortiza_creditos',
    amort_debits: 'amortiza_debitos',
    expenses: 'despesas',
    net_value: 'liquido_liberado',
  };
  const mappedSoiField = parsed.program === 'SOI' ? soiFieldMapping[fieldName] : null;
  const soiCandidatesRaw =
    mappedSoiField && typeof (regexMatches as Record<string, unknown>).soi_formula_field_candidates === 'object'
      ? ((regexMatches as Record<string, unknown>).soi_formula_field_candidates as Record<string, unknown>)[mappedSoiField]
      : null;
  const rawList =
    Array.isArray(soiCandidatesRaw)
      ? soiCandidatesRaw
      : (regexMatches as Record<string, unknown>)[`${fieldName}_candidates`];
  if (!Array.isArray(rawList)) return [];

  return rawList
    .map((item) => {
      const valueRaw = (item as Record<string, unknown>)?.value;
      const parsedValue = typeof valueRaw === 'number' && Number.isFinite(valueRaw) ? valueRaw : null;
      if (parsedValue === null) return null;

      const confidenceRaw = (item as Record<string, unknown>)?.confidence;
      const confidence = typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw) ? confidenceRaw : null;
      const rawValueRaw = (item as Record<string, unknown>)?.raw;
      const rawValue = typeof rawValueRaw === 'string' ? rawValueRaw : null;
      const matchTypeRaw = (item as Record<string, unknown>)?.match_type;
      const matchType = typeof matchTypeRaw === 'string' ? matchTypeRaw : null;
      const sourceMethodRaw = (item as Record<string, unknown>)?.source_method;
      const sourceMethod: ParsedCandidateRow['source_method'] =
        sourceMethodRaw === 'regex' ||
        sourceMethodRaw === 'ocr' ||
        sourceMethodRaw === 'heuristic' ||
        sourceMethodRaw === 'manual'
          ? sourceMethodRaw
          : null;

      return {
        value: parsedValue,
        raw_value: rawValue,
        match_type: matchType,
        confidence,
        source_method: sourceMethod,
      };
    })
    .filter((item): item is ParsedCandidateRow => Boolean(item));
}

function computeExtractionDiagnostics(
  parsed: DisecuritParseResult,
  totalsChecks: ReturnType<typeof computeTotalsChecks>,
  options?: { ocrUsed?: boolean }
): { diagnostics: DisecuritExtractionDiagnostic[]; hasCriticalConflict: boolean } {
  const fieldNames =
    parsed.program === 'SOI'
      ? ['face_value', 'discount_value', 'amort_credits', 'amort_debits', 'expenses', 'net_value']
      : [
          'face_value',
          'purchase_value',
          'ad_valorem',
          'iss',
          'expenses',
          'iof',
          'iof_additional',
          'recompra',
          'net_value',
        ];
  const diagnostics: DisecuritExtractionDiagnostic[] = [];

  for (const fieldName of fieldNames) {
    const regexMatches = (parsed.debug?.regex_matches as Record<string, unknown> | undefined) || {};
    const soiFieldMapping: Record<string, string> = {
      face_value: 'valor_original',
      discount_value: 'valor_desagio',
      amort_credits: 'amortiza_creditos',
      amort_debits: 'amortiza_debitos',
      expenses: 'despesas',
      net_value: 'liquido_liberado',
    };
    const mappedSoiField = parsed.program === 'SOI' ? soiFieldMapping[fieldName] : null;
    const soiSelectionReasonRaw =
      mappedSoiField && typeof regexMatches.soi_formula_selection_reason === 'object'
        ? (regexMatches.soi_formula_selection_reason as Record<string, unknown>)[mappedSoiField]
        : null;
    const soiSelectionReason = typeof soiSelectionReasonRaw === 'string' ? soiSelectionReasonRaw : null;

    const resolvedValueRaw = (parsed.values as Record<string, unknown>)[fieldName];
    const resolvedValue = typeof resolvedValueRaw === 'number' && Number.isFinite(resolvedValueRaw) ? resolvedValueRaw : null;
    const candidates = readCandidateList(parsed, fieldName);
    const fallbackMatchTypeRaw = regexMatches[`${fieldName}_match_type`];
    const fallbackMatchType = typeof fallbackMatchTypeRaw === 'string' ? fallbackMatchTypeRaw : null;
    const fallbackRawRaw = regexMatches[`${fieldName}_raw`];
    const fallbackRaw = typeof fallbackRawRaw === 'string' ? fallbackRawRaw : null;

    if (resolvedValue !== null && !candidates.length) {
      candidates.push({
        value: resolvedValue,
        raw_value: fallbackRaw,
        match_type: fallbackMatchType,
        confidence: null,
        source_method: null,
      });
    }

    const candidateValues = candidates.map((item) => item.value);
    const maxCandidate = candidateValues.length ? Math.max(...candidateValues) : null;
    const minCandidate = candidateValues.length ? Math.min(...candidateValues) : null;

    let conflictFlag = false;
    let reason: string | null = null;
    let comparedValue: number | null = null;
    let tolerance: number | null = null;
    let difference: number | null = null;

    if (candidateValues.length >= 2 && maxCandidate !== null && minCandidate !== null) {
      tolerance = resolveHybridTolerance(maxCandidate, minCandidate);
      difference = Number(Math.abs(maxCandidate - minCandidate).toFixed(2));
      if (difference > tolerance) {
        conflictFlag = true;
        reason = 'Candidatos de extração divergentes acima da tolerância.';
      }
    }

    if (fieldName === 'face_value' && resolvedValue !== null && totalsChecks.docs_count > 0 && totalsChecks.sum_valor !== null) {
      const toleranceAgainstDocs = resolveHybridTolerance(resolvedValue, totalsChecks.sum_valor);
      const diffAgainstDocs = Number(Math.abs(resolvedValue - totalsChecks.sum_valor).toFixed(2));
      if (diffAgainstDocs > toleranceAgainstDocs) {
        conflictFlag = true;
        reason = reason || 'Diferença entre total do cabeçalho e soma dos documentos.';
      }
      comparedValue = totalsChecks.sum_valor;
      tolerance = toleranceAgainstDocs;
      difference = diffAgainstDocs;
    }

    if (fieldName === 'net_value' && resolvedValue !== null && totalsChecks.docs_count > 0 && totalsChecks.sum_liquido !== null) {
      const toleranceAgainstDocs = resolveHybridTolerance(resolvedValue, totalsChecks.sum_liquido);
      const diffAgainstDocs = Number(Math.abs(resolvedValue - totalsChecks.sum_liquido).toFixed(2));
      if (diffAgainstDocs > toleranceAgainstDocs) {
        conflictFlag = true;
        reason = reason || 'Diferença entre líquido do cabeçalho e soma líquida dos documentos.';
      }
      comparedValue = totalsChecks.sum_liquido;
      tolerance = toleranceAgainstDocs;
      difference = diffAgainstDocs;
    }

    if (soiSelectionReason) {
      const selectionLabel = `Critério do parser: ${soiSelectionReason}.`;
      reason = reason ? `${reason} ${selectionLabel}` : selectionLabel;
    }

    const bestCandidate = candidates
      .slice()
      .sort((left, right) => (right.confidence || 0) - (left.confidence || 0))[0];
    const sourceMethod = mapMatchTypeToSourceMethod(bestCandidate?.match_type || fallbackMatchType, {
      ocrUsed: options?.ocrUsed,
    });
    const confidence =
      typeof bestCandidate?.confidence === 'number' && Number.isFinite(bestCandidate.confidence)
        ? bestCandidate.confidence
        : parsed.confidence || null;
    const critical =
      fieldName === 'face_value' ||
      fieldName === 'net_value' ||
      (parsed.program === 'SPPRO' && (fieldName === 'purchase_value' || fieldName === 'recompra'));

    diagnostics.push({
      field_name: fieldName,
      resolved_value: resolvedValue,
      source_method: sourceMethod,
      confidence: confidence === null ? null : Number(confidence.toFixed(4)),
      conflict_flag: conflictFlag,
      critical,
      reason,
      compared_value: comparedValue,
      tolerance: tolerance === null ? null : Number(tolerance.toFixed(2)),
      difference: difference === null ? null : Number(difference.toFixed(2)),
      candidates: candidates.map((candidate) => ({
        value: candidate.value,
        raw_value: candidate.raw_value,
        source_method:
          candidate.source_method ||
          mapMatchTypeToSourceMethod(candidate.match_type, { ocrUsed: options?.ocrUsed }),
        confidence: candidate.confidence,
      })),
    });
  }

  if (parsed.program === 'SPPRO') {
    const face = hasNumber(parsed.values?.face_value) ? Number(parsed.values?.face_value) : null;
    const compra = hasNumber(parsed.values?.purchase_value) ? Number(parsed.values?.purchase_value) : null;
    const adValorem = hasNumber(parsed.values?.ad_valorem) ? Number(parsed.values?.ad_valorem) : 0;
    const iss = hasNumber(parsed.values?.iss) ? Number(parsed.values?.iss) : 0;
    const despesas = hasNumber(parsed.values?.expenses) ? Number(parsed.values?.expenses) : 0;
    const iof = hasNumber(parsed.values?.iof) ? Number(parsed.values?.iof) : 0;
    const iofAdicional = hasNumber(parsed.values?.iof_additional) ? Number(parsed.values?.iof_additional) : 0;
    const recompra = hasNumber((parsed.values as Record<string, unknown>)?.recompra)
      ? Number((parsed.values as Record<string, unknown>).recompra)
      : 0;
    const liquido = hasNumber(parsed.values?.net_value) ? Number(parsed.values?.net_value) : null;

    if (face !== null && compra !== null && liquido !== null) {
      const formulaLiquido = Number(
        (face - compra - adValorem - iss - despesas - iof - iofAdicional - recompra).toFixed(2)
      );
      const tolerance = resolveHybridTolerance(liquido, formulaLiquido);
      const difference = Number(Math.abs(liquido - formulaLiquido).toFixed(2));
      if (difference > tolerance) {
        const netDiagnostic = diagnostics.find((diagnostic) => diagnostic.field_name === 'net_value');
        if (netDiagnostic) {
          netDiagnostic.conflict_flag = true;
          netDiagnostic.critical = true;
          netDiagnostic.reason = netDiagnostic.reason
            ? `${netDiagnostic.reason} Divergência da fórmula SPPRO.`
            : 'Divergência da fórmula SPPRO.';
          netDiagnostic.compared_value = formulaLiquido;
          netDiagnostic.tolerance = tolerance;
          netDiagnostic.difference = difference;
        }
      }
    }
  }

  if (parsed.program === 'SOI') {
    const formulaRaw =
      (parsed.debug as Record<string, unknown> | undefined)?.soi_formula_v2 ||
      (parsed.debug as Record<string, unknown> | undefined)?.soi_formula ||
      null;
    const formula = formulaRaw && typeof formulaRaw === 'object' ? (formulaRaw as Record<string, unknown>) : null;

    const readFormulaValue = (key: string): number | null => {
      if (!formula) return null;
      const value = formula[key];
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (value && typeof value === 'object') {
        const nestedValue = (value as Record<string, unknown>).value;
        if (typeof nestedValue === 'number' && Number.isFinite(nestedValue)) return nestedValue;
      }
      return null;
    };

    const valorOriginal = readFormulaValue('valor_original');
    const valorDesagio = readFormulaValue('valor_desagio');
    const valorDesagioAntecipacao = readFormulaValue('valor_desagio_antecipacao') ?? 0;
    const despesas = readFormulaValue('despesas') ?? 0;
    const regresso = readFormulaValue('regresso') ?? 0;
    const amortizaDebitos = readFormulaValue('amortiza_debitos') ?? 0;
    const amortizaCreditos = readFormulaValue('amortiza_creditos') ?? 0;
    const creditosGerados = readFormulaValue('creditos_gerados') ?? 0;
    const liquidoLiberado = readFormulaValue('liquido_liberado');

    if (valorOriginal !== null && valorDesagio !== null && liquidoLiberado !== null) {
      const formulaLiquido = Number(
        (
          valorOriginal -
          valorDesagio -
          valorDesagioAntecipacao -
          despesas -
          regresso -
          amortizaDebitos +
          amortizaCreditos -
          creditosGerados
        ).toFixed(2)
      );
      const tolerance = resolveHybridTolerance(liquidoLiberado, formulaLiquido);
      const difference = Number(Math.abs(liquidoLiberado - formulaLiquido).toFixed(2));
      if (difference > tolerance) {
        const netDiagnostic = diagnostics.find((diagnostic) => diagnostic.field_name === 'net_value');
        if (netDiagnostic) {
          netDiagnostic.conflict_flag = true;
          netDiagnostic.critical = true;
          netDiagnostic.reason = netDiagnostic.reason
            ? `${netDiagnostic.reason} Divergência da fórmula SOI.`
            : 'Divergência da fórmula SOI.';
          netDiagnostic.compared_value = formulaLiquido;
          netDiagnostic.tolerance = tolerance;
          netDiagnostic.difference = difference;
        }
      }
    }
  }

  return {
    diagnostics,
    hasCriticalConflict: diagnostics.some((diagnostic) => diagnostic.critical && diagnostic.conflict_flag),
  };
}

function evaluateParseStatus(
  parsed: DisecuritParseResult,
  programHintUsed: boolean,
  totalsChecks: ReturnType<typeof computeTotalsChecks>,
  extractionDiagnostics: ReturnType<typeof computeExtractionDiagnostics>
): {
  status: ImportParseStatus;
  reason: string | null;
  warnings: string[];
  missing_critical: string[];
} {
  const warnings = [...(parsed.debug?.warnings || [])];

  const hasDate = Boolean(parsed.document?.date || parsed.document?.payment_date);
  const confidence = Number(parsed.confidence || 0);
  const lowConfidence = confidence < 0.45;

  const missingCritical: string[] = [];

  if (parsed.program === 'SPPRO') {
    if (!parsed.document?.bordero_number) missingCritical.push('bordero_number');
    if (!hasDate) missingCritical.push('date');
    if (!hasNumber(parsed.values?.face_value)) missingCritical.push('face_value');
    if (!hasNumber(parsed.values?.net_value)) missingCritical.push('net_value');
  } else {
    if (!parsed.document?.operation_number) missingCritical.push('operation_number');
    if (!hasDate) missingCritical.push('date');

    if (!hasNumber(parsed.values?.face_value)) missingCritical.push('face_value');
    if (!hasNumber(parsed.values?.net_value)) missingCritical.push('net_value');
  }

  const unreliableProgram = parsed.detected_by === 'fallback' && lowConfidence && !programHintUsed;
  const totalsMismatch =
    totalsChecks.docs_count > 0 &&
    (totalsChecks.valor_ok === false || totalsChecks.liquido_ok === false);
  const hasCriticalConflict = extractionDiagnostics.hasCriticalConflict;

  if (totalsMismatch) {
    warnings.push('Inconsistência entre totais do cabeçalho e soma dos documentos.');
  }

  if (hasCriticalConflict) {
    warnings.push('Conflito crítico de extração numérica detectado. Revisão manual obrigatória.');
  }

  if (missingCritical.length === 0 && !unreliableProgram && !totalsMismatch && !hasCriticalConflict) {
    return {
      status: 'parsed',
      reason: null,
      warnings,
      missing_critical: missingCritical,
    };
  }

  if (missingCritical.length === 0 && (unreliableProgram || totalsMismatch || hasCriticalConflict)) {
    if (unreliableProgram) {
      warnings.push('Programa detectado com baixa confiança.');
    }

    const reasonParts: string[] = [];
    if (totalsMismatch) reasonParts.push('Inconsistência de totais entre cabeçalho e documentos');
    if (unreliableProgram) reasonParts.push('programa identificado com baixa confiança');
    if (hasCriticalConflict) reasonParts.push('conflito crítico de extração numérica');

    return {
      status: 'parse_partial',
      reason: `${reasonParts.join('; ')}. Revisão manual recomendada.`,
      warnings,
      missing_critical: missingCritical,
    };
  }

  if (missingCritical.length >= 3 && unreliableProgram) {
    return {
      status: 'failed',
      reason: `Campos críticos ausentes (${missingCritical.join(', ')}) e baixa confiança de detecção.`,
      warnings,
      missing_critical: missingCritical,
    };
  }

  const reason =
    `Campos críticos ausentes (${missingCritical.join(', ')})` +
    (totalsMismatch ? '; inconsistência de totais entre cabeçalho e documentos.' : '.');

  return {
    status: 'parse_partial',
    reason,
    warnings,
    missing_critical: missingCritical,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expectedSecret = getParseSecret();
  if (!expectedSecret) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Segredo de parsing DISECURIT não configurado.',
    });
  }

  const providedSecret = String(getHeaderValue(req, 'x-disecurit-parse-secret') || '').trim();
  if (!providedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'x-disecurit-parse-secret inválido.',
    });
  }

  let body: any;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo inválido.' });
  }

  const rawText = String(body?.raw_text || '').trim();
  const rawTextOcr = String(body?.ocr_text || body?.raw_text_ocr || '').trim();
  const rawScore = scoreTextStructuralQuality(rawText);
  const ocrScore = scoreTextStructuralQuality(rawTextOcr);
  const shouldPreferOcr =
    Boolean(rawTextOcr) &&
    (rawText.length < 40 || (ocrScore >= 6 && ocrScore > rawScore + 2));
  const parseText = shouldPreferOcr ? rawTextOcr : rawText || rawTextOcr;
  const ocrUsed = Boolean(rawTextOcr && parseText === rawTextOcr);

  if (!parseText) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'raw_text é obrigatório para parsing.',
    });
  }

  const rootProgramHint = normalizeProgramHint(body?.program_hint || null);
  const hintsProgramHint = normalizeProgramHint(body?.hints?.program_hint || null);
  const programHint = rootProgramHint || hintsProgramHint;

  const parsedPayload = parseDisecuritPdfText(parseText, programHint || undefined, {
    hints: {
      operation_number: body?.hints?.operation_number || null,
    },
  });
  const totalsChecks = computeTotalsChecks(parsedPayload);
  const extractionDiagnostics = computeExtractionDiagnostics(parsedPayload, totalsChecks, { ocrUsed });
  const evaluation = evaluateParseStatus(parsedPayload, Boolean(programHint), totalsChecks, extractionDiagnostics);
  const operationNumber =
    parsedPayload.document?.operation_number || parsedPayload.document?.bordero_number || null;

  const mergedWarnings = [...evaluation.warnings];
  if (ocrUsed) {
    mergedWarnings.push('OCR fallback utilizado por baixa qualidade do texto bruto.');
  }

  // Garante warnings atualizados no payload retornado
  parsedPayload.debug = {
    ...(parsedPayload.debug || {}),
    warnings: [...new Set(mergedWarnings)],
    missing_critical: evaluation.missing_critical,
    extraction_diagnostics: extractionDiagnostics.diagnostics,
    has_critical_conflict: extractionDiagnostics.hasCriticalConflict,
  };

  return res.status(200).json({
    import_file_id: body?.import_file_id || null,
    empresa_id: body?.empresa_id || null,
    source: 'disecurit',
    program_hint: programHint || null,
    parse_status: evaluation.status,
    reason: evaluation.reason,
    operation_number: operationNumber,
    file_sha256: body?.file_sha256 || null,
    parsed_payload: parsedPayload,
    totals_checks: totalsChecks,
    warnings: [...new Set(mergedWarnings)],
    missing_critical: evaluation.missing_critical,
    extraction_diagnostics: extractionDiagnostics.diagnostics,
    has_critical_conflict: extractionDiagnostics.hasCriticalConflict,
    ocr_used: ocrUsed,
    next_parse_attempt: body?.next_parse_attempt ?? null,
  });
}
