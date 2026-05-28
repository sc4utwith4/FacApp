import { afterEach, describe, expect, it, vi } from 'vitest';

const { getAdminClientMock } = vi.hoisted(() => ({
  getAdminClientMock: vi.fn(),
}));

vi.mock('../../src/server/bank-statement/_shared.js', () => ({
  extractBearerToken: vi.fn(() => 'token-123'),
  getAdminClient: getAdminClientMock,
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const value = req.headers?.[headerName];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }),
  getRuntimeBuildId: vi.fn(() => 'runtime-test'),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.local'),
  verifyTokenAndGetEmpresaId: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
}));

import handler from './chat-sessions';

interface MockResponse {
  statusCode: number;
  payload: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
}

function createMockResponse(): MockResponse {
  return {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.payload = data;
      return this;
    },
  };
}

describe('api_legacy/operacoes-ia/chat-sessions', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GET lista sessões do usuário', async () => {
    const rows = [
      {
        id: 's1',
        empresa_id: 'empresa-1',
        user_id: 'user-1',
        title: 'SOI · 2026-03-01',
        last_message_at: '2026-03-29T10:00:00.000Z',
        reference_date: '2026-03-01',
      },
    ];

    getAdminClientMock.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  is: () => Promise.resolve({ data: rows, error: null }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token-123' },
      query: { limit: '50' },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ ok: true, data: rows });
  });

  it('DELETE faz soft-delete da sessão', async () => {
    getAdminClientMock.mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  select: () => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: 's-del' },
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
    });

    const req = {
      method: 'DELETE',
      headers: { authorization: 'Bearer token-123' },
      query: { session_id: 's-del' },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ ok: true, data: { id: 's-del', archived: true } });
  });
});
