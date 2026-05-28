import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  buildInsertPayloadFromConfirmItemMock,
  buildOperationImportDocumentRowsMock,
  clampPercentMock,
  evaluateConfirmPayloadIssuesMock,
  evaluateDuplicateFlagsMock,
  normalizeComparableTextMock,
  safeInsertIntegrationAuditLogMock,
  summarizeDuplicateFlagsMock,
  toDateOnlyMock,
  toNumberMock,
  getAdminClientMock,
  buildManualCorrectionRowsFromPayloadMock,
  insertExtractionHistoryRowsMock,
  normalizeExtractionDiagnosticsFromPayloadMock,
  isConflictOverrideDuplicateTestEnabledMock,
  isDuplicateTestModeEnabledMock,
  resolveDuplicateOriginImportMock,
  refreshSoiOriginPayloadIfNeededMock,
} = vi.hoisted(() => ({
  buildInsertPayloadFromConfirmItemMock: vi.fn(() => ({
    historico: 'payload',
    liquido_operacao: 1100,
  })),
  buildOperationImportDocumentRowsMock: vi.fn(() => []),
  clampPercentMock: vi.fn((value: number) => Math.max(0, Math.min(1, value))),
  evaluateConfirmPayloadIssuesMock: vi.fn(() => []),
  evaluateDuplicateFlagsMock: vi.fn(() => ({
    importAlreadyLinked: false,
    hashAlreadyLinked: false,
    operationNumberAlreadyExists: false,
  })),
  normalizeComparableTextMock: vi.fn((value?: string | null) =>
    String(value || '')
      .toLowerCase()
      .trim()
  ),
  safeInsertIntegrationAuditLogMock: vi.fn(async () => null),
  summarizeDuplicateFlagsMock: vi.fn(() => []),
  toDateOnlyMock: vi.fn((value: string | null | undefined) => value || null),
  toNumberMock: vi.fn((value: unknown) => {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value);
    return null;
  }),
  getAdminClientMock: vi.fn(),
  buildManualCorrectionRowsFromPayloadMock: vi.fn(() => []),
  insertExtractionHistoryRowsMock: vi.fn(async () => null),
  normalizeExtractionDiagnosticsFromPayloadMock: vi.fn(() => []),
  isConflictOverrideDuplicateTestEnabledMock: vi.fn(() => false),
  isDuplicateTestModeEnabledMock: vi.fn(() => false),
  resolveDuplicateOriginImportMock: vi.fn(async () => ({
    duplicate_origin_import_file_id: 'imp-source',
    duplicate_hydration_status: 'hydrated',
    duplicate_hydration_resolution_method: 'audit',
    source_import_row: {
      id: 'imp-source',
      empresa_id: 'empresa-1',
      source: 'disecurit',
      parse_status: 'parsed',
      parsed_payload: { document: { operation_number: 'SRC-1' }, values: { face_value: 1200, net_value: 1100 } },
      linked_operacao_id: null,
      operation_number: 'SRC-1',
      original_filename: 'source.pdf',
      file_sha256: 'hash-src',
      program_hint: 'SOI',
      created_at: '2026-03-24T00:00:00.000Z',
    },
    resolution_method: 'audit',
  })),
  refreshSoiOriginPayloadIfNeededMock: vi.fn(async (_client: unknown, row: unknown) => ({
    row,
    status: 'ok',
  })),
}));

vi.mock('../../src/server/operacoes-ia/core.js', () => ({
  buildInsertPayloadFromConfirmItem: buildInsertPayloadFromConfirmItemMock,
  buildOperationImportDocumentRows: buildOperationImportDocumentRowsMock,
  clampPercent: clampPercentMock,
  evaluateConfirmPayloadIssues: evaluateConfirmPayloadIssuesMock,
  evaluateDuplicateFlags: evaluateDuplicateFlagsMock,
  isConflictOverrideDuplicateTestEnabled: isConflictOverrideDuplicateTestEnabledMock,
  isDuplicateTestModeEnabled: isDuplicateTestModeEnabledMock,
  normalizeComparableText: normalizeComparableTextMock,
  resolveDuplicateOriginImport: resolveDuplicateOriginImportMock,
  refreshSoiOriginPayloadIfNeeded: refreshSoiOriginPayloadIfNeededMock,
  safeInsertIntegrationAuditLog: safeInsertIntegrationAuditLogMock,
  summarizeDuplicateFlags: summarizeDuplicateFlagsMock,
  toDateOnly: toDateOnlyMock,
  toNumber: toNumberMock,
}));

