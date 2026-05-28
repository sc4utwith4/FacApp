'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** URL canónica `https://<ref>.supabase.co` (env). Usada para ref do projeto, storage keys e dev/local. */
export const getDirectSupabaseUrl = (): string => {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return process.env.NEXT_PUBLIC_SUPABASE_URL;
  }
  if (typeof process !== 'undefined' && process.env.VITE_SUPABASE_URL) {
    return process.env.VITE_SUPABASE_URL;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) {
    return import.meta.env.VITE_SUPABASE_URL;
  }
  throw new Error('NEXT_PUBLIC_SUPABASE_URL or VITE_SUPABASE_URL não encontrada');
};

function shouldUseSameOriginSupabaseProxy(): boolean {
  const force = import.meta.env.VITE_SUPABASE_USE_SAME_ORIGIN_PROXY === 'true';
  const prodLike = import.meta.env.PROD === true || import.meta.env.MODE === 'production';
  return force || prodLike;
}

export type ResolveSupabaseUrlForBrowserOptions = {
  /** Para testes; por omissão usa `window` e flags de build. */
  window?: Pick<Window, 'location'>;
  /** Se definido, ignora `shouldUseSameOriginSupabaseProxy()`. */
  useProxy?: boolean;
};

/**
 * Em produção no browser (ex.: Vercel), usa mesmo origin + `/supabase` para que o DNS do cliente
 * só precise resolver o domínio da app — o proxy em vercel.json encaminha para o projeto Supabase.
 */
export function resolveSupabaseUrlForBrowser(
  directUrl: string,
  opts?: ResolveSupabaseUrlForBrowserOptions
): string {
  const w = opts?.window ?? (typeof window !== 'undefined' ? window : undefined);
  if (typeof w === 'undefined') return directUrl;
  const { hostname, origin } = w.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return directUrl;

  const useProxy = opts?.useProxy ?? shouldUseSameOriginSupabaseProxy();
  if (!useProxy) return directUrl;
  return `${origin}/supabase`;
}

const getSupabaseUrl = (): string => resolveSupabaseUrlForBrowser(getDirectSupabaseUrl());

function getSupabaseProjectRef(): string {
  const ref = getProjectRefFromUrl(getDirectSupabaseUrl());
  if (!ref) {
    throw new Error('Não foi possível obter o project ref a partir de VITE_SUPABASE_URL');
  }
  return ref;
}

export const getSupabaseAnonKey = (): string => {
  if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
  if (typeof process !== 'undefined' && process.env.VITE_SUPABASE_PUBLISHABLE_KEY) {
    return process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  }
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY) {
    return import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  }
  throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY or VITE_SUPABASE_PUBLISHABLE_KEY não encontrada');
};

const INVALID_REFRESH_TOKEN_PATTERNS = ['invalid refresh token', 'refresh token not found'];

function isInvalidRefreshTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { message?: unknown };
  const message = String(maybeError.message || '').toLowerCase();
  if (!message) return false;
  return INVALID_REFRESH_TOKEN_PATTERNS.some((pattern) => message.includes(pattern));
}

function getProjectRefFromUrl(supabaseUrl: string): string | null {
  try {
    const parsed = new URL(supabaseUrl);
    const host = parsed.hostname || '';
    const [projectRef] = host.split('.');
    return projectRef || null;
  } catch {
    return null;
  }
}

function clearSupabaseAuthStorage(supabaseUrl: string) {
  if (typeof window === 'undefined') return;
  const projectRef = getProjectRefFromUrl(supabaseUrl);
  if (!projectRef) return;

  const prefix = `sb-${projectRef}-`;
  const shouldRemove = (key: string) => key.startsWith(prefix) && key.includes('auth-token');
  const cleanup = (storage: Storage | undefined) => {
    if (!storage) return;
    const keys = Object.keys(storage);
    for (const key of keys) {
      if (shouldRemove(key)) {
        storage.removeItem(key);
      }
    }
    if (storage.getItem('supabase.auth.token')) {
      storage.removeItem('supabase.auth.token');
    }
  };

  cleanup(window.localStorage);
  cleanup(window.sessionStorage);
}

function installInvalidRefreshTokenRecovery(client: SupabaseClient, supabaseUrl: string) {
  const authClient = client.auth as any;
  if (!authClient || authClient.__assfacInvalidRefreshGuardInstalled) return;
  authClient.__assfacInvalidRefreshGuardInstalled = true;

  let recovered = false;
  const recoverInvalidSession = () => {
    if (recovered) return;
    recovered = true;
    clearSupabaseAuthStorage(supabaseUrl);
    if (typeof window !== 'undefined' && import.meta.env?.MODE === 'development') {
      console.warn('Sessao local invalida (refresh token). Storage de auth limpo automaticamente.');
    }
  };

  const wrapAuthMethod = (methodName: string, fallbackResult: unknown) => {
    const original = authClient[methodName];
    if (typeof original !== 'function') return;
    authClient[methodName] = async (...args: any[]) => {
      try {
        const result = await original.apply(authClient, args);
        if (isInvalidRefreshTokenError(result?.error)) {
          recoverInvalidSession();
          return fallbackResult;
        }
        return result;
      } catch (error) {
        if (!isInvalidRefreshTokenError(error)) {
          throw error;
        }
        recoverInvalidSession();
        return fallbackResult;
      }
    };
  };

  wrapAuthMethod('getSession', { data: { session: null }, error: null });
  wrapAuthMethod('refreshSession', { data: { user: null, session: null }, error: null });
  wrapAuthMethod('_callRefreshToken', { data: null, error: null });
  wrapAuthMethod('_recoverAndRefresh', undefined);
}

let supabaseClient: ReturnType<typeof createClient> | null = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    try {
      const supabaseUrl = getSupabaseUrl();
      const supabaseAnonKey = getSupabaseAnonKey();
      const projectRef = getSupabaseProjectRef();

      supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          storageKey: `sb-${projectRef}-auth-token`,
          storage: typeof window !== 'undefined' ? window.localStorage : undefined,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
      installInvalidRefreshTokenRecovery(supabaseClient, getDirectSupabaseUrl());
    } catch (error) {
      if (typeof window !== 'undefined' && import.meta.env?.MODE === 'development') {
        console.error('❌ Erro ao criar cliente Supabase:', error);
      }
      throw error;
    }
  }
  return supabaseClient;
}

export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(_target, prop) {
    const client = getSupabaseClient();
    const value = client[prop as keyof typeof client];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export const __authSessionRecoveryInternals = {
  isInvalidRefreshTokenError,
  getProjectRefFromUrl,
  clearSupabaseAuthStorage,
  resolveSupabaseUrlForBrowser,
};
