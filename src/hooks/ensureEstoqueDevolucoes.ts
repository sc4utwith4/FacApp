import { isConflictError } from '@/lib/uuid';
import { logger } from '@/lib/logger';

export type EstoqueDevolucoesRow = {
  id: number;
  saldo_atual: number | string | null;
  saldo_inicial: number | string | null;
};

type QueryResult<T> = {
  data: T | null;
  error: {
    code?: string;
    message?: string;
    status?: number;
  } | null;
};

type EstoquesSelectChain = {
  eq: (column: string, value: unknown) => EstoquesSelectChain;
  order: (column: string, options: { ascending: boolean }) => EstoquesSelectChain;
  limit: (count: number) => Promise<QueryResult<EstoqueDevolucoesRow[]>>;
};

type EstoquesInsertChain = {
  select: (columns: string) => {
    single: () => Promise<QueryResult<EstoqueDevolucoesRow>>;
  };
};

export type EnsureEstoqueDevolucoesClient = {
  from: (table: 'estoques') => {
    select: (columns: string) => EstoquesSelectChain;
    insert: (payload: Record<string, unknown>) => EstoquesInsertChain;
  };
};

type EnsureEstoqueLogger = Pick<typeof logger, 'warn'>;

async function listarEstoquesDevolucoesAtivos(
  client: EnsureEstoqueDevolucoesClient,
  empresaId: string,
): Promise<EstoqueDevolucoesRow[]> {
  const { data, error } = await client
    .from('estoques')
    .select('id, saldo_atual, saldo_inicial')
    .eq('empresa_id', empresaId)
    .eq('tipo', 'DEVOLUCOES')
    .eq('ativo', true)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(2);

  if (error) {
    throw new Error(`Erro ao buscar estoque DEVOLUCOES: ${error.message || 'Erro desconhecido'}`);
  }

  return data || [];
}

export async function ensureEstoqueDevolucoes(
  client: EnsureEstoqueDevolucoesClient,
  empresaId: string,
  userId: string,
  log: EnsureEstoqueLogger = logger,
): Promise<EstoqueDevolucoesRow> {
  const estoquesAtivos = await listarEstoquesDevolucoesAtivos(client, empresaId);
  if (estoquesAtivos.length > 0) {
    if (estoquesAtivos.length > 1) {
      log.warn('Múltiplos estoques DEVOLUCOES ativos; usando o mais antigo.', {
        empresa_id: empresaId,
        estoque_ids: estoquesAtivos.map((item) => item.id),
      });
    }
    return estoquesAtivos[0];
  }

  const { data: novoEstoque, error: createError } = await client
    .from('estoques')
    .insert({
      empresa_id: empresaId,
      tipo: 'DEVOLUCOES',
      descricao: 'Estoque de Devoluções',
      saldo_inicial: 0,
      saldo_atual: 0,
      ativo: true,
      created_by: userId,
    })
    .select('id, saldo_atual, saldo_inicial')
    .single();

  if (!createError && novoEstoque) {
    return novoEstoque;
  }

  if (isConflictError(createError)) {
    const afterConflict = await listarEstoquesDevolucoesAtivos(client, empresaId);
    if (afterConflict.length > 0) {
      log.warn('Conflito ao criar estoque DEVOLUCOES; usando registro existente.', {
        empresa_id: empresaId,
        estoque_ids: afterConflict.map((item) => item.id),
      });
      return afterConflict[0];
    }
  }

  throw new Error(`Erro ao criar estoque DEVOLUCOES: ${createError?.message || 'Erro desconhecido'}`);
}

