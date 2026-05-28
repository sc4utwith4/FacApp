import { describe, expect, it } from 'vitest';
import {
  resolveInternalApiBaseUrlFromRequest,
  type VercelRequest,
} from '../_shared';

const makeRequest = (headers: Record<string, string | string[] | undefined>): VercelRequest => ({
  method: 'POST',
  headers,
  body: {},
});

describe('resolveInternalApiBaseUrlFromRequest', () => {
  it('prioritiza x-forwarded-proto quando informado', () => {
    const req = makeRequest({
      'x-forwarded-proto': 'http,https',
      'x-forwarded-host': 'proxy.assfac.local:8081',
    });

    expect(resolveInternalApiBaseUrlFromRequest(req)).toBe('http://proxy.assfac.local:8081');
  });

  it('usa http para host local sem x-forwarded-proto', () => {
    const req = makeRequest({
      host: 'localhost:8082',
    });

    expect(resolveInternalApiBaseUrlFromRequest(req)).toBe('http://localhost:8082');
  });

  it('usa https para host nao local sem x-forwarded-proto', () => {
    const req = makeRequest({
      host: 'assfac-plataforma.vercel.app',
    });

    expect(resolveInternalApiBaseUrlFromRequest(req)).toBe('https://assfac-plataforma.vercel.app');
  });

  it('falha com mensagem controlada quando host estiver ausente', () => {
    const req = makeRequest({});

    expect(() =>
      resolveInternalApiBaseUrlFromRequest(req, {
        missingHostMessage: 'Nao foi possivel resolver host da requisicao para executar acao.',
      })
    ).toThrow('Nao foi possivel resolver host da requisicao para executar acao.');
  });
});

