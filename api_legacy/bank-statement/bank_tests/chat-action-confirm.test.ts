import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  executeBankChatActionMock,
  buildBankReconciliationChatContextMock,
  ensureBankChatSessionMock,
  insertBankChatMessageMock,
  safeInsertBankAuditLogMock,
  resolveInternalApiBaseUrlFromRequestMock,
} = vi.hoisted(() => ({
  executeBankChatActionMock: vi.fn(),
  buildBankReconciliationChatContextMock: vi.fn(),
  ensureBankChatSessionMock: vi.fn(),
  insertBankChatMessageMock: vi.fn(),
  safeInsertBankAuditLogMock: vi.fn(async () => null),
  resolveInternalApiBaseUrlFromRequestMock: vi.fn(),
}));

vi.mock('../../../src/server/bank-statement/chat/actionExecutor.js', () => ({
  executeBankChatAction: executeBankChatActionMock,
}));

vi.mock('../../../src/server/bank-statement/chat/contextBuilder.js', () => ({
  buildBankReconciliationChatContext: buildBankReconciliationChatContextMock,
}));

vi.mock('../../../src/server/bank-statement/chat/orchestrator.js', () => ({
  ensureBankChatSession: ensureBankChatSessionMock,
  insertBankChatMessage: insertBankChatMessageMock,
}));

vi.mock('../../../src/server/bank-statement/_shared.js', () => ({
  extractBearerToken: vi.fn(() => 'token-123'),
  getAdminClient: vi.fn(() => ({ kind: 'admin-client-mock' })),
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const direct = req.headers?.[headerName];
    if (Array.isArray(direct)) return direct[0] ?? null;
    if (typeof direct === 'string') return direct;

    const key = Object.keys(req.headers || {}).find((item) => item.toLowerCase() === headerName.toLowerCase());
    if (!key) return null;
    const value = req.headers?.[key];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }),
  resolveInternalApiBaseUrlFromRequest: resolveInternalApiBaseUrlFromRequestMock,
  getRuntimeBuildId: vi.fn(() => 'runtime-dev'),
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

import handler from '../chat/action/confirm';

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

const defaultContextSnapshot = {
  conta_bancaria_id: 'conta-1',
  conta_label: 'Conta Local',
  data_referencia: '2026-03-18',
  import_id: 'import-1',
  ofx_required: false,
  ofx_required_reason: null,
};

const defaultExecutionResult = {
  ok: true,
  action: 'run_daily_reconciliation',
  idempotency_key: 'idem-1',
  executed_at: '2026-03-18T16:56:39.000Z',
  result: { ok: true },
  assistant_message: 'Conciliação executada.',
};

describe('chat/action/confirm handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    executeBankChatActionMock.mockReset();
    buildBankReconciliationChatContextMock.mockReset();
    ensureBankChatSessionMock.mockReset();
    insertBankChatMessageMock.mockReset();
    safeInsertBankAuditLogMock.mockClear();
    resolveInternalApiBaseUrlFromRequestMock.mockReset();
  });

  it('resolve baseUrl local com http quando host local chega sem x-forwarded-proto', async () => {
    resolveInternalApiBaseUrlFromRequestMock.mockReturnValue('http://localhost:8082');
    buildBankReconciliationChatContextMock.mockResolvedValue(defaultContextSnapshot);
    ensureBankChatSessionMock.mockResolvedValue({ id: 'session-1' });
    executeBankChatActionMock.mockResolvedValue(defaultExecutionResult);
    insertBankChatMessageMock
      .mockResolvedValueOnce({ id: 'msg-user', role: 'user', content: 'Confirmar ação: run_daily_reconciliation' })
      .mockResolvedValueOnce({ id: 'msg-assistant', role: 'assistant', content: 'Conciliação executada.' });

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        host: 'localhost:8082',
      },
      body: {
        action: 'run_daily_reconciliation',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-18',
        import_id: 'import-1',
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(resolveInternalApiBaseUrlFromRequestMock).toHaveBeenCalledTimes(1);
    expect(executeBankChatActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'http://localhost:8082',
      })
    );
  });

  it('registra diagnostico estruturado no audit log quando chamada interna falha', async () => {
    resolveInternalApiBaseUrlFromRequestMock.mockReturnValue('http://localhost:8082');
    buildBankReconciliationChatContextMock.mockResolvedValue(defaultContextSnapshot);
    ensureBankChatSessionMock.mockResolvedValue({ id: 'session-1' });

    const internalApiError = new Error('Falha de conectividade interna ao chamar POST /api/bank-statement/match.');
    internalApiError.name = 'InternalApiError';
    (internalApiError as Error & { details?: Record<string, unknown> }).details = {
      type: 'network',
      method: 'POST',
      path: '/api/bank-statement/match',
      target: 'http://localhost:8082',
      status: null,
      reason: 'fetch failed',
    };
    executeBankChatActionMock.mockRejectedValue(internalApiError);

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        host: 'localhost:8082',
      },
      body: {
        action: 'run_daily_reconciliation',
        conta_bancaria_id: 'conta-1',
        data_referencia: '2026-03-18',
        import_id: 'import-1',
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(422);
    expect(res.payload).toMatchObject({
      error: 'Chat action error',
      runtime_build_id: 'runtime-dev',
    });
    expect(safeInsertBankAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'chat_action_failed',
        status: 'error',
        details: expect.objectContaining({
          error_category: 'internal_api_network',
          error_name: 'InternalApiError',
          resolved_internal_base_url: 'http://localhost:8082',
          internal_api: expect.objectContaining({
            type: 'network',
            method: 'POST',
            path: '/api/bank-statement/match',
            target: 'http://localhost:8082',
          }),
        }),
      })
    );
  });
});

