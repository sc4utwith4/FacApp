import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockUseQuery,
  mockUseMutation,
  mockUseQueryClient,
  mockSupabase,
} = vi.hoisted(() => ({
  mockUseQuery: vi.fn(),
  mockUseMutation: vi.fn(),
  mockUseQueryClient: vi.fn(),
  mockSupabase: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQuery: mockUseQuery,
    useMutation: mockUseMutation,
    useQueryClient: mockUseQueryClient,
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: mockSupabase,
}));

import { useDeleteMovimentacaoEstoque } from '../useEstoque';

describe('useDeleteMovimentacaoEstoque — B2 vínculo determinístico', () => {
  const deletedLancamentoIds: string[] = [];

  beforeEach(() => {
    deletedLancamentoIds.length = 0;
    vi.clearAllMocks();

    mockUseQueryClient.mockReturnValue({
      invalidateQueries: vi.fn(),
    });
    mockUseQuery.mockReturnValue({
      data: 'empresa-test',
      isLoading: false,
      error: null,
    });
    mockUseMutation.mockImplementation((options: { mutationFn: (arg: unknown) => Promise<unknown> }) => ({
      mutateAsync: options.mutationFn,
    }));

    mockSupabase.rpc.mockResolvedValue({ error: null });

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'movimentacoes_estoque') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 101,
                  tipo: 'conta_para_estoque',
                  valor: 50,
                  data: '2026-04-14',
                  conta_bancaria_id: 'conta-1',
                  estoque_destino_id: 20,
                  operacao_estoque_id: null,
                },
                error: null,
              }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }

      if (table === 'lancamentos_caixa') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              ilike: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'linked',
                    observacoes: 'Transferência | movimentacao_estoque_id:101',
                    tipo: 'saida',
                    valor: 50,
                    data: '2026-04-14',
                    conta_bancaria_id: 'conta-1',
                  },
                  {
                    id: 'cross',
                    observacoes: 'Transferência | movimentacao_estoque_id:1010',
                    tipo: 'saida',
                    valor: 50,
                    data: '2026-04-14',
                    conta_bancaria_id: 'conta-1',
                  },
                ],
                error: null,
              }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn((_: string, id: string) => {
              deletedLancamentoIds.push(id);
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      throw new Error(`Tabela não mockada no teste B2: ${table}`);
    });
  });

  it('deleta apenas o lançamento com vínculo exato da movimentação (sem exclusão cruzada)', async () => {
    const hook = useDeleteMovimentacaoEstoque();

    await hook.mutateAsync(101);

    expect(deletedLancamentoIds).toEqual(['linked']);
  });

  it('bloqueia legado sem vínculo explícito antes de qualquer reversão ou exclusão', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'movimentacoes_estoque') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 101,
                  tipo: 'conta_para_estoque',
                  valor: 50,
                  data: '2026-04-14',
                  conta_bancaria_id: 'conta-1',
                  estoque_destino_id: 20,
                  operacao_estoque_id: null,
                },
                error: null,
              }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }

      if (table === 'lancamentos_caixa') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              ilike: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn((_: string, id: string) => {
              deletedLancamentoIds.push(id);
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      throw new Error(`Tabela não mockada no teste B2 legado: ${table}`);
    });

    const hook = useDeleteMovimentacaoEstoque();

    await expect(hook.mutateAsync(101)).rejects.toThrow('MOVIMENTACAO_SEM_VINCULO');
    expect(deletedLancamentoIds).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('conta_para_conta: exclui somente os dois lançamentos vinculados à movimentação', async () => {
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'movimentacoes_estoque') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 202,
                  tipo: 'conta_para_conta',
                  valor: 75,
                  data: '2026-04-15',
                  conta_bancaria_id: 'conta-origem',
                  conta_bancaria_destino_id: 'conta-destino',
                  operacao_estoque_id: null,
                },
                error: null,
              }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ error: null }),
          })),
        };
      }

      if (table === 'lancamentos_caixa') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              ilike: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'saida-202',
                    observacoes: 'Transferência Conta → Conta | movimentacao_estoque_id:202',
                    tipo: 'saida',
                    valor: 75,
                    data: '2026-04-15',
                    conta_bancaria_id: 'conta-origem',
                  },
                  {
                    id: 'entrada-202',
                    observacoes: 'Transferência Conta → Conta | movimentacao_estoque_id:202',
                    tipo: 'entrada',
                    valor: 75,
                    data: '2026-04-15',
                    conta_bancaria_id: 'conta-destino',
                  },
                  {
                    id: 'cross-2020',
                    observacoes: 'Transferência Conta → Conta | movimentacao_estoque_id:2020',
                    tipo: 'saida',
                    valor: 75,
                    data: '2026-04-15',
                    conta_bancaria_id: 'conta-origem',
                  },
                ],
                error: null,
              }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn((_: string, id: string) => {
              deletedLancamentoIds.push(id);
              return Promise.resolve({ error: null });
            }),
          })),
        };
      }

      throw new Error(`Tabela não mockada no teste B2 conta_para_conta: ${table}`);
    });

    const hook = useDeleteMovimentacaoEstoque();

    await hook.mutateAsync(202);

    expect(deletedLancamentoIds).toEqual(['saida-202', 'entrada-202']);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
