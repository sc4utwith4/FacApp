import { describe, expect, it } from 'vitest';
import { __authSessionRecoveryInternals } from '@/integrations/supabase/client';

describe('supabase client session recovery internals', () => {
  it('reconhece erro de refresh token invalido', () => {
    expect(
      __authSessionRecoveryInternals.isInvalidRefreshTokenError({
        message: 'Invalid Refresh Token: Refresh Token Not Found',
      })
    ).toBe(true);
    expect(
      __authSessionRecoveryInternals.isInvalidRefreshTokenError({
        message: 'network timeout',
      })
    ).toBe(false);
  });

  it('extrai project ref da URL Supabase', () => {
    expect(__authSessionRecoveryInternals.getProjectRefFromUrl('https://zhsucbowsxfwmsrdvhre.supabase.co')).toBe(
      'zhsucbowsxfwmsrdvhre'
    );
    expect(__authSessionRecoveryInternals.getProjectRefFromUrl('invalid-url')).toBeNull();
  });

  it('resolve URL do browser: Vercel usa proxy same-origin quando useProxy', () => {
    const direct = 'https://zhsucbowsxfwmsrdvhre.supabase.co';
    const fakeWin = {
      location: { origin: 'https://assfac-plataforma.vercel.app', hostname: 'assfac-plataforma.vercel.app' },
    } as Window;
    expect(
      __authSessionRecoveryInternals.resolveSupabaseUrlForBrowser(direct, { window: fakeWin, useProxy: true })
    ).toBe('https://assfac-plataforma.vercel.app/supabase');
  });

  it('resolve URL do browser: localhost mantém URL direta do Supabase', () => {
    const direct = 'https://zhsucbowsxfwmsrdvhre.supabase.co';
    const fakeWin = {
      location: { origin: 'http://localhost:8080', hostname: 'localhost' },
    } as Window;
    expect(
      __authSessionRecoveryInternals.resolveSupabaseUrlForBrowser(direct, { window: fakeWin, useProxy: true })
    ).toBe(direct);
  });

  it('remove apenas chaves de auth do projeto no local/session storage', () => {
    const ref = 'zhsucbowsxfwmsrdvhre';
    localStorage.setItem(`sb-${ref}-auth-token`, '{"foo":"bar"}');
    localStorage.setItem('other-key', 'keep');
    sessionStorage.setItem(`sb-${ref}-auth-token`, '{"foo":"bar"}');
    sessionStorage.setItem('supabase.auth.token', 'legacy');

    __authSessionRecoveryInternals.clearSupabaseAuthStorage(`https://${ref}.supabase.co`);

    expect(localStorage.getItem(`sb-${ref}-auth-token`)).toBeNull();
    expect(sessionStorage.getItem(`sb-${ref}-auth-token`)).toBeNull();
    expect(sessionStorage.getItem('supabase.auth.token')).toBeNull();
    expect(localStorage.getItem('other-key')).toBe('keep');
  });
});
