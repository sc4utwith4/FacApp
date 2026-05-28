import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normaliza uma data para o formato YYYY-MM-DD garantindo que seja tratada como data local
 * sem conversão de timezone. Esta função resolve o problema de datas sendo salvas
 * um dia antes no PostgreSQL devido a conversões de timezone.
 * 
 * @param date - Pode ser uma string no formato YYYY-MM-DD, um objeto Date, ou null/undefined
 * @returns String no formato YYYY-MM-DD ou a string original se já estiver no formato correto
 * 
 * @example
 * normalizeDateForDB("2024-01-15") // "2024-01-15"
 * normalizeDateForDB(new Date(2024, 0, 15)) // "2024-01-15" (data local)
 * normalizeDateForDB("2024-01-15T00:00:00Z") // "2024-01-15"
 */
export function normalizeDateForDB(date: string | Date | null | undefined): string {
  if (!date) {
    return "";
  }

  // Se já é uma string no formato YYYY-MM-DD, retorna diretamente
  if (typeof date === "string") {
    // Verifica se está no formato YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateRegex.test(date)) {
      return date;
    }
    
    // Se for uma string com timestamp, extrai apenas a parte da data
    // e garante que seja tratada como data local
    const dateObj = new Date(date);
    if (!isNaN(dateObj.getTime())) {
      // Usa métodos locais para evitar conversão de timezone
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const day = String(dateObj.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }
    
    return date;
  }

  // Se é um objeto Date, extrai ano, mês e dia usando métodos locais
  if (date instanceof Date) {
    if (isNaN(date.getTime())) {
      return "";
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return "";
}

/**
 * Lê uma data do banco de dados e garante que seja tratada como data local
 * sem conversão de timezone. Esta função resolve problemas de conversão
 * quando o Supabase retorna datas do PostgreSQL.
 * 
 * @param input - String de data do banco (formato YYYY-MM-DD ou ISO string)
 * @returns Date object tratado como local ou null se inválido
 * 
 * @example
 * parseDateFromDB("2024-12-14") // Date object para 14/12/2024 (local)
 * parseDateFromDB("2024-12-14T00:00:00Z") // Date object para 14/12/2024 (local)
 */
export function parseDateFromDB(input?: string | null): Date | null {
  if (!input) return null;
  
  // Se já está no formato YYYY-MM-DD, criar Date usando componentes locais
  const dateRegex = /^(\d{4})-(\d{2})-(\d{2})/;
  const match = input.match(dateRegex);
  
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // JavaScript months are 0-indexed
    const day = parseInt(match[3], 10);
    
    // Criar Date usando componentes locais (sem timezone)
    // Usar meio-dia para evitar problemas de timezone
    const date = new Date(year, month, day, 12, 0, 0);
    
    // Validar se a data é válida
    if (isNaN(date.getTime())) {
      return null;
    }
    
    return date;
  }
  
  // Fallback: tentar parsear como Date normal
  const date = new Date(input);
  if (isNaN(date.getTime())) {
    return null;
  }
  
  // Se foi parseado com sucesso, extrair componentes locais e recriar
  // para garantir que seja tratado como local
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();
  
  return new Date(year, month, day, 12, 0, 0);
}

/**
 * Formata um valor numérico como moeda brasileira (R$)
 * 
 * @param value - Valor numérico a ser formatado
 * @returns String formatada como moeda brasileira (ex: "R$ 1.234,56")
 * 
 * @example
 * formatCurrency(1234.56) // "R$ 1.234,56"
 * formatCurrency(null) // "R$ 0,00"
 */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "R$ 0,00";
  }
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}
