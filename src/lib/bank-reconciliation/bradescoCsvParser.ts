import { createHash } from 'crypto';
import type {
  BankTransactionType,
  ParsedBankStatementTransaction,
  ParsedBankStatementTransactionInput,
  ParsedBradescoCsvResult,
} from '../../types/bank-reconciliation.js';

const DATE_DDMMYYYY = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const DATE_YYYYMMDD = /^(\d{4})-(\d{2})-(\d{2})$/;

const normalizeText = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeHeader = (value: string): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const compactHeaderToken = (value: string): string =>
  normalizeHeader(value).replace(/_/g, '');

const isCreditHeaderToken = (value: string): boolean => {
  const compact = compactHeaderToken(value);
  return (
    compact.includes('credito') ||
    compact.includes('crdito') ||
    compact.includes('credit') ||
    compact.includes('entrada') ||
    compact.includes('entradas') ||
    /cr.*d.*t/.test(compact)
  );
};

const isDebitHeaderToken = (value: string): boolean => {
  const compact = compactHeaderToken(value);
  return (
    compact.includes('debito') ||
    compact.includes('dbito') ||
    compact.includes('debit') ||
    compact.includes('saida') ||
    compact.includes('saidas') ||
    /d[e]?b.*t/.test(compact)
  );
};

const normalizeDescription = (value: string): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const parseDate = (value: string): string | null => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;

  const ddmmyyyy = normalized.match(DATE_DDMMYYYY);
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }

  const yyyymmdd = normalized.match(DATE_YYYYMMDD);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
  }

  return null;
};

const parseMoneyToCentavos = (value: string): number | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/R\$\s*/gi, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;

  return Math.round(parsed * 100);
};

