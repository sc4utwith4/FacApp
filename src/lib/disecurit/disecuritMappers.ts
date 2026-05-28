import type {
  DisecuritParseResult,
  UiDefaultsSOI,
  UiDefaultsSPPRO,
} from '../../types/disecurit-import.js';

const toZeroIfNull = (value: number | null | undefined): number => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return Number(value);
};

function pickDate(parsed: DisecuritParseResult): string | undefined {
  return parsed.document?.date || parsed.document?.payment_date || undefined;
}

function formatBrl(value: number | null | undefined): string {
  const safe = toZeroIfNull(value);
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(safe);
}

export function mapToUiSPPRO(parsed: DisecuritParseResult): UiDefaultsSPPRO {
  const values = parsed.values || {};
  const spproFormula = parsed.debug?.sppro_formula;

  return {
    data: pickDate(parsed),
    documento: parsed.document?.bordero_number || parsed.document?.operation_number || undefined,
    quantidadeTitulos: spproFormula?.quantidade_titulos?.value ?? null,
    faceDosTitulos: values.face_value ?? null,
    valorDeCompra: values.purchase_value ?? values.discount_value ?? null,
    adValorem: values.ad_valorem ?? 0,
    iss: values.iss ?? 0,
    iof: values.iof ?? 0,
    iofAdicional: values.iof_additional ?? 0,
    despesas: values.expenses ?? 0,
    recompra: values.recompra ?? 0,
    valorLiquidoOperacao: values.net_value ?? null,
    amortizacaoDebitos: values.amort_debits ?? 0,
    amortizacaoCreditos: values.amort_credits ?? 0,
  };
}

export function mapToUiSOI(parsed: DisecuritParseResult): UiDefaultsSOI {
  const values = parsed.values || {};
  const operationNumber = parsed.document?.operation_number || parsed.document?.bordero_number || '';
  const clientName = parsed.parties?.client_name || 'Cliente não identificado';

  return {
    data: pickDate(parsed),
    documento: operationNumber || undefined,
    faceDosTitulos: values.face_value ?? null,
    valorDeCompra: values.net_value ?? values.purchase_value ?? null,
    despesas: values.expenses ?? 0,
    amortizacaoDebitos: values.amort_debits ?? 0,
    amortizacaoCreditos: values.amort_credits ?? 0,
    historico: `DISECURIT/SOI Operação ${operationNumber || '-'} — Cliente ${clientName} — Face ${formatBrl(
      values.face_value
    )} — Líquido ${formatBrl(values.net_value)}`,
  };
}
