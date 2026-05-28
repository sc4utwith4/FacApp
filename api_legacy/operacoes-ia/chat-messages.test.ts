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

import handler from './chat-messages';

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

describe('api_legacy/operacoes-ia/chat-messages', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('GET retorna sessão e mensagens', async () => {
    const session = {
      id: 's1',
      empresa_id: 'empresa-1',
      user_id: 'user-1',
      reference_date: '2026-03-01',
      program_hint: 'SOI',
      operation_hint: null,
      cnpj_hint: null,
      title: 't',
      last_message_at: '2026-03-29T10:00:00.000Z',
    };
    const messages = [
      {
        id: 'm1',
        session_id: 's1',
        empresa_id: 'empresa-1',
        role: 'user',
        content: 'oi',
        context: {},
        metadata: {},
        created_at: '2026-03-29T10:00:00.000Z',
      },
    ];

    const sessionChain = {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              limit: () => ({
                is: () => Promise.resolve({ data: [session], error: null }),
              }),
            }),
          }),
        }),
      }),
    };

    getAdminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'operacoes_ia_chat_sessions') return sessionChain;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: messages, error: null }),
              }),
            }),
          }),
        };
      },
    });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token-123' },
      query: { session_id: 's1' },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      data: { session, messages },
    });
  });
});
