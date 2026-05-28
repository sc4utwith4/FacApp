import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperacoesIaIndex from '../Index';

/** Compatível com callOperacoesIaApi (response.text + Content-Type JSON). */
function mockApiResponse(ok: boolean, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  return {
    ok,
    status,
    headers: {
      get: (header: string) =>
        String(header).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null,
    },
    text: async () => body,
    json: async () => JSON.parse(body),
  };
}

const uploadImportMutationMock = {
  mutateAsync: vi.fn(),
  isPending: false,
};

const importsFixture = [
  {
    id: 'imp-1',
    original_filename: 'import-1.pdf',
    operation_number: 'OP-1',
    parse_status: 'parsed',
    linked_operacao_id: null,
  },
];

vi.mock('@/hooks/useDisecuritImport', () => ({
  useDisecuritImport: vi.fn(() => ({
    importsQuery: {
      data: importsFixture,
      isFetching: false,
    },
    uploadImportMutation: uploadImportMutationMock,
  })),
  normalizeCnpjValue: vi.fn((value?: string | null) => String(value || '').replace(/\D/g, '')),
}));

vi.mock('@/hooks/useFornecedores', () => ({
  useFornecedoresSelect: vi.fn(() => ({
    data: [{ id: 'fornecedor-1', razao_social: 'Fornecedor 1' }],
  })),
}));

vi.mock('@/hooks/useEstoque', () => ({
  useEstoquesSelect: vi.fn(() => ({
    data: [{ id: 10, tipo: 'SOI', descricao: 'SOI Principal' }],
  })),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: { access_token: 'token-123' },
        },
      })),
    },
  },
}));

