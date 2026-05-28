import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useAICopilot } from '../useAICopilot';

// Mock do fetch
global.fetch = vi.fn();

// Mock do hook de conversas
vi.mock('../useAICopilotConversations', () => ({
  useAICopilotConversations: () => ({
    saveConversation: vi.fn().mockResolvedValue(undefined),
    conversations: [],
    isLoading: false,
    error: null,
    loadConversations: vi.fn(),
    deleteConversation: vi.fn(),
    loadConversation: vi.fn(),
  }),
}));

describe('useAICopilot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deve inicializar com estado vazio', () => {
    const { result } = renderHook(() => useAICopilot());

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.conversationId).toBeDefined();
    expect(typeof result.current.conversationId).toBe('string');
  });

  it('deve ter conversationId único em cada instância', () => {
    const { result: result1 } = renderHook(() => useAICopilot());
    const { result: result2 } = renderHook(() => useAICopilot());

    expect(result1.current.conversationId).not.toBe(result2.current.conversationId);
  });

  it('deve limpar mensagens corretamente', () => {
    const { result } = renderHook(() => useAICopilot());

    act(() => {
      result.current.clearMessages();
    });

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBe(null);
  });

  it('não deve enviar mensagem vazia', async () => {
    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('');
    });

    expect(result.current.messages).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('não deve enviar mensagem apenas com espaços', async () => {
    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('   ');
    });

    expect(result.current.messages).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('deve adicionar mensagem do usuário ao enviar', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ answer: 'Resposta da IA' }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('Teste de pergunta');
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBeGreaterThan(0);
    });

    const userMessage = result.current.messages.find(m => m.role === 'user');
    expect(userMessage).toBeDefined();
    expect(userMessage?.content).toBe('Teste de pergunta');
  });

  it('deve adicionar resposta da IA após sucesso', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ answer: 'Resposta da IA' }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('Teste');
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    const assistantMessage = result.current.messages.find(m => m.role === 'assistant');
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.content).toBe('Resposta da IA');
  });

  it('deve desserializar output JSON com intent=clarify', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        output: JSON.stringify({
          intent: 'clarify',
          clarifyQuestion: 'Qual período você deseja consultar?',
        }),
      }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('Mostre minhas operações');
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    const assistantMessage = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistantMessage?.content).toBe('Qual período você deseja consultar?');
  });

  it('deve desserializar output JSON com intent=data e fallback por rows quando answer não vier', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        output: JSON.stringify({
          intent: 'data',
          needsQuery: true,
        }),
        data: {
          rows: [
            { id: 1, valor: 100 },
            { id: 2, valor: 250 },
          ],
        },
      }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('Quais lançamentos tive hoje?');
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    const assistantMessage = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistantMessage?.content).toContain('2 registros');
  });

  it('deve ler output no formato data.output quando vier aninhado', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        data: {
          output: JSON.stringify({
            intent: 'clarify',
            clarifyQuestion: 'Você quer filtrar por programa?',
          }),
        },
      }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('Mostre minhas operações');
    });

    await waitFor(() => {
      expect(result.current.messages.length).toBe(2);
    });

    const assistantMessage = result.current.messages.find((m) => m.role === 'assistant');
    expect(assistantMessage?.content).toBe('Você quer filtrar por programa?');
  });

  it('deve definir isLoading como true durante requisição', async () => {
    let resolvePromise: (value: any) => void;
    const promise = new Promise(resolve => {
      resolvePromise = resolve;
    });

    (global.fetch as any).mockReturnValueOnce(promise);

    const { result } = renderHook(() => useAICopilot());

    act(() => {
      result.current.sendMessage('Teste');
    });

    // Deve estar carregando
    expect(result.current.isLoading).toBe(true);

    // Resolver a promise
    await act(async () => {
      resolvePromise!({
        ok: true,
        json: async () => ({ answer: 'Resposta' }),
      });
      await promise;
    });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('deve tratar erro de requisição', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ message: 'Erro do servidor' }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('Teste');
    });

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
      expect(result.current.messages.length).toBe(2); // User message + error message
    });

    const errorMessage = result.current.messages.find(m => 
      m.role === 'assistant' && m.content.includes('Erro')
    );
    expect(errorMessage).toBeDefined();
  });

  it('deve fazer trim na pergunta antes de enviar', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ answer: 'Resposta' }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());

    await act(async () => {
      await result.current.sendMessage('  Pergunta com espaços  ');
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callArgs = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.question).toBe('Pergunta com espaços');
  });

  it('deve incluir conversationId no body da requisição', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ answer: 'Resposta' }),
    };

    (global.fetch as any).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useAICopilot());
    const conversationId = result.current.conversationId;

    await act(async () => {
      await result.current.sendMessage('Teste');
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });

    const callArgs = (global.fetch as any).mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.conversationId).toBe(conversationId);
  });
});
