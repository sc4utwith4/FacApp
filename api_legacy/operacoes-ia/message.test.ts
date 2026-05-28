import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyTokenAndGetEmpresaIdMock, getAdminClientMock } = vi.hoisted(() => ({
  verifyTokenAndGetEmpresaIdMock: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
  getAdminClientMock: vi.fn(),
}));

function createPersistMocks() {
  const messagesInsert = vi.fn().mockResolvedValue({ error: null });
  const sessionsInsert = vi.fn(() => ({
    select: () => ({
      single: vi.fn().mockResolvedValue({ data: { id: 'sess-new' }, error: null }),
    }),
  }));
  const sessionsUpdate = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ error: null }),
  }));

  getAdminClientMock.mockReturnValue({
    from: (table: string) => {
      if (table === 'operacoes_ia_chat_sessions') {
        return {
          insert: sessionsInsert,
          update: sessionsUpdate,
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  is: () => ({
                    maybeSingle: vi
                      .fn()
                      .mockResolvedValue({ data: { id: '11111111-1111-4111-8111-111111111111' }, error: null }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        insert: messagesInsert,
      };
    },
  });
}

vi.mock('../../src/server/bank-statement/_shared.js', () => ({
  extractBearerToken: vi.fn(() => 'token-123'),
  getAdminClient: getAdminClientMock,
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const direct = req.headers?.[headerName];
    if (Array.isArray(direct)) return direct[0] ?? null;
    if (typeof direct === 'string') return direct;
    return null;
  }),
  getRuntimeBuildId: vi.fn(() => 'runtime-test'),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.local'),
  parseJsonBody: vi.fn((req: { body?: unknown }) => req.body),
  verifyTokenAndGetEmpresaId: verifyTokenAndGetEmpresaIdMock,
}));

import handler from './message';

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

describe('api_legacy/operacoes-ia/message', () => {
  const envBackup = {
    webhookUrl: process.env.N8N_OPERACOES_IA_WEBHOOK_URL,
    webhookSecret: process.env.N8N_OPERACOES_IA_INTEGRATION_SECRET,
  };
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createPersistMocks();
  });

  afterEach(() => {
    process.env.N8N_OPERACOES_IA_WEBHOOK_URL = envBackup.webhookUrl;
    process.env.N8N_OPERACOES_IA_INTEGRATION_SECRET = envBackup.webhookSecret;
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    getAdminClientMock.mockReset();
    verifyTokenAndGetEmpresaIdMock.mockReset();
    verifyTokenAndGetEmpresaIdMock.mockResolvedValue({
      empresaId: 'empresa-1',
      userId: 'user-1',
    });
  });

  it('retorna fallback estático quando env do n8n não está configurada e persiste sessão/mensagens', async () => {
    delete process.env.N8N_OPERACOES_IA_WEBHOOK_URL;
    delete process.env.N8N_OPERACOES_IA_INTEGRATION_SECRET;

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        message: 'Como tratar duplicidade?',
        context: {
          batch_id: 'batch-1',
          item_id: 'item-1',
          import_file_id: 'import-1',
          program_hint: 'SOI',
          reference_date: '2026-03-25',
        },
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      session_id: 'sess-new',
    });
    expect(String((res.payload as { reply?: string }).reply || '')).toContain('workspace');
  });

  it('quando n8n retorna HTTP erro, grava resposta de erro e responde 200 com session_id', async () => {
    process.env.N8N_OPERACOES_IA_WEBHOOK_URL = 'https://n8n.example.com/webhook/operacoes-ia/chat';
    process.env.N8N_OPERACOES_IA_INTEGRATION_SECRET = 'secret-ops-ia';

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
        text: async () => '',
      }))
    );

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        message: 'Status do lote?',
        context: {
          program_hint: 'SPPRO',
          reference_date: '2026-03-24',
          session_import_ids: ['imp-1', 'imp-1', 'imp-2'],
        },
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      session_id: 'sess-new',
    });
    expect(String((res.payload as { reply?: string }).reply || '')).toContain('HTTP 503');
  });
});
