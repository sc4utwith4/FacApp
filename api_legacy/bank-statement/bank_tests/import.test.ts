import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  processBankImportMock,
  triggerBankReconciliationAiWorkflowMock,
  safeInsertBankAuditLogMock,
  downloadMock,
  fromMock,
} = vi.hoisted(() => ({
  processBankImportMock: vi.fn(),
  triggerBankReconciliationAiWorkflowMock: vi.fn(),
  safeInsertBankAuditLogMock: vi.fn(async () => null),
  downloadMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('../../../src/server/bank-statement/_import-core.js', () => ({
  processBankImport: processBankImportMock,
}));

vi.mock('../../../src/server/bank-statement/_ai-trigger.js', () => ({
  triggerBankReconciliationAiWorkflow: triggerBankReconciliationAiWorkflowMock,
}));

vi.mock('../../../api_legacy/bank-statement/import/notice/ack.js', () => ({
  default: vi.fn(),
}));

vi.mock('../../../src/server/bank-statement/_shared.js', () => ({
  extractBearerToken: vi.fn(() => 'token-123'),
  getAdminClient: vi.fn(() => ({
    from: fromMock,
    storage: {
      from: vi.fn(() => ({
        download: downloadMock,
      })),
    },
  })),
  getErrorMessage: vi.fn((error: unknown, fallback = 'Erro inesperado') =>
    error instanceof Error && error.message ? error.message : fallback
  ),
  getHeaderValue: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }, headerName: string) => {
    const value = req.headers?.[headerName];
    return Array.isArray(value) ? value[0] ?? null : value ?? null;
  }),
  isBankReconciliationOfxOnlyEnabled: vi.fn(() => true),
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.example.com'),
  resolveInternalApiBaseUrlFromRequest: vi.fn((req: { headers?: Record<string, string | string[] | undefined> }) => {
    const host = req.headers?.host;
    const hostValue = Array.isArray(host) ? host[0] : host;
    return `http://${hostValue || 'localhost:8082'}`;
  }),
  parseJsonBody: vi.fn((req: { body?: unknown }) => req.body),
  safeInsertBankAuditLog: safeInsertBankAuditLogMock,
  verifyTokenAndGetEmpresaId: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
}));

import handler from '../../../api/bank-statement/import';

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

