import { afterEach, describe, expect, it, vi } from 'vitest';

const originalProxyTarget = process.env.VITE_API_PROXY_TARGET;

afterEach(() => {
  process.env.VITE_API_PROXY_TARGET = originalProxyTarget;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('dev-bank-api-preflight', () => {
  it('normaliza proxy target valido', async () => {
    const mod = await import('../dev-bank-api-preflight.cjs');
    const parsed = mod.normalizeProxyTarget('http://localhost:3100');
    expect(parsed.origin).toBe('http://localhost:3100');
  });

  it('falha para proxy target invalido', async () => {
    const mod = await import('../dev-bank-api-preflight.cjs');
    expect(() => mod.normalizeProxyTarget('://invalid-url')).toThrow(/VITE_API_PROXY_TARGET invalido/);
  });

  it('retorna ok quando healthcheck responde 401', async () => {
    process.env.VITE_API_PROXY_TARGET = 'http://localhost:3100';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"Unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } }))
    );
    const mod = await import('../dev-bank-api-preflight.cjs');
    const result = await mod.runBankApiPreflight({ quiet: true });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(401);
  });

  it('retorna falha quando healthcheck responde status inesperado', async () => {
    process.env.VITE_API_PROXY_TARGET = 'http://localhost:3100';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500, headers: { 'content-type': 'text/plain' } }))
    );
    const mod = await import('../dev-bank-api-preflight.cjs');
    const result = await mod.runBankApiPreflight({ quiet: true });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.reason).toBe('unexpected_status');
  });
});
