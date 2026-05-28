import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { useUpdateMovimentacaoEstoque } from '../useEstoque';
import type { TipoTransferencia } from '@/types/estoque';

describe('useUpdateMovimentacaoEstoque — proteção de edição de transferências', () => {
  const updatePayloads: Array<Record<string, unknown>> = [];
  let movimentacaoTipo: TipoTransferencia = 'conta_para_conta';

  beforeEach(() => {
    updatePayloads.length = 0;
    movimentacaoTipo = 'conta_para_conta';
    vi.clearAllMocks();
    vi.stubEnv('VITE_ENABLE_TRANSFERENCIA_EDIT_RPC', 'false');

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
      if (table !== 'movimentacoes_estoque') {
        throw new Error(`Tabela não esperada no teste de update seguro: ${table}`);
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 555,
                tipo: movimentacaoTipo,
                valor: 100,
                data: '2026-04-20',
                conta_bancaria_id: 'conta-origem',
                conta_bancaria_destino_id: 'conta-destino',
                estoque_origem_id: 10,
                estoque_destino_id: 20,
              },
              error: null,
            }),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          updatePayloads.push(payload);
          return {
            eq: vi.fn().mockResolvedValue({ error: null }),
          };
        }),
      };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each<TipoTransferencia>([
    'conta_para_conta',
    'conta_para_estoque',
    'estoque_para_conta',
    'estoque_para_estoque',
  ])('bloqueia edição de %s antes de atualizar movimentação ou saldos', async (tipo) => {
    movimentacaoTipo = tipo;
    const hook = useUpdateMovimentacaoEstoque();

    await expect(
      hook.mutateAsync({
        id: 555,
        valor: 120,
        data: '2026-04-21',
        historico: 'Tentativa de edição',
      }),
    ).rejects.toThrow('EDICAO_TRANSFERENCIA_RPC_DESATIVADA');

    expect(updatePayloads).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it('usa RPC transacional quando feature flag esta ativa', async () => {
    vi.stubEnv('VITE_ENABLE_TRANSFERENCIA_EDIT_RPC', 'true');
    movimentacaoTipo = 'conta_para_conta';
    mockSupabase.rpc.mockResolvedValueOnce({
      data: { status: 'atualizada', movimentacao_id: 555 },
      error: null,
    });

    const hook = useUpdateMovimentacaoEstoque();

    await hook.mutateAsync({
      id: 555,
      valor: 120,
      data: '2026-04-21',
      historico: 'Edição transacional',
      conta_bancaria_id: 'conta-nova-origem',
      conta_bancaria_destino_id: 'conta-nova-destino',
    });

    expect(updatePayloads).toEqual([]);
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'atualizar_transferencia_estoque',
      expect.objectContaining({
        payload: expect.objectContaining({
          movimentacao_id: 555,
          valor: 120,
          data: '2026-04-21',
          historico: 'Edição transacional',
          conta_bancaria_id: 'conta-nova-origem',
          conta_bancaria_destino_id: 'conta-nova-destino',
        }),
      }),
    );
  });
});
