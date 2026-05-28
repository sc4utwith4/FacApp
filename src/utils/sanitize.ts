/**
 * Utilitários para sanitização de strings e prevenção de XSS
 */

import DOMPurify from 'dompurify';

/**
 * Sanitiza uma string HTML removendo scripts e conteúdo perigoso
 */
export function sanitizeHTML(html: string): string {
  if (typeof window === 'undefined') {
    // Server-side: retornar string limpa sem HTML
    return html.replace(/<[^>]*>/g, '');
  }
  
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'code', 'pre', 'blockquote'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Valida e sanitiza input do usuário
 */
export function sanitizeUserInput(input: string): string {
  if (!input || typeof input !== 'string') {
    return '';
  }

  // Remover caracteres de controle
  let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Limitar tamanho máximo (5000 caracteres)
  const MAX_LENGTH = 5000;
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH);
  }

  // Trim
  sanitized = sanitized.trim();

  return sanitized;
}

/**
 * Valida se uma string é uma URL segura
 */
export function isValidURL(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Permitir apenas http e https
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Sanitiza URLs antes de usar em links
 */
export function sanitizeURL(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  const trimmed = url.trim();
  
  if (!isValidURL(trimmed)) {
    return null;
  }

  return trimmed;
}

