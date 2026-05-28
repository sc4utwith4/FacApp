/**
 * Valida se um valor é um UUID válido
 * @param value - Valor a ser validado
 * @returns true se for string UUID válido
 */
export function isValidUUID(value: any): value is string {
  if (typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Garante que um valor seja UUID válido ou retorna null
 * @param value - Valor a ser validado
 * @returns UUID string ou null se inválido
 */
export function ensureUUID(value: any): string | null {
  if (!value) return null;
  const stringValue = String(value);
  return isValidUUID(stringValue) ? stringValue : null;
}

/**
 * Verifica se um erro do Supabase é um erro de conflito (409) ou duplicate key
 * @param error - Erro do Supabase
 * @returns true se for erro de conflito
 */
export function isConflictError(error: any): boolean {
  if (!error) return false;
  
  return (
    error.code === '23505' ||
    error.message?.includes('duplicate') ||
    error.message?.includes('already exists') ||
    error.message?.includes('unique constraint') ||
    (error as any)?.status === 409 ||
    (error as any)?.statusCode === 409
  );
}

/**
 * Gera um UUID v4
 * @returns UUID string
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

