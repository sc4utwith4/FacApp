import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  buildDraftItemFromImportMock,
  safeInsertIntegrationAuditLogMock,
  getAdminClientMock,
  groupHistoryTimelineByImportMock,
  insertExtractionHistoryRowsMock,
  normalizeExtractionDiagnosticsFromPayloadMock,
  buildHistoryRowsFromDiagnosticsMock,
  isConflictOverrideDuplicateTestEnabledMock,
  isDuplicateTestModeEnabledMock,
  resolveDuplicateOriginImportMock,
  refreshSoiOriginPayloadIfNeededMock,
} = vi.hoisted(() => ({
  buildDraftItemFromImportMock: vi.fn(),
  safeInsertIntegrationAuditLogMock: vi.fn(async () => null),
  getAdminClientMock: vi.fn(),
  groupHistoryTimelineByImportMock: vi.fn(() => new Map()),
  insertExtractionHistoryRowsMock: vi.fn(async () => null),
  normalizeExtractionDiagnosticsFromPayloadMock: vi.fn(() => []),
  buildHistoryRowsFromDiagnosticsMock: vi.fn(() => []),
  isConflictOverrideDuplicateTestEnabledMock: vi.fn(() => false),
  isDuplicateTestModeEnabledMock: vi.fn(() => false),
  resolveDuplicateOriginImportMock: vi.fn(async () => ({
    duplicate_origin_import_file_id: null,
    duplicate_hydration_status: 'missing',
    duplicate_hydration_resolution_method: 'none',
    source_import_row: null,
    resolution_method: 'none',
  })),
  refreshSoiOriginPayloadIfNeededMock: vi.fn(async (_client: unknown, row: unknown) => ({
    row,
    status: 'ok',
  })),
}));

vi.mock('../../src/server/operacoes-ia/core.js', () => ({
  buildDraftItemFromImport: buildDraftItemFromImportMock,
  safeInsertIntegrationAuditLog: safeInsertIntegrationAuditLogMock,
  isConflictOverrideDuplicateTestEnabled: isConflictOverrideDuplicateTestEnabledMock,
  isDuplicateTestModeEnabled: isDuplicateTestModeEnabledMock,
  resolveDuplicateOriginImport: resolveDuplicateOriginImportMock,
  refreshSoiOriginPayloadIfNeeded: refreshSoiOriginPayloadIfNeededMock,
}));

vi.mock('../../src/server/operacoes-ia/extractionHistory.js', () => ({
  groupHistoryTimelineByImport: groupHistoryTimelineByImportMock,
  insertExtractionHistoryRows: insertExtractionHistoryRowsMock,
  normalizeExtractionDiagnosticsFromPayload: normalizeExtractionDiagnosticsFromPayloadMock,
  buildHistoryRowsFromDiagnostics: buildHistoryRowsFromDiagnosticsMock,
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
  parseJsonBody: vi.fn((req: { body?: unknown }) => req.body),
  verifyTokenAndGetEmpresaId: vi.fn(async () => ({
    empresaId: 'empresa-1',
    userId: 'user-1',
  })),
}));

import handler from './preview';

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

