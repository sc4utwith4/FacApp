import { z } from 'zod';
import { logger } from '@/lib/logger';

/**
 * Schema de validação para variáveis de ambiente
 * Valida todas as envs obrigatórias no boot da aplicação
 */
const envSchema = z.object({
  // Supabase - Vite (atual)
  VITE_SUPABASE_URL: z.string().url().optional(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  
  // Supabase - Next.js (futuro)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  
  // Ambiente
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

type Env = z.infer<typeof envSchema>;

/**
 * Helper para obter variáveis de ambiente (compatível com Vite e Next.js)
 */
function getEnvVar(key: string): string | undefined {
  // No Next.js, variáveis NEXT_PUBLIC_ são injetadas em build time no cliente
  // Elas ficam disponíveis em process.env no lado do cliente
  if (typeof process !== 'undefined' && process.env) {
    // Tentar acessar diretamente
    const value = process.env[key];
    // Verificar se é uma string válida e não vazia
    if (value && typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  
  // Vite usa import.meta.env (fallback)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const value = import.meta.env[key];
    if (value && typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  
  // No Next.js, também podemos tentar acessar via window (em alguns casos)
  if (typeof window !== 'undefined' && (window as any).__NEXT_DATA__) {
    // Variáveis podem estar em __NEXT_DATA__.env
    const nextData = (window as any).__NEXT_DATA__;
    if (nextData.env && nextData.env[key]) {
      return nextData.env[key];
    }
  }
  
  return undefined;
}

/**
 * Valida e retorna variáveis de ambiente tipadas
 * Falha rápido se envs obrigatórias estiverem faltando
 */
function validateEnv(): Env {
  const rawEnv = {
    VITE_SUPABASE_URL: getEnvVar('VITE_SUPABASE_URL'),
    VITE_SUPABASE_PUBLISHABLE_KEY: getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY'),
    NEXT_PUBLIC_SUPABASE_URL: getEnvVar('NEXT_PUBLIC_SUPABASE_URL'),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    NODE_ENV: (getEnvVar('NODE_ENV') as 'development' | 'test' | 'production' | undefined) || 'development',
  };

  try {
    return envSchema.parse(rawEnv);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingEnvs = error.errors
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      
      throw new Error(
        `❌ Variáveis de ambiente inválidas:\n${missingEnvs}\n\n` +
        `Verifique se o arquivo .env existe e contém todas as variáveis necessárias.\n` +
        `Consulte o arquivo .env.example para referência.`
      );
    }
    throw error;
  }
}

/**
 * Variáveis de ambiente validadas e tipadas
 * Acesso: env.VITE_SUPABASE_URL, env.NODE_ENV, etc.
 * Lazy-loaded para funcionar no Next.js
 */
let cachedEnv: Env | null = null;

function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = validateEnv();
  }
  return cachedEnv;
}

// Exportar Proxy para lazy loading
export const env = new Proxy({} as Env, {
  get(_target, prop) {
    return getEnv()[prop as keyof Env];
  },
});

/**
 * Helper para obter URL do Supabase (Vite ou Next.js)
 */
export function getSupabaseUrl(): string {
  return env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '';
}

/**
 * Helper para obter chave anônima do Supabase (Vite ou Next.js)
 */
export function getSupabaseAnonKey(): string {
  return env.VITE_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

/**
 * Valida se Supabase está configurado
 * Lazy-loaded para funcionar no Next.js
 */
export function validateSupabaseConfig(): { url: string; anonKey: string } {
  // Obter variáveis diretamente (sem usar env proxy)
  const viteUrl = getEnvVar('VITE_SUPABASE_URL');
  const nextUrl = getEnvVar('NEXT_PUBLIC_SUPABASE_URL');
  const viteKey = getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY');
  const nextKey = getEnvVar('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  
  // Debug: verificar se as variáveis estão sendo lidas
  if (typeof window !== 'undefined') {
    // Apenas no cliente, para debug
    logger.debug('🔍 Debug - Variáveis de ambiente:');
    logger.debug('  process.env.NEXT_PUBLIC_SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
    logger.debug('  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY:', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'EXISTS' : 'NOT FOUND');
    logger.debug('  getEnvVar(NEXT_PUBLIC_SUPABASE_URL):', nextUrl);
    logger.debug('  getEnvVar(NEXT_PUBLIC_SUPABASE_ANON_KEY):', nextKey ? 'EXISTS' : 'NOT FOUND');
  }
  
  const url = viteUrl || nextUrl || '';
  const anonKey = viteKey || nextKey || '';

  if (!url) {
    const errorMsg = 
      'Missing VITE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL environment variable.\n' +
      'Please check your .env.local file and ensure NEXT_PUBLIC_SUPABASE_URL is set.\n' +
      `Debug info: viteUrl=${viteUrl ? 'EXISTS' : 'NOT FOUND'}, nextUrl=${nextUrl ? 'EXISTS' : 'NOT FOUND'}`;
    logger.error('❌ Error:', errorMsg);
    throw new Error(errorMsg);
  }

  if (!anonKey) {
    const errorMsg = 
      'Missing VITE_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable.\n' +
      'Please check your .env.local file and ensure NEXT_PUBLIC_SUPABASE_ANON_KEY is set.\n' +
      `Debug info: viteKey=${viteKey ? 'EXISTS' : 'NOT FOUND'}, nextKey=${nextKey ? 'EXISTS' : 'NOT FOUND'}`;
    logger.error('❌ Error:', errorMsg);
    throw new Error(errorMsg);
  }

  return { url, anonKey };
}