describe('/operacoes/ia - Index', () => {
  beforeEach(() => {
    importsFixture[0].parse_status = 'parsed';
    uploadImportMutationMock.mutateAsync.mockResolvedValue({
      importRow: { id: 'imp-1' },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('envia fila, gera preview e muda para filtro Falhas após confirmação parcial', async () => {
    const user = userEvent.setup();

    const previewResponse = {
      ok: true,
      batch_id: 'opsia_batch_1',
      generated_at: '2026-03-25T10:00:00.000Z',
      contas_bancarias: [{ id: 'conta-1', descricao: 'SB-S0I2' }],
      default_conta_bancaria_id: 'conta-1',
      summary: {
        total: 1,
        ready: 1,
        review: 0,
        error: 0,
        linked: 0,
        auto_supplier_suggested: 0,
      },
      items: [
        {
          id: 'item:imp-1',
          import_file_id: 'imp-1',
          source_type: 'disecurit_pdf',
          parse_status: 'parsed',
          original_filename: 'import-1.pdf',
          operation_number: 'OP-1',
          file_sha256: 'hash-1',
          linked_operacao_id: null,
          program: 'SOI',
          estoque_id: 10,
          fornecedor_id: 'fornecedor-1',
          fornecedor_match_method: 'manual',
          fornecedor_match_confidence: null,
          conta_bancaria_id: 'conta-1',
          data_operacao: '2026-03-25',
          documento: 'OP-1',
          historico: 'Importado',
          face_titulos: 1000,
          valor_compra: 20,
          despesas: 0,
          recompra: 0,
          ad_valorem: 0,
          iss: 0,
          iof: 0,
          iof_adicional: 0,
          amortizacao_debitos: 0,
          amortizacao_creditos: 0,
          soi_formula: {
            valor_original: 1000,
            valor_desagio: 20,
            amortiza_creditos: 0,
            creditos_gerados: 0,
            liquido_liberado: 980,
            desagio_antecipacao: 0,
          },
          raw_pdf_snapshot: [],
          extraction_diagnostics: [],
          has_critical_conflict: false,
          history_timeline: [],
          status: 'ready',
          issues: [],
        },
      ],
    };

    const confirmPartialResponse = {
      ok: true,
      summary: {
        total: 1,
        created: 0,
        ignored: 0,
        failed: 1,
        pending_review: 1,
        value_total_created: 0,
        auto_supplier_rate: 0,
        processing_time_ms: 120,
      },
      results: [
        {
          item_id: 'item:imp-1',
          import_file_id: 'imp-1',
          status: 'failed',
          message: 'Fornecedor não identificado.',
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/operacoes-ia/preview')) {
        return mockApiResponse(true, 200, previewResponse);
      }

      if (url.includes('/api/operacoes-ia/confirm')) {
        return mockApiResponse(true, 200, confirmPartialResponse);
      }

      if (url.includes('/api/operacoes-ia/message')) {
        return mockApiResponse(true, 200, { ok: true, reply: 'ok', session_id: 'sess-test' });
      }

      return mockApiResponse(false, 404, { message: 'not found' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<OperacoesIaIndex />);

    await user.selectOptions(screen.getByLabelText('Programa *'), 'SOI');

    const dateInput = screen.getByLabelText('Data do lote *');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-03-25');

    const pdfInput = screen.getByLabelText('PDF (DISECURIT)');
    await user.upload(pdfInput, new File(['pdf-content'], 'operacao.pdf', { type: 'application/pdf' }));

    await user.click(screen.getByRole('button', { name: 'Enviar fila' }));
    await waitFor(() => expect(uploadImportMutationMock.mutateAsync).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Gerar preview do lote' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/operacoes-ia/preview', expect.any(Object))
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirmar lote' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Confirmar lote' }));

    await waitFor(() =>
      expect(screen.getByText(/Lote parcial: o filtro foi movido para/i)).toBeInTheDocument()
    );
    expect((screen.getByRole('option', { name: 'Falhas' }) as HTMLOptionElement).selected).toBe(true);
  }, 15000);

  it('limpa fila e contexto ao iniciar Nova sessão', async () => {
    const user = userEvent.setup();
    render(<OperacoesIaIndex />);

    const pdfInput = screen.getByLabelText('PDF (DISECURIT)');
    await user.upload(pdfInput, new File(['pdf-content'], 'operacao.pdf', { type: 'application/pdf' }));

    expect(screen.getByText('Fila de upload (1)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Nova sessão' }));

    expect(screen.getByText('Fila de upload (0)')).toBeInTheDocument();
    expect(screen.getByText('Arquivos nesta sessão (0)')).toBeInTheDocument();
  });

  it('carrega historico diario ao abrir menu no copiloto', async () => {
    const user = userEvent.setup();

    const historyResponse = {
      ok: true,
      data: {
        timezone: 'America/Sao_Paulo',
        date_ref: '2026-03-29',
        range_start_utc: '2026-03-29T03:00:00.000Z',
        range_end_utc: '2026-03-30T02:59:59.999Z',
        fetched_at: '2026-03-29T15:00:00.000Z',
        summary: {
          total: 1,
          errors: 0,
          created: 0,
          corrections: 1,
          imports: 0,
        },
        events: [
          {
            id: 'event-1',
            timestamp: '2026-03-29T15:00:00.000Z',
            tipo_evento: 'manual_field_corrected',
            programa: 'SOI',
            operacao: '2759',
            documento: '2759',
            import_file_id: 'imp-1',
            status: 'info',
            categoria: 'corrections',
            mensagem: 'Correcao manual no campo soi_valor_desagio.',
            usuario: 'user-1',
            metadata: {},
            origin: 'operation_import_extraction_history',
          },
        ],
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/operacoes-ia/history')) {
        return mockApiResponse(true, 200, historyResponse);
      }

      return mockApiResponse(false, 404, { message: 'not found' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<OperacoesIaIndex />);

    await user.click(screen.getByRole('button', { name: 'Detalhes' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/operacoes-ia/history?limit=200',
        expect.objectContaining({ method: 'GET' })
      )
    );
    expect(await screen.findByText('manual_field_corrected')).toBeInTheDocument();
  });

  it('auto-ignora duplicate em produção e envia decisão ignore no confirm', async () => {
    const user = userEvent.setup();
    importsFixture[0].parse_status = 'duplicate';

    const previewResponse = {
      ok: true,
      batch_id: 'opsia_batch_duplicate',
      generated_at: '2026-03-29T10:00:00.000Z',
      meta: {
        duplicate_test_mode_enabled: false,
        conflict_override_duplicate_test_enabled: false,
      },
      contas_bancarias: [{ id: 'conta-1', descricao: 'SB-S0I2' }],
      default_conta_bancaria_id: 'conta-1',
      summary: {
        total: 1,
        ready: 0,
        review: 1,
        error: 0,
        linked: 0,
        auto_supplier_suggested: 0,
      },
      items: [
        {
          id: 'item:imp-1',
          import_file_id: 'imp-1',
          source_type: 'disecurit_pdf',
          parse_status: 'duplicate',
          original_filename: 'import-1.pdf',
          operation_number: 'OP-1',
          file_sha256: 'hash-1',
          linked_operacao_id: null,
          program: 'SPPRO',
          estoque_id: 10,
          fornecedor_id: null,
          fornecedor_match_method: 'none',
          fornecedor_match_confidence: null,
          conta_bancaria_id: 'conta-1',
          data_operacao: '2026-03-25',
          documento: 'OP-1',
          historico: 'Importado',
          face_titulos: 1000,
          valor_compra: 100,
          despesas: 10,
          recompra: 0,
          ad_valorem: 5,
          iss: 2,
          iof: 3,
          iof_adicional: 1,
          amortizacao_debitos: 0,
          amortizacao_creditos: 0,
          soi_formula: null,
          sppro_formula: {
            quantidade_titulos: 1,
            valor_face: 1000,
            valor_compra: 100,
            ad_valorem: 5,
            iss: 2,
            despesas: 10,
            iof: 3,
            iof_adicional: 1,
            recompra: 0,
            liquido_operacao: 879,
          },
          raw_pdf_snapshot: [],
          extraction_diagnostics: [],
          has_critical_conflict: false,
          history_timeline: [],
          status: 'review',
          issues: ['Import em status duplicate.'],
          duplicate_origin_import_file_id: null,
          duplicate_hydration_status: null,
          duplicate_hydration_resolution_method: null,
        },
      ],
    };

    const confirmBodies: Array<Record<string, unknown>> = [];
    const confirmResponse = {
      ok: true,
      summary: {
        total: 1,
        created: 0,
        ignored: 1,
        failed: 0,
        pending_review: 0,
        value_total_created: 0,
        auto_supplier_rate: 0,
        processing_time_ms: 100,
      },
      results: [
        {
          item_id: 'item:imp-1',
          import_file_id: 'imp-1',
          status: 'ignored',
          message: 'Item duplicado ignorado automaticamente em produção.',
        },
      ],
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/operacoes-ia/preview')) {
        return mockApiResponse(true, 200, previewResponse);
      }

      if (url.includes('/api/operacoes-ia/confirm')) {
        confirmBodies.push(JSON.parse(String(init?.body || '{}')));
        return mockApiResponse(true, 200, confirmResponse);
      }

      return mockApiResponse(false, 404, { message: 'not found' });
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    render(<OperacoesIaIndex />);

    await user.selectOptions(screen.getByLabelText('Programa *'), 'SPPRO');
    const dateInput = screen.getByLabelText('Data do lote *');
    await user.clear(dateInput);
    await user.type(dateInput, '2026-03-25');

    const pdfInput = screen.getByLabelText('PDF (DISECURIT)');
    await user.upload(pdfInput, new File(['pdf-content'], 'operacao.pdf', { type: 'application/pdf' }));
    await user.click(screen.getByRole('button', { name: 'Enviar fila' }));
    await waitFor(() => expect(uploadImportMutationMock.mutateAsync).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Gerar preview do lote' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/operacoes-ia/preview', expect.any(Object))
    );

    expect(await screen.findByText('Ignorado automaticamente (produção)')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Confirmar lote' }));
    await waitFor(() => expect(confirmBodies.length).toBe(1));

    const firstItem = (confirmBodies[0].items as Array<Record<string, unknown>>)[0];
    expect(firstItem.decision).toBe('ignore');
    expect(String(firstItem.ignore_reason || '')).toContain('auto_ignore_duplicate_prod');

    importsFixture[0].parse_status = 'parsed';
  });
});