function createPreviewAdminClientMock(options?: { parseStatusImp1?: string; parsedPayloadImp1?: Record<string, unknown> }) {
  const queryBuilder = (table: string) => {
    let historyStage = false;
    const chain: {
      select: () => typeof chain;
      eq: () => typeof chain;
      in: () => Promise<{ data: unknown[]; error: null }> | typeof chain;
      order: () => Promise<{ data: unknown[]; error: null }> | typeof chain;
      limit: () => Promise<{ data: unknown[]; error: null }>;
    } = {
      select: () => chain,
      eq: () => chain,
      in: () => {
        if (table === 'operation_import_files') {
          return Promise.resolve({
            data: [
              {
                id: 'imp-1',
                empresa_id: 'empresa-1',
                source: 'disecurit',
                parse_status: options?.parseStatusImp1 || 'parsed',
                parsed_payload: options?.parsedPayloadImp1 ?? {},
                linked_operacao_id: null,
                operation_number: 'OP-1',
                original_filename: 'import-1.pdf',
                file_sha256: 'hash-1',
                program_hint: 'SOI',
                created_at: '2026-03-25T00:00:00.000Z',
              },
            ],
            error: null,
          });
        }
        if (table === 'operation_import_extraction_history') {
          historyStage = true;
          return chain;
        }
        return Promise.resolve({ data: [], error: null });
      },
      order: () => {
        if (table === 'operation_import_extraction_history' && historyStage) {
          return chain;
        }
        if (table === 'fornecedores') {
          return Promise.resolve({
            data: [{ id: 'fornecedor-1', razao_social: 'Fornecedor 1', nome_fantasia: null, cnpj: '123', status: true }],
            error: null,
          });
        }
        if (table === 'estoques') {
          return Promise.resolve({
            data: [{ id: 10, tipo: 'SOI', descricao: 'SOI', ativo: true }],
            error: null,
          });
        }
        if (table === 'contas_bancarias') {
          return Promise.resolve({
            data: [{ id: 'conta-1', descricao: 'Conta principal SB-S0I2', status: true }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
      limit: () => {
        if (table === 'operation_import_extraction_history') {
          return Promise.resolve({ data: [], error: null });
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

describe('api_legacy/operacoes-ia/preview', () => {
  afterEach(() => {
    buildDraftItemFromImportMock.mockReset();
    safeInsertIntegrationAuditLogMock.mockClear();
    getAdminClientMock.mockReset();
    groupHistoryTimelineByImportMock.mockReset();
    insertExtractionHistoryRowsMock.mockReset();
    normalizeExtractionDiagnosticsFromPayloadMock.mockReset();
    buildHistoryRowsFromDiagnosticsMock.mockReset();
    isConflictOverrideDuplicateTestEnabledMock.mockReset();
    isDuplicateTestModeEnabledMock.mockClear();
    resolveDuplicateOriginImportMock.mockReset();
    refreshSoiOriginPayloadIfNeededMock.mockReset();
    vi.restoreAllMocks();
  });

  it('gera preview com item pronto quando build do draft retorna ready', async () => {
    getAdminClientMock.mockReturnValue(createPreviewAdminClientMock());
    buildDraftItemFromImportMock.mockImplementation((row: { id: string }) => ({
      id: `item:${row.id}`,
      import_file_id: row.id,
      source_type: 'disecurit_pdf',
      parse_status: 'parsed',
      original_filename: 'import-1.pdf',
      operation_number: 'OP-1',
      file_sha256: 'hash-1',
      linked_operacao_id: null,
      program: 'SOI',
      estoque_id: 10,
      fornecedor_id: 'fornecedor-1',
      fornecedor_match_method: 'cnpj',
      fornecedor_match_confidence: 1,
      conta_bancaria_id: 'conta-1',
      data_operacao: '2026-03-25',
      documento: 'OP-1',
      historico: 'Importado',
      face_titulos: 1000,
      valor_compra: 980,
      despesas: 0,
      recompra: 0,
      ad_valorem: 0,
      iss: 0,
      iof: 0,
      iof_adicional: 0,
      amortizacao_debitos: 0,
      amortizacao_creditos: 0,
      raw_pdf_snapshot: [],
      extraction_diagnostics: [],
      has_critical_conflict: false,
      history_timeline: [],
      status: 'ready',
      issues: [],
    }));

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        import_file_ids: ['imp-1'],
        reference_date: '2026-03-25',
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        ready: 1,
        review: 0,
        error: 0,
      },
      default_conta_bancaria_id: 'conta-1',
      meta: {
        duplicate_test_mode_enabled: false,
      },
    });
    expect(buildDraftItemFromImportMock).toHaveBeenCalledTimes(1);
  });

  it('mantém item em revisão quando fornecedor não é encontrado', async () => {
    getAdminClientMock.mockReturnValue(createPreviewAdminClientMock());
    buildDraftItemFromImportMock.mockImplementation((row: { id: string }) => ({
      id: `item:${row.id}`,
      import_file_id: row.id,
      source_type: 'disecurit_pdf',
      parse_status: 'parsed',
      original_filename: 'import-1.pdf',
      operation_number: 'OP-1',
      file_sha256: 'hash-1',
      linked_operacao_id: null,
      program: 'SOI',
      estoque_id: 10,
      fornecedor_id: null,
      fornecedor_match_method: 'none',
      fornecedor_match_confidence: null,
      conta_bancaria_id: 'conta-1',
      data_operacao: '2026-03-25',
      documento: 'OP-1',
      historico: 'Importado',
      face_titulos: 1000,
      valor_compra: 980,
      despesas: 0,
      recompra: 0,
      ad_valorem: 0,
      iss: 0,
      iof: 0,
      iof_adicional: 0,
      amortizacao_debitos: 0,
      amortizacao_creditos: 0,
      raw_pdf_snapshot: [],
      extraction_diagnostics: [],
      has_critical_conflict: false,
      history_timeline: [],
      status: 'review',
      issues: ['Fornecedor não identificado. Item deve permanecer em revisão.'],
    }));

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        import_file_ids: ['imp-1'],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        ready: 0,
        review: 1,
      },
    });
  });

  it('hidrata duplicate no modo teste com payload da origem e mantém semântica duplicate', async () => {
    const adminClient = createPreviewAdminClientMock({
      parseStatusImp1: 'duplicate',
      parsedPayloadImp1: {},
    });
    getAdminClientMock.mockReturnValue(adminClient);
    isDuplicateTestModeEnabledMock.mockReturnValue(true);
    resolveDuplicateOriginImportMock.mockResolvedValue({
      duplicate_origin_import_file_id: 'imp-origin',
      duplicate_hydration_status: 'hydrated',
      duplicate_hydration_resolution_method: 'audit',
      source_import_row: {
        id: 'imp-origin',
        empresa_id: 'empresa-1',
        source: 'disecurit',
        parse_status: 'parsed',
        parsed_payload: { document: { operation_number: 'ORIG-1' }, values: { face_value: 1000, net_value: 980 } },
        linked_operacao_id: null,
        operation_number: 'ORIG-1',
        original_filename: 'origin.pdf',
        file_sha256: 'hash-origin',
        program_hint: 'SOI',
        created_at: '2026-03-24T00:00:00.000Z',
      },
      resolution_method: 'audit',
    });

    buildDraftItemFromImportMock.mockImplementation((row: { id: string }) => ({
      id: `item:${row.id}`,
      import_file_id: row.id,
      source_type: 'disecurit_pdf',
      parse_status: 'parsed',
      original_filename: 'origin.pdf',
      operation_number: 'ORIG-1',
      file_sha256: 'hash-origin',
      linked_operacao_id: null,
      program: 'SOI',
      estoque_id: 10,
      fornecedor_id: 'fornecedor-1',
      fornecedor_match_method: 'cnpj',
      fornecedor_match_confidence: 1,
      conta_bancaria_id: 'conta-1',
      data_operacao: '2026-03-25',
      documento: 'ORIG-1',
      historico: 'Importado',
      face_titulos: 1000,
      valor_compra: 980,
      despesas: 0,
      recompra: 0,
      ad_valorem: 0,
      iss: 0,
      iof: 0,
      iof_adicional: 0,
      amortizacao_debitos: 0,
      amortizacao_creditos: 0,
      raw_pdf_snapshot: [],
      extraction_diagnostics: [],
      has_critical_conflict: false,
      history_timeline: [],
      status: 'ready',
      issues: [],
    }));

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        import_file_ids: ['imp-1'],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      meta: { duplicate_test_mode_enabled: true },
      items: [
        expect.objectContaining({
          import_file_id: 'imp-1',
          parse_status: 'duplicate',
          duplicate_origin_import_file_id: 'imp-origin',
          duplicate_hydration_status: 'hydrated',
          status: 'review',
        }),
      ],
    });
  });

  it('mantém duplicate bloqueado quando origem de hidratação não é encontrada', async () => {
    getAdminClientMock.mockReturnValue(
      createPreviewAdminClientMock({
        parseStatusImp1: 'duplicate',
        parsedPayloadImp1: {},
      })
    );
    isDuplicateTestModeEnabledMock.mockReturnValue(true);
    resolveDuplicateOriginImportMock.mockResolvedValue({
      duplicate_origin_import_file_id: null,
      duplicate_hydration_status: 'missing',
      duplicate_hydration_resolution_method: 'none',
      source_import_row: null,
      resolution_method: 'none',
    });
    buildDraftItemFromImportMock.mockImplementation((row: { id: string }) => ({
      id: `item:${row.id}`,
      import_file_id: row.id,
      source_type: 'disecurit_pdf',
      parse_status: 'duplicate',
      original_filename: 'dup.pdf',
      operation_number: null,
      file_sha256: null,
      linked_operacao_id: null,
      program: 'SOI',
      estoque_id: null,
      fornecedor_id: null,
      fornecedor_match_method: 'none',
      fornecedor_match_confidence: null,
      conta_bancaria_id: null,
      data_operacao: null,
      documento: null,
      historico: null,
      face_titulos: null,
      valor_compra: null,
      despesas: 0,
      recompra: 0,
      ad_valorem: 0,
      iss: 0,
      iof: 0,
      iof_adicional: 0,
      amortizacao_debitos: 0,
      amortizacao_creditos: 0,
      raw_pdf_snapshot: [],
      extraction_diagnostics: [],
      has_critical_conflict: false,
      history_timeline: [],
      status: 'review',
      issues: [],
    }));

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        import_file_ids: ['imp-1'],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      items: [
        expect.objectContaining({
          parse_status: 'duplicate',
          duplicate_hydration_status: 'missing',
          status: 'review',
          issues: expect.arrayContaining([expect.stringContaining('sem origem confiável')]),
        }),
      ],
    });
  });

  it('mantém duplicate bloqueado quando origem existe mas está stale', async () => {
    getAdminClientMock.mockReturnValue(
      createPreviewAdminClientMock({
        parseStatusImp1: 'duplicate',
        parsedPayloadImp1: {},
      })
    );
    isDuplicateTestModeEnabledMock.mockReturnValue(true);
    resolveDuplicateOriginImportMock.mockResolvedValue({
      duplicate_origin_import_file_id: 'imp-origin',
      duplicate_hydration_status: 'hydrated',
      duplicate_hydration_resolution_method: 'audit',
      source_import_row: {
        id: 'imp-origin',
        empresa_id: 'empresa-1',
        source: 'disecurit',
        parse_status: 'parsed',
        parsed_payload: { document: { operation_number: 'ORIG-STALE' } },
        linked_operacao_id: null,
        operation_number: 'ORIG-STALE',
        original_filename: 'origin-stale.pdf',
        file_sha256: 'hash-origin-stale',
        program_hint: 'SOI',
        created_at: '2026-03-24T00:00:00.000Z',
      },
      resolution_method: 'audit',
    });
    refreshSoiOriginPayloadIfNeededMock.mockResolvedValue({
      row: {
        id: 'imp-origin',
        empresa_id: 'empresa-1',
        source: 'disecurit',
        parse_status: 'parsed',
        parsed_payload: { document: { operation_number: 'ORIG-STALE' } },
        linked_operacao_id: null,
        operation_number: 'ORIG-STALE',
        original_filename: 'origin-stale.pdf',
        file_sha256: 'hash-origin-stale',
        program_hint: 'SOI',
        created_at: '2026-03-24T00:00:00.000Z',
      },
      refreshed: false,
      status: 'source_stale',
    });
    buildDraftItemFromImportMock.mockImplementation((row: { id: string }) => ({
      id: `item:${row.id}`,
      import_file_id: row.id,
      source_type: 'disecurit_pdf',
      parse_status: 'duplicate',
      original_filename: 'dup.pdf',
      operation_number: null,
      file_sha256: null,
      linked_operacao_id: null,
      program: 'SOI',
      estoque_id: null,
      fornecedor_id: null,
      fornecedor_match_method: 'none',
      fornecedor_match_confidence: null,
      conta_bancaria_id: null,
      data_operacao: null,
      documento: null,
      historico: null,
      face_titulos: null,
      valor_compra: null,
      despesas: 0,
      recompra: 0,
      ad_valorem: 0,
      iss: 0,
      iof: 0,
      iof_adicional: 0,
      amortizacao_debitos: 0,
      amortizacao_creditos: 0,
      raw_pdf_snapshot: [],
      extraction_diagnostics: [],
      has_critical_conflict: false,
      history_timeline: [],
      status: 'review',
      issues: [],
    }));

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        import_file_ids: ['imp-1'],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      items: [
        expect.objectContaining({
          parse_status: 'duplicate',
          duplicate_hydration_status: 'missing',
          status: 'review',
          issues: expect.arrayContaining([expect.stringContaining('sem origem confiável')]),
        }),
      ],
    });
  });
});
