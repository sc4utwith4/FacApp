export const APP_LOCALE = "pt-BR";
export const APP_CURRENCY = "BRL";

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat(APP_LOCALE, {
    style: "currency",
    currency: APP_CURRENCY,
  }).format(value);
}

export function formatNumberBR(value: number): string {
  return new Intl.NumberFormat(APP_LOCALE).format(value);
}

export function formatDateBR(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(APP_LOCALE);
}

export function formatDateTimeBR(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(APP_LOCALE);
}

export function formatTimeBR(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString(APP_LOCALE);
}
