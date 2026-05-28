import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ReconciliationChatView } from '../ReconciliationChatView';
import type { ChatMessage } from '@/types/bank-reconciliation';

const baseMessages: ChatMessage[] = [
  {
    id: 'assistant-1',
    role: 'assistant',
    content: 'OFX importado. Contexto aberto.',
    timestamp: '2026-03-06T12:00:00.000Z',
  },
];

const baseProps = {
  messages: baseMessages,
  onSendMessage: vi.fn(),
  empresaId: 'empresa-1',
  contaId: 'conta-1',
  contaLabel: 'SB-S0I2',
  contas: [{ id: 'conta-1', descricao: 'SB-S0I2' }],
  importId: 'import-1',
  dataReferencia: '2026-03-06',
  parseStatus: 'parsed',
  statusCounts: { pendente: 1, sugerido: 0, conciliado: 0, divergente: 0 },
  composerValue: '',
  onComposerValueChange: vi.fn(),
  mode: 'copilot' as const,
};

describe('ReconciliationChatView', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it('nao mostra badge de IA apenas porque a mensagem esta sendo enviada', () => {
    render(
      <ReconciliationChatView
        {...baseProps}
        sendingMessage
      />
    );

    expect(screen.queryByText('Aguardando IA…')).not.toBeInTheDocument();
  });

  it('mostra badge de IA quando ha trigger explicito em andamento', () => {
    render(
      <ReconciliationChatView
        {...baseProps}
        triggerPending
      />
    );

    expect(screen.getByText('Aguardando IA…')).toBeInTheDocument();
  });
});
