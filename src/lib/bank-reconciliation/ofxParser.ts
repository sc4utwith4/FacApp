import { createHash } from 'crypto';
import type {
  BankTransactionType,
  ParsedBankStatementTransaction,
  ParsedBankStatementTransactionInput,
  ParsedOfxResult,
} from '../../types/bank-reconciliation.js';

const normalizeText = (value: string): string =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeDescription = (value: string): string =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hashSha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

const parseDate = (raw: string): string | null => {
  const value = String(raw || '').trim();
  if (!value) return null;

  const justDigits = value.replace(/[^0-9]/g, '');
  if (justDigits.length < 8) return null;

  const year = justDigits.slice(0, 4);
  const month = justDigits.slice(4, 6);
  const day = justDigits.slice(6, 8);

  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
};

const parseAmountToCentavos = (raw: string): number | null => {
  const value = String(raw || '').trim();
  if (!value) return null;

  const normalized = value.replace(',', '.').replace(/[^0-9.-]/g, '');
  const amount = Number.parseFloat(normalized);

  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
};

const extractTagValue = (block: string, tag: string): string => {
  const tagUpper = tag.toUpperCase();
  const blockUpper = block.toUpperCase();

  const open = `<${tagUpper}>`;
  const openIdx = blockUpper.indexOf(open);
  if (openIdx < 0) return '';

  const start = openIdx + open.length;
  const close = `</${tagUpper}>`;
  const closeIdx = blockUpper.indexOf(close, start);

  if (closeIdx >= 0) {
    return block.slice(start, closeIdx).trim();
  }

  const tail = block.slice(start);
  const nextTagIdx = tail.search(/\r?\n\s*</);
  if (nextTagIdx >= 0) {
    return tail.slice(0, nextTagIdx).trim();
  }

  return tail.trim();
};

const splitStmtTrnBlocks = (content: string): string[] => {
  const text = String(content || '');
  const regex = /<STMTTRN>([\s\S]*?)(?:<\/STMTTRN>|(?=<STMTTRN>)|$)/gi;
  const blocks: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1]?.trim();
    if (block) blocks.push(block);
  }

  return blocks;
};

const inferType = (amountCentavosSigned: number, trnTypeRaw: string, description: string): BankTransactionType => {
  const trnType = normalizeText(trnTypeRaw).toLowerCase();

  if (['credit', 'dep', 'directdep', 'xfer', 'int', 'payment'].includes(trnType)) {
    if (amountCentavosSigned >= 0) return 'credit';
  }

  if (['debit', 'check', 'atm', 'cash', 'pos', 'fee', 'payment'].includes(trnType)) {
    if (amountCentavosSigned <= 0) return 'debit';
  }

  if (amountCentavosSigned > 0) return 'credit';
  if (amountCentavosSigned < 0) return 'debit';

  const normalizedDescription = normalizeDescription(description);
  if (/tarifa|pagamento|pix enviado|ted enviada|doc enviada|saque|imposto|iof|debito/.test(normalizedDescription)) {
    return 'debit';
  }

  if (/credito|recebimento|pix recebido|ted recebida|doc recebido|deposito/.test(normalizedDescription)) {
    return 'credit';
  }

  return 'other';
};

const buildHashFallback = (
  tx: Pick<ParsedBankStatementTransactionInput, 'data_movimento' | 'valor_centavos' | 'descricao_norm' | 'tipo' | 'documento_ref'>,
  dedupeOrdinal: number
): string => {
  const base = [
    tx.data_movimento,
    String(tx.valor_centavos),
    tx.descricao_norm,
    tx.tipo,
    tx.documento_ref || '',
    String(dedupeOrdinal),
  ].join('|');

  return hashSha256(base);
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
      tx.fit_id || '',
    ].join('|');

    const dedupeOrdinal = (seen.get(keyBase) || 0) + 1;
    seen.set(keyBase, dedupeOrdinal);

    return {
      ...tx,
      dedupe_ordinal: dedupeOrdinal,
      hash_fallback: buildHashFallback(tx, dedupeOrdinal),
    };
  });
};

export function parseOfx(content: string): ParsedOfxResult {
  const text = String(content || '').replace(/^\uFEFF/, '');
  const blocks = splitStmtTrnBlocks(text);

  if (!blocks.length) {
    return {
      source: 'ofx_generic',
      format: 'ofx',
      transactions: [],
      periodo_inicio: null,
      periodo_fim: null,
      warnings: [],
      errors: ['Nenhum bloco STMTTRN encontrado no OFX.'],
    };
  }

  const warnings: string[] = [];
  const errors: string[] = [];
  const txInputs: Array<ParsedBankStatementTransactionInput & { line_number: number }> = [];

  blocks.forEach((block, index) => {
    const lineNumber = index + 1;

    const dateMov = parseDate(extractTagValue(block, 'DTPOSTED'));
    if (!dateMov) {
      warnings.push(`Transacao ${lineNumber}: DTPOSTED invalida.`);
      return;
    }

    const dateComp = parseDate(extractTagValue(block, 'DTUSER'));
    const amountSigned = parseAmountToCentavos(extractTagValue(block, 'TRNAMT'));
    if (amountSigned === null) {
      warnings.push(`Transacao ${lineNumber}: TRNAMT invalido.`);
      return;
    }

    const fitId = normalizeText(extractTagValue(block, 'FITID'));
    const trnType = normalizeText(extractTagValue(block, 'TRNTYPE'));
    const checkNum = normalizeText(extractTagValue(block, 'CHECKNUM'));
    const name = normalizeText(extractTagValue(block, 'NAME'));
    const memo = normalizeText(extractTagValue(block, 'MEMO'));

    const descriptionRaw = normalizeText([name, memo].filter(Boolean).join(' - ')) || `OFX transacao ${lineNumber}`;
    const tipo = inferType(amountSigned, trnType, descriptionRaw);
    const valorCentavos = Math.abs(amountSigned);

    if (!valorCentavos) {
      warnings.push(`Transacao ${lineNumber}: valor zero ignorado.`);
      return;
    }

    txInputs.push({
      line_number: lineNumber,
      data_movimento: dateMov,
      data_compensacao: dateComp,
      descricao_raw: descriptionRaw,
      descricao_norm: normalizeDescription(descriptionRaw),
      valor_centavos: valorCentavos,
      tipo,
      documento_ref: checkNum || null,
      fit_id: fitId || null,
      metadata: {
        parser: 'ofx_generic_v1',
        trntype: trnType || null,
      },
    });
  });

  if (!txInputs.length) {
    errors.push('Nenhuma transacao valida encontrada no OFX.');
  }

  const transactions = enrichWithDedupe(txInputs);
  const dates = transactions.map((tx) => tx.data_movimento).sort();

  return {
    source: 'ofx_generic',
    format: 'ofx',
    transactions,
    periodo_inicio: dates.length ? dates[0] : null,
    periodo_fim: dates.length ? dates[dates.length - 1] : null,
    warnings,
    errors,
  };
}