vi.mock('../../src/server/operacoes-ia/extractionHistory.js', () => ({
  buildManualCorrectionRowsFromPayload: buildManualCorrectionRowsFromPayloadMock,
  insertExtractionHistoryRows: insertExtractionHistoryRowsMock,
  normalizeExtractionDiagnosticsFromPayload: normalizeExtractionDiagnosticsFromPayloadMock,
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

import handler from './confirm';

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

function createConfirmAdminClientMock(options?: {
  failIncrement?: boolean;
  failLancamento?: boolean;
  parseStatusImp1?: string;
}) {
  let createdOperationId = 8000;
  let createdLancamentoId = 9000;

  const operationImportUpdateChain: {
    eq: () => typeof operationImportUpdateChain;
    then: (resolve: (value: { error: null }) => void, reject?: (reason?: unknown) => void) => Promise<void>;
  } = {
    eq: () => operationImportUpdateChain,
    then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
  };

  const operationImportChain: {
    select: () => typeof operationImportChain;
    eq: () => typeof operationImportChain;
    in: () => Promise<{ data: unknown[]; error: null }>;
    update: () => typeof operationImportUpdateChain;
  } = {
    select: () => operationImportChain,
    eq: () => operationImportChain,
    in: () =>
      Promise.resolve({
        data: [
              {
                id: 'imp-1',
                empresa_id: 'empresa-1',
                source: 'disecurit',
                parse_status: options?.parseStatusImp1 || 'parsed',
            parsed_payload: {},
            linked_operacao_id: null,
            operation_number: null,
            original_filename: 'import-1.pdf',
            file_sha256: null,
            program_hint: 'SOI',
            created_at: '2026-03-25T00:00:00.000Z',
          },
          {
            id: 'imp-2',
            empresa_id: 'empresa-1',
            source: 'disecurit',
            parse_status: 'parsed',
            parsed_payload: {},
            linked_operacao_id: null,
            operation_number: null,
            original_filename: 'import-2.pdf',
            file_sha256: null,
            program_hint: 'SOI',
            created_at: '2026-03-25T00:00:00.000Z',
          },
        ],
        error: null,
      }),
    update: () => operationImportUpdateChain,
  };

  const fornecedoresChain = {
    select: () => fornecedoresChain,
    eq: () => fornecedoresChain,
    in: () =>
      Promise.resolve({
        data: [{ id: 'fornecedor-1', razao_social: 'Fornecedor 1', nome_fantasia: null, cnpj: '123', status: true }],
        error: null,
      }),
  };

  const contasBancariasChain = {
    select: () => contasBancariasChain,
    eq: () => contasBancariasChain,
    in: () =>
      Promise.resolve({
        data: [{ id: 'conta-1', descricao: 'SB-S0I2', status: true }],
        error: null,
      }),
  };

  const estoquesChain = {
    select: () => estoquesChain,
    eq: () => estoquesChain,
    in: () => Promise.resolve({ data: [{ id: 10, tipo: 'SOI', descricao: 'SOI', ativo: true }], error: null }),
  };

  const operacoesInsertSelectChain = {
    single: () =>
      Promise.resolve({
        data: { id: createdOperationId++ },
        error: null,
      }),
  };

  const operacoesInsertChain = {
    select: () => operacoesInsertSelectChain,
  };

  const operacoesDeleteChain = {
    eq: () => operacoesDeleteChain,
    then: (resolve: (value: { error: null }) => void, reject?: (reason?: unknown) => void) =>
      Promise.resolve({ error: null }).then(resolve, reject),
  };

  const operacoesChain = {
    select: () => operacoesChain,
    eq: () => operacoesChain,
    in: () => Promise.resolve({ data: [], error: null }),
    insert: () => operacoesInsertChain,
    delete: () => operacoesDeleteChain,
  };

  const lancamentosInsertSelectChain = {
    single: () =>
      options?.failLancamento
        ? Promise.resolve({ data: null, error: { message: 'erro lancamento' } })
        : Promise.resolve({
            data: { id: `lanc-${createdLancamentoId++}` },
            error: null,
          }),
  };

  const lancamentosInsertChain = {
    select: () => lancamentosInsertSelectChain,
  };

  const lancamentosDeleteChain = {
    eq: () => lancamentosDeleteChain,
    then: (resolve: (value: { error: null }) => void, reject?: (reason?: unknown) => void) =>
      Promise.resolve({ error: null }).then(resolve, reject),
  };

  const lancamentosChain = {
    insert: () => lancamentosInsertChain,
    delete: () => lancamentosDeleteChain,
  };

  const docsChain = {
    insert: () => Promise.resolve({ data: null, error: null }),
  };

  return {
    from: vi.fn((table: string) => {
      if (table === 'operation_import_files') return operationImportChain;
      if (table === 'fornecedores') return fornecedoresChain;
      if (table === 'contas_bancarias') return contasBancariasChain;
      if (table === 'estoques') return estoquesChain;
      if (table === 'operacoes_estoque') return operacoesChain;
      if (table === 'lancamentos_caixa') return lancamentosChain;
      if (table === 'operation_import_documents') return docsChain;
      throw new Error(`Tabela não mapeada no mock: ${table}`);
    }),
    rpc: vi.fn((fn: string) => {
      if (fn === 'increment_bigint') {
        if (options?.failIncrement) {
          return Promise.resolve({ data: null, error: { message: 'erro increment' } });
        }
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

const basePayload = {
  program: 'SOI' as const,
  estoque_id: 10,
  fornecedor_id: 'fornecedor-1',
  fornecedor_match_method: 'manual' as const,
  conta_bancaria_id: 'conta-1',
  data_operacao: '2026-03-25',
  documento: null,
  historico: 'Importado',
  face_titulos: 1200,
  valor_compra: 1100,
  despesas: 0,
  recompra: 0,
  ad_valorem: 0,
  iss: 0,
  iof: 0,
  iof_adicional: 0,
  amortizacao_debitos: 0,
  amortizacao_creditos: 0,
};

describe('api_legacy/operacoes-ia/confirm', () => {
  afterEach(() => {
    evaluateConfirmPayloadIssuesMock.mockReset();
    evaluateDuplicateFlagsMock.mockReset();
    summarizeDuplicateFlagsMock.mockReset();
    safeInsertIntegrationAuditLogMock.mockClear();
    buildManualCorrectionRowsFromPayloadMock.mockReset();
    insertExtractionHistoryRowsMock.mockReset();
    normalizeExtractionDiagnosticsFromPayloadMock.mockReset();
    isConflictOverrideDuplicateTestEnabledMock.mockClear();
    isDuplicateTestModeEnabledMock.mockClear();
    resolveDuplicateOriginImportMock.mockClear();
    refreshSoiOriginPayloadIfNeededMock.mockClear();
    getAdminClientMock.mockReset();
    vi.restoreAllMocks();
  });

  it('confirma lote com sucesso total quando itens estão válidos', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock());
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: false,
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 1,
        failed: 0,
      },
    });
    expect(buildManualCorrectionRowsFromPayloadMock).toHaveBeenCalledTimes(1);
    expect(insertExtractionHistoryRowsMock).toHaveBeenCalled();
  });

  it('retorna confirmação parcial quando há item inválido sem fornecedor', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock());
    evaluateConfirmPayloadIssuesMock.mockImplementation((payload: { fornecedor_id?: string | null }) => {
      if (!payload.fornecedor_id) return ['Fornecedor não identificado. Item deve permanecer em revisão.'];
      return [];
    });
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: false,
            payload: basePayload,
          },
          {
            item_id: 'item-2',
            import_file_id: 'imp-2',
            decision: 'confirm',
            force_create: false,
            payload: {
              ...basePayload,
              fornecedor_id: null,
            },
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 2,
        created: 1,
        failed: 1,
      },
    });
  });

  it('permite duplicidade com force_create quando justificativa é informada', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock());
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: true,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue(['Hash de arquivo já vinculado.']);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: true,
            force_create_reason: 'Mesmo contrato, novo processamento aprovado.',
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 1,
        failed: 0,
      },
      results: [
        expect.objectContaining({
          status: 'created',
        }),
      ],
    });
  });

  it('bloqueia force_create sem justificativa quando há duplicidade sobreponível', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock());
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: true,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue(['Hash de arquivo já vinculado.']);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: true,
            force_create_reason: '',
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 0,
        failed: 1,
      },
      results: [
        expect.objectContaining({
          status: 'failed',
          message: 'force_create exige justificativa obrigatória.',
        }),
      ],
    });
  });

  it('ignora automaticamente item duplicate quando modo teste está desativado', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock({ parseStatusImp1: 'duplicate' }));
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);
    isDuplicateTestModeEnabledMock.mockReturnValue(false);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: false,
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 0,
        ignored: 1,
        failed: 0,
      },
      results: [
        expect.objectContaining({
          status: 'ignored',
          message: expect.stringContaining('ignorado automaticamente em produção'),
        }),
      ],
    });

    expect(safeInsertIntegrationAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        event_type: 'operations_ia_duplicate_auto_ignored_production',
      })
    );
  });

  it('em modo teste preenche justificativa automática quando duplicate está sem motivo', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock({ parseStatusImp1: 'duplicate' }));
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);
    isDuplicateTestModeEnabledMock.mockReturnValue(true);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: true,
            force_create_reason: '',
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 1,
        failed: 0,
      },
    });
  });

  it('em modo teste permite duplicate com force_create e justificativa', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock({ parseStatusImp1: 'duplicate' }));
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);
    isDuplicateTestModeEnabledMock.mockReturnValue(true);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: true,
            force_create_reason: 'Teste controlado de duplicate em preview.',
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 1,
        failed: 0,
      },
    });
  });

  it('em modo teste bloqueia duplicate quando origem confiável não é encontrada', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock({ parseStatusImp1: 'duplicate' }));
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);
    isDuplicateTestModeEnabledMock.mockReturnValue(true);
    resolveDuplicateOriginImportMock.mockResolvedValueOnce({
      duplicate_origin_import_file_id: null,
      duplicate_hydration_status: 'missing',
      duplicate_hydration_resolution_method: 'none',
      source_import_row: null,
      resolution_method: 'none',
    });

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: true,
            force_create_reason: 'Teste controlado',
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 0,
        failed: 1,
      },
      results: [
        expect.objectContaining({
          status: 'failed',
          duplicate_detected: true,
          message: expect.stringContaining('origem confiável'),
        }),
      ],
    });
  });

  it('bloqueia confirmação quando conflito crítico de extração não foi revisado', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock());
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);
    normalizeExtractionDiagnosticsFromPayloadMock.mockReturnValue([
      {
        field_name: 'face_value',
        resolved_value: 1000,
        source_method: 'regex',
        confidence: 0.9,
        conflict_flag: true,
        critical: true,
        reason: 'Candidatos divergentes',
        compared_value: 1000,
        tolerance: 0.5,
        difference: 200,
        candidates: [{ value: 1000, raw_value: '1.000,00', source_method: 'regex', confidence: 0.9 }],
      },
    ]);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: false,
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 0,
        failed: 1,
      },
      results: [
        expect.objectContaining({
          status: 'failed',
          message: expect.stringContaining('Conflito crítico de extração'),
        }),
      ],
    });
  });

  it('em modo teste permite override de conflito crítico para duplicate com force_create', async () => {
    getAdminClientMock.mockReturnValue(createConfirmAdminClientMock({ parseStatusImp1: 'duplicate' }));
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);
    isDuplicateTestModeEnabledMock.mockReturnValue(true);
    isConflictOverrideDuplicateTestEnabledMock.mockReturnValue(true);
    normalizeExtractionDiagnosticsFromPayloadMock.mockReturnValue([
      {
        field_name: 'net_value',
        resolved_value: 980,
        source_method: 'regex',
        confidence: 0.91,
        conflict_flag: true,
        critical: true,
        reason: 'Conflito em líquido',
        compared_value: 980,
        tolerance: 0.5,
        difference: 100,
        candidates: [{ value: 980, raw_value: '980,00', source_method: 'regex', confidence: 0.91 }],
      },
    ]);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: true,
            force_create_reason: 'Aceite operacional temporário',
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 1,
        failed: 0,
      },
    });
  });

  it('faz compensação quando falha ao criar lançamento de caixa', async () => {
    const adminClientMock = createConfirmAdminClientMock({ failLancamento: true });
    getAdminClientMock.mockReturnValue(adminClientMock);
    evaluateConfirmPayloadIssuesMock.mockReturnValue([]);
    evaluateDuplicateFlagsMock.mockReturnValue({
      importAlreadyLinked: false,
      hashAlreadyLinked: false,
      operationNumberAlreadyExists: false,
    });
    summarizeDuplicateFlagsMock.mockReturnValue([]);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token-123' },
      body: {
        items: [
          {
            item_id: 'item-1',
            import_file_id: 'imp-1',
            decision: 'confirm',
            force_create: false,
            payload: basePayload,
          },
        ],
      },
    };
    const res = createMockResponse();

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({
      ok: true,
      summary: {
        total: 1,
        created: 0,
        failed: 1,
      },
      results: [
        expect.objectContaining({
          status: 'failed',
        }),
      ],
    });

    expect(adminClientMock.rpc).toHaveBeenCalledWith(
      'increment_bigint',
      expect.objectContaining({
        table_name: 'estoques',
        amount: 1200,
      })
    );
    expect(adminClientMock.rpc).toHaveBeenCalledWith(
      'increment_bigint',
      expect.objectContaining({
        table_name: 'estoques',
        amount: -1200,
      })
    );
  });
});
