import { describe, expect, it, vi } from 'vitest';

import {
  ensureEstoqueDevolucoes,
  type EnsureEstoqueDevolucoesClient,
  type EstoqueDevolucoesRow,
} from '../ensureEstoqueDevolucoes';

type SelectResponse = {
  data: EstoqueDevolucoesRow[] | null;
  error: { code?: string; message?: string; status?: number } | null;
};

type InsertResponse = {
  data: EstoqueDevolucoesRow | null;
  error: { code?: string; message?: string; status?: number } | null;
};

function makeClient(selectQueue: SelectResponse[], insertResponse: InsertResponse) {
  const queue = [...selectQueue];

  const selectChain = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(async () => queue.shift() ?? { data: [], error: null }),
  };
  selectChain.eq.mockReturnValue(selectChain);
  selectChain.order.mockReturnValue(selectChain);

  const singleSpy = vi.fn(async () => insertResponse);
  const insertSelectSpy = vi.fn(() => ({ single: singleSpy }));
  const insertSpy = vi.fn(() => ({ select: insertSelectSpy }));
  const selectSpy = vi.fn(() => selectChain);

  const client: EnsureEstoqueDevolucoesClient = {
    from: vi.fn(() => ({
      select: selectSpy,
      insert: insertSpy,
    })),
  };

  return { client, insertSpy };
}

describe('ensureEstoqueDevolucoes', () => {
  it('retorna estoque existente sem tentar criar novo', async () => {
    const existing: EstoqueDevolucoesRow = { id: 10, saldo_atual: 100, saldo_inicial: 0 };
    const { client, insertSpy } = makeClient(
      [{ data: [existing], error: null }],
      { data: null, error: null },
    );
    const warn = vi.fn();

    const out = await ensureEstoqueDevolucoes(client, 'empresa-1', 'user-1', { warn });

    expect(out).toEqual(existing);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('quando há múltiplos estoques ativos, usa o mais antigo e registra warning', async () => {
    const oldest: EstoqueDevolucoesRow = { id: 7, saldo_atual: 10, saldo_inicial: 0 };
    const newest: EstoqueDevolucoesRow = { id: 9, saldo_atual: 20, saldo_inicial: 0 };
    const { client, insertSpy } = makeClient(
      [{ data: [oldest, newest], error: null }],
      { data: null, error: null },
    );
    const warn = vi.fn();

    const out = await ensureEstoqueDevolucoes(client, 'empresa-2', 'user-2', { warn });

    expect(out).toEqual(oldest);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('cria estoque quando não existe nenhum ativo', async () => {
    const created: EstoqueDevolucoesRow = { id: 30, saldo_atual: 0, saldo_inicial: 0 };
    const { client, insertSpy } = makeClient(
      [{ data: [], error: null }],
      { data: created, error: null },
    );
    const warn = vi.fn();

    const out = await ensureEstoqueDevolucoes(client, 'empresa-3', 'user-3', { warn });

    expect(out).toEqual(created);
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('em conflito na criação, refaz select e usa estoque existente (race-safe)', async () => {
    const existingAfterConflict: EstoqueDevolucoesRow = { id: 55, saldo_atual: 0, saldo_inicial: 0 };
    const { client } = makeClient(
      [
        { data: [], error: null },
        { data: [existingAfterConflict], error: null },
      ],
      {
        data: null,
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint',
        },
      },
    );
    const warn = vi.fn();

    const out = await ensureEstoqueDevolucoes(client, 'empresa-4', 'user-4', { warn });

    expect(out).toEqual(existingAfterConflict);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falha cedo quando select inicial retorna erro', async () => {
    const { client } = makeClient(
      [{ data: null, error: { message: 'boom-select' } }],
      { data: null, error: null },
    );
    const warn = vi.fn();

    await expect(
      ensureEstoqueDevolucoes(client, 'empresa-5', 'user-5', { warn }),
    ).rejects.toThrow('Erro ao buscar estoque DEVOLUCOES: boom-select');
  });
});

