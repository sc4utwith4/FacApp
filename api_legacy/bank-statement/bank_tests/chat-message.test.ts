import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  processBankReconciliationChatMessageMock,
  resolveInternalApiBaseUrlFromRequestMock,
  safeInsertBankAuditLogMock,
} = vi.hoisted(() => ({
  processBankReconciliationChatMessageMock: vi.fn(),
  resolveInternalApiBaseUrlFromRequestMock: vi.fn(() => 'http://localhost:8080'),
  safeInsertBankAuditLogMock: vi.fn(async () => null),
}));

vi.mock('../../../src/server/bank-statement/chat/orchestrator.js', () => ({
  processBankReconciliationChatMessage: processBankReconciliationChatMessageMock,
}));

vi.mock('../../../src/server/bank-statement/_shared.js', () => ({
  extractBearerToken: vi.fn(() => 'token-123'),
  getAdminClient: vi.fn(() => ({})),
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const value = req.headers?.[headerName];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }),
  resolveInternalApiBaseUrlFromRequest: resolveInternalApiBaseUrlFromRequestMock,
  getRuntimeBuildId: vi.fn(() => 'runtime-dev'),
  isBankReconciliationOfxOnlyEnabled: vi.fn(() => false),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.example.com'),
  parseJsonBody: vi.fn((req: { body?: unknown }) => req.body),
  safeInsertBankAuditLog: safeInsertBankAuditLogMock,
  verifyTokenAndGetEmpresaId: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
}));

import handler from '../../../api_legacy/bank-statement/chat/message';

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

describe('api_legacy/bank-statement/chat/message', () => {
  afterEach(() => {
    processBankReconciliationChatMessageMock.mockReset();
    resolveInternalApiBaseUrlFromRequestMock.mockReset();
    resolveInternalApiBaseUrlFromRequestMock.mockReturnValue('http://localhost:8080');
    safeInsertBankAuditLogMock.mockClear();
    vi.restoreAllMocks();
  });

  it('processa mensagem com baseUrl resolvida pelo helper compartilhado', async () => {
    processBankReconciliationChatMessageMock.mockResolvedValue({
      session: { id: 'session-1' },
      user_message: { id: 'user-message-1', metadata: {} },
      assistant_message: { id: 'assistant-message-1', metadata: {} },
      context_snapshot: {
        import_id: null,
        data_referencia: '2026-03-20',
      },
      action_preview: null,
      reconciliation_plan: null,
      clarifying_questions: [],
      pending_cases: [],
      pending_action_state: null,
      ai_processing_status: null,
      last_execution_summary: null,
      suggested_next_actions: null,
      review_guidance: null,
      ui_show_operational_cards: false,
      ui_show_plan_card: false,
      ui_show_guided_card: false,
    });

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        host: 'localhost:8080',
      },
      body: {
        conta_bancaria_id: 'conta-1',
        message: 'Conciliar agora',
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(processBankReconciliationChatMessageMock).toHaveBeenCalledTimes(1);
    expect(processBankReconciliationChatMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://localhost:8080',
        contaBancariaId: 'conta-1',
        message: 'Conciliar agora',
      })
    );
  });
});
