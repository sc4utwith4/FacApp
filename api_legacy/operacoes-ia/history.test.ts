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
  getSupabaseAnonKey: vi.fn(() => 'anon-key'),
  getSupabaseServiceRoleKey: vi.fn(() => 'service-role'),
  getSupabaseUrl: vi.fn(() => 'https://supabase.local'),
  verifyTokenAndGetEmpresaId: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
}));

import handler from './history';

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

function createAdminClientMock() {
  const queryBuilder = (table: string) => {
    const chain: {
      select: () => typeof chain;
      eq: () => typeof chain;
      gte: () => typeof chain;
      lt: () => typeof chain;
      or: () => typeof chain;
      order: () => typeof chain;
      limit: () => Promise<{ data: unknown[]; error: null }>;
    } = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lt: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => {
        if (table === 'operation_import_files') {
          return Promise.resolve({
            data: [
              {
                id: 'imp-1',
                parse_status: 'parsed',
                program_hint: 'SOI',
                operation_number: '2759',
                linked_operacao_id: null,
                error_message: null,
                created_at: '2026-03-29T11:00:00.000Z',
                created_by: 'user-import',
                original_filename: 'soi-2759.pdf',
                parsed_payload: {
                  program: 'SOI',
                  document: {
                    operation_number: '2759',
                  },
                },
              },
            ],
            error: null,
          });
        }

        if (table === 'integration_audit_log') {
          return Promise.resolve({
            data: [
              {
                id: 'audit-1',
                import_file_id: 'imp-1',
                event_type: 'operations_ia_item_created',
                status: 'success',
                message: 'Operacao criada com sucesso.',
                details: {
                  operation_id: 123,
                  user_id: 'user-audit',
                  program_hint: 'SOI',
                },
                created_at: '2026-03-29T11:05:00.000Z',
                created_by: 'user-audit',
                source: 'disecurit',
              },
              {
                id: 'audit-2',
                import_file_id: 'imp-1',
                event_type: 'unrelated_event',
                status: 'info',
                message: 'Nao deve entrar',
                details: {},
                created_at: '2026-03-29T10:00:00.000Z',
                created_by: 'user-audit',
                source: 'disecurit',
              },
            ],
            error: null,
          });
        }

        if (table === 'operation_import_extraction_history') {
          return Promise.resolve({
            data: [
              {
                id: 'hist-1',
                import_file_id: 'imp-1',
                line_index: null,
                field_name: 'soi_valor_desagio',
                status: 'corrected',
                source_method: 'manual',
                conflict_flag: false,
                raw_value: '20,00',
                normalized_value: 20,
                metadata: {
                  phase: 'confirm',
                  event_type: 'manual_field_corrected',
                  item_id: 'item:imp-1',
                },
                created_at: '2026-03-29T11:10:00.000Z',
                actor_user_id: 'user-history',
              },
            ],
            error: null,
          });
        }

        return Promise.resolve({ data: [], error: null });
      },
    };

    return chain;
  };

  return {
    from: vi.fn((table: string) => queryBuilder(table)),
  };
}

describe('api_legacy/operacoes-ia/history', () => {
  afterEach(() => {
    getAdminClientMock.mockReset();
    vi.restoreAllMocks();
  });

  it('retorna consolidado de imports, auditoria e historico tecnico', async () => {
    getAdminClientMock.mockReturnValue(createAdminClientMock());

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token-123' },
      query: {
        date: '2026-03-29',
        limit: '100',
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);

    const payload = res.payload as {
      ok: boolean;
      data: {
        summary: {
          total: number;
          created: number;
          corrections: number;
          imports: number;
        };
        events: Array<{ tipo_evento: string }>;
      };
    };

    expect(payload.ok).toBe(true);
    expect(payload.data.events).toHaveLength(3);
    expect(payload.data.events[0]?.tipo_evento).toBe('manual_field_corrected');
    expect(payload.data.summary).toMatchObject({
      total: 3,
      created: 1,
      corrections: 1,
      imports: 1,
    });
  });

  it('retorna 405 para metodo diferente de GET', async () => {
    getAdminClientMock.mockReturnValue(createAdminClientMock());

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      query: {},
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(405);
  });
});
