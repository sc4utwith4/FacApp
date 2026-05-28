/**
 * Utilitários para histórico de conciliação (sidebar "Conciliações Feitas").
 * Fonte: conciliacao_fechamentos_diarios; resolução de import por regra determinística.
 */

import type {
  DailyClosingRow,
  ReconciliationHistoryDay,
  ReconciliationHistoryAccountItem,
} from '@/types/bank-reconciliation';

export type { DailyClosingRow, ReconciliationHistoryDay, ReconciliationHistoryAccountItem };

/** Forma mínima de extratos_import usada na resolução de import por data/conta */
export interface ExtratoImportRow {
  id: string;
  conta_bancaria_id: string;
  parse_status: string;
  file_format?: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  created_at: string;
}

const toDateOnly = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const s = String(value).trim();
  return s.slice(0, 10) || null;
};

/**
 * Formata data para exibição na sidebar (pt-BR: DD/MM/YYYY).
 */
export function formatClosingDateLabel(dataReferencia: string): string {
  const d = toDateOnly(dataReferencia);
  if (!d) return dataReferencia;
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return dataReferencia;
  return `${day}/${m}/${y}`;
}

/**
 * Agrupa fechamentos por data e depois por conta.
 * Ordena por data_referencia DESC; dentro de cada dia, mantém ordem dos fechamentos.
 */
export function groupClosingsByDateAndAccount(
  closings: DailyClosingRow[],
  contasMap: Map<string, string> = new Map()
): ReconciliationHistoryDay[] {
  const byDate = new Map<string, { date: string; accounts: ReconciliationHistoryAccountItem[] }>();

  const sorted = [...closings].sort((a, b) => {
    const da = toDateOnly(a.data_referencia) || '';
    const db = toDateOnly(b.data_referencia) || '';
    return db.localeCompare(da);
  });

  for (const row of sorted) {
    const dateKey = toDateOnly(row.data_referencia) || row.data_referencia;
    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, {
        date: dateKey,
        accounts: [],
      });
    }
    const entry = byDate.get(dateKey)!;
    const existing = entry.accounts.some((a) => a.conta_bancaria_id === row.conta_bancaria_id);
    if (!existing) {
      entry.accounts.push({
        conta_bancaria_id: row.conta_bancaria_id,
        descricao: contasMap.get(row.conta_bancaria_id) || row.conta_bancaria_id,
      });
    }
  }

  return Array.from(byDate.values()).map((entry) => ({
    dataReferencia: entry.date,
    label: formatClosingDateLabel(entry.date),
    accounts: entry.accounts,
  }));
}

/**
 * Resolve o melhor import para conta + data (regra determinística).
 * Prioridade 1: import parsed cujo período contenha a data (periodo_inicio <= data <= periodo_fim), mais recente.
 * Prioridade 2: import da conta criado no dia (created_at::date = data), mais recente.
 * Prioridade 3: último import da conta (fallback).
 */
export function resolveBestImportForDateAccount(
  imports: ExtratoImportRow[],
  contaBancariaId: string,
  dataReferencia: string,
  options?: { ofxOnly?: boolean }
): string | null {
  const dateStr = toDateOnly(dataReferencia);
  if (!dateStr) return null;

  const byConta = imports.filter((i) => {
    if (i.conta_bancaria_id !== contaBancariaId) return false;
    if (!options?.ofxOnly) return true;
    return String(i.file_format || '').toLowerCase() === 'ofx';
  });
  if (byConta.length === 0) return null;

  const parsed = byConta.filter((i) => i.parse_status === 'parsed');

  // Prioridade 1: período contém a data, mais recente
  const inPeriod = parsed.filter((i) => {
    const start = toDateOnly(i.periodo_inicio);
    const end = toDateOnly(i.periodo_fim);
    if (!start || !end) return false;
    return start <= dateStr && dateStr <= end;
  });
  if (inPeriod.length > 0) {
    inPeriod.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return inPeriod[0].id;
  }

  // Prioridade 2: criado no dia
  const createdOnDate = byConta.filter((i) => {
    const created = toDateOnly(i.created_at);
    return created === dateStr;
  });
  if (createdOnDate.length > 0) {
    createdOnDate.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    return createdOnDate[0].id;
  }

  // Prioridade 3: último import da conta
  byConta.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return byConta[0].id;
}
