import { createHash } from 'crypto';
import type {
  DisecuritDetectedBy,
  DisecuritParseResult,
  DisecuritProgram,
  DisecuritParsedDocument,
  DisecuritSpproFormulaSnapshot,
  DisecuritSoiFormulaSnapshot,
} from '../../types/disecurit-import.js';

const MONEY_CAPTURE = '([+-]?(?:\\d{1,3}(?:\\.\\d{3})*|\\d+)(?:,\\d{2})?)';
const MONEY_CAPTURE_LOOSE = '([+-]?(?:\\d[\\d.\\s]*\\d|\\d)(?:,\\d{2})?)';

const SPPRO_MARKERS = [
  /DEMONSTRATIVO\s+DE\s+OPERA[ÇC][AÃ]O\s+DE\s+FOMENTO\s+MERCANTIL/i,
  /COMPRA\s+DE\s+CR[ÉE]DITOS\.\s*PAGAMENTO\s+A\s+VISTA/i,
  /VALOR\s+DE\s+FACE\s+DOS\s+T[ÍI]TULOS/i,
  /VALOR\s+L[ÍI]QUIDO\s+DA\s+OPERA[ÇC][AÃ]O/i,
];

const SOI_MARKERS = [
  /BORDER[ÔO]\s+DE\s+OPERA[ÇC][AÃ]O/i,
  /DOCUMENTOS\s+DA\s*OPERA[ÇC][AÃ]O/i,
  /OPERA[ÇC][AÃ]O\s*:\s*\d+/i,
  /DT\.?\s*PAG\.?\s*:\s*\d{2}\/\d{2}\/\d{4}/i,
];

const SEARCH_TEXT_CLEANUP_REGEX = /[^\w\s$.,:+=\-()/]/g;
const CURRENCY_TOKEN = '(?:R\\s*\\$\\s*:?)';

type MatchType =
  | 'after_label'
  | 'before_label'
  | 'direct_label'
  | 'table_block_sequence'
  | 'table_block_formula_choice'
  | 'header_sequence'
  | 'hint_fallback'
  | 'forward_window'
  | 'forward_last_money'
  | 'documents_sum'
  | 'formula_reference'
  | 'line_number'
  | null;

interface MoneyLabelExtraction {
  value: number | null;
  raw: string | null;
  matchType: MatchType;
}

interface MoneyCandidate {
  value: number;
  raw: string | null;
  matchType: MatchType;
  confidence: number;
}

interface SpProValuesResult {
  values: {
    face_value: number | null;
    purchase_value: number | null;
    ad_valorem: number | null;
    iss: number | null;
    iof: number | null;
    iof_additional: number | null;
    expenses: number | null;
    recompra: number | null;
    amort_debits: number | null;
    amort_credits: number | null;
    discount_value: number | null;
    net_value: number | null;
  };
  regex_matches: Record<string, unknown>;
  sppro_formula: DisecuritSpproFormulaSnapshot;
}

interface SoiDocumentResult {
  document: {
    operation_number: string | null;
    bordero_number: null;
    date: string | null;
    payment_date: string | null;
  };
  regex_matches: Record<string, unknown>;
  warnings: string[];
}

interface SoiValuesResult {
  values: {
    face_value: number | null;
    purchase_value: number | null;
    ad_valorem: number | null;
    iss: number | null;
    iof: number | null;
    iof_additional: number | null;
    expenses: number | null;
    recompra: number | null;
    amort_debits: number | null;
    amort_credits: number | null;
    discount_value: number | null;
    net_value: number | null;
  };
  regex_matches: Record<string, unknown>;
  soi_formula: DisecuritSoiFormulaSnapshot;
}

interface ParseDisecuritOptions {
  hints?: {
    operation_number?: string | null;
  } | null;
}