describe('api/bank-statement/import', () => {
  afterEach(() => {
    processBankImportMock.mockReset();
    triggerBankReconciliationAiWorkflowMock.mockReset();
    safeInsertBankAuditLogMock.mockClear();
    downloadMock.mockReset();
    fromMock.mockReset();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('processa o OFX, executa auto-match deterministico e encerra sem disparar IA automaticamente', async () => {
    processBankImportMock.mockResolvedValue({
      ok: true,
      parse_status: 'parsed',
      errors: [],
      warnings: [],
    });

    downloadMock.mockResolvedValue({
      data: {
        arrayBuffer: async () => new TextEncoder().encode('<OFX>conteudo</OFX>').buffer,
      },
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'contas_bancarias') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(async () => ({
            data: { id: 'conta-1', empresa_id: 'empresa-1' },
            error: null,
          })),
        };
        return query;
      }

      if (table === 'extratos_import') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: 'import-1',
                  conta_bancaria_id: 'conta-1',
                  empresa_id: 'empresa-1',
                  parse_status: 'received',
                },
                error: null,
              })),
            })),
          })),
        };
      }

      if (table === 'bank_reconciliation_audit_log') {
        return {
          insert: vi.fn(async () => ({ data: null, error: null })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        confirmed_count: 1,
        suggested_count: 0,
        skipped_count: 0,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        host: 'localhost:8082',
      },
      body: {
        conta_bancaria_id: 'conta-1',
        source: 'ofx_generic',
        file_format: 'ofx',
        file_storage_bucket: 'extratos-bancarios',
        file_storage_key: 'empresa-1/conta-1/extrato.ofx',
        original_filename: 'extrato.ofx',
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(processBankImportMock).toHaveBeenCalledTimes(1);
    expect(res.payload).toMatchObject({
      ok: true,
      duplicate: false,
      import_row: {
        id: 'import-1',
      },
      parse_result: {
        parse_status: 'parsed',
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8082/api/bank-statement/match',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer token-123',
          'Content-Type': 'application/json',
        }),
      })
    );
    const matchBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body || '{}')) as Record<string, unknown>;
    expect(matchBody).toMatchObject({
      import_id: 'import-1',
      auto_confirm: true,
    });
    expect((res.payload as Record<string, unknown>).ai_trigger).toBeUndefined();
    expect(triggerBankReconciliationAiWorkflowMock).not.toHaveBeenCalled();
  });

  it('mantem import em sucesso quando auto-match falha, registrando warning', async () => {
    processBankImportMock.mockResolvedValue({
      ok: true,
      parse_status: 'parsed',
      errors: [],
      warnings: [],
    });

    downloadMock.mockResolvedValue({
      data: {
        arrayBuffer: async () => new TextEncoder().encode('<OFX>conteudo</OFX>').buffer,
      },
      error: null,
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'contas_bancarias') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(async () => ({
            data: { id: 'conta-1', empresa_id: 'empresa-1' },
            error: null,
          })),
        };
        return query;
      }

      if (table === 'extratos_import') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: {
                  id: 'import-1',
                  conta_bancaria_id: 'conta-1',
                  empresa_id: 'empresa-1',
                  parse_status: 'received',
                },
                error: null,
              })),
            })),
          })),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'Internal server error',
        message: 'match failed',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        host: 'localhost:8082',
      },
      body: {
        conta_bancaria_id: 'conta-1',
        source: 'ofx_generic',
        file_format: 'ofx',
        file_storage_bucket: 'extratos-bancarios',
        file_storage_key: 'empresa-1/conta-1/extrato.ofx',
        original_filename: 'extrato.ofx',
      },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.payload).toMatchObject({
      ok: true,
      parse_result: {
        parse_status: 'parsed',
      },
    });

    const parseResult =
      (res.payload as Record<string, unknown>).parse_result &&
      typeof (res.payload as Record<string, unknown>).parse_result === 'object'
        ? ((res.payload as Record<string, unknown>).parse_result as Record<string, unknown>)
        : null;

    expect(Array.isArray(parseResult?.warnings)).toBe(true);
    expect((parseResult?.warnings as string[]).some((warning) => warning.includes('auto-match deterministico'))).toBe(true);
    expect(triggerBankReconciliationAiWorkflowMock).not.toHaveBeenCalled();
  });

  it('reprocessa importacao parsed sem disparar IA automaticamente', async () => {
    processBankImportMock.mockResolvedValue({
      ok: true,
      parse_status: 'parsed',
      errors: [],
      warnings: [],
    });

    let importFetchCount = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === 'extratos_import') {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          maybeSingle: vi.fn(async () => {
            importFetchCount += 1;
            if (importFetchCount === 1) {
              return {
                data: {
                  id: 'import-1',
                  conta_bancaria_id: 'conta-1',
                  empresa_id: 'empresa-1',
                  parse_status: 'received',
                },
                error: null,
              };
            }

            return {
              data: {
                id: 'import-1',
                conta_bancaria_id: 'conta-1',
                empresa_id: 'empresa-1',
                parse_status: 'parsed',
              },
              error: null,
            };
          }),
        };
        return query;
      }

      throw new Error(`Unexpected table ${table}`);
    });

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        confirmed_count: 0,
        suggested_count: 0,
        skipped_count: 0,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      headers: {
        authorization: 'Bearer token-123',
        host: 'localhost:8082',
      },
      body: {
        import_id: 'import-1',
      },
      query: {
        action: 'reprocess',
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(processBankImportMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(triggerBankReconciliationAiWorkflowMock).not.toHaveBeenCalled();
    expect(res.payload).toMatchObject({
      ok: true,
      import_row: {
        id: 'import-1',
        parse_status: 'parsed',
      },
      parse_result: {
        parse_status: 'parsed',
      },
      ai_trigger: null,
    });
  });
});