const splitCsvLine = (line: string, delimiter: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const detectDelimiter = (lines: string[]): string => {
  const candidates = [';', ',', '\t'];
  const scores = candidates.map((delimiter) => {
    const score = lines.slice(0, 10).reduce((acc, line) => acc + (line.split(delimiter).length - 1), 0);
    return { delimiter, score };
  });

  scores.sort((a, b) => b.score - a.score);
  return scores[0]?.score > 0 ? scores[0].delimiter : ';';
};

const isHeaderRow = (cells: string[]): boolean => {
  const normalized = cells.map((cell) => normalizeHeader(cell));
  const hasDate = normalized.some((value) => value.includes('data'));
  const hasDescription = normalized.some(
    (value) =>
      value.includes('historico') ||
      value.includes('descricao') ||
      value.includes('complemento') ||
      /lan.*amento/.test(value)
  );
  const hasValue = normalized.some(
    (value) =>
      value.includes('valor') ||
      value.includes('saldo') ||
      isCreditHeaderToken(value) ||
      isDebitHeaderToken(value)
  );
  return hasDate && hasDescription && hasValue;
};

interface ColumnMap {
  date: number;
  dateComp?: number;
  description: number;
  document?: number;
  type?: number;
  value?: number;
  credit?: number;
  debit?: number;
  fitId?: number;
}

const resolveColumnMap = (headerCells: string[]): ColumnMap => {
  const normalized = headerCells.map((cell) => normalizeHeader(cell));

  const findIndex = (matcher: (value: string) => boolean): number | undefined => {
    const index = normalized.findIndex(matcher);
    return index >= 0 ? index : undefined;
  };

  const date =
    findIndex((value) => value.includes('data_mov')) ??
    findIndex((value) => value.includes('data_lanc')) ??
    findIndex((value) => value === 'data') ??
    0;

  const description =
    findIndex((value) => value.includes('lancamento')) ??
    findIndex((value) => /lan.*amento/.test(value)) ??
    findIndex((value) => value.includes('historico')) ??
    findIndex((value) => value.includes('descricao')) ??
    findIndex((value) => value.includes('complemento')) ??
    1;

  const value = findIndex(
    (value) => value.includes('valor') && !value.includes('saldo') && !value.includes('dispon')
  );

  const credit =
    findIndex((value) => isCreditHeaderToken(value)) ??
    findIndex((value) => /cr.*dito/.test(value));

  const debit =
    findIndex((value) => isDebitHeaderToken(value)) ??
    findIndex((value) => /deb.*to/.test(value));

  return {
    date,
    dateComp:
      findIndex((value) => value.includes('compens')) ??
      findIndex((value) => value.includes('dispon')),
    description,
    document:
      findIndex((value) => value.includes('documento')) ??
      findIndex((value) => value.includes('dcto')) ??
      findIndex((value) => value.includes('numero_doc')) ??
      findIndex((value) => value.includes('referencia')),
    type:
      findIndex((value) => value === 'tipo') ??
      findIndex((value) => value.includes('natureza')) ??
      findIndex((value) => value.includes('credito_debito')) ??
      findIndex((value) => value === 'dc'),
    value,
    credit,
    debit,
    fitId:
      findIndex((value) => value.includes('fit_id')) ??
      findIndex((value) => value.includes('id_transacao')) ??
      findIndex((value) => value.includes('nsu')),
  };
};

const inferType = (valueCentavosSigned: number, explicitTypeRaw: string, description: string): BankTransactionType => {
  const explicit = normalizeText(explicitTypeRaw).toLowerCase();

  if (['c', 'cr', 'credito', 'credit'].includes(explicit)) return 'credit';
  if (['d', 'db', 'debito', 'debit'].includes(explicit)) return 'debit';

  if (valueCentavosSigned > 0) return 'credit';
  if (valueCentavosSigned < 0) return 'debit';

  const normalizedDescription = normalizeDescription(description);
  if (
    /tarifa|pagamento|pix enviado|pix des|ted enviada|doc enviada|saque|imposto|iof|debito/.test(
      normalizedDescription
    )
  ) {
    return 'debit';
  }

  if (
    /credito|recebimento|pix recebido|pix rem|ted recebida|doc recebido|deposito/.test(
      normalizedDescription
    )
  ) {
    return 'credit';
  }

  return 'other';
};

const isBalanceLikeDescription = (value: string): boolean => {
  if (!value) return false;
  if (/^saldo(\s|$)/.test(value)) return true;
  if (/saldo\s+apos(\s+o)?\s+lanc/.test(value)) return true;
  if (/saldo\s+final/.test(value)) return true;
  if (/saldo\s+do\s+dia/.test(value)) return true;
  if (/saldo\s+em\s+conta/.test(value)) return true;
  if (/saldo\s+anterior/.test(value)) return true;
  if (/saldo\s+disponivel/.test(value)) return true;
  if (/valor\s+disponivel/.test(value)) return true;

  return (
    value.startsWith('saldo anterior') ||
    value.startsWith('saldo disponivel') ||
    value.startsWith('valor disponivel') ||
    value.includes(' saldo disponivel') ||
    value.includes(' valor disponivel')
  );
};

const hashSha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export const buildCsvHashFallback = (
  tx: Pick<ParsedBankStatementTransactionInput, 'data_movimento' | 'valor_centavos' | 'descricao_norm' | 'tipo' | 'documento_ref'>,
  dedupeOrdinal: number
): string => {
  const parts = [
    tx.data_movimento,
    String(tx.valor_centavos),
    tx.descricao_norm,
    tx.tipo,
    tx.documento_ref || '',
    String(dedupeOrdinal),
  ];

  return hashSha256(parts.join('|'));
};

const enrichWithDedupe = (
  txInputs: Array<ParsedBankStatementTransactionInput & { line_number: number }>
): ParsedBankStatementTransaction[] => {
  const seen = new Map<string, number>();

  return txInputs.map((tx) => {
    const keyBase = [
      tx.data_movimento,
      String(tx.valor_centavos),
      tx.descricao_norm,
      tx.tipo,
      tx.documento_ref || '',
    ].join('|');

    const dedupeOrdinal = (seen.get(keyBase) || 0) + 1;
    seen.set(keyBase, dedupeOrdinal);

    return {
      ...tx,
      dedupe_ordinal: dedupeOrdinal,
      hash_fallback: buildCsvHashFallback(tx, dedupeOrdinal),
    };
  });
};

export function parseBradescoCsv(content: string): ParsedBradescoCsvResult {
  const text = String(content || '').replace(/^\uFEFF/, '');
  const rawLines = text
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (rawLines.length === 0) {
    return {
      source: 'bradesco',
      format: 'csv',
      transactions: [],
      periodo_inicio: null,
      periodo_fim: null,
      warnings: [],
      errors: ['Arquivo CSV vazio.'],
    };
  }

  const delimiter = detectDelimiter(rawLines);
  const parsedLines = rawLines.map((line) => splitCsvLine(line, delimiter));

  let headerIndex = parsedLines.findIndex((cells) => isHeaderRow(cells));
  if (headerIndex < 0) headerIndex = 0;

  const headerCells = parsedLines[headerIndex];
  const columns = resolveColumnMap(headerCells);

  const warnings: string[] = [];
  const errors: string[] = [];
  const txInputs: Array<ParsedBankStatementTransactionInput & { line_number: number }> = [];

  for (let row = headerIndex + 1; row < parsedLines.length; row += 1) {
    const cells = parsedLines[row];
    const rawLine = rawLines[row] || '';
    const normalizedLine = normalizeDescription(rawLine);

    if (normalizedLine.includes('futuros') && normalizedLine.includes('lan')) {
      break;
    }

    const dateRaw = cells[columns.date] || '';
    const movementDate = parseDate(dateRaw);
    if (!movementDate) {
      warnings.push(`Linha ${row + 1}: data invalida (${dateRaw || 'vazio'}).`);
      continue;
    }

    const dateCompRaw = columns.dateComp !== undefined ? cells[columns.dateComp] || '' : '';
    const compensationDate = parseDate(dateCompRaw);

    const descriptionRaw = normalizeText(cells[columns.description] || '');
    if (!descriptionRaw) {
      warnings.push(`Linha ${row + 1}: descricao vazia.`);
      continue;
    }

    const normalizedDescription = normalizeDescription(descriptionRaw);
    if (isBalanceLikeDescription(normalizedDescription)) {
      warnings.push(`Linha ${row + 1}: descricao de saldo ignorada (${descriptionRaw}).`);
      continue;
    }

    let centavosSigned: number | null = null;

    if (columns.credit !== undefined || columns.debit !== undefined) {
      const creditRaw = columns.credit !== undefined ? cells[columns.credit] || '' : '';
      const debitRaw = columns.debit !== undefined ? cells[columns.debit] || '' : '';

      const creditCentavos = parseMoneyToCentavos(creditRaw);
      const debitCentavos = parseMoneyToCentavos(debitRaw);

      if (creditCentavos !== null && Math.abs(creditCentavos) > 0) {
        centavosSigned = Math.abs(creditCentavos);
      }

      if (debitCentavos !== null && Math.abs(debitCentavos) > 0) {
        const debitSigned = -Math.abs(debitCentavos);
        centavosSigned = centavosSigned === null ? debitSigned : centavosSigned + debitSigned;
      }
    }

    const valueRaw = columns.value !== undefined ? cells[columns.value] || '' : '';
    if (centavosSigned === null && columns.value !== undefined) {
      centavosSigned = parseMoneyToCentavos(valueRaw);
    }

    if (centavosSigned === null) {
      warnings.push(`Linha ${row + 1}: valor invalido (${valueRaw || 'vazio'}).`);
      continue;
    }

    const tipo = inferType(centavosSigned, columns.type !== undefined ? cells[columns.type] || '' : '', descriptionRaw);
    const valorCentavos = Math.abs(centavosSigned);

    if (!valorCentavos) {
      warnings.push(`Linha ${row + 1}: valor zero ignorado.`);
      continue;
    }

    const documentoRef = columns.document !== undefined ? normalizeText(cells[columns.document] || '') : '';
    const fitId = columns.fitId !== undefined ? normalizeText(cells[columns.fitId] || '') : '';

    txInputs.push({
      line_number: row + 1,
      data_movimento: movementDate,
      data_compensacao: compensationDate,
      descricao_raw: descriptionRaw,
      descricao_norm: normalizeDescription(descriptionRaw),
      valor_centavos: valorCentavos,
      tipo,
      documento_ref: documentoRef || null,
      fit_id: fitId || null,
      metadata: {
        parser: 'bradesco_csv_v1',
        delimiter,
      },
    });
  }

  if (!txInputs.length) {
    errors.push('Nenhuma transacao valida encontrada no CSV.');
  }

  const transactions = enrichWithDedupe(txInputs);
  const dates = transactions.map((tx) => tx.data_movimento).sort();

  return {
    source: 'bradesco',
    format: 'csv',
    transactions,
    periodo_inicio: dates.length ? dates[0] : null,
    periodo_fim: dates.length ? dates[dates.length - 1] : null,
    warnings,
    errors,
  };
}