function pickFirstTextMatch(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function toIsoDate(day: string, month: string, year: string): string | null {
  if (!day || !month || !year) return null;
  const iso = `${year}-${month}-${day}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return iso;
}

function normalizeProgram(input?: string | null): DisecuritProgram | null {
  const value = String(input || '').trim().toUpperCase();
  if (value === 'SPPRO' || value === 'SOI') return value;
  return null;
}

function parseMoneyFromRegex(text: string, regex: RegExp): number | null {
  const match = text.match(regex);
  return parseMoneyBR(match?.[1] ?? null);
}

function parseMoneyFromRegexes(text: string, regexes: RegExp[]): number | null {
  for (const regex of regexes) {
    const parsed = parseMoneyFromRegex(text, regex);
    if (parsed !== null) return parsed;
  }
  return null;
}

function parseTextSha256(text: string): string {
  return createHash('sha256').update(text || '', 'utf8').digest('hex');
}

function normalizeWhitespace(text: string): string {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\t ]+/g, ' ')
    .trim();
}

function buildTextExcerpt(text: string, maxLength = 1200): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function normalizeForLabelSearch(text: string): string {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(SEARCH_TEXT_CLEANUP_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickSpProValuesScope(text: string): string {
  const normalized = normalizeWhitespace(text);
  const upper = normalized.toUpperCase();

  const startMarkers = [
    'VALOR DE FACE',
    'VALOR DE COMPRA',
    'DEMONSTRATIVO DE OPERACAO',
    'DEMONSTRATIVO DE OPERAÇÃO',
  ];
  const endMarkers = ['DEMONSTRATIVO DE PAGAMENTO', 'DESTINO DO PAGAMENTO', 'DESPESAS COBRAR'];

  let start = -1;
  for (const marker of startMarkers) {
    const idx = upper.indexOf(marker);
    if (idx >= 0 && (start < 0 || idx < start)) start = idx;
  }
  if (start < 0) start = 0;

  let end = normalized.length;
  for (const marker of endMarkers) {
    const idx = upper.indexOf(marker, start + 1);
    if (idx > start && idx < end) end = idx;
  }

  const maxSpan = 2800;
  if (end - start > maxSpan) end = start + maxSpan;

  return normalized.slice(start, end);
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractMoneyFromLabeledScope(
  scope: string,
  labels: string[],
  options?: {
    allowBeforeLabel?: boolean;
    beforeOperator?: '+' | '-' | '=' | '*';
    excludeLabelSuffixes?: string[];
    allowLooseAfterLabelSearch?: boolean;
    allowAfterLabelSearch?: boolean;
    preferBeforeLabel?: boolean;
  }
): MoneyLabelExtraction {
  const cleanScope = normalizeForLabelSearch(scope);
  const allowBeforeLabel = options?.allowBeforeLabel === true;
  const preferBeforeLabel = options?.preferBeforeLabel === true;
  const escapedOperator = options?.beforeOperator ? escapeForRegex(options.beforeOperator) : null;
  const escapedSuffixes = (options?.excludeLabelSuffixes || [])
    .map((suffix) => normalizeForLabelSearch(suffix))
    .filter(Boolean)
    .map((suffix) => escapeForRegex(suffix));
  const suffixGuard = escapedSuffixes.length ? `(?!\\s+(?:${escapedSuffixes.join('|')})\\b)` : '';
  const allowLooseAfterLabelSearch = options?.allowLooseAfterLabelSearch !== false;
  const allowAfterLabelSearch = options?.allowAfterLabelSearch !== false;

  for (const label of labels) {
    const escapedLabel = escapeForRegex(label);
    const labelPattern = `${escapedLabel}${suffixGuard}`;

    const afterPatterns = [
      new RegExp(
        `${labelPattern}\\s*:?\\s*(?:\\(\\s*[+\\-=]\\s*\\)\\s*)?(?:${CURRENCY_TOKEN}\\s*)?${MONEY_CAPTURE}`,
        'i'
      ),
      new RegExp(`${labelPattern}\\s*:?\\s*(?:\\(\\s*[+\\-=]\\s*\\)\\s*)?${MONEY_CAPTURE}`, 'i'),
      ...(allowLooseAfterLabelSearch
        ? [new RegExp(`${labelPattern}[\\s\\S]{0,36}?${CURRENCY_TOKEN}\\s*${MONEY_CAPTURE}`, 'i')]
        : []),
    ];

    const beforePatterns = escapedOperator
      ? [
          new RegExp(
            `${MONEY_CAPTURE}\\s*(?:${CURRENCY_TOKEN}\\s*)?\\(\\s*${escapedOperator}\\s*\\)\\s*${labelPattern}`,
            'i'
          ),
          new RegExp(`${MONEY_CAPTURE}\\s*${CURRENCY_TOKEN}\\s*${labelPattern}`, 'i'),
        ]
      : [
          new RegExp(`${MONEY_CAPTURE}\\s*${CURRENCY_TOKEN}\\s*(?:\\(\\s*[+\\-=]\\s*\\)\\s*)?${labelPattern}`, 'i'),
        ];

    const tryBefore = (): MoneyLabelExtraction | null => {
      if (!allowBeforeLabel) return null;
      for (const pattern of beforePatterns) {
        const match = cleanScope.match(pattern);
        const parsed = parseMoneyBR(match?.[1] ?? null);
        if (parsed !== null) {
          return {
            value: parsed,
            raw: match?.[1] ?? null,
            matchType: 'before_label',
          };
        }
      }
      return null;
    };

    const tryAfter = (): MoneyLabelExtraction | null => {
      if (!allowAfterLabelSearch) return null;
      for (const pattern of afterPatterns) {
        const match = cleanScope.match(pattern);
        const parsed = parseMoneyBR(match?.[1] ?? null);
        if (parsed !== null) {
          return {
            value: parsed,
            raw: match?.[1] ?? null,
            matchType: 'after_label',
          };
        }
      }
      return null;
    };

    if (preferBeforeLabel) {
      const before = tryBefore();
      if (before) return before;
    }

    const after = tryAfter();
    if (after) return after;

    const before = tryBefore();
    if (before) return before;
  }

  return { value: null, raw: null, matchType: null };
}

function extractIsoDates(text: string): string[] {
  const matches = text.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
  const unique = new Set<string>();

  for (const match of matches) {
    const iso = parseDateBR(match);
    if (iso) unique.add(iso);
  }

  return [...unique];
}

function scoreMatchType(matchType: MatchType): number {
  if (matchType === 'direct_label') return 0.95;
  if (matchType === 'after_label') return 0.92;
  if (matchType === 'before_label') return 0.89;
  if (matchType === 'table_block_sequence') return 0.97;
  if (matchType === 'table_block_formula_choice') return 0.93;
  if (matchType === 'documents_sum') return 0.96;
  if (matchType === 'header_sequence') return 0.86;
  if (matchType === 'forward_window') return 0.8;
  if (matchType === 'forward_last_money') return 0.78;
  if (matchType === 'line_number') return 0.9;
  if (matchType === 'hint_fallback') return 0.6;
  if (matchType === 'formula_reference') return 0.82;
  return 0.5;
}

function resolveMoneyTolerance(...values: Array<number | null | undefined>): number {
  const base = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce((max, current) => Math.max(max, Math.abs(current)), 0);
  return Math.max(0.5, Number((base * 0.002).toFixed(2)));
}

function pickBestMoneyCandidateWithReference(
  candidates: MoneyCandidate[],
  referenceValue: number | null
): MoneyCandidate | null {
  if (!candidates.length) return null;
  if (referenceValue === null) return pickBestMoneyCandidate(candidates);

  return [...candidates].sort((left, right) => {
    const score = (candidate: MoneyCandidate) => {
      const base = candidate.confidence || 0;
      const tolerance = resolveMoneyTolerance(candidate.value, referenceValue);
      const diff = Math.abs(candidate.value - referenceValue);
      const consistencyBonus = diff <= tolerance ? 0.25 : -0.45;
      return base + consistencyBonus;
    };

    return score(right) - score(left);
  })[0];
}

function toMoneyCandidate(extraction: MoneyLabelExtraction): MoneyCandidate | null {
  if (extraction.value === null) return null;
  return {
    value: extraction.value,
    raw: extraction.raw,
    matchType: extraction.matchType,
    confidence: scoreMatchType(extraction.matchType),
  };
}

function addMoneyCandidate(target: MoneyCandidate[], candidate: MoneyCandidate | null): void {
  if (!candidate) return;
  const key = `${candidate.value.toFixed(2)}::${candidate.matchType || 'none'}`;
  const existing = target.find((item) => `${item.value.toFixed(2)}::${item.matchType || 'none'}` === key);
  if (!existing) {
    target.push(candidate);
    return;
  }
  if ((candidate.confidence || 0) > (existing.confidence || 0)) {
    existing.raw = candidate.raw;
    existing.confidence = candidate.confidence;
  }
}

function pickBestMoneyCandidate(candidates: MoneyCandidate[]): MoneyCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
}

function mapMatchTypeToSourceMethod(matchType: MatchType): 'regex' | 'heuristic' {
  if (
    matchType === 'hint_fallback' ||
    matchType === 'header_sequence' ||
    matchType === 'documents_sum' ||
    matchType === 'formula_reference' ||
    matchType === 'table_block_formula_choice'
  ) {
    return 'heuristic';
  }
  return 'regex';
}

function toFormulaFieldSnapshot(
  best: MoneyCandidate | null,
  candidates: MoneyCandidate[]
): DisecuritSoiFormulaSnapshot['valor_original'] {
  return {
    value: best?.value ?? null,
    raw_value: best?.raw ?? null,
    source_method: mapMatchTypeToSourceMethod(best?.matchType || null),
    confidence: best?.confidence ?? null,
    match_type: best?.matchType || null,
    candidates: candidates.map((candidate) => ({
      value: candidate.value,
      raw_value: candidate.raw,
      source_method: mapMatchTypeToSourceMethod(candidate.matchType),
      confidence: candidate.confidence ?? null,
      match_type: candidate.matchType || null,
    })),
  };
}

function extractMoneyCandidatesFromLabelLine(
  text: string,
  labelRegexes: RegExp[],
  options?: { includeNextLine?: boolean; preferLastOnLine?: boolean }
): MoneyCandidate[] {
  const lines = normalizeWhitespace(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: MoneyCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeForLabelSearch(line);
    const hasLabel = labelRegexes.some((regex) => regex.test(normalizedLine));
    if (!hasLabel) continue;

    const lineTokens = extractMoneyTokens(line);
    if (lineTokens.length > 0) {
      lineTokens.forEach((token, tokenIndex) => {
        const parsed = parseMoneyBR(token);
        if (parsed === null) return;
        const isLast = tokenIndex === lineTokens.length - 1;
        const confidenceBoost = options?.preferLastOnLine
          ? isLast
            ? 0.08
            : -0.14
          : 0;
        addMoneyCandidate(candidates, {
          value: parsed,
          raw: token,
          matchType: isLast ? 'direct_label' : 'forward_window',
          confidence: Math.max(0, (isLast ? 0.95 : 0.78) + confidenceBoost),
        });
      });
    }

    if (options?.includeNextLine) {
      const nextLine = lines[index + 1] || '';
      if (nextLine) {
        const nextTokens = extractMoneyTokens(nextLine);
        nextTokens.forEach((token, tokenIndex) => {
          const parsed = parseMoneyBR(token);
          if (parsed === null) return;
          const isLast = tokenIndex === nextTokens.length - 1;
          addMoneyCandidate(candidates, {
            value: parsed,
            raw: token,
            matchType: isLast ? 'forward_last_money' : 'forward_window',
            confidence: isLast ? 0.8 : 0.74,
          });
        });
      }
    }
  }

  return candidates;
}

function extractMoneyTokens(text: string): string[] {
  return text.match(/[+-]?(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}/g) || [];
}

function extractMoneyFromForwardWindow(
  text: string,
  labelRegexes: RegExp[],
  options: { windowSize: number; pickLast: boolean; matchType: MatchType; stopRegexes?: RegExp[] }
): MoneyLabelExtraction {
  for (const labelRegex of labelRegexes) {
    const labelMatch = labelRegex.exec(text);
    if (!labelMatch || labelMatch.index === undefined) continue;

    const startIndex = labelMatch.index + labelMatch[0].length;
    const endIndex = Math.min(text.length, startIndex + options.windowSize);
    let windowText = text.slice(startIndex, endIndex);

    if (options.stopRegexes && options.stopRegexes.length > 0) {
      let cutIndex = windowText.length;
      for (const stopRegex of options.stopRegexes) {
        const stopMatch = stopRegex.exec(windowText);
        if (stopMatch && stopMatch.index !== undefined && stopMatch.index < cutIndex) {
          cutIndex = stopMatch.index;
        }
      }
      windowText = windowText.slice(0, cutIndex);
    }

    const moneyTokens = extractMoneyTokens(windowText);
    if (moneyTokens.length === 0) continue;

    const raw = options.pickLast ? moneyTokens[moneyTokens.length - 1] : moneyTokens[0];
    const value = parseMoneyBR(raw);

    if (value !== null) {
      return {
        value,
        raw,
        matchType: options.matchType,
      };
    }
  }

  return { value: null, raw: null, matchType: null };
}

export function normalizeProgramHint(programHint?: string | null): DisecuritProgram | null {
  return normalizeProgram(programHint);
}

export function parseMoneyBR(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/R\$\s*/gi, '')
    .replace(/[^\d,.-]/g, '')
    .replace(/\s/g, '');

  if (!cleaned) return null;

  let normalized = cleaned;

  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseDateBR(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return null;
  return toIsoDate(match[1], match[2], match[3]);
}

export function detectProgramFromText(text: string): DisecuritProgram | null {
  const normalized = normalizeWhitespace(text).toUpperCase();

  const spproHits = SPPRO_MARKERS.reduce((acc, marker) => acc + (marker.test(normalized) ? 1 : 0), 0);
  const soiHits = SOI_MARKERS.reduce((acc, marker) => acc + (marker.test(normalized) ? 1 : 0), 0);

  if (spproHits === 0 && soiHits === 0) return null;
  if (spproHits > soiHits) return 'SPPRO';
  if (soiHits > spproHits) return 'SOI';

  // Empate: prioriza SOI por ser o layout mais comum na fase atual
  return 'SOI';
}

function parseSpProDocument(text: string) {
  const relaxedText = normalizeForLabelSearch(text);

  const borderoNumber =
    pickFirstTextMatch(text, [/Border[ôo]\s*n[ºo]?\s*(\d+)/i]) ||
    pickFirstTextMatch(relaxedText, [/Bord(?:ero|oro)\s*n[ºo]?\s*(\d+)/i]);

  const borderoLineDateRaw =
    pickFirstTextMatch(text, [/Border[ôo][^\n]*?(\d{2}\/\d{2}\/\d{4})/i]) ||
    pickFirstTextMatch(relaxedText, [/Bord(?:ero|oro)[^\n]*?(\d{2}\/\d{2}\/\d{4})/i]);

  const borderoLineDate = parseDateBR(borderoLineDateRaw);
  const fallbackDate = extractIsoDates(text)[0] || null;

  return {
    operation_number: null,
    bordero_number: borderoNumber,
    date: borderoLineDate || fallbackDate,
    payment_date: null,
  };
}

function parseSoiDocument(text: string, operationNumberHint?: string | null): SoiDocumentResult {
  const warnings: string[] = [];

  const directOperationMatch = text.match(/Opera[çc][aã]o\s*:\s*(\d{3,})\b/i);
  const headerSequenceMatch = text.match(
    /Opera[çc][aã]o\s*:[\s\S]{0,140}?(\d{3,})\s+(\d{2}\/\d{2}\/\d{4})\s+(NORMAL|PAGA|ABERTA|LIQUIDADA|VENCIDA)/i
  );

  let operationNumber = directOperationMatch?.[1] || null;
  let operationNumberMatchType: MatchType = directOperationMatch ? 'direct_label' : null;

  if (!operationNumber && headerSequenceMatch?.[1]) {
    operationNumber = headerSequenceMatch[1];
    operationNumberMatchType = 'header_sequence';
  }

  if (!operationNumber) {
    const hintDigits = String(operationNumberHint || '').match(/\d{3,}/)?.[0] || null;
    if (hintDigits) {
      operationNumber = hintDigits;
      operationNumberMatchType = 'hint_fallback';
      warnings.push('Número da operação preenchido via hint do usuário.');
    }
  }

  const paymentDateRaw =
    pickFirstTextMatch(text, [/Dt\.?\s*Pag\.?\s*:\s*(\d{2}\/\d{2}\/\d{4})/i]) ||
    headerSequenceMatch?.[2] ||
    null;

  const paymentDate = parseDateBR(paymentDateRaw);

  return {
    document: {
      operation_number: operationNumber,
      bordero_number: null,
      date: paymentDate,
      payment_date: paymentDate,
    },
    regex_matches: {
      operation_number_raw: operationNumber,
      operation_number_match_type: operationNumberMatchType,
    },
    warnings,
  };
}

function parseSpProParties(text: string) {
  const seller = pickFirstTextMatch(text, [/Vendedora\s*-\s*Contratante\s*:\s*(.+)/i]);
  const buyer = pickFirstTextMatch(text, [/Compradora\s*-\s*Contratada\s*:\s*(.+)/i]);

  return {
    seller_name: seller,
    buyer_name: buyer,
    client_name: null,
    client_doc: null,
  };
}

function parseSoiParties(text: string) {
  const match = text.match(/Cliente\s*:\s*.*?-\s*(.*?)\s+(CNPJ|CPF)\s*:\s*([0-9.\-/]+)/i);

  return {
    seller_name: null,
    buyer_name: null,
    client_name: match?.[1]?.trim() || null,
    client_doc: match?.[3]?.trim() || null,
  };
}

function parseSpProValues(text: string): SpProValuesResult {
  const valuesScope = pickSpProValuesScope(text);

  const extractQuantityCandidates = (scope: string): MoneyCandidate[] => {
    const candidates: MoneyCandidate[] = [];
    const lines = normalizeWhitespace(scope)
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const normalizedLine = normalizeForLabelSearch(line);

      if (!/quantidade\s+de\s+titulos/.test(normalizedLine)) continue;

      const inlineMatch = line.match(/(\d{1,5})\s*$/);
      if (inlineMatch?.[1]) {
        const parsed = parseMoneyBR(inlineMatch[1]);
        if (parsed !== null) {
          addMoneyCandidate(candidates, {
            value: parsed,
            raw: inlineMatch[1],
            matchType: 'direct_label',
            confidence: scoreMatchType('direct_label'),
          });
        }
      }

      const nextLine = lines[index + 1] || '';
      const nextLineMatch = nextLine.match(/^(\d{1,5})$/);
      if (nextLineMatch?.[1]) {
        const parsed = parseMoneyBR(nextLineMatch[1]);
        if (parsed !== null) {
          addMoneyCandidate(candidates, {
            value: parsed,
            raw: nextLineMatch[1],
            matchType: 'line_number',
            confidence: scoreMatchType('line_number'),
          });
        }
      }
    }

    const directMatch = scope.match(/Quantidade\s+de\s+T[íi]tulos\s*:?\s*(\d{1,5})/i);
    if (directMatch?.[1]) {
      const parsed = parseMoneyBR(directMatch[1]);
      if (parsed !== null) {
        addMoneyCandidate(candidates, {
          value: parsed,
          raw: directMatch[1],
          matchType: 'after_label',
          confidence: scoreMatchType('after_label'),
        });
      }
    }

    return candidates;
  };

  const buildCandidates = (seed: Array<MoneyLabelExtraction | null>, lineCandidates?: MoneyCandidate[]): MoneyCandidate[] => {
    const candidates: MoneyCandidate[] = [];
    for (const extraction of seed) {
      addMoneyCandidate(candidates, toMoneyCandidate(extraction || { value: null, raw: null, matchType: null }));
    }
    for (const candidate of lineCandidates || []) {
      addMoneyCandidate(candidates, candidate);
    }
    return candidates;
  };

  const faceCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, [
      'Valor de Face dos Titulos',
      'Valor de Face dos Creditos',
      'Face dos Titulos',
      'Valor Original',
    ]),
    extractMoneyFromForwardWindow(valuesScope, [/Valor de Face dos Titulos\s*:?/i, /Face dos Titulos\s*:?/i], {
      windowSize: 160,
      pickLast: false,
      matchType: 'forward_window',
    }),
  ]);

  const purchaseCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, ['Valor de Compra', 'Valor Pago ao Cedente', 'Valor Pago']),
    extractMoneyFromForwardWindow(valuesScope, [/Valor de Compra\s*:?/i, /Valor Pago ao Cedente\s*:?/i], {
      windowSize: 160,
      pickLast: false,
      matchType: 'forward_window',
    }),
  ]);

  const adValoremCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, ['Valor de Ad-valorem'], {
      allowBeforeLabel: true,
      beforeOperator: '-',
    }),
    extractMoneyFromForwardWindow(valuesScope, [/Valor de Ad-?valorem\s*:?/i], {
      windowSize: 120,
      pickLast: false,
      matchType: 'forward_window',
    }),
  ]);

  const issCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, ['Valor de ISS'], {
      allowBeforeLabel: true,
      beforeOperator: '-',
    }),
    extractMoneyFromForwardWindow(valuesScope, [/Valor de ISS\s*:?/i], {
      windowSize: 100,
      pickLast: false,
      matchType: 'forward_window',
    }),
  ]);

  const expensesCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, ['Valor de Despesas', 'Despesas'], {
      allowBeforeLabel: true,
      beforeOperator: '-',
    }),
    extractMoneyFromForwardWindow(valuesScope, [/Valor de Despesas\s*:?/i, /Despesas\s*:?/i], {
      windowSize: 120,
      pickLast: false,
      matchType: 'forward_window',
    }),
  ]);

  const iofCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, ['Valor de IOF'], {
      allowBeforeLabel: true,
      beforeOperator: '-',
      excludeLabelSuffixes: ['Adicional'],
      allowLooseAfterLabelSearch: false,
      preferBeforeLabel: true,
    }),
    extractMoneyFromForwardWindow(valuesScope, [/Valor de IOF(?!\s+Adicional)\s*:?/i], {
      windowSize: 120,
      pickLast: true,
      matchType: 'forward_last_money',
    }),
  ]);

  const iofAdditionalCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, ['Valor de IOF Adicional'], {
      allowBeforeLabel: true,
      beforeOperator: '-',
      allowLooseAfterLabelSearch: false,
      preferBeforeLabel: true,
    }),
    extractMoneyFromForwardWindow(valuesScope, [/Valor de IOF Adicional\s*:?/i], {
      windowSize: 140,
      pickLast: true,
      matchType: 'forward_last_money',
    }),
  ]);

  const recompraCandidates = buildCandidates([
    extractMoneyFromLabeledScope(valuesScope, ['Valor de Recompra'], {
      allowBeforeLabel: true,
      beforeOperator: '-',
      allowLooseAfterLabelSearch: false,
      allowAfterLabelSearch: false,
      preferBeforeLabel: true,
    }),
  ]);

  const netLineCandidates = extractMoneyCandidatesFromLabelLine(
    valuesScope,
    [/Valor L[íi]quido da Opera[çc][aã]o/i, /L[íi]quido da Opera[çc][aã]o/i, /L[íi]quido Liberado/i],
    { includeNextLine: true, preferLastOnLine: true }
  );
  const netCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(
        valuesScope,
        ['Valor Liquido da Operacao', 'Liquido da Operacao', 'Liquido Liberado'],
        { allowBeforeLabel: true, beforeOperator: '=' }
      ),
      extractMoneyFromForwardWindow(
        valuesScope,
        [/Valor L[íi]quido da Opera[çc][aã]o\s*:?/i, /L[íi]quido da Opera[çc][aã]o\s*:?/i, /L[íi]quido Liberado\s*:?/i],
        { windowSize: 220, pickLast: true, matchType: 'forward_last_money' }
      ),
    ],
    netLineCandidates
  );

  const quantityCandidates = extractQuantityCandidates(valuesScope);

  const bestFace = pickBestMoneyCandidate(faceCandidates);
  const bestPurchase = pickBestMoneyCandidate(purchaseCandidates);
  const bestAdValorem = pickBestMoneyCandidate(adValoremCandidates);
  const bestIss = pickBestMoneyCandidate(issCandidates);
  const bestExpenses = pickBestMoneyCandidate(expensesCandidates);
  const bestIof = pickBestMoneyCandidate(iofCandidates);
  const bestIofAdditional = pickBestMoneyCandidate(iofAdditionalCandidates);
  const bestRecompra = pickBestMoneyCandidate(recompraCandidates);
  const bestQuantity = pickBestMoneyCandidate(quantityCandidates);
  const resolvedRecompraValue = bestRecompra?.value ?? 0;

  const formulaNetReference =
    bestFace &&
    bestPurchase &&
    bestAdValorem &&
    bestIss &&
    bestExpenses &&
    bestIof &&
    bestIofAdditional &&
    bestFace.value !== null &&
    bestPurchase.value !== null &&
    bestAdValorem.value !== null &&
    bestIss.value !== null &&
    bestExpenses.value !== null &&
    bestIof.value !== null &&
    bestIofAdditional.value !== null
      ? Number(
          (
            bestFace.value -
            bestPurchase.value -
            bestAdValorem.value -
            bestIss.value -
            bestExpenses.value -
            bestIof.value -
            bestIofAdditional.value -
            resolvedRecompraValue
          ).toFixed(2)
        )
      : null;

  if (formulaNetReference !== null) {
    addMoneyCandidate(netCandidates, {
      value: formulaNetReference,
      raw: formulaNetReference.toFixed(2),
      matchType: 'formula_reference',
      confidence: scoreMatchType('formula_reference'),
    });
  }

  const bestNet = pickBestMoneyCandidateWithReference(netCandidates, formulaNetReference);
  const recompraSnapshot = toFormulaFieldSnapshot(bestRecompra, recompraCandidates);
  if (recompraSnapshot.value === null) {
    recompraSnapshot.value = 0;
    recompraSnapshot.reason = 'Campo não encontrado no layout; aplicado default 0 para consistência da fórmula SPPRO.';
    recompraSnapshot.match_type = 'hint_fallback';
    recompraSnapshot.source_method = 'heuristic';
    recompraSnapshot.confidence = Math.max(recompraSnapshot.confidence ?? 0, 0.6);
  }

  const spproFormula: DisecuritSpproFormulaSnapshot = {
    quantidade_titulos: toFormulaFieldSnapshot(bestQuantity, quantityCandidates),
    valor_face: toFormulaFieldSnapshot(bestFace, faceCandidates),
    valor_compra: toFormulaFieldSnapshot(bestPurchase, purchaseCandidates),
    ad_valorem: toFormulaFieldSnapshot(bestAdValorem, adValoremCandidates),
    iss: toFormulaFieldSnapshot(bestIss, issCandidates),
    despesas: toFormulaFieldSnapshot(bestExpenses, expensesCandidates),
    iof: toFormulaFieldSnapshot(bestIof, iofCandidates),
    iof_adicional: toFormulaFieldSnapshot(bestIofAdditional, iofAdditionalCandidates),
    recompra: recompraSnapshot,
    liquido_operacao: toFormulaFieldSnapshot(bestNet, netCandidates),
  };

  return {
    values: {
      face_value: spproFormula.valor_face.value,
      purchase_value: spproFormula.valor_compra.value,
      ad_valorem: spproFormula.ad_valorem.value,
      iss: spproFormula.iss.value,
      iof: spproFormula.iof.value,
      iof_additional: spproFormula.iof_adicional.value,
      expenses: spproFormula.despesas.value,
      recompra: spproFormula.recompra.value,
      amort_debits: 0,
      amort_credits: 0,
      discount_value: null,
      net_value: spproFormula.liquido_operacao.value,
    },
    regex_matches: {
      quantidade_titulos_raw: bestQuantity?.raw ?? null,
      quantidade_titulos_match_type: bestQuantity?.matchType ?? null,
      quantidade_titulos_candidates: quantityCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      face_value_raw: bestFace?.raw ?? null,
      face_value_match_type: bestFace?.matchType ?? null,
      face_value_candidates: faceCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      purchase_value_raw: bestPurchase?.raw ?? null,
      purchase_value_match_type: bestPurchase?.matchType ?? null,
      purchase_value_candidates: purchaseCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      ad_valorem_raw: bestAdValorem?.raw ?? null,
      ad_valorem_match_type: bestAdValorem?.matchType ?? null,
      ad_valorem_candidates: adValoremCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      iss_raw: bestIss?.raw ?? null,
      iss_match_type: bestIss?.matchType ?? null,
      iss_candidates: issCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      expenses_raw: bestExpenses?.raw ?? null,
      expenses_match_type: bestExpenses?.matchType ?? null,
      expenses_candidates: expensesCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      iof_raw: bestIof?.raw ?? null,
      iof_match_type: bestIof?.matchType ?? null,
      iof_candidates: iofCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      iof_additional_raw: bestIofAdditional?.raw ?? null,
      iof_additional_match_type: bestIofAdditional?.matchType ?? null,
      iof_additional_candidates: iofAdditionalCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      recompra_raw: bestRecompra?.raw ?? null,
      recompra_match_type: bestRecompra?.matchType ?? null,
      recompra_candidates: recompraCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      net_value_raw: bestNet?.raw ?? null,
      net_value_match_type: bestNet?.matchType ?? null,
      net_value_candidates: netCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      net_value_formula_reference: formulaNetReference,
    },
    sppro_formula: spproFormula,
  };
}

function extractMoneyCandidatesFromOperatorLabelLine(
  text: string,
  labels: RegExp[],
  options?: { includeNextLine?: boolean; includeTailLineCandidates?: boolean }
): MoneyCandidate[] {
  const lines = normalizeWhitespace(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates: MoneyCandidate[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matchedLabel = labels.find((label) => new RegExp(label.source, label.flags).test(line));
    if (!matchedLabel) continue;

    const match = new RegExp(matchedLabel.source, matchedLabel.flags).exec(line);
    if (!match || typeof match.index !== 'number') continue;

    const tail = line.slice(match.index + match[0].length);
    const nextOperatorIndex = tail.search(/\(\s*[+\-*=-]\s*\)\s*[A-Za-zÀ-ÿ]/);
    const scopedTail = nextOperatorIndex >= 0 ? tail.slice(0, nextOperatorIndex) : tail;
    const scopedTokens = extractMoneyTokens(scopedTail);

    if (scopedTokens.length > 0) {
      const firstToken = scopedTokens[0];
      const parsedFirst = parseMoneyBR(firstToken);
      if (parsedFirst !== null) {
        addMoneyCandidate(candidates, {
          value: parsedFirst,
          raw: firstToken,
          matchType: 'direct_label',
          confidence: 0.95,
        });
      }

      if (scopedTokens.length > 1) {
        const lastToken = scopedTokens[scopedTokens.length - 1];
        const parsedLast = parseMoneyBR(lastToken);
        if (parsedLast !== null) {
          addMoneyCandidate(candidates, {
            value: parsedLast,
            raw: lastToken,
            matchType: 'forward_last_money',
            confidence: 0.8,
          });
        }
      }
    }

    if (options?.includeTailLineCandidates) {
      const lineTokens = extractMoneyTokens(line);
      lineTokens.forEach((token, tokenIndex) => {
        const parsed = parseMoneyBR(token);
        if (parsed === null) return;
        const isLast = tokenIndex === lineTokens.length - 1;
        addMoneyCandidate(candidates, {
          value: parsed,
          raw: token,
          matchType: isLast ? 'forward_last_money' : 'forward_window',
          confidence: isLast ? 0.76 : 0.68,
        });
      });
    }

    if (options?.includeNextLine) {
      const nextLine = lines[index + 1] || '';
      if (nextLine) {
        const nextTokens = extractMoneyTokens(nextLine);
        if (nextTokens.length > 0) {
          const firstToken = nextTokens[0];
          const parsed = parseMoneyBR(firstToken);
          if (parsed !== null) {
            addMoneyCandidate(candidates, {
              value: parsed,
              raw: firstToken,
              matchType: 'forward_window',
              confidence: 0.72,
            });
          }
        }
      }
    }
  }

  return candidates;
}

function extractSoiDemonstrativoScope(text: string): string {
  const normalized = normalizeWhitespace(text);
  const start = normalized.search(/DEMONSTRATIVO\s+DOS\s+VALORES\s+APURADOS\s+NA\s+OPERA[ÇC][AÃ]O/i);
  if (start < 0) return '';

  const tail = normalized.slice(start);
  const end = tail.search(/DOCUMENTOS\s+DA\s*OPERA[ÇC][AÃ]O/i);
  if (end >= 0) {
    return tail.slice(0, end);
  }
  return tail.slice(0, 2200);
}

function extractSoiTableAwareCandidates(text: string): Partial<Record<keyof DisecuritSoiFormulaSnapshot, MoneyCandidate[]>> {
  const scope = extractSoiDemonstrativoScope(text);
  const tableCandidates: Partial<Record<keyof DisecuritSoiFormulaSnapshot, MoneyCandidate[]>> = {};

  const pushCandidate = (field: keyof DisecuritSoiFormulaSnapshot, raw: string | null, matchType: MatchType): void => {
    const parsed = parseMoneyBR(raw);
    if (parsed === null) return;
    if (!tableCandidates[field]) tableCandidates[field] = [];
    addMoneyCandidate(tableCandidates[field]!, {
      value: parsed,
      raw,
      matchType,
      confidence: scoreMatchType(matchType),
    });
  };

  if (scope) {
    const firstBlockPattern = new RegExp(
      `\\(\\s*[+\\-*=?]?\\s*\\)\\s*Despesas[\\s\\S]{0,120}?\\(\\s*[+\\-*=?]?\\s*\\)\\s*Regresso[\\s\\S]{0,120}?\\(\\s*[+\\-*=?]?\\s*\\)\\s*Amortiza\\s+d[ée]bitos\\s+${MONEY_CAPTURE}\\s+${MONEY_CAPTURE}\\s+${MONEY_CAPTURE}`,
      'i'
    );
    const firstMatch = firstBlockPattern.exec(scope);
    if (firstMatch) {
      // Layout colunar linearizado observado em SOI: amortiza débitos, regresso, despesas.
      pushCandidate('amortiza_debitos', firstMatch[1] || null, 'table_block_sequence');
      pushCandidate('regresso', firstMatch[2] || null, 'table_block_sequence');
      pushCandidate('despesas', firstMatch[3] || null, 'table_block_sequence');
    }

    const secondBlockPattern = new RegExp(
      `\\(\\s*\\+\\s*\\)\\s*Valor\\s+Original[\\s\\S]{0,140}?\\(\\s*-\\s*\\)\\s*Valor\\s+de\\s+Des[áa]gio(?!\\s+Antecipa)[\\s\\S]{0,40}?${MONEY_CAPTURE}[\\s\\S]{0,140}?\\(\\s*\\+\\s*\\)\\s*Amortiza\\s*cr[ée]ditos[\\s\\S]{0,100}?\\(\\s*-\\s*\\)\\s*Cr[ée]ditos\\s+gerados\\s+${MONEY_CAPTURE}\\s+${MONEY_CAPTURE}[\\s\\S]{0,160}?\\(\\s*=\\s*\\)\\s*L[íi]quido\\s+Liberado\\s+${MONEY_CAPTURE}[\\s\\S]{0,180}?\\(\\s*-\\s*\\)\\s*Valor\\s+de\\s+Des[áa]gio\\s+Antecipa[çc][aã]o\\s+${MONEY_CAPTURE}\\s+${MONEY_CAPTURE}`,
      'i'
    );
    const secondMatch = secondBlockPattern.exec(scope);
    if (secondMatch) {
      // Ordem observada no texto linearizado dos PDFs SOI reais:
      // [valor original], [amortiza créditos], [créditos gerados], [deságio], [deságio antecipação], [líquido].
      pushCandidate('valor_original', secondMatch[1] || null, 'table_block_sequence');
      pushCandidate('amortiza_creditos', secondMatch[2] || null, 'table_block_sequence');
      pushCandidate('creditos_gerados', secondMatch[3] || null, 'table_block_sequence');
      pushCandidate('valor_desagio', secondMatch[4] || null, 'table_block_sequence');
      pushCandidate('valor_desagio_antecipacao', secondMatch[5] || null, 'table_block_sequence');
      pushCandidate('liquido_liberado', secondMatch[6] || null, 'table_block_sequence');
    }

    const fallbackLiquidPattern = new RegExp(
      `\\(\\s*=\\s*\\)\\s*L[íi]quido\\s+Liberado\\s+${MONEY_CAPTURE}[\\s\\S]{0,180}?\\(\\s*-\\s*\\)\\s*Valor\\s+de\\s+Des[áa]gio\\s+Antecipa[çc][aã]o\\s+${MONEY_CAPTURE}\\s+${MONEY_CAPTURE}`,
      'i'
    );
    const fallbackLiquidMatch = fallbackLiquidPattern.exec(scope);
    if (fallbackLiquidMatch) {
      // Em PDFs flatten, o valor após "Líquido Liberado" costuma ser o deságio.
      pushCandidate('valor_desagio', fallbackLiquidMatch[1] || null, 'table_block_sequence');
      pushCandidate('valor_desagio_antecipacao', fallbackLiquidMatch[2] || null, 'table_block_sequence');
      pushCandidate('liquido_liberado', fallbackLiquidMatch[3] || null, 'table_block_sequence');
    }
  }

  const operationSummaryPattern = new RegExp(
    `${MONEY_CAPTURE_LOOSE}\\s+${MONEY_CAPTURE_LOOSE}\\s+\\d+\\s*Opera[çc][aã]o\\s+${MONEY_CAPTURE_LOOSE}`,
    'gi'
  );
  const operationSummaryScope = normalizeWhitespace(text);
  let operationSummaryMatch: RegExpExecArray | null = operationSummaryPattern.exec(operationSummaryScope);
  while (operationSummaryMatch) {
    // Linha-resumo observada no rodapé: [deságio] [valor original] [qtd] Operação [líquido]
    pushCandidate('valor_desagio', operationSummaryMatch[1] || null, 'table_block_sequence');
    pushCandidate('valor_original', operationSummaryMatch[2] || null, 'table_block_sequence');
    pushCandidate('liquido_liberado', operationSummaryMatch[3] || null, 'table_block_sequence');
    operationSummaryMatch = operationSummaryPattern.exec(operationSummaryScope);
  }

  return tableCandidates;
}

function parseSoiValues(text: string, documents: DisecuritParsedDocument[] = []): SoiValuesResult {
  const tableAwareCandidates = extractSoiTableAwareCandidates(text);

  const buildCandidates = (seed: Array<MoneyLabelExtraction | null>, lineCandidates?: MoneyCandidate[]): MoneyCandidate[] => {
    const candidates: MoneyCandidate[] = [];
    for (const extraction of seed) {
      addMoneyCandidate(candidates, toMoneyCandidate(extraction || { value: null, raw: null, matchType: null }));
    }
    for (const candidate of lineCandidates || []) {
      addMoneyCandidate(candidates, candidate);
    }
    return candidates;
  };

  const faceCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Valor Original']),
      extractMoneyFromLabeledScope(text, ['Valor informado']),
      extractMoneyFromLabeledScope(text, ['Valor apurado']),
      extractMoneyFromForwardWindow(text, [/Valor Original\s*:?/i, /Valor informado\s*:/i, /Valor apurado\s*:/i], {
        windowSize: 180,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.valor_original || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*\+\s*\)\s*Valor\s+Original/i], {
        includeNextLine: true,
      }),
    ]
  );

  const desagioCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Valor de Desagio', 'Valor de Deságio'], {
        allowBeforeLabel: true,
        beforeOperator: '-',
      }),
      extractMoneyFromForwardWindow(text, [/Valor de Des[áa]gio(?!\s+Antecipa[çc][aã]o)\s*:?/i], {
        windowSize: 160,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.valor_desagio || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(
        text,
        [/\(\s*-\s*\)\s*Valor\s+de\s+Des[áa]gio(?!\s+Antecipa[çc][aã]o)/i],
        { includeNextLine: true }
      ),
    ]
  );

  const desagioAntecipacaoCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Valor de Desagio Antecipacao', 'Valor de Deságio Antecipação'], {
        allowBeforeLabel: true,
        beforeOperator: '-',
      }),
      extractMoneyFromForwardWindow(text, [/Valor de Des[áa]gio Antecipa[çc][aã]o\s*:?/i], {
        windowSize: 180,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.valor_desagio_antecipacao || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*-\s*\)\s*Valor\s+de\s+Des[áa]gio\s+Antecipa[çc][aã]o/i], {
        includeNextLine: true,
      }),
    ]
  );

  const despesasCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Despesas'], {
        allowBeforeLabel: true,
        beforeOperator: '*',
      }),
      extractMoneyFromForwardWindow(text, [/\(\s*\*\s*\)\s*Despesas/i, /Despesas\s*:?/i], {
        windowSize: 180,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.despesas || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*\*\s*\)\s*Despesas/i], {
        includeNextLine: true,
      }),
    ]
  );

  const regressoCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Regresso'], {
        allowBeforeLabel: true,
        beforeOperator: '-',
      }),
      extractMoneyFromForwardWindow(text, [/Regresso\s*:?/i], {
        windowSize: 120,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.regresso || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*-\s*\)\s*Regresso/i], {
        includeNextLine: true,
      }),
    ]
  );

  const amortizaDebitosCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Amortiza debitos', 'Amortiza débitos'], {
        allowBeforeLabel: true,
        beforeOperator: '-',
      }),
      extractMoneyFromForwardWindow(text, [/Amortiza d[ée]bitos\s*:?/i], {
        windowSize: 120,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.amortiza_debitos || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*-\s*\)\s*Amortiza\s+d[ée]bitos/i], {
        includeNextLine: true,
      }),
    ]
  );

  const amortizaCreditosCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Amortiza creditos', 'Amortiza créditos'], {
        allowBeforeLabel: true,
        beforeOperator: '+',
      }),
      extractMoneyFromForwardWindow(text, [/Amortiza cr[ée]ditos\s*:?/i], {
        windowSize: 120,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.amortiza_creditos || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*\+\s*\)\s*Amortiza\s+cr[ée]ditos/i], {
        includeNextLine: true,
      }),
    ]
  );

  const creditosGeradosCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Creditos gerados', 'Créditos gerados'], {
        allowBeforeLabel: true,
        beforeOperator: '-',
      }),
      extractMoneyFromForwardWindow(text, [/Cr[ée]ditos gerados\s*:?/i], {
        windowSize: 120,
        pickLast: false,
        matchType: 'forward_window',
      }),
    ],
    [
      ...(tableAwareCandidates.creditos_gerados || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*-\s*\)\s*Cr[ée]ditos\s+gerados/i], {
        includeNextLine: true,
      }),
    ]
  );

  const netCandidates = buildCandidates(
    [
      extractMoneyFromLabeledScope(text, ['Liquido Liberado', 'Líquido Liberado'], {
        allowBeforeLabel: true,
        beforeOperator: '=',
      }),
      extractMoneyFromForwardWindow(text, [/L[íi]quido Liberado\s*:?/i], {
        windowSize: 420,
        pickLast: true,
        matchType: 'forward_last_money',
        stopRegexes: [/DOCUMENTOS\s+DA\s*OPERA[ÇC][AÃ]O/i],
      }),
    ],
    [
      ...(tableAwareCandidates.liquido_liberado || []),
      ...extractMoneyCandidatesFromOperatorLabelLine(text, [/\(\s*=\s*\)\s*L[íi]quido\s+Liberado/i], {
        includeNextLine: true,
        includeTailLineCandidates: true,
      }),
    ]
  );

  const bestFace = pickBestMoneyCandidate(faceCandidates);
  const bestDesagio = pickBestMoneyCandidate(desagioCandidates);
  const bestDesagioAntecipacao = pickBestMoneyCandidate(desagioAntecipacaoCandidates);
  const bestDespesas = pickBestMoneyCandidate(despesasCandidates);
  const bestRegresso = pickBestMoneyCandidate(regressoCandidates);
  const bestAmortizaDebitos = pickBestMoneyCandidate(amortizaDebitosCandidates);
  const bestAmortizaCreditos = pickBestMoneyCandidate(amortizaCreditosCandidates);
  const bestCreditosGerados = pickBestMoneyCandidate(creditosGeradosCandidates);

  const formulaNetReference =
    bestFace &&
    bestDesagio &&
    bestDesagioAntecipacao &&
    bestDespesas &&
    bestRegresso &&
    bestAmortizaDebitos &&
    bestAmortizaCreditos &&
    bestCreditosGerados &&
    bestFace.value !== null &&
    bestDesagio.value !== null &&
    bestDesagioAntecipacao.value !== null &&
    bestDespesas.value !== null &&
    bestRegresso.value !== null &&
    bestAmortizaDebitos.value !== null &&
    bestAmortizaCreditos.value !== null &&
    bestCreditosGerados.value !== null
      ? Number(
          (
            bestFace.value -
            bestDesagio.value -
            bestDesagioAntecipacao.value -
            bestDespesas.value -
            bestRegresso.value -
            bestAmortizaDebitos.value +
            bestAmortizaCreditos.value -
            bestCreditosGerados.value
          ).toFixed(2)
        )
      : null;

  const docsNetReference =
    documents.length >= 2
      ? Number(
          documents.reduce((total, document) => total + (Number(document.net) || 0), 0).toFixed(2)
        )
      : null;

  if (formulaNetReference !== null && formulaNetReference > 0) {
    addMoneyCandidate(netCandidates, {
      value: formulaNetReference,
      raw: formulaNetReference.toFixed(2),
      matchType: 'formula_reference',
      confidence: scoreMatchType('formula_reference'),
    });
  }

  if (docsNetReference !== null && docsNetReference > 0) {
    addMoneyCandidate(netCandidates, {
      value: docsNetReference,
      raw: docsNetReference.toFixed(2),
      matchType: 'documents_sum',
      confidence: scoreMatchType('documents_sum'),
    });
  }

  let adjustedNetCandidates = [...netCandidates];

  if (
    formulaNetReference !== null &&
    docsNetReference !== null &&
    Math.abs(formulaNetReference - docsNetReference) >
      resolveMoneyTolerance(formulaNetReference, docsNetReference)
  ) {
    adjustedNetCandidates = adjustedNetCandidates.filter((candidate) => candidate.matchType !== 'documents_sum');
  }

  const hasTableNetCandidate = adjustedNetCandidates.some(
    (candidate) =>
      candidate.matchType === 'table_block_sequence' || candidate.matchType === 'table_block_formula_choice'
  );
  const referenceForNet = hasTableNetCandidate ? formulaNetReference : docsNetReference ?? formulaNetReference;

  adjustedNetCandidates = adjustedNetCandidates.map((candidate) => {
    let confidence = candidate.confidence;
    if (
      referenceForNet !== null &&
      referenceForNet >= 500 &&
      Math.abs(candidate.value) < 100 &&
      candidate.matchType !== 'documents_sum' &&
      candidate.matchType !== 'formula_reference'
    ) {
      confidence -= 0.45;
    }
    return {
      ...candidate,
      confidence,
    };
  });

  let bestNet = pickBestMoneyCandidateWithReference(adjustedNetCandidates, referenceForNet);
  if (bestNet && formulaNetReference !== null && docsNetReference === null) {
    const formulaTolerance = resolveMoneyTolerance(bestNet.value, formulaNetReference);
    const isFormulaCoherent = Math.abs(bestNet.value - formulaNetReference) <= formulaTolerance;
    if (!isFormulaCoherent) {
      const coherentCandidates = adjustedNetCandidates
        .filter((candidate) => Math.abs(candidate.value - formulaNetReference) <= resolveMoneyTolerance(candidate.value, formulaNetReference))
        .sort((left, right) => (right.confidence || 0) - (left.confidence || 0));
      if (coherentCandidates.length) {
        const promoted = coherentCandidates[0];
        bestNet = {
          ...promoted,
          matchType: promoted.matchType === 'table_block_sequence' ? promoted.matchType : 'table_block_formula_choice',
          confidence: Math.max(promoted.confidence || 0, scoreMatchType('table_block_formula_choice')),
        };
      }
    }
  }

  const toRankedCandidates = (candidates: MoneyCandidate[]) =>
    [...candidates]
      .sort((left, right) => (right.confidence || 0) - (left.confidence || 0))
      .slice(0, 6)
      .map((candidate) => ({
        value: candidate.value,
        raw_value: candidate.raw,
        source_method: mapMatchTypeToSourceMethod(candidate.matchType),
        confidence: candidate.confidence ?? null,
        match_type: candidate.matchType || null,
      }));

  const resolveSelectionReason = (best: MoneyCandidate | null): string => {
    if (!best) return 'no_candidate';
    if (best.matchType === 'documents_sum') return 'documents_sum_reference';
    if (best.matchType === 'formula_reference') return 'formula_reference';
    if (best.matchType === 'table_block_formula_choice') return 'table_formula_coherence';
    if (best.matchType === 'table_block_sequence') return 'table_block_sequence';
    if (best.matchType === 'direct_label') return 'direct_label';
    if (best.matchType === 'after_label' || best.matchType === 'before_label') return 'label_anchor';
    return 'confidence_ranking';
  };

  const fieldCandidates = {
    valor_original: toRankedCandidates(faceCandidates),
    valor_desagio: toRankedCandidates(desagioCandidates),
    valor_desagio_antecipacao: toRankedCandidates(desagioAntecipacaoCandidates),
    despesas: toRankedCandidates(despesasCandidates),
    regresso: toRankedCandidates(regressoCandidates),
    amortiza_debitos: toRankedCandidates(amortizaDebitosCandidates),
    amortiza_creditos: toRankedCandidates(amortizaCreditosCandidates),
    creditos_gerados: toRankedCandidates(creditosGeradosCandidates),
    liquido_liberado: toRankedCandidates(adjustedNetCandidates),
  };

  const selectionReason = {
    valor_original: resolveSelectionReason(bestFace),
    valor_desagio: resolveSelectionReason(bestDesagio),
    valor_desagio_antecipacao: resolveSelectionReason(bestDesagioAntecipacao),
    despesas: resolveSelectionReason(bestDespesas),
    regresso: resolveSelectionReason(bestRegresso),
    amortiza_debitos: resolveSelectionReason(bestAmortizaDebitos),
    amortiza_creditos: resolveSelectionReason(bestAmortizaCreditos),
    creditos_gerados: resolveSelectionReason(bestCreditosGerados),
    liquido_liberado: resolveSelectionReason(bestNet),
  };

  const soiFormula: DisecuritSoiFormulaSnapshot = {
    valor_original: toFormulaFieldSnapshot(bestFace, faceCandidates),
    valor_desagio: toFormulaFieldSnapshot(bestDesagio, desagioCandidates),
    valor_desagio_antecipacao: toFormulaFieldSnapshot(bestDesagioAntecipacao, desagioAntecipacaoCandidates),
    despesas: toFormulaFieldSnapshot(bestDespesas, despesasCandidates),
    regresso: toFormulaFieldSnapshot(bestRegresso, regressoCandidates),
    amortiza_debitos: toFormulaFieldSnapshot(bestAmortizaDebitos, amortizaDebitosCandidates),
    amortiza_creditos: toFormulaFieldSnapshot(bestAmortizaCreditos, amortizaCreditosCandidates),
    creditos_gerados: toFormulaFieldSnapshot(bestCreditosGerados, creditosGeradosCandidates),
    liquido_liberado: toFormulaFieldSnapshot(bestNet, adjustedNetCandidates),
  };
  soiFormula.valor_original.reason = selectionReason.valor_original;
  soiFormula.valor_desagio.reason = selectionReason.valor_desagio;
  soiFormula.valor_desagio_antecipacao.reason = selectionReason.valor_desagio_antecipacao;
  soiFormula.despesas.reason = selectionReason.despesas;
  soiFormula.regresso.reason = selectionReason.regresso;
  soiFormula.amortiza_debitos.reason = selectionReason.amortiza_debitos;
  soiFormula.amortiza_creditos.reason = selectionReason.amortiza_creditos;
  soiFormula.creditos_gerados.reason = selectionReason.creditos_gerados;
  soiFormula.liquido_liberado.reason = selectionReason.liquido_liberado;
  const soiFormulaWithMeta = {
    ...soiFormula,
    field_candidates: fieldCandidates,
    selection_reason: selectionReason,
  } as DisecuritSoiFormulaSnapshot;

  return {
    values: {
      face_value: soiFormulaWithMeta.valor_original.value,
      purchase_value: soiFormulaWithMeta.valor_desagio.value,
      ad_valorem: null,
      iss: null,
      iof: null,
      iof_additional: null,
      expenses:
        (soiFormulaWithMeta.despesas.value ?? 0) +
        (soiFormulaWithMeta.valor_desagio_antecipacao.value ?? 0),
      recompra: soiFormulaWithMeta.regresso.value ?? 0,
      amort_debits:
        (soiFormulaWithMeta.amortiza_debitos.value ?? 0) +
        (soiFormulaWithMeta.creditos_gerados.value ?? 0),
      amort_credits: soiFormulaWithMeta.amortiza_creditos.value,
      discount_value: soiFormulaWithMeta.valor_desagio.value,
      net_value: soiFormulaWithMeta.liquido_liberado.value,
    },
    regex_matches: {
      face_value_raw: soiFormulaWithMeta.valor_original.raw_value,
      face_value_match_type: soiFormulaWithMeta.valor_original.match_type,
      face_value_candidates: faceCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      purchase_value_raw: soiFormulaWithMeta.valor_desagio.raw_value,
      purchase_value_match_type: soiFormulaWithMeta.valor_desagio.match_type,
      purchase_value_candidates: desagioCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      discount_value_raw: soiFormulaWithMeta.valor_desagio.raw_value,
      discount_value_match_type: soiFormulaWithMeta.valor_desagio.match_type,
      discount_value_candidates: desagioCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      soi_valor_desagio_antecipacao_raw: soiFormulaWithMeta.valor_desagio_antecipacao.raw_value,
      soi_valor_desagio_antecipacao_match_type: soiFormulaWithMeta.valor_desagio_antecipacao.match_type,
      soi_valor_desagio_antecipacao_candidates: desagioAntecipacaoCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      soi_despesas_raw: soiFormulaWithMeta.despesas.raw_value,
      soi_despesas_match_type: soiFormulaWithMeta.despesas.match_type,
      soi_despesas_candidates: despesasCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      soi_regresso_raw: soiFormulaWithMeta.regresso.raw_value,
      soi_regresso_match_type: soiFormulaWithMeta.regresso.match_type,
      soi_regresso_candidates: regressoCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      amort_credits_raw: soiFormulaWithMeta.amortiza_creditos.raw_value,
      amort_credits_match_type: soiFormulaWithMeta.amortiza_creditos.match_type,
      amort_credits_candidates: amortizaCreditosCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      soi_amortiza_debitos_raw: soiFormulaWithMeta.amortiza_debitos.raw_value,
      soi_amortiza_debitos_match_type: soiFormulaWithMeta.amortiza_debitos.match_type,
      soi_amortiza_debitos_candidates: amortizaDebitosCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      amort_debits_raw: soiFormulaWithMeta.creditos_gerados.raw_value,
      amort_debits_match_type: soiFormulaWithMeta.creditos_gerados.match_type,
      amort_debits_candidates: creditosGeradosCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      expenses_raw: (soiFormulaWithMeta.despesas.raw_value || soiFormulaWithMeta.valor_desagio_antecipacao.raw_value),
      expenses_match_type: soiFormulaWithMeta.despesas.match_type || soiFormulaWithMeta.valor_desagio_antecipacao.match_type,
      expenses_candidates: [...despesasCandidates, ...desagioAntecipacaoCandidates].map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      net_value_raw: soiFormula.liquido_liberado.raw_value,
      net_value_match_type: soiFormula.liquido_liberado.match_type,
      net_value_candidates: adjustedNetCandidates.map((candidate) => ({
        value: candidate.value,
        raw: candidate.raw,
        match_type: candidate.matchType,
        confidence: candidate.confidence,
      })),
      net_value_formula_reference: formulaNetReference,
      net_value_documents_reference: docsNetReference,
      soi_formula_field_candidates: fieldCandidates,
      soi_formula_selection_reason: selectionReason,
    },
    soi_formula: soiFormulaWithMeta,
  };
}

function parseSoiDocuments(text: string): DisecuritParsedDocument[] {
  const lines = normalizeWhitespace(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const startIndex = lines.findIndex((line) => /DOCUMENTOS\s+DA\s*OPERA[ÇC][AÃ]O/i.test(line));
  if (startIndex < 0) return [];

  const documents: DisecuritParsedDocument[] = [];

  const isDebtorDoc = (line: string) => /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{11}|\d{14}/.test(line);
  const isDocumentRef = (line: string) => /^\d+\/[\w-]+$/i.test(line);
  const isDueDate = (line: string) => /\d{2}\/\d{2}\/\d{4}/.test(line);
  const stopLine = (line: string) => /(^|\s)Opera[çc][aã]o(\s|$)/i.test(line) && /\d{1,3}(?:\.\d{3})*,\d{2}/.test(line);

  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const l1 = lines[i] || '';
    const l2 = lines[i + 1] || '';
    const l3 = lines[i + 2] || '';
    const l4 = lines[i + 3] || '';
    const l5 = lines[i + 4] || '';
    const l6 = lines[i + 5] || '';
    const l7 = lines[i + 6] || '';

    if (stopLine(l1) || stopLine(l5)) break;

    const numericParts = l5.match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+/g) || [];
    const blockLooksValid =
      !!l1 && isDebtorDoc(l2) && isDocumentRef(l3) && isDueDate(l4) && numericParts.length >= 5;

    if (!blockLooksValid) {
      continue;
    }

    const parsedNumbers = numericParts.map((part) => parseMoneyBR(part));

    let value = null;
    let discount = null;
    let net = null;

    if (parsedNumbers.length >= 6) {
      value = parsedNumbers[2];
      discount = parsedNumbers[3];
      net = parsedNumbers[4];
    } else if (parsedNumbers.length === 5) {
      value = parsedNumbers[1];
      discount = parsedNumbers[2];
      net = parsedNumbers[3];
    }

    documents.push({
      debtor_name: l1,
      debtor_doc: l2,
      document: l3,
      due_date: parseDateBR(l4),
      value,
      discount,
      net,
      doc_type: /^[A-Z]{1,6}$/i.test(l7) ? l7.toUpperCase() : null,
    });

    i += 6;
  }

  if (documents.length > 0) return documents;

  const normalized = normalizeWhitespace(text);
  const docsStart =
    normalized.search(/DOCUMENTOS\s+DA\s*OPERA[ÇC][AÃ]O/i) >= 0
      ? normalized.search(/DOCUMENTOS\s+DA\s*OPERA[ÇC][AÃ]O/i)
      : -1;
  if (docsStart < 0) return [];

  const inlineScope = normalized.slice(docsStart);
  const inlinePattern =
    /([A-ZÀ-Ú0-9 .&'\/()-]{3,}?)\s+(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{11}|\d{14})\s+(\d+\/[\w-]+)\s+(\d{2}\/\d{2}\/\d{4})\s+\d+\s+\d{1,3}(?:\.\d{3})*,\d{2}\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s+\d{1,3}(?:\.\d{3})*,\d{2})?\s+\d+\s+([A-Z]{1,6})/gi;

  const inlineDocuments: DisecuritParsedDocument[] = [];
  let match: RegExpExecArray | null = inlinePattern.exec(inlineScope);
  while (match) {
    inlineDocuments.push({
      debtor_name: String(match[1] || '').replace(/\s+/g, ' ').trim() || null,
      debtor_doc: match[2] || null,
      document: match[3] || null,
      due_date: parseDateBR(match[4] || null),
      value: parseMoneyBR(match[5] || null),
      discount: parseMoneyBR(match[6] || null),
      net: parseMoneyBR(match[7] || null),
      doc_type: String(match[8] || '').trim().toUpperCase() || null,
    });
    match = inlinePattern.exec(inlineScope);
  }

  return inlineDocuments;
}

function isEssentialPresent(program: DisecuritProgram, parsed: DisecuritParseResult): boolean {
  if (program === 'SPPRO') {
    return Boolean(
      parsed.document?.bordero_number &&
      (parsed.document?.date || parsed.document?.payment_date) &&
      parsed.values.face_value !== null &&
      parsed.values.net_value !== null
    );
  }

  return Boolean(
    parsed.document?.operation_number &&
    (parsed.document?.date || parsed.document?.payment_date) &&
    parsed.values.face_value !== null &&
    parsed.values.net_value !== null
  );
}

function calcKeywordConfidence(text: string, program: DisecuritProgram): number {
  const markers = program === 'SPPRO' ? SPPRO_MARKERS : SOI_MARKERS;
  const normalized = text.toUpperCase();
  const hits = markers.reduce((acc, marker) => acc + (marker.test(normalized) ? 1 : 0), 0);
  return Math.min(0.6 + hits * 0.1, 0.95);
}

export function parseDisecuritPdfText(
  text: string,
  programHint?: DisecuritProgram | string | null,
  options?: ParseDisecuritOptions
): DisecuritParseResult {
  const normalizedText = normalizeWhitespace(text);
  const normalizedHint = normalizeProgram(programHint);
  const operationNumberHint = String(options?.hints?.operation_number || '').trim() || null;

  let program: DisecuritProgram | null = null;
  let detectedBy: DisecuritDetectedBy = 'fallback';
  let confidence = 0.3;

  if (normalizedHint) {
    program = normalizedHint;
    detectedBy = 'user_stock';
    confidence = 1;
  } else {
    const detected = detectProgramFromText(normalizedText);
    if (detected) {
      program = detected;
      detectedBy = 'keyword';
      confidence = calcKeywordConfidence(normalizedText, detected);
    }
  }

  const fallbackWarnings: string[] = [];

  if (!program) {
    if (/Valor de Face dos T[íi]tulos|Border[ôo]\s*n[ºo]?/i.test(normalizedText)) {
      program = 'SPPRO';
      detectedBy = 'fallback';
      confidence = 0.35;
      fallbackWarnings.push('Programa inferido por fallback com baixa confiança.');
    } else if (/Opera[çc][aã]o\s*:\s*\d+|Dt\.?\s*Pag\.?\s*:/i.test(normalizedText)) {
      program = 'SOI';
      detectedBy = 'fallback';
      confidence = 0.35;
      fallbackWarnings.push('Programa inferido por fallback com baixa confiança.');
    }
  }

  const safeProgram = program || 'SOI';
  const soiDocumentResult =
    safeProgram === 'SOI' ? parseSoiDocument(normalizedText, operationNumberHint) : null;
  const document = safeProgram === 'SPPRO' ? parseSpProDocument(normalizedText) : soiDocumentResult!.document;
  const parties = safeProgram === 'SPPRO' ? parseSpProParties(normalizedText) : parseSoiParties(normalizedText);
  const documents = safeProgram === 'SOI' ? parseSoiDocuments(normalizedText) : [];
  const spProValues = safeProgram === 'SPPRO' ? parseSpProValues(normalizedText) : null;
  const soiValuesResult = safeProgram === 'SOI' ? parseSoiValues(normalizedText, documents) : null;
  const values = spProValues?.values || soiValuesResult?.values || parseSoiValues(normalizedText).values;

  const warnings: string[] = [...fallbackWarnings, ...(soiDocumentResult?.warnings || [])];

  if (!program) {
    warnings.push('Não foi possível detectar o programa com alta confiança.');
  }

  if (!isEssentialPresent(safeProgram, {
    source: 'disecurit',
    program: safeProgram,
    detected_by: detectedBy,
    confidence,
    document,
    parties,
    values,
    documents,
    raw: { text_hash: '', text_excerpt: '' },
    debug: {},
  })) {
    warnings.push('Campos essenciais do layout não foram encontrados integralmente.');
  }

  const result: DisecuritParseResult = {
    source: 'disecurit',
    program: safeProgram,
    detected_by: detectedBy,
    confidence: Number(confidence.toFixed(2)),
    document,
    parties,
    values,
    documents,
    raw: {
      text_hash: parseTextSha256(normalizedText),
      text_excerpt: buildTextExcerpt(normalizedText),
    },
    debug: {
      regex_matches: {
        ...(spProValues?.regex_matches || {}),
        ...(soiDocumentResult?.regex_matches || {}),
        ...(soiValuesResult?.regex_matches || {}),
      },
      sppro_formula: spProValues?.sppro_formula,
      soi_formula: soiValuesResult?.soi_formula,
      soi_formula_v2: soiValuesResult?.soi_formula,
      warnings: [...new Set(warnings)],
    },
  };

  return result;
}
