import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OperacoesIaCopilotPanel } from '../OperacoesIaCopilotPanel';

const baseProps = {
  batchId: null,
  activeItem: null,
  counts: {
    total: 0,
    ready: 0,
    review: 0,
    error: 0,
    created: 0,
    failed: 0,
    ignored: 0,
  },
  lastSummary: null,
  onSendApi: vi.fn(async () => ({ reply: 'ok', session_id: null })),
  copilotThreadKey: 'test-thread',
  copilotSeedMessages: null,
  programHint: '' as const,
  onProgramHintChange: vi.fn(),
  dataReferenciaLote: '2026-03-25',
  onDataReferenciaLoteChange: vi.fn(),
  operationHint: '',
  onOperationHintChange: vi.fn(),
  cnpjHint: '',
  onCnpjHintChange: vi.fn(),
  uploadQueue: [] as Array<{
    id: string;
    name: string;
    status: 'queued' | 'uploading' | 'success' | 'error';
    error_message?: string | null;
    import_file_id?: string | null;
  }>,
  onAddFiles: vi.fn(),
  onUploadQueued: vi.fn(),
  onRetryUpload: vi.fn(),
  onRemoveUpload: vi.fn(),
  onClearCompleted: vi.fn(),
  uploadPending: false,
  sessionImports: [],
};

describe('OperacoesIaCopilotPanel', () => {
  it('aceita multi-upload e envia lista de arquivos para a fila', async () => {
    const user = userEvent.setup();
    const onAddFiles = vi.fn();

    render(
      <OperacoesIaCopilotPanel
        {...baseProps}
        onAddFiles={onAddFiles}
      />
    );

    const input = screen.getByLabelText('PDF (DISECURIT)') as HTMLInputElement;
    const fileA = new File(['pdf-a'], 'a.pdf', { type: 'application/pdf' });
    const fileB = new File(['pdf-b'], 'b.pdf', { type: 'application/pdf' });

    await user.upload(input, [fileA, fileB]);

    expect(onAddFiles).toHaveBeenCalledTimes(1);
    expect(onAddFiles).toHaveBeenCalledWith([fileA, fileB]);
  });

  it('renderiza abas Entrada/Assistente e executa ações de fila', async () => {
    const user = userEvent.setup();
    const onRetryUpload = vi.fn();
    const onClearCompleted = vi.fn();

    render(
      <OperacoesIaCopilotPanel
        {...baseProps}
        uploadQueue={[
          { id: 'q1', name: 'falhou.pdf', status: 'error', error_message: 'Erro de parse' },
          { id: 'q2', name: 'ok.pdf', status: 'success' },
        ]}
        onRetryUpload={onRetryUpload}
        onClearCompleted={onClearCompleted}
      />
    );

    expect(screen.getByRole('tab', { name: 'Entrada' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Assistente' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Assistente' }));
    expect(screen.getByText('Resumo do workspace')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Entrada' }));
    await user.click(screen.getByRole('button', { name: 'Reenviar' }));
    await user.click(screen.getByRole('button', { name: 'Limpar concluídos' }));

    expect(onRetryUpload).toHaveBeenCalledWith('q1');
    expect(onClearCompleted).toHaveBeenCalledTimes(1);
  });

  it('abre historico no dropdown e detalha no drawer com filtros', async () => {
    const user = userEvent.setup();
    const onOpenHistoryMenu = vi.fn();
    const onRefreshHistory = vi.fn();

    render(
      <OperacoesIaCopilotPanel
        {...baseProps}
        historyData={{
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
              metadata: { field_name: 'soi_valor_desagio' },
              origin: 'operation_import_extraction_history',
            },
          ],
        }}
        onOpenHistoryMenu={onOpenHistoryMenu}
        onRefreshHistory={onRefreshHistory}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Detalhes' }));
    expect(onOpenHistoryMenu).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Histórico do dia')).toBeInTheDocument();
    expect(screen.getByText('manual_field_corrected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ver detalhes do dia' }));
    expect(screen.getByText('Histórico diário')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Erros' }));
    expect(screen.getByText('Nenhum evento encontrado para o filtro selecionado.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(onRefreshHistory).toHaveBeenCalledTimes(1);
  });

  it('menu Conversas lista sessões e Carregar chama onLoadChatSession', async () => {
    const user = userEvent.setup();
    const onLoadChatSession = vi.fn();
    const onOpenChatSessionsMenu = vi.fn();

    render(
      <OperacoesIaCopilotPanel
        {...baseProps}
        chatSessions={[
          {
            id: 'chat-1',
            empresa_id: 'e1',
            user_id: 'u1',
            session_key: 'k1',
            reference_date: '2026-03-01',
            program_hint: 'SOI',
            operation_hint: null,
            cnpj_hint: null,
            title: 'SOI · teste',
            created_at: '2026-03-01T00:00:00.000Z',
            updated_at: '2026-03-01T00:00:00.000Z',
            last_message_at: '2026-03-01T12:00:00.000Z',
            archived_at: null,
            archived_by: null,
            archived_reason: null,
          },
        ]}
        onOpenChatSessionsMenu={onOpenChatSessionsMenu}
        onLoadChatSession={onLoadChatSession}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Conversas' }));
    expect(onOpenChatSessionsMenu).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Carregar' }));
    expect(onLoadChatSession).toHaveBeenCalledWith('chat-1');
  });
});
