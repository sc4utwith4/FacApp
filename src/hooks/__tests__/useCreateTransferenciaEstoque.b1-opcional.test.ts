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
    auth: {
      getSession: vi.fn(),
    },
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

import { useCreateTransferenciaEstoque } from '../useEstoque';

type InsertCall = {
  table: string;
  payload: Record<string, unknown>;
};

type RpcCall = {
  fnName: string;
  payload: Record<string, unknown>;
};

const insertCalls: InsertCall[] = [];
const rpcCalls: RpcCall[] = [];

const pushInsert = (table: string, payload: Record<string, unknown>) => {
  insertCalls.push({ table, payload });
};

const estoqueInfo = {
  tipo: 'SPPRO',
  descricao: 'Estoque teste',
  saldo_atual: 1000,
};

function buildFromMock(table: string) {
  if (table === 'estoques') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: estoqueInfo, error: null }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ error: null }),
      })),
    };
  }

  if (table === 'operacoes_estoque') {
    return {
      insert: vi.fn((payload: Record<string, unknown>) => {
        pushInsert(table, payload);
        return {
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 1234 },
              error: null,
            }),
          })),
        };
      }),
    };
  }

  if (table === 'movimentacoes_estoque') {
    return {
      insert: vi.fn((payload: Record<string, unknown>) => {
        pushInsert(table, payload);
        return {
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 777 },
              error: null,
            }),
          })),
        };
      }),
    };
  }

  if (table === 'contas_bancarias') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { descricao: 'Conta mock', saldo_atual: 10000 },
            error: null,
          }),
        })),
      })),
    };
  }

  if (table === 'lancamentos_caixa') {
    return {
      insert: vi.fn(async (payload: Record<string, unknown>) => {
        pushInsert(table, payload);
        return { error: null };
      }),
    };
  }

  throw new Error(`Tabela não mockada no teste B1 opcional: ${table}`);
}

const assertNoContaIncrement = () => {
  const hasContaIncrement = rpcCalls.some(
    (call) =>
      call.fnName === 'increment' &&
      call.payload.table_name === 'contas_bancarias',
  );
  expect(hasContaIncrement).toBe(false);
};

const assertEstoqueIncrement = (amount: number) => {
  expect(rpcCalls).toContainEqual(
    expect.objectContaining({
      fnName: 'increment',
      payload: expect.objectContaining({
        table_name: 'estoques',
        amount,
      }),
    }),
  );
};

describe('useCreateTransferenciaEstoque — B1 opcional runtime', () => {
  beforeEach(() => {
    insertCalls.length = 0;
    rpcCalls.length = 0;
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

    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-test' },
        },
      },
    });

    mockSupabase.from.mockImplementation((table: string) => buildFromMock(table));
    mockSupabase.rpc.mockImplementation(async (fnName: string, payload: Record<string, unknown>) => {
      rpcCalls.push({ fnName, payload });
      return { error: null };
    });
  });

  it('conta_para_estoque: não incrementa contas_bancarias e mantém lançamento + incremento de estoque', async () => {
    const hook = useCreateTransferenciaEstoque();

    await hook.mutateAsync({
      tipo: 'conta_para_estoque',
      origem_id: 'conta-a',
      destino_id: 10,
      valor: 120,
      data: '2026-04-13',
      historico: 'Teste conta para estoque',
    });

    const lancamento = insertCalls.find((call) => call.table === 'lancamentos_caixa')?.payload;
    expect(lancamento).toMatchObject({
      empresa_id: 'empresa-test',
      conta_bancaria_id: 'conta-a',
      tipo: 'saida',
      valor: 120,
    });

    const movimentacao = insertCalls.find((call) => call.table === 'movimentacoes_estoque')?.payload;
    expect(movimentacao).toMatchObject({
      tipo: 'conta_para_estoque',
      conta_bancaria_id: 'conta-a',
      estoque_destino_id: 10,
    });

    assertNoContaIncrement();
    assertEstoqueIncrement(120);
  });

  it('estoque_para_conta: não incrementa contas_bancarias e mantém lançamento + decremento de estoque', async () => {
    const hook = useCreateTransferenciaEstoque();

    await hook.mutateAsync({
      tipo: 'estoque_para_conta',
      origem_id: 10,
      destino_id: 'conta-b',
      valor: 80,
      data: '2026-04-13',
      historico: 'Teste estoque para conta',
    });

    const lancamento = insertCalls.find((call) => call.table === 'lancamentos_caixa')?.payload;
    expect(lancamento).toMatchObject({
      empresa_id: 'empresa-test',
      conta_bancaria_id: 'conta-b',
      tipo: 'entrada',
      valor: 80,
    });

    const movimentacao = insertCalls.find((call) => call.table === 'movimentacoes_estoque')?.payload;
    expect(movimentacao).toMatchObject({
      tipo: 'estoque_para_conta',
      conta_bancaria_id: 'conta-b',
      estoque_origem_id: 10,
    });

    assertNoContaIncrement();
    assertEstoqueIncrement(-80);
  });

  it('conta_para_conta: cria movimentação + saída e entrada em caixa, sem increment RPC em contas', async () => {
    const hook = useCreateTransferenciaEstoque();

    await hook.mutateAsync({
      tipo: 'conta_para_conta',
      origem_id: 'conta-orig',
      destino_id: 'conta-dest',
      valor: 0.25,
      data: '2026-04-16',
      historico: 'Teste conta para conta',
    });

    const movimentacao = insertCalls.find((call) => call.table === 'movimentacoes_estoque')?.payload;
    expect(movimentacao).toMatchObject({
      tipo: 'conta_para_conta',
      valor: 0.25,
      conta_bancaria_id: 'conta-orig',
      conta_bancaria_destino_id: 'conta-dest',
    });

    const lancamentos = insertCalls.filter((call) => call.table === 'lancamentos_caixa');
    expect(lancamentos).toHaveLength(2);
    expect(lancamentos.map((c) => c.payload)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          empresa_id: 'empresa-test',
          conta_bancaria_id: 'conta-orig',
          tipo: 'saida',
          valor: 0.25,
          observacoes: expect.stringContaining('movimentacao_estoque_id:777'),
        }),
        expect.objectContaining({
          empresa_id: 'empresa-test',
          conta_bancaria_id: 'conta-dest',
          tipo: 'entrada',
          valor: 0.25,
          observacoes: expect.stringContaining('movimentacao_estoque_id:777'),
        }),
      ]),
    );

    assertNoContaIncrement();
    expect(rpcCalls.filter((c) => c.fnName === 'increment')).toHaveLength(0);
  });
});
