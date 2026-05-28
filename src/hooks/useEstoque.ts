import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ensureUUID, isConflictError } from '@/lib/uuid';
import { logger } from '@/lib/logger';
import {
  appendMovimentacaoLancamentoVinculo,
  buildMovimentacaoLancamentoVinculo,
  filterLancamentosByMovimentacaoVinculo,
} from '@/hooks/movimentacaoLancamentoVinculo';
import { ensureEstoqueDevolucoes } from '@/hooks/ensureEstoqueDevolucoes';
import { isMovimentacaoTipoRedundanteNaListaMista } from '@/lib/movimentacaoListaLancamentos';
import { CRITICAL_FINANCIAL_QUERY_POLICY, READ_DASHBOARD_QUERY_POLICY } from '@/lib/queryPolicies';
import type {
  Estoque,
  CreateEstoque,
  UpdateEstoque,
  OperacaoEstoqueComRelacoes,
  CreateOperacaoEstoque,
  CreateMovimentacaoEstoque,
  FiltrosOperacoesEstoque,
  TipoEstoque,
  DistribuicaoConta,
  TipoTransferencia,
  DevolucaoEstoque,
  DevolucaoEstoqueComRelacoes,
  CreateDevolucaoEstoque,
  DevolucoesTotais,
  RecompraEstoque,
  RecompraEstoqueComRelacoes,
  CreateRecompraEstoque,
  PagarRecompraEstoque,
  TransferirDevolucoesInput,
  DevolucaoTransferivel,
  DevolucaoOrfaDiagnostico,
  LimpezaDevolucoesOrfasResultado,
  TransferirDevolucoesRpcCode,
  CriarDevolucaoRpcCode,
  TipoOrigemDevolucao,
  DiagnosticoConsistenciaDevolucoesEstoque,
  RepararInconsistenciasDevolucoesPayload,
  RepararInconsistenciasDevolucoesResultado,
  ConsultarReconciliacaoDevolucoesPayload,
  ConsultarReconciliacaoDevolucoesResultado,
} from '@/types/estoque';
import {
  calcularLiquidoSPPRO,
  calcularLiquidoSOI,
} from '@/types/estoque';

export type RegistrarRecompraInput = {
  operacao: OperacaoEstoqueComRelacoes;
  tipoEstoque: TipoEstoque;
  valor: number;
  data: string;
  historico?: string;
  observacoes?: string;
};

export type RegistrarRecompraResult = {
  operacaoId: number;
  novoTotalRecompra: number;
  novoLiquido: number;
  diferencaLiquido: number;
};

type DeleteDevolucaoRpcCode =
  | 'LEGADO_AMBIGUO'
  | 'DEVOLUCAO_NAO_ENCONTRADA'
  | 'NAO_AUTENTICADO'
  | 'REQUEST_ID_INVALIDO'
  | 'ESTADO_INVALIDO';

type DeleteDevolucaoRpcResult = {
  error?: string;
  code?: DeleteDevolucaoRpcCode | string;
  devolucao_id?: number;
  operacao_entrada_devolucoes_id?: number;
  valor_devolucao?: number;
  total_transferencias_revertidas?: number;
  status?: 'excluida';
};

type DeleteDevolucaoError = Error & { code?: DeleteDevolucaoRpcCode | string };

type LancamentoCaixaVinculadoMovimentacao = {
  id: string;
  observacoes?: string | null;
  tipo?: string | null;
  valor?: number | string | null;
  data?: string | null;
  conta_bancaria_id?: string | null;
};

type MovimentacaoComLancamentoCaixa = {
  id: number | string;
  tipo?: string | null;
  valor?: number | string | null;
  data?: string | null;
  conta_bancaria_id?: string | null;
  conta_bancaria_destino_id?: string | null;
};

const TIPOS_MOVIMENTACAO_COM_LANCAMENTO_CAIXA = new Set([
  'conta_para_estoque',
  'estoque_para_conta',
  'conta_para_conta',
]);

const TIPOS_TRANSFERENCIA_MOVIMENTACAO = new Set<TipoTransferencia>([
  'conta_para_estoque',
  'estoque_para_conta',
  'estoque_para_estoque',
  'conta_para_conta',
]);

const isTipoTransferenciaMovimentacao = (tipo: string | null | undefined): tipo is TipoTransferencia =>
  TIPOS_TRANSFERENCIA_MOVIMENTACAO.has(tipo as TipoTransferencia);

const isTransferenciaEditRpcEnabled = (): boolean =>
  import.meta.env.VITE_ENABLE_TRANSFERENCIA_EDIT_RPC === 'true';

const createTransferenciaEditRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeDateOnly = (value: string | null | undefined): string => (value ?? '').slice(0, 10);

const normalizeCentavos = (value: number | string | null | undefined): number =>
  Math.round(Number(value ?? 0) * 100);

const isLancamentoCompativelComMovimentacao = (
  lancamento: LancamentoCaixaVinculadoMovimentacao,
  movimentacao: MovimentacaoComLancamentoCaixa,
  tipo: 'entrada' | 'saida',
  contaBancariaId: string | null | undefined,
): boolean => (
  lancamento.tipo === tipo &&
  (lancamento.conta_bancaria_id ?? null) === (contaBancariaId ?? null) &&
  normalizeDateOnly(lancamento.data) === normalizeDateOnly(movimentacao.data) &&
  normalizeCentavos(lancamento.valor) === normalizeCentavos(movimentacao.valor)
);

const validarLancamentosVinculadosMovimentacao = (
  movimentacao: MovimentacaoComLancamentoCaixa,
  lancamentos: LancamentoCaixaVinculadoMovimentacao[],
): LancamentoCaixaVinculadoMovimentacao[] => {
  if (lancamentos.length === 0) {
    throw new Error(
      `MOVIMENTACAO_SEM_VINCULO: movimentação #${movimentacao.id} não possui lançamentos com vínculo explícito. Exclusão bloqueada para evitar alteração indevida de saldos.`,
    );
  }

  if (movimentacao.tipo === 'conta_para_estoque') {
    const valido = lancamentos.length === 1 && isLancamentoCompativelComMovimentacao(
      lancamentos[0],
      movimentacao,
      'saida',
      movimentacao.conta_bancaria_id,
    );

    if (!valido) {
      throw new Error(
        `LEGADO_AMBIGUO: vínculo explícito inconsistente para movimentação conta_para_estoque #${movimentacao.id}. Exclusão bloqueada.`,
      );
    }

    return lancamentos;
  }

  if (movimentacao.tipo === 'estoque_para_conta') {
    const valido = lancamentos.length === 1 && isLancamentoCompativelComMovimentacao(
      lancamentos[0],
      movimentacao,
      'entrada',
      movimentacao.conta_bancaria_id,
    );

    if (!valido) {
      throw new Error(
        `LEGADO_AMBIGUO: vínculo explícito inconsistente para movimentação estoque_para_conta #${movimentacao.id}. Exclusão bloqueada.`,
      );
    }

    return lancamentos;
  }

  if (movimentacao.tipo === 'conta_para_conta') {
    const saidaOrigem = lancamentos.filter((lancamento) =>
      isLancamentoCompativelComMovimentacao(
        lancamento,
        movimentacao,
        'saida',
        movimentacao.conta_bancaria_id,
      ),
    );
    const entradaDestino = lancamentos.filter((lancamento) =>
      isLancamentoCompativelComMovimentacao(
        lancamento,
        movimentacao,
        'entrada',
        movimentacao.conta_bancaria_destino_id,
      ),
    );
    const valido = lancamentos.length === 2 && saidaOrigem.length === 1 && entradaDestino.length === 1;

    if (!valido) {
      throw new Error(
        `LEGADO_AMBIGUO: vínculo explícito inconsistente para movimentação conta_para_conta #${movimentacao.id}. Exclusão bloqueada.`,
      );
    }

    return [saidaOrigem[0], entradaDestino[0]];
  }

  return [];
};

export function getDeleteDevolucaoMessage(
  code: DeleteDevolucaoRpcCode | string | undefined,
  fallback?: string
): string {
  switch (code) {
    case 'LEGADO_AMBIGUO':
      return (
        'Não foi possível excluir automaticamente esta devolução porque os vínculos legados estão ambíguos. ' +
        'Execute o saneamento/backfill da Fase 2 e tente novamente.'
      );
    case 'DEVOLUCAO_NAO_ENCONTRADA':
      return 'Devolução não encontrada ou já excluída.';
    case 'NAO_AUTENTICADO':
      return 'Usuário não autenticado.';
    case 'REQUEST_ID_INVALIDO':
      return 'Falha interna: request_id inválido para exclusão.';
    case 'ESTADO_INVALIDO':
      return fallback || 'Estado da devolução inválido para exclusão.';
    default:
      return fallback || 'Erro ao excluir devolução.';
  }
}

function createDeleteDevolucaoError(
  code: DeleteDevolucaoRpcCode | string | undefined,
  fallback?: string
): DeleteDevolucaoError {
  const err = new Error(getDeleteDevolucaoMessage(code, fallback)) as DeleteDevolucaoError;
  err.code = code;
  return err;
}

type TransferirDevolucoesRpcResult = {
  error?: string;
  code?: TransferirDevolucoesRpcCode | string;
  saldo_atual?: number;
  valor_solicitado?: number;
  operacao_saida_id?: number;
  movimentacao_id?: number;
  operacao_entrada_id?: number | null;
  lancamento_destino_id?: string | null;
  devolucoes_atualizadas?: unknown[];
};

type TransferirDevolucoesError = Error & {
  code?: TransferirDevolucoesRpcCode | string;
  saldoAtual?: number;
  valorSolicitado?: number;
};

const formatCurrencyValue = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));

export function getTransferirDevolucoesMessage(
  code: TransferirDevolucoesRpcCode | string | undefined,
  fallback?: string,
  saldoAtual?: number,
  valorSolicitado?: number,
): string {
  switch (code) {
    case 'SALDO_DEVOLUCOES_INSUFICIENTE':
      return (
        `Saldo insuficiente no estoque DEVOLUCOES para transferir devoluções ` +
        `(saldo atual: ${formatCurrencyValue(saldoAtual)}, solicitado: ${formatCurrencyValue(valorSolicitado)}).`
      );
    case 'SOBRETRANSFERENCIA':
      return fallback || 'Valor informado excede o restante disponível da devolução.';
    case 'DEVOLUCAO_NAO_ENCONTRADA':
      return 'Uma ou mais devoluções não foram encontradas.';
    case 'DESTINO_INVALIDO':
      return 'Destino inválido para transferência.';
    case 'VALOR_INVALIDO':
      return fallback || 'Valor de transferência inválido.';
    case 'REQUEST_ID_INVALIDO':
      return 'Falha interna: request_id inválido para transferência.';
    case 'NAO_AUTENTICADO':
      return 'Usuário não autenticado.';
    default:
      return fallback || 'Erro ao transferir devoluções.';
  }
}

function createTransferirDevolucoesError(result: TransferirDevolucoesRpcResult): TransferirDevolucoesError {
  const err = new Error(
    getTransferirDevolucoesMessage(
      result.code,
      result.error,
      Number(result.saldo_atual || 0),
      Number(result.valor_solicitado || 0),
    ),
  ) as TransferirDevolucoesError;
  err.code = result.code;
  err.saldoAtual = result.saldo_atual;
  err.valorSolicitado = result.valor_solicitado;
  return err;
}

type CriarDevolucaoRpcResult = {
  error?: string;
  code?: CriarDevolucaoRpcCode | string;
  devolucao_id?: number;
  lancamento_caixa_id?: string;
  operacao_entrada_devolucoes_id?: number;
  conta_bancaria_id?: string;
  estoque_devolucoes_id?: number;
  tipo_origem_devolucao?: TipoOrigemDevolucao;
  face_titulos?: number;
  total_devolvido?: number;
  valor_solicitado?: number;
  saldo_disponivel?: number;
};

type CriarDevolucaoError = Error & {
  code?: CriarDevolucaoRpcCode | string;
};

function getCriarDevolucaoMessage(
  code: CriarDevolucaoRpcCode | string | undefined,
  fallback?: string,
  metadata?: CriarDevolucaoRpcResult,
) {
  switch (code) {
    case 'CONTA_SB_S0I2_NAO_ENCONTRADA':
      return 'Conta SB-S0I2 não encontrada. Por favor, crie a conta antes de registrar devoluções.';
    case 'CONTA_INVALIDA':
      return 'A devolução deve ser registrada na conta SB-S0I2.';
    case 'LIMITE_FACE_EXCEDIDO':
      return (
        fallback ||
        `Total de devoluções excede a Face dos Títulos ` +
          `(face: ${formatCurrencyValue(metadata?.face_titulos)}, ` +
          `já devolvido: ${formatCurrencyValue(metadata?.total_devolvido)}, ` +
          `solicitado: ${formatCurrencyValue(metadata?.valor_solicitado)}).`
      );
    case 'TIPO_ESTOQUE_INVALIDO':
      return 'Tipo de estoque inválido para devolução direta. Use SPPRO ou SOI.';
    case 'SALDO_ESTOQUE_ORIGEM_INSUFICIENTE':
      return (
        fallback ||
        `Valor da devolução excede o saldo disponível no estoque de origem ` +
          `(saldo: ${formatCurrencyValue(metadata?.saldo_disponivel)}, ` +
          `solicitado: ${formatCurrencyValue(metadata?.valor_solicitado)}).`
      );
    case 'OPERACAO_NAO_ENCONTRADA':
      return 'Operação de estoque não encontrada ou inválida para devolução.';
    case 'ESTOQUE_NAO_ENCONTRADO':
      return fallback || 'Nenhum estoque encontrado para o tipo informado.';
    case 'REQUEST_ID_INVALIDO':
      return 'Falha interna: request_id inválido para criação da devolução.';
    case 'NAO_AUTENTICADO':
      return 'Usuário não autenticado.';
    case 'EMPRESA_NAO_ENCONTRADA':
      return 'Empresa não encontrada para o usuário.';
    case 'DATA_INVALIDA':
      return 'Data da devolução inválida.';
    case 'VALOR_INVALIDO':
      return 'Valor da devolução deve ser maior que zero.';
    default:
      return fallback || 'Erro ao registrar devolução.';
  }
}

function createCriarDevolucaoError(result: CriarDevolucaoRpcResult): CriarDevolucaoError {
  const err = new Error(
    getCriarDevolucaoMessage(result.code, result.error, result),
  ) as CriarDevolucaoError;
  err.code = result.code;
  return err;
}

// Hook para listar estoques
export function useEstoques(tipo?: TipoEstoque) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['estoques', tipo, empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      let query = supabase
        .from('estoques')
        .select(`
          *,
          fornecedores:fornecedor_id (
            id,
            razao_social,
            nome_fantasia
          )
        `)
        .eq('empresa_id', empresaId)
        .eq('ativo', true)
        .order('descricao', { ascending: true });

      if (tipo) {
        query = query.eq('tipo', tipo);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Erro ao buscar estoques: ${error.message}`);
      }

      return (data || []) as Estoque[];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para buscar estoque por ID
export function useEstoque(id: number) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['estoque', id, empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data, error } = await supabase
        .from('estoques')
        .select(`
          *,
          fornecedores:fornecedor_id (
            id,
            razao_social,
            nome_fantasia
          )
        `)
        .eq('id', id)
        .eq('empresa_id', empresaId)
        .single();

      if (error) {
        throw new Error(`Erro ao buscar estoque: ${error.message}`);
      }

      if (!data) {
        throw new Error('Estoque não encontrado');
      }

      return data as Estoque;
    },
    enabled: !!id && !!empresaId,
    retry: false,
  });
}

// Hook para criar estoque
export function useCreateEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateEstoque) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const { data: estoque, error } = await supabase
        .from('estoques')
        .insert({
          ...data,
          created_by: session.user.id,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Erro ao criar estoque: ${error.message}`);
      }

      return estoque as Estoque;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      toast.success('Estoque criado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao criar estoque: ' + error.message);
    },
  });
}

// Hook para atualizar estoque
export function useUpdateEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateEstoque) => {
      const { data: estoque, error } = await supabase
        .from('estoques')
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Erro ao atualizar estoque: ${error.message}`);
      }

      return estoque as Estoque;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      toast.success('Estoque atualizado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao atualizar estoque: ' + error.message);
    },
  });
}

// Hook para listar operações de estoque
export function useOperacoesEstoque(filtros?: FiltrosOperacoesEstoque) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['operacoes-estoque', filtros, empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      let query = supabase
        .from('operacoes_estoque')
        .select(`
          *,
          estoques:estoque_id (
            id,
            tipo,
            descricao,
            saldo_atual
          ),
          fornecedores:fornecedor_id (
            id,
            razao_social,
            nome_fantasia
          ),
          contas_bancarias:conta_bancaria_id (
            id,
            descricao
          )
        `)
        .eq('empresa_id', empresaId)
        .order('data', { ascending: false })
        .order('id', { ascending: false });

      // Aplicar filtros
      if (filtros?.tipo_operacao) {
        query = query.eq('tipo_operacao', filtros.tipo_operacao);
      }

      if (filtros?.estoque_id) {
        query = query.eq('estoque_id', filtros.estoque_id);
      }

      if (filtros?.fornecedor_id && typeof filtros.fornecedor_id === 'string') {
        query = query.eq('fornecedor_id', filtros.fornecedor_id);
      }

      if (filtros?.conta_bancaria_id && typeof filtros.conta_bancaria_id === 'string') {
        query = query.eq('conta_bancaria_id', filtros.conta_bancaria_id);
      }

      if (filtros?.data_inicio) {
        query = query.gte('data', filtros.data_inicio);
      }

      if (filtros?.data_fim) {
        query = query.lte('data', filtros.data_fim);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Erro ao buscar operações: ${error.message}`);
      }

      let filtered = (data || []) as OperacaoEstoqueComRelacoes[];

      // Filtro por tipo_estoque (precisa filtrar após join)
      if (filtros?.tipo_estoque) {
        filtered = filtered.filter(op => {
          const estoque = Array.isArray(op.estoques) ? op.estoques[0] : op.estoques;
          return estoque?.tipo === filtros.tipo_estoque;
        });
      }

      // Mapear relações para formato esperado
      return filtered.map(op => {
        const estoque = Array.isArray(op.estoques) ? op.estoques[0] : op.estoques;
        const fornecedorRaw = Array.isArray(op.fornecedores) ? op.fornecedores[0] : op.fornecedores;
        const conta = Array.isArray(op.contas_bancarias) ? op.contas_bancarias[0] : op.contas_bancarias;
        
        // Mapear fornecedor para formato esperado
        interface FornecedorRaw {
          id: number;
          razao_social?: string;
          nome_fantasia?: string | null;
        }
        
        const fornecedor = fornecedorRaw ? {
          id: (fornecedorRaw as FornecedorRaw).id,
          nome: (fornecedorRaw as FornecedorRaw).razao_social || '',
          nome_fantasia: (fornecedorRaw as FornecedorRaw).nome_fantasia || null,
        } : null;

        return {
          ...op,
          estoques: estoque,
          fornecedores: fornecedor,
          contas_bancarias: conta,
        };
      }) as OperacaoEstoqueComRelacoes[];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para buscar operações de um fornecedor específico
export function useOperacoesFornecedor(
  fornecedorId: string | undefined,
  tipoEstoque: 'SPPRO' | 'SOI' | undefined,
  filters?: { data_inicio?: string; data_fim?: string; tipo_operacao?: 'entrada' | 'saida' }
) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['operacoes-fornecedor', fornecedorId, tipoEstoque, filters, empresaId],
    queryFn: async () => {
      if (!empresaId || !fornecedorId) {
        throw new Error('Empresa ou fornecedor não encontrado');
      }

      let query = supabase
        .from('operacoes_estoque')
        .select(`
          *,
          estoques:estoque_id (
            id,
            tipo,
            descricao,
            saldo_atual
          ),
          fornecedores:fornecedor_id (
            id,
            razao_social,
            nome_fantasia
          ),
          contas_bancarias:conta_bancaria_id (
            id,
            descricao
          )
        `)
        .eq('empresa_id', empresaId)
        .eq('fornecedor_id', fornecedorId)
        .order('data', { ascending: false })
        .order('id', { ascending: false });

      // Aplicar filtros opcionais
      if (filters?.tipo_operacao) {
        query = query.eq('tipo_operacao', filters.tipo_operacao);
      }

      if (filters?.data_inicio) {
        query = query.gte('data', filters.data_inicio);
      }

      if (filters?.data_fim) {
        query = query.lte('data', filters.data_fim);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Erro ao buscar operações do fornecedor: ${error.message}`);
      }

      let filtered = (data || []) as OperacaoEstoqueComRelacoes[];

      // Filtro por tipo_estoque (precisa filtrar após join) - apenas se tipoEstoque foi especificado
      if (tipoEstoque) {
        filtered = filtered.filter(op => {
          const estoque = Array.isArray(op.estoques) ? op.estoques[0] : op.estoques;
          return estoque?.tipo === tipoEstoque;
        });
      }

      // Mapear relações para formato esperado
      return filtered.map(op => {
        const estoque = Array.isArray(op.estoques) ? op.estoques[0] : op.estoques;
        const fornecedorRaw = Array.isArray(op.fornecedores) ? op.fornecedores[0] : op.fornecedores;
        const conta = Array.isArray(op.contas_bancarias) ? op.contas_bancarias[0] : op.contas_bancarias;
        
        // Mapear fornecedor para formato esperado
        interface FornecedorRaw {
          id: number;
          razao_social?: string;
          nome_fantasia?: string | null;
        }
        
        const fornecedor = fornecedorRaw ? {
          id: (fornecedorRaw as FornecedorRaw).id,
          nome: (fornecedorRaw as FornecedorRaw).razao_social || '',
          nome_fantasia: (fornecedorRaw as FornecedorRaw).nome_fantasia || null,
        } : null;

        return {
          ...op,
          estoques: estoque,
          fornecedores: fornecedor,
          contas_bancarias: conta,
        };
      }) as OperacaoEstoqueComRelacoes[];
    },
    enabled: !!empresaId && !!fornecedorId,
    retry: false,
  });
}

// Interface para fornecedor com operações
export interface FornecedorComOperacoes {
  fornecedor_id: string;
  fornecedor_nome: string;
  total_operacoes: number;
  total_entradas: number;
  total_saidas: number;
  total_liquido: number;
  ultima_operacao: string | null;
}

// Hook para buscar fornecedores que possuem operações do tipo especificado
export function useFornecedoresComOperacoes(tipoEstoque: 'SPPRO' | 'SOI') {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['fornecedores-com-operacoes', tipoEstoque, empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      // Primeiro, buscar todos os estoques do tipo especificado
      const { data: estoques, error: estoquesError } = await supabase
        .from('estoques')
        .select('id')
        .eq('empresa_id', empresaId)
        .eq('tipo', tipoEstoque)
        .eq('ativo', true);

      if (estoquesError) {
        throw new Error(`Erro ao buscar estoques: ${estoquesError.message}`);
      }

      if (!estoques || estoques.length === 0) {
        return [] as FornecedorComOperacoes[];
      }

      const estoqueIds = estoques.map(e => e.id);

      // Buscar operações agrupadas por fornecedor
      const { data: operacoes, error: operacoesError } = await supabase
        .from('operacoes_estoque')
        .select(`
          fornecedor_id,
          tipo_operacao,
          liquido_operacao,
          data,
          fornecedores:fornecedor_id (
            id,
            razao_social,
            nome_fantasia
          )
        `)
        .eq('empresa_id', empresaId)
        .in('estoque_id', estoqueIds)
        .not('fornecedor_id', 'is', null);

      if (operacoesError) {
        throw new Error(`Erro ao buscar operações: ${operacoesError.message}`);
      }

      // Agrupar por fornecedor e calcular estatísticas
      const fornecedoresMap = new Map<string, {
        fornecedor_id: string;
        fornecedor_nome: string;
        operacoes: Array<{ tipo: string; liquido: number; data: string }>;
      }>();

      (operacoes || []).forEach((op: any) => {
        if (!op.fornecedor_id) return;

        const fornecedorId = op.fornecedor_id;
        const fornecedorRaw = Array.isArray(op.fornecedores) ? op.fornecedores[0] : op.fornecedores;
        const fornecedorNome = fornecedorRaw?.razao_social || fornecedorRaw?.nome_fantasia || 'Fornecedor sem nome';

        if (!fornecedoresMap.has(fornecedorId)) {
          fornecedoresMap.set(fornecedorId, {
            fornecedor_id: fornecedorId,
            fornecedor_nome: fornecedorNome,
            operacoes: [],
          });
        }

        const fornecedor = fornecedoresMap.get(fornecedorId)!;
        fornecedor.operacoes.push({
          tipo: op.tipo_operacao,
          liquido: Number(op.liquido_operacao) || 0,
          data: op.data,
        });
      });

      // Calcular estatísticas para cada fornecedor
      const resultado: FornecedorComOperacoes[] = Array.from(fornecedoresMap.values()).map(fornecedor => {
        const totalEntradas = fornecedor.operacoes
          .filter(op => op.tipo === 'entrada')
          .reduce((sum, op) => sum + op.liquido, 0);

        const totalSaidas = fornecedor.operacoes
          .filter(op => op.tipo === 'saida')
          .reduce((sum, op) => sum + op.liquido, 0);

        const ultimaOperacao = fornecedor.operacoes
          .sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())[0]?.data || null;

        return {
          fornecedor_id: fornecedor.fornecedor_id,
          fornecedor_nome: fornecedor.fornecedor_nome,
          total_operacoes: fornecedor.operacoes.length,
          total_entradas: totalEntradas,
          total_saidas: totalSaidas,
          total_liquido: totalEntradas - totalSaidas,
          ultima_operacao: ultimaOperacao,
        };
      });

      // Ordenar por nome do fornecedor
      return resultado.sort((a, b) => a.fornecedor_nome.localeCompare(b.fornecedor_nome));
    },
    enabled: !!empresaId,
    retry: false,
  });
}

export interface MovimentacaoEstoqueHistorico {
  id: number;
  tipo: TipoTransferencia;
  valor: number;
  data: string;
  historico: string | null;
  conta_bancaria?: {
    id: string;
    descricao: string | null;
  } | null;
  conta_bancaria_origem?: {
    id: string;
    descricao: string | null;
  } | null;
  conta_bancaria_destino?: {
    id: string;
    descricao: string | null;
  } | null;
  estoque_origem?: {
    id: number;
    descricao: string | null;
    tipo: TipoEstoque;
  } | null;
  estoque_destino?: {
    id: number;
    descricao: string | null;
    tipo: TipoEstoque;
  } | null;
}

// Hook para buscar movimentações como lançamentos (para exibir na página de lançamentos)
export function useMovimentacoesComoLancamentos() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['movimentacoes-como-lancamentos', empresaId],
    ...CRITICAL_FINANCIAL_QUERY_POLICY,
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      // Buscar movimentações através de operações de estoque da empresa
      // ou através de estoques/contas da empresa
      const { data, error } = await supabase
        .from('movimentacoes_estoque')
        .select(`
          id,
          tipo,
          valor,
          data,
          historico,
          created_at,
          conta_bancaria_id,
          conta_bancaria_destino_id,
          estoque_origem_id,
          estoque_destino_id,
          operacao_estoque_id,
          contas_bancarias:conta_bancaria_id(id, descricao),
          estoque_origem:estoque_origem_id(id, tipo, descricao, empresa_id),
          estoque_destino:estoque_destino_id(id, tipo, descricao, empresa_id),
          operacoes_estoque:operacao_estoque_id(id, empresa_id)
        `)
        .order('data', { ascending: false })
        .order('id', { ascending: false });

      if (error) throw error;

      // Filtrar movimentações da empresa
      const movimentacoesFiltradas = (data || []).filter((mov: any) => {
        // Verificar se está vinculada a uma operação da empresa
        if (mov.operacoes_estoque?.empresa_id === empresaId) {
          return true;
        }
        // Verificar se está vinculada a um estoque da empresa
        if (mov.estoque_origem?.empresa_id === empresaId || mov.estoque_destino?.empresa_id === empresaId) {
          return true;
        }
        // Verificar se está vinculada a uma conta da empresa (através do relacionamento)
        // Se não tem operação nem estoque, mas tem conta_bancaria_id, precisamos verificar a conta
        if (mov.conta_bancaria_id && !mov.operacoes_estoque && !mov.estoque_origem && !mov.estoque_destino) {
          // Vamos incluir e depois verificar a conta no frontend se necessário
          return true;
        }
        return false;
      }).filter((mov: any) => !isMovimentacaoTipoRedundanteNaListaMista(mov.tipo));

      // Converter movimentações para formato de lançamento
      return movimentacoesFiltradas.map((mov: any) => {
        let historico = '';
        let observacoes = '';
        let conta_bancaria_id = null;

        switch (mov.tipo) {
          case 'conta_para_estoque':
            historico = `Transferência para ${mov.estoque_destino?.descricao || 'Estoque'} (${mov.estoque_destino?.tipo || ''})`;
            observacoes = 'Transferência Conta → Estoque';
            conta_bancaria_id = mov.conta_bancaria_id;
            break;
          case 'estoque_para_conta':
            historico = `Transferência de ${mov.estoque_origem?.descricao || 'Estoque'} (${mov.estoque_origem?.tipo || ''})`;
            observacoes = 'Transferência Estoque → Conta';
            conta_bancaria_id = mov.conta_bancaria_id;
            break;
          case 'estoque_para_estoque':
            historico = `Transferência ${mov.estoque_origem?.tipo || ''} → ${mov.estoque_destino?.tipo || ''}`;
            observacoes = 'Transferência Estoque → Estoque';
            conta_bancaria_id = null;
            break;
          default:
            historico = mov.historico || 'Movimentação';
            observacoes = `Movimentação ${mov.tipo}`;
        }

        return {
          id: `mov_${mov.id}`, // Prefixo para diferenciar de lançamentos normais
          data: mov.data,
          historico,
          tipo: mov.tipo === 'estoque_para_conta' ? 'entrada' : 'saida',
          valor: mov.valor,
          documento: null,
          conta_bancaria_id,
          conta_bancaria_destino_id: mov.conta_bancaria_destino_id ?? null,
          grupo_contas_id: null,
          observacoes,
          created_at: mov.created_at,
          updated_at: mov.created_at,
          contas_bancarias: mov.contas_bancarias,
          grupos_contas: null,
          _isMovimentacao: true, // Flag para identificar que é movimentação
          _movimentacaoOriginal: mov // Dados originais da movimentação
        };
      });
    },
    enabled: !!empresaId,
  });
}

export function useMovimentacoesEstoqueHistorico(limit = 20) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['movimentacoes-estoque', empresaId, limit],
    enabled: !!empresaId,
    retry: false,
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data, error } = await supabase
        .from('movimentacoes_estoque')
        .select(`
          id,
          tipo,
          valor,
          data,
          historico,
          conta_bancaria_id,
          conta_origem_id,
          conta_bancaria_destino_id,
          estoque_origem_id,
          estoque_destino_id,
          contas_bancarias:conta_bancaria_id ( id, descricao ),
          conta_origem:conta_origem_id ( id, descricao ),
          conta_bancaria_origem:conta_bancaria_id ( id, descricao ),
          conta_bancaria_destino:conta_bancaria_destino_id ( id, descricao ),
          estoque_origem:estoque_origem_id ( id, descricao, tipo ),
          estoque_destino:estoque_destino_id ( id, descricao, tipo )
        `)
        .order('data', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Erro ao buscar movimentações: ${error.message}`);
      }

      return (data || []).map((mov) => ({
        id: mov.id,
        tipo: mov.tipo as TipoTransferencia,
        valor: Number(mov.valor) || 0,
        data: mov.data,
        historico: mov.historico,
        conta_bancaria: Array.isArray(mov.contas_bancarias)
          ? mov.contas_bancarias[0]
          : mov.contas_bancarias,
        conta_bancaria_origem: Array.isArray(mov.conta_bancaria_origem)
          ? mov.conta_bancaria_origem[0]
          : mov.conta_bancaria_origem,
        conta_bancaria_destino: Array.isArray(mov.conta_bancaria_destino)
          ? mov.conta_bancaria_destino[0]
          : mov.conta_bancaria_destino,
        estoque_origem: Array.isArray(mov.estoque_origem)
          ? mov.estoque_origem[0]
          : mov.estoque_origem,
        estoque_destino: Array.isArray(mov.estoque_destino)
          ? mov.estoque_destino[0]
          : mov.estoque_destino,
      })) as MovimentacaoEstoqueHistorico[];
    },
  });
}

// Hook para criar operação de estoque
export function useCreateOperacaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateOperacaoEstoque & {
      distribuicoes?: DistribuicaoConta[];
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      // Validar que o estoque corresponde ao tipo_estoque
      const { data: estoque, error: estoqueError } = await supabase
        .from('estoques')
        .select('id, tipo, saldo_atual')
        .eq('id', data.estoque_id)
        .single();

      if (estoqueError || !estoque) {
        throw new Error(`Erro ao buscar estoque: ${estoqueError?.message || 'Estoque não encontrado'}`);
      }

      // Normalizar tipo do estoque (pode estar em diferentes formatos)
      const tipoEstoqueNormalizado = typeof estoque.tipo === 'string' 
        ? estoque.tipo.trim().toUpperCase() 
        : '';
      const tipoEsperado = data.tipo_estoque.toUpperCase();

      // Validar correspondência de tipo
      if (tipoEstoqueNormalizado !== tipoEsperado) {
        throw new Error(
          `Tipo de estoque incompatível: o estoque selecionado é do tipo "${tipoEstoqueNormalizado}" mas a operação é do tipo "${tipoEsperado}". ` +
          `Selecione um estoque do tipo correto.`
        );
      }

      // Calcular líquido automaticamente
      let liquido_operacao = 0;

      if (data.tipo_estoque === 'SPPRO') {
        liquido_operacao = calcularLiquidoSPPRO({
          face_titulos: data.face_titulos,
          valor_compra: data.valor_compra,
          ad_valorem: data.ad_valorem || 0,
          iss: data.iss || 0,
          iof: data.iof || 0,
          iof_adicional: (data as any).iof_adicional || 0, // Usado apenas no cálculo, não salvo no banco
          despesas: data.despesas || 0,
          recompra: data.recompra || 0,
          amortizacao_debitos: (data as any).amortizacao_debitos || 0,
          amortizacao_creditos: (data as any).amortizacao_creditos || 0,
        });
      } else if (data.tipo_estoque === 'SOI') {
        liquido_operacao = calcularLiquidoSOI({
          face_titulos: data.face_titulos,
          valor_compra: data.valor_compra,
          despesas: data.despesas || 0,
          recompra: data.recompra || 0,
          amortizacao_debitos: data.amortizacao_debitos || 0,
          amortizacao_creditos: data.amortizacao_creditos || 0,
        });
      }

      // Validar saldo suficiente para operações de saída
      if (data.tipo_operacao === 'saida' && liquido_operacao > 0) {
        const saldoAtual = Number(estoque.saldo_atual ?? 0);
        if (saldoAtual < liquido_operacao) {
          throw new Error(
            `Saldo insuficiente no estoque. Saldo atual: R$ ${saldoAtual.toFixed(2)}, ` +
            `Valor necessário: R$ ${liquido_operacao.toFixed(2)}`
          );
        }
        
        logger.debug(`✅ Validação de saldo: Saldo atual (${saldoAtual}) >= Líquido operação (${liquido_operacao})`);
      }

      // Preparar dados para inserção
      interface InsertData {
        empresa_id: string; // UUID
        estoque_id: number;
        tipo_operacao: string;
        data: string;
        face_titulos: number;
        valor_compra: number;
        despesas: number;
        recompra: number;
        liquido_operacao: number;
        fornecedor_id?: string | null; // UUID
        conta_bancaria_id?: string | null; // UUID
        historico?: string | null;
        documento?: string | null;
        observacoes?: string | null;
        created_by: string;
        ad_valorem?: number | null;
        iss?: number | null;
        iof?: number | null;
        amortizacao_debitos?: number | null;
        amortizacao_creditos?: number | null;
      }

      const insertData: InsertData = {
        empresa_id: data.empresa_id,
        estoque_id: data.estoque_id,
        tipo_operacao: data.tipo_operacao,
        data: data.data,
        face_titulos: data.face_titulos,
        valor_compra: data.valor_compra,
        despesas: data.despesas || 0,
        recompra: data.recompra || 0,
        liquido_operacao,
        fornecedor_id: data.fornecedor_id || null,
        conta_bancaria_id: data.conta_bancaria_id || null,
        historico: data.historico || null,
        documento: data.documento || null,
        observacoes: data.observacoes || null,
        created_by: session.user.id,
      };

      // Campos específicos por tipo
      if (data.tipo_estoque === 'SPPRO') {
        insertData.ad_valorem = data.ad_valorem || 0;
        insertData.iss = data.iss || 0;
        insertData.iof = data.iof || 0;
        // iof_adicional não existe na tabela, removido
        insertData.amortizacao_debitos = null;
        insertData.amortizacao_creditos = null;
      } else {
        insertData.ad_valorem = null;
        insertData.iss = null;
        insertData.iof = null;
        // iof_adicional não existe na tabela, removido
        insertData.amortizacao_debitos = data.amortizacao_debitos || 0;
        insertData.amortizacao_creditos = data.amortizacao_creditos || 0;
      }

      // Log em desenvolvimento
      logger.debug('📝 Criando operação com dados:', {
        ...insertData,
        distribuicoes: data.distribuicoes?.length || 0,
      });

      // Inserir no banco
      const { data: operacao, error } = await supabase
        .from('operacoes_estoque')
        .insert(insertData)
        .select()
        .single();

      if (error) {
        logger.error('❌ Erro ao criar operação:', error);
        throw new Error(`Erro ao criar operação: ${error.message}`);
      }

      logger.debug('✅ Operação criada:', operacao.id);

      // Função auxiliar para normalizar valor monetário (formato brasileiro e americano)
      const normalizeMonetaryValue = (value: string | number): number => {
        if (typeof value === 'number') return value;
        if (typeof value !== 'string') return 0;
        
        // Remove espaços e caracteres não numéricos exceto vírgula e ponto
        const cleaned = value.replace(/[^\d,.-]/g, '');
        
        // Se tem vírgula e ponto, assume formato brasileiro (1.000,50)
        if (cleaned.includes(',') && cleaned.includes('.')) {
          return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
        }
        
        // Se só tem vírgula, assume como decimal (1000,50)
        if (cleaned.includes(',') && !cleaned.includes('.')) {
          return parseFloat(cleaned.replace(',', '.')) || 0;
        }
        
        // Caso padrão: ponto como decimal
        return parseFloat(cleaned) || 0;
      };

      const faceTitulosTotal = normalizeMonetaryValue(data.face_titulos);

      // Logs de debug
      logger.debug('[ESTOQUE] face_titulos recebido:', data.face_titulos);
      logger.debug('[ESTOQUE] faceTitulosTotal calculado:', faceTitulosTotal);
      logger.debug('[ESTOQUE] tipo_operacao:', data.tipo_operacao);
      logger.debug('[ESTOQUE] estoque_id:', data.estoque_id);

      // Validação explícita do valor da face (para evitar seguir fluxo com NaN/Infinity)
      if (!Number.isFinite(faceTitulosTotal) || faceTitulosTotal < 0) {
        logger.error('[ESTOQUE ERROR] faceTitulosTotal inválido:', faceTitulosTotal, 'tipo:', typeof faceTitulosTotal);
        throw new Error(`Valor de face dos títulos inválido: ${String(data.face_titulos)}`);
      }

      const estoqueIdNum = Number(data.estoque_id);
      if (!Number.isFinite(estoqueIdNum) || estoqueIdNum <= 0) {
        logger.error('[ESTOQUE ERROR] estoque_id inválido:', data.estoque_id);
        throw new Error(`Estoque ID inválido: ${String(data.estoque_id)}`);
      }

      const ajustarSaldoEstoque = async (amount: number) => {
        const valor = Number(amount) || 0;
        if (valor === 0) {
          logger.debug('[ESTOQUE] ⚠️ ajustarSaldoEstoque: valor é zero, ignorando');
          return;
        }

        if (!Number.isFinite(valor)) {
          logger.error('[ESTOQUE ERROR] ajustarSaldoEstoque: valor inválido:', valor);
          throw new Error(`Valor inválido para ajustar saldo: ${String(amount)}`);
        }

        logger.debug(`[ESTOQUE] 🔄 ajustarSaldoEstoque: Tentando ajustar saldo em ${valor} para estoque ${estoqueIdNum}`);

        // Verificar se o estoque existe antes de tentar atualizar
        const { data: estoqueInfo, error: estoqueInfoError } = await supabase
          .from('estoques')
          .select('id, saldo_atual, ativo')
          .eq('id', estoqueIdNum)
          .single();

        if (estoqueInfoError || !estoqueInfo) {
          const errorMsg = `Estoque não encontrado: ${estoqueIdNum}`;
          logger.error('[ESTOQUE ERROR]', errorMsg, estoqueInfoError);
          throw new Error(errorMsg);
        }

        if (!estoqueInfo.ativo) {
          logger.warn('[ESTOQUE WARNING] Estoque inativo, mas atualizando saldo mesmo assim');
        }

        const saldoAnterior = Number(estoqueInfo.saldo_atual ?? 0);
        logger.debug('[ESTOQUE] Saldo anterior:', saldoAnterior);

        // Tentar usar RPC increment primeiro (atômico e seguro) com 1 retry
        let updateError: any | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          const { error: rpcErr } = await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: estoqueIdNum,
            amount_column: 'saldo_atual',
            amount: Number(valor),
          });

          if (!rpcErr) {
            updateError = null;
            break;
          }

          updateError = rpcErr;
          logger.error(`[ESTOQUE ERROR] RPC increment falhou (tentativa ${attempt}/2):`, rpcErr);

          if (attempt === 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
        }

        if (updateError) {
          logger.debug('[ESTOQUE] Usando fallback manual...');

          // Fallback manual: buscar saldo atual e atualizar
          const { data: estoqueAtual, error: estoqueError } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', estoqueIdNum)
            .single();

          if (estoqueError || !estoqueAtual) {
            const errorMsg = estoqueError?.message || updateError.message;
            logger.error('[ESTOQUE ERROR] ❌ Erro ao buscar estoque para fallback:', errorMsg);
            throw new Error(errorMsg);
          }

          const saldoAtual = Number(estoqueAtual.saldo_atual ?? 0);
          const novoSaldo = saldoAtual + valor;

          logger.debug(`[ESTOQUE] 📊 Fallback manual: saldo atual ${saldoAtual} + ${valor} = ${novoSaldo}`);

          const { error: fallbackError } = await supabase
            .from('estoques')
            .update({ saldo_atual: novoSaldo })
            .eq('id', estoqueIdNum);

          if (fallbackError) {
            logger.error('[ESTOQUE ERROR] ❌ Erro no fallback manual:', fallbackError.message);
            throw new Error(fallbackError.message);
          }

          // Verificar se realmente atualizou (fallback)
          const { data: estoqueVerificadoFallback } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', estoqueIdNum)
            .single();

          if (estoqueVerificadoFallback) {
            const novoSaldoVerificado = Number(estoqueVerificadoFallback.saldo_atual ?? 0);
            logger.debug('[ESTOQUE] ✅ Saldo atualizado via fallback. Novo saldo:', novoSaldoVerificado);
            
            // Verificar se realmente mudou
            if (Math.abs(novoSaldoVerificado - saldoAnterior - valor) > 0.01) {
              logger.error('[ESTOQUE ERROR] Saldo não foi atualizado corretamente no fallback!');
              toast.error(`Atenção: Saldo do estoque pode não ter sido atualizado corretamente.`);
            }
          }
        } else {
          // RPC funcionou, verificar se realmente atualizou
          const { data: estoqueVerificado } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', estoqueIdNum)
            .single();
          
          if (estoqueVerificado) {
            const novoSaldo = Number(estoqueVerificado.saldo_atual ?? 0);
            logger.debug('[ESTOQUE] ✅ Saldo após RPC:', novoSaldo);
            
            // Verificar se realmente mudou
            if (Math.abs(novoSaldo - saldoAnterior - valor) > 0.01) {
              logger.error('[ESTOQUE ERROR] Saldo não foi atualizado corretamente via RPC!');
              logger.error(`[ESTOQUE ERROR] Esperado: ${saldoAnterior + valor}, Obtido: ${novoSaldo}`);
              toast.error(`Atenção: Saldo do estoque pode não ter sido atualizado corretamente.`);
            } else {
              logger.debug('[ESTOQUE] ✅ Saldo atualizado corretamente via RPC');
            }
          } else {
            logger.warn('[ESTOQUE WARNING] Não foi possível verificar saldo após RPC');
          }
        }
      };

      // Ajustar saldo IMEDIATAMENTE após criar a operação (antes de lançamentos/distribuições).
      // Se qualquer etapa posterior falhar, pelo menos o saldo da face terá sido aplicado.
      if (data.tipo_operacao === 'entrada' && faceTitulosTotal > 0) {
        if (!operacao?.id) {
          throw new Error('Operação não foi criada corretamente (sem id)');
        }

        logger.debug('[ESTOQUE] ✅ Ajuste de saldo (pré-lançamentos) iniciando...');
        logger.debug('[ESTOQUE] Operação ID:', operacao.id);
        logger.debug('[ESTOQUE] Estoque ID:', estoqueIdNum);
        logger.debug('[ESTOQUE] Valor a somar (face):', faceTitulosTotal);

        // Capturar saldo anterior para verificação pós-ajuste
        const { data: estoqueAntes, error: estoqueAntesErr } = await supabase
          .from('estoques')
          .select('saldo_atual')
          .eq('id', estoqueIdNum)
          .single();

        if (estoqueAntesErr) {
          logger.error('[ESTOQUE ERROR] Não foi possível buscar saldo anterior:', estoqueAntesErr);
          throw new Error(`Erro ao buscar saldo do estoque antes do ajuste: ${estoqueAntesErr.message}`);
        }

        const saldoAnteriorParaVerificar = Number(estoqueAntes?.saldo_atual ?? 0);

        try {
          await ajustarSaldoEstoque(faceTitulosTotal);
        } catch (err) {
          logger.error('[ESTOQUE ERROR] ❌ Falha ao ajustar saldo do estoque:', err);
          toast.error(`Erro ao atualizar saldo do estoque: ${err instanceof Error ? err.message : 'Erro desconhecido'}`);
          throw err instanceof Error ? err : new Error('Erro desconhecido ao ajustar saldo do estoque');
        }

        // Verificação final pós-criação (anti-cache/anti-lag)
        await new Promise((resolve) => setTimeout(resolve, 100));

        const { data: estoqueDepois, error: estoqueDepoisErr } = await supabase
          .from('estoques')
          .select('saldo_atual')
          .eq('id', estoqueIdNum)
          .single();

        if (estoqueDepoisErr) {
          logger.error('[ESTOQUE ERROR] Não foi possível buscar saldo após ajuste:', estoqueDepoisErr);
          throw new Error(`Erro ao buscar saldo do estoque após o ajuste: ${estoqueDepoisErr.message}`);
        }

        const saldoDepois = Number(estoqueDepois?.saldo_atual ?? 0);
        const saldoEsperado = saldoAnteriorParaVerificar + faceTitulosTotal;

        if (Math.abs(saldoDepois - saldoEsperado) > 0.01) {
          logger.error('[ESTOQUE ERROR] Saldo pós-ajuste divergente!');
          logger.error('[ESTOQUE ERROR] Esperado:', saldoEsperado, 'Obtido:', saldoDepois);

          // Tentar corrigir automaticamente (último recurso)
          const { error: fixErr } = await supabase
            .from('estoques')
            .update({ saldo_atual: saldoEsperado })
            .eq('id', estoqueIdNum);

          if (fixErr) {
            logger.error('[ESTOQUE ERROR] Falha ao corrigir saldo manualmente:', fixErr);
            toast.error('Saldo do estoque não foi atualizado corretamente e a correção automática falhou.');
          } else {
            logger.debug('[ESTOQUE] ✅ Saldo corrigido manualmente para o valor esperado.');
            toast.warning('Saldo do estoque foi corrigido automaticamente. Verifique o resultado.');
          }
        } else {
          logger.debug('[ESTOQUE] ✅ Verificação pós-ajuste OK:', saldoDepois);
        }
      }

      // Criar lançamento de caixa para a operação de estoque
      // IMPORTANTE: O líquido da operação representa o dinheiro que SAI da conta ao comprar títulos
      // REGRA: 
      // - Se NÃO há distribuições: criar APENAS UM lançamento com a conta bancária da operação
      // - Se HÁ distribuições: NÃO criar lançamento principal, apenas os de distribuição
      const temDistribuicoes = data.distribuicoes && data.distribuicoes.length > 0;
      
      if (data.tipo_operacao === 'entrada' && liquido_operacao > 0) {
        // Se NÃO há distribuições, criar lançamento principal
        if (!temDistribuicoes) {
          // Validar que tem conta bancária
          if (!data.conta_bancaria_id) {
            throw new Error('Operação de entrada requer conta bancária ou distribuições para criar lançamento de caixa');
          }

          const tipoEstoqueLabel = data.tipo_estoque === 'SPPRO' ? 'SPPRO' : 'SOI';
          const historicoLancamento = data.historico 
            ? `Operação ${tipoEstoqueLabel} #${operacao.id} - ${data.historico}`
            : `Operação ${tipoEstoqueLabel} #${operacao.id}`;

          const lancDataOperacao = {
            empresa_id: data.empresa_id,
            conta_bancaria_id: data.conta_bancaria_id,
            grupo_contas_id: null,
            data: data.data,
            historico: historicoLancamento,
            tipo: 'saida' as const, // Líquido sai da conta ao comprar títulos
            valor: liquido_operacao,
            documento: data.documento || null,
            observacoes: `Operação de estoque ${tipoEstoqueLabel} - Líquido: R$ ${liquido_operacao.toFixed(2)}`,
          };

          logger.debug('💰 Criando lançamento de caixa para operação (sem distribuições):', lancDataOperacao);

          const { error: lancOperacaoError } = await supabase
            .from('lancamentos_caixa')
            .insert(lancDataOperacao);

          if (lancOperacaoError) {
            logger.error('❌ Erro ao criar lançamento de caixa da operação:', lancOperacaoError);
            throw new Error(`Erro ao criar lançamento de caixa: ${lancOperacaoError.message}`);
          }
        } else {
          // Se há distribuições, NÃO criar lançamento principal
          // Os lançamentos serão criados apenas nas distribuições
          logger.debug('💰 Operação com distribuições: lançamento principal será criado apenas nas distribuições');
        }
      }

      // SAÍDA não altera o saldo e, para ENTRADA, o saldo já foi ajustado antes dos lançamentos/distribuições.

      if (temDistribuicoes) {
        for (const distribuicao of data.distribuicoes) {
          if (distribuicao.conta_bancaria_id && distribuicao.valor > 0) {
            // Criar movimentação de estoque
            const movData = {
              operacao_estoque_id: operacao.id,
              tipo: 'distribuicao_conta' as const,
              valor: distribuicao.valor,
              conta_bancaria_id: distribuicao.conta_bancaria_id,
              data: data.data,
              historico: `Distribuição de líquido - Operação #${operacao.id}`,
            };

            logger.debug('📦 Criando movimentação:', movData);

            const { error: movError } = await supabase
              .from('movimentacoes_estoque')
              .insert(movData);

            if (movError) {
              logger.error('❌ Erro ao criar movimentação:', movError);
              throw new Error(`Erro ao criar movimentação: ${movError.message}`);
            }

            // Criar lançamento de caixa para a distribuição específica
            // IMPORTANTE: Quando há distribuições, NÃO criamos lançamento principal
            // Cada distribuição cria seu próprio lançamento de saída
            const lancData = {
              empresa_id: data.empresa_id,
              conta_bancaria_id: distribuicao.conta_bancaria_id,
              grupo_contas_id: null,
              data: data.data,
              historico: `Distribuição Operação #${operacao.id} - ${data.historico || 'Operação de estoque'}`,
              tipo: 'saida' as const,
              valor: distribuicao.valor,
              documento: data.documento || null,
              observacoes: `Distribuição do líquido da operação de estoque #${operacao.id}`,
            };

            logger.debug('💰 Criando lançamento de caixa adicional (distribuição):', lancData);

            const { error: lancError } = await supabase
              .from('lancamentos_caixa')
              .insert(lancData);

            if (lancError) {
              logger.error('❌ Erro ao criar lançamento de caixa:', lancError);
              throw new Error(`Erro ao criar lançamento de caixa: ${lancError.message}`);
            }

            // NOTA: As distribuições NÃO afetam o saldo do estoque.
            // O saldo do estoque é ajustado apenas pela FACE DOS TÍTULOS (linha 1056).
            // As distribuições são apenas movimentações do líquido para contas bancárias
            // e não devem alterar o saldo do estoque, que representa o valor total dos títulos.
          }
        }
      }

      return operacao as OperacaoEstoqueComRelacoes;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      toast.success('Operação de estoque criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao criar operação de estoque: ' + error.message);
    },
  });
}

export function useRegistrarRecompra() {
  const queryClient = useQueryClient();

  return useMutation<RegistrarRecompraResult, Error, RegistrarRecompraInput>({
    mutationFn: async ({ operacao, tipoEstoque, valor, data, historico, observacoes }) => {
      const valorRecompra = Number(valor);
      if (!Number.isFinite(valorRecompra) || valorRecompra <= 0) {
        throw new Error('Valor da recompra deve ser maior que zero');
      }

      if (!data || !data.trim()) {
        throw new Error('Data da recompra é obrigatória');
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const totalRecompraAtual = Number(operacao.recompra) || 0;
      const novoTotalRecompra = totalRecompraAtual + valorRecompra;

      const calcularLiquido = () => {
        if (tipoEstoque === 'SPPRO') {
          return calcularLiquidoSPPRO({
            face_titulos: Number(operacao.face_titulos) || 0,
            valor_compra: Number(operacao.valor_compra) || 0,
            ad_valorem: Number(operacao.ad_valorem) || 0,
            iss: Number(operacao.iss) || 0,
            iof: Number(operacao.iof) || 0,
            iof_adicional: Number((operacao as any).iof_adicional) || 0,
            despesas: Number(operacao.despesas) || 0,
            recompra: novoTotalRecompra,
            amortizacao_debitos: Number(operacao.amortizacao_debitos) || 0,
            amortizacao_creditos: Number(operacao.amortizacao_creditos) || 0,
          });
        }

        return calcularLiquidoSOI({
          face_titulos: Number(operacao.face_titulos) || 0,
          valor_compra: Number(operacao.valor_compra) || 0,
          despesas: Number(operacao.despesas) || 0,
          recompra: novoTotalRecompra,
          amortizacao_debitos: Number(operacao.amortizacao_debitos) || 0,
          amortizacao_creditos: Number(operacao.amortizacao_creditos) || 0,
        });
      };

      const novoLiquido = calcularLiquido();
      const liquidoAnterior = Number(operacao.liquido_operacao) || 0;
      const diferencaLiquido = novoLiquido - liquidoAnterior;

      const atualizarOperacao = async (recompraValue: number, liquidoValue: number) => {
        const { error } = await supabase
          .from('operacoes_estoque')
          .update({
            recompra: recompraValue,
            liquido_operacao: liquidoValue,
          })
          .eq('id', operacao.id);

        if (error) {
          throw new Error(error.message);
        }
      };

      const ajustarSaldoEstoque = async (amount: number) => {
        if (amount === 0 || operacao.tipo_operacao !== 'entrada') {
          logger.debug('⚠️ ajustarSaldoEstoque (recompra): valor é zero ou não é entrada, ignorando');
          return;
        }

        logger.debug(`🔄 ajustarSaldoEstoque (recompra): Tentando ajustar saldo em ${amount} para estoque ${operacao.estoque_id}`);

        const { error: rpcError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: Number(operacao.estoque_id),
          amount_column: 'saldo_atual',
          amount: Number(amount),
        });

        if (rpcError) {
          if (process.env.NODE_ENV === 'development') {
            logger.warn('⚠️ RPC increment falhou (recompra), usando fallback manual:', rpcError.message);
          }

          const { data: estoqueAtual, error: estoqueError } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', operacao.estoque_id)
            .single();

          if (estoqueError || !estoqueAtual) {
            const errorMsg = estoqueError?.message || 'Erro ao buscar saldo do estoque';
            logger.error('❌ Erro ao buscar estoque para fallback (recompra):', errorMsg);
            throw new Error(errorMsg);
          }

          const saldoAtual = Number(estoqueAtual.saldo_atual ?? 0);
          const novoSaldo = saldoAtual + amount;

          if (process.env.NODE_ENV === 'development') {
            logger.debug(`📊 Fallback manual (recompra): saldo atual ${saldoAtual} + ${amount} = ${novoSaldo}`);
          }

          const { error: fallbackError } = await supabase
            .from('estoques')
            .update({ saldo_atual: novoSaldo })
            .eq('id', operacao.estoque_id);

          if (fallbackError) {
            logger.error('❌ Erro no fallback manual (recompra):', fallbackError.message);
            throw new Error(fallbackError.message);
          }

          if (process.env.NODE_ENV === 'development') {
            logger.debug('✅ Saldo atualizado via fallback manual (recompra)');
          }
        } else {
          if (process.env.NODE_ENV === 'development') {
            const { data: estoqueVerificado } = await supabase
              .from('estoques')
              .select('saldo_atual')
              .eq('id', operacao.estoque_id)
              .single();
            
            if (estoqueVerificado) {
              logger.debug(`✅ Saldo atualizado via RPC (recompra). Novo saldo: ${estoqueVerificado.saldo_atual}`);
            }
          }
        }
      };

      await atualizarOperacao(novoTotalRecompra, novoLiquido);

      // IMPORTANTE: A recompra SUBTRAI o valor da recompra do saldo_atual
      // Apenas para operações de ENTRADA (saídas não alteram saldo)
      if (operacao.tipo_operacao === 'entrada') {
        await ajustarSaldoEstoque(-valorRecompra);
        
        if (process.env.NODE_ENV === 'development') {
          logger.debug(`📉 Recompra: subtraindo ${valorRecompra} do saldo do estoque`);
        }
      }

      const historicoMovimentacao = historico?.trim().length
        ? historico.trim()
        : `Recompra operação #${operacao.id}`;

      const historicoCompleto = observacoes && observacoes.trim().length
        ? `${historicoMovimentacao} - ${observacoes.trim()}`
        : historicoMovimentacao;

      const { error: movimentoError } = await supabase
        .from('movimentacoes_estoque')
        .insert({
          operacao_estoque_id: operacao.id,
          tipo: 'recompra',
          valor: valorRecompra,
          conta_bancaria_id: null,
          estoque_origem_id: null,
          estoque_destino_id: null,
          historico: historicoCompleto,
          data,
        });

      if (movimentoError) {
        await atualizarOperacao(totalRecompraAtual, liquidoAnterior);

        // Reverter ajuste de saldo se foi feito
        if (operacao.tipo_operacao === 'entrada') {
          await ajustarSaldoEstoque(valorRecompra); // Reverter (somar de volta)
        }

        throw new Error(movimentoError.message);
      }

      return {
        operacaoId: operacao.id,
        novoTotalRecompra,
        novoLiquido,
        diferencaLiquido,
      } satisfies RegistrarRecompraResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-estoque'] });
      toast.success('Recompra registrada com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao registrar recompra');
    },
  });
}

// Hook para deletar operação de estoque com reversão completa de saldo
export function useDeleteOperacaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (operacaoId: number) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      // 1. Buscar operação completa
      const { data: operacao, error: operacaoError } = await supabase
        .from('operacoes_estoque')
        .select('*')
        .eq('id', operacaoId)
        .single();

      if (operacaoError || !operacao) {
        throw new Error(`Erro ao buscar operação: ${operacaoError?.message || 'Operação não encontrada'}`);
      }

      // 2. Buscar movimentações de estoque relacionadas (distribuições)
      const { data: movimentacoes, error: movError } = await supabase
        .from('movimentacoes_estoque')
        .select('*')
        .eq('operacao_estoque_id', operacaoId)
        .eq('tipo', 'distribuicao_conta');

      if (movError) {
        logger.error('Erro ao buscar movimentações:', movError);
        // Não falhar se não encontrar movimentações, pode não ter distribuições
      }

      const movimentacoesList = movimentacoes || [];
      const totalDistribuido = movimentacoesList.reduce(
        (sum, mov) => sum + (Number(mov.valor) || 0),
        0
      );

      // 3. Buscar lançamentos de caixa relacionados
      // Lançamento principal da operação (saída) - busca por padrão no histórico
      // IMPORTANTE: O lançamento principal é tipo 'saida' (líquido que sai da conta)
      const tipoEstoqueLabel = (operacao.tipo_estoque === 'SPPRO' ? 'SPPRO' : 'SOI');
      const padraoHistoricoPrincipal = `Operação ${tipoEstoqueLabel} #${operacao.id}`;

      const { data: lancamentosPrincipal, error: lancPrincipalError } = await supabase
        .from('lancamentos_caixa')
        .select('id')
        .eq('empresa_id', operacao.empresa_id)
        .like('historico', `${padraoHistoricoPrincipal}%`)
        .eq('tipo', 'saida'); // Corrigido: lançamento principal é SAÍDA, não entrada

      if (lancPrincipalError) {
        logger.error('Erro ao buscar lançamento principal:', lancPrincipalError);
      }

      // Lançamentos de distribuições (saídas)
      const { data: lancamentosDistribuicoes, error: lancDistError } = await supabase
        .from('lancamentos_caixa')
        .select('id')
        .eq('empresa_id', operacao.empresa_id)
        .like('historico', `Distribuição Operação #${operacao.id}%`)
        .eq('tipo', 'saida');

      if (lancDistError) {
        logger.error('Erro ao buscar lançamentos de distribuições:', lancDistError);
      }

      const lancamentosParaDeletar = [
        ...(lancamentosPrincipal || []),
        ...(lancamentosDistribuicoes || []),
      ];

      // 4. Função auxiliar para ajustar saldo do estoque
      const ajustarSaldoEstoque = async (amount: number) => {
        const valor = Number(amount) || 0;
        if (valor === 0) {
          logger.debug('⚠️ ajustarSaldoEstoque (delete): valor é zero, ignorando');
          return;
        }

        logger.debug(`🔄 ajustarSaldoEstoque (delete): Tentando ajustar saldo em ${valor} para estoque ${operacao.estoque_id}`);

        const { error: updateError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: Number(operacao.estoque_id),
          amount_column: 'saldo_atual',
          amount: Number(valor), // Pode ser negativo para subtrair
        });

        if (updateError) {
          logger.warn('⚠️ RPC increment falhou (delete), usando fallback manual:', updateError.message);

          // Fallback manual
          const { data: estoqueAtual, error: estoqueError } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', operacao.estoque_id)
            .single();

          if (estoqueError || !estoqueAtual) {
            const errorMsg = estoqueError?.message || updateError.message;
            logger.error('❌ Erro ao buscar estoque para fallback (delete):', errorMsg);
            throw new Error(errorMsg);
          }

          const saldoAtual = Number(estoqueAtual.saldo_atual ?? 0);
          const novoSaldo = saldoAtual + valor; // valor pode ser negativo

          logger.debug(`📊 Fallback manual (delete): saldo atual ${saldoAtual} + ${valor} = ${novoSaldo}`);

          const { error: fallbackError } = await supabase
            .from('estoques')
            .update({ saldo_atual: novoSaldo })
            .eq('id', operacao.estoque_id);

          if (fallbackError) {
            logger.error('❌ Erro no fallback manual (delete):', fallbackError.message);
            throw new Error(fallbackError.message);
          }

          logger.debug('✅ Saldo atualizado via fallback manual (delete)');
        } else {
          const { data: estoqueVerificado } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', operacao.estoque_id)
            .single();
          
          if (estoqueVerificado) {
            logger.debug(`✅ Saldo atualizado via RPC (delete). Novo saldo: ${estoqueVerificado.saldo_atual}`);
          }
        }
      };

      // 5. Reverter saldo do estoque baseado no tipo de operação
      // IMPORTANTE: Apenas ENTRADAS alteram o saldo, então apenas ENTRADAS precisam ser revertidas
      // SAÍDAS não alteram o saldo, então não precisam ser revertidas
      const faceTitulos = Number(operacao.face_titulos) || 0;
      
      if (operacao.tipo_operacao === 'entrada' && faceTitulos > 0) {
        // Para ENTRADA: subtrair a face dos títulos que foi adicionada (reverter)
        await ajustarSaldoEstoque(-faceTitulos);
        logger.debug(`🔄 Revertendo entrada: subtraindo ${faceTitulos} (face dos títulos) do estoque`);
      }
      // SAÍDA não altera saldo, então não precisa reverter nada

      // 6. Deletar lançamentos de caixa relacionados
      if (lancamentosParaDeletar.length > 0) {
        const lancamentosIds = lancamentosParaDeletar.map(l => l.id);
        const { error: deleteLancError } = await supabase
          .from('lancamentos_caixa')
          .delete()
          .in('id', lancamentosIds);

        if (deleteLancError) {
          logger.error('Erro ao deletar lançamentos de caixa:', deleteLancError);
          // Não falhar completamente, mas logar o erro
        }
      }

      // 7. Deletar recebíveis relacionados (se existirem)
      const { error: deleteRecebiveisError } = await supabase
        .from('recebiveis_operacoes_estoque')
        .delete()
        .eq('operacao_estoque_id', operacaoId);

      if (deleteRecebiveisError) {
        logger.error('Erro ao deletar recebíveis:', deleteRecebiveisError);
        // Não falhar completamente, mas logar o erro
      }

      // 8. Deletar movimentações de estoque relacionadas
      if (movimentacoesList.length > 0) {
        const movimentacoesIds = movimentacoesList.map(m => m.id);
        const { error: deleteMovError } = await supabase
          .from('movimentacoes_estoque')
          .delete()
          .in('id', movimentacoesIds);

        if (deleteMovError) {
          logger.error('Erro ao deletar movimentações:', deleteMovError);
          throw new Error(`Erro ao deletar movimentações: ${deleteMovError.message}`);
        }
      }

      // 9. Deletar a operação principal
      const { error: deleteError } = await supabase
        .from('operacoes_estoque')
        .delete()
        .eq('id', operacaoId);

      if (deleteError) {
        throw new Error(`Erro ao deletar operação: ${deleteError.message}`);
      }

      logger.debug('✅ Operação deletada com sucesso:', operacaoId);

      return { operacaoId, operacao };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque-totais'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      queryClient.invalidateQueries({ queryKey: ['recebiveis-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['recebiveis-operacao'] });
      toast.success('Operação excluída com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao excluir operação: ' + error.message);
    },
  });
}

// Hook para criar movimentação de estoque
export function useCreateMovimentacaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMovimentacaoEstoque) => {
      const { data: movimentacao, error } = await supabase
        .from('movimentacoes_estoque')
        .insert(data)
        .select()
        .single();

      if (error) {
        throw new Error(`Erro ao criar movimentação: ${error.message}`);
      }

      return movimentacao;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      toast.success('Movimentação de estoque criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao criar movimentação de estoque: ' + error.message);
    },
  });
}

// Hook para criar transferência entre contas e estoques
export function useCreateTransferenciaEstoque() {
  const queryClient = useQueryClient();
  const { data: empresaId } = useEmpresaId();

  return useMutation({
    mutationFn: async (data: {
      tipo: TipoTransferencia;
      origem_id: string | number;
      destino_id: string | number;
      valor: number;
      data: string;
      historico?: string;
    }) => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      // Validar origem ≠ destino
      if (data.origem_id === data.destino_id) {
        throw new Error('Origem e destino devem ser diferentes');
      }

      // Para estoque ↔ estoque, validar saldo suficiente (permitir transferências entre tipos diferentes)
      if (data.tipo === 'estoque_para_estoque') {
        const origemId = typeof data.origem_id === 'number' ? data.origem_id : Number.parseInt(data.origem_id.toString(), 10);
        const destinoId = typeof data.destino_id === 'number' ? data.destino_id : Number.parseInt(data.destino_id.toString(), 10);

        const { data: estoqueOrigem } = await supabase
          .from('estoques')
          .select('tipo, saldo_atual')
          .eq('id', origemId)
          .single();

        const { data: estoqueDestino } = await supabase
          .from('estoques')
          .select('tipo')
          .eq('id', destinoId)
          .single();

        if (!estoqueOrigem || !estoqueDestino) {
          throw new Error('Estoques não encontrados');
        }

        // Permitir transferências entre tipos diferentes (SPPRO ↔ SOI)
        // A validação de tipo foi removida para permitir transferências entre SPPRO e SOI

        if (Number(estoqueOrigem.saldo_atual) < data.valor) {
          throw new Error(`Saldo insuficiente no estoque de origem (Saldo: ${Number(estoqueOrigem.saldo_atual).toFixed(2)})`);
        }
      }

      // Criar movimentações e atualizar saldos conforme o tipo
      if (data.tipo === 'conta_para_estoque') {
        const contaId = data.origem_id as string;
        const estoqueId = typeof data.destino_id === 'number' ? data.destino_id : Number.parseInt(data.destino_id.toString(), 10);

        // Buscar informações do estoque para criar operação
        const { data: estoqueInfo } = await supabase
          .from('estoques')
          .select('tipo, descricao')
          .eq('id', estoqueId)
          .single();

        if (!estoqueInfo) {
          throw new Error('Estoque não encontrado');
        }

        const tipoEstoqueNormalizado = estoqueInfo.tipo?.toString().trim().toUpperCase() || '';
        const tipoEstoqueLabel = tipoEstoqueNormalizado === 'SOI' ? 'SOI' : 'SPPRO';

        // Criar operação de estoque (entrada)
        const operacaoEstoqueData = {
          empresa_id: empresaId,
          estoque_id: estoqueId,
          tipo_operacao: 'entrada' as const,
          data: data.data,
          fornecedor_id: null,
          conta_bancaria_id: null,
          face_titulos: 0,
          valor_compra: 0,
          despesas: 0,
          recompra: 0,
          liquido_operacao: data.valor,
          historico: data.historico || `Transferência Conta → Estoque ${tipoEstoqueLabel}`,
          documento: null,
          observacoes: `Transferência recebida da conta bancária`,
          created_by: session.user.id,
        };

        // Campos específicos por tipo
        if (tipoEstoqueNormalizado === 'SPPRO') {
          (operacaoEstoqueData as any).ad_valorem = 0;
          (operacaoEstoqueData as any).iss = 0;
          (operacaoEstoqueData as any).iof = 0;
          (operacaoEstoqueData as any).amortizacao_debitos = null;
          (operacaoEstoqueData as any).amortizacao_creditos = null;
        } else {
          (operacaoEstoqueData as any).ad_valorem = null;
          (operacaoEstoqueData as any).iss = null;
          (operacaoEstoqueData as any).iof = null;
          (operacaoEstoqueData as any).amortizacao_debitos = 0;
          (operacaoEstoqueData as any).amortizacao_creditos = 0;
        }

        const { data: operacaoEstoque, error: operacaoError } = await supabase
          .from('operacoes_estoque')
          .insert(operacaoEstoqueData)
          .select()
          .single();

        if (operacaoError) {
          throw new Error(`Erro ao criar operação de estoque: ${operacaoError.message}`);
        }

        // Criar movimentação vinculada à operação
        const { data: movimentacaoCriada, error: movError } = await supabase
          .from('movimentacoes_estoque')
          .insert({
            tipo: 'conta_para_estoque',
            valor: data.valor,
            conta_bancaria_id: contaId,
            estoque_destino_id: estoqueId,
            operacao_estoque_id: operacaoEstoque.id,
            data: data.data,
            historico: data.historico || `Transferência Conta → Estoque`,
          })
          .select('id')
          .single();

        if (movError) throw new Error(`Erro ao criar movimentação: ${movError.message}`);
        if (!movimentacaoCriada?.id) throw new Error('Erro ao criar movimentação: id não retornado');

        const observacoesVinculadas = appendMovimentacaoLancamentoVinculo(
          'Transferência Conta → Estoque',
          Number(movimentacaoCriada.id),
        );

        // Criar lançamento de saída na conta
        const { error: lancError } = await supabase
          .from('lancamentos_caixa')
          .insert({
            empresa_id: empresaId,
            conta_bancaria_id: contaId,
            data: data.data,
            historico: data.historico || `Transferência para Estoque #${estoqueId}`,
            tipo: 'saida',
            valor: data.valor,
            observacoes: observacoesVinculadas,
          });

        if (lancError) throw new Error(`Erro ao criar lançamento: ${lancError.message}`);

        // Fonte única de verdade do saldo da conta:
        // o trigger em lancamentos_caixa já aplica o débito/crédito automaticamente.

        // Incrementar estoque
        const { error: estoqueError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: Number(estoqueId),
          amount_column: 'saldo_atual',
          amount: Number(data.valor),
        });

        if (estoqueError) {
          // Fallback manual
          const { data: estoque } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', estoqueId)
            .single();

          if (estoque) {
            const novoSaldo = Number(estoque.saldo_atual) + data.valor;
            await supabase
              .from('estoques')
              .update({ saldo_atual: novoSaldo })
              .eq('id', estoqueId);
          }
        }
      } else if (data.tipo === 'estoque_para_conta') {
        const estoqueId = typeof data.origem_id === 'number' ? data.origem_id : Number.parseInt(data.origem_id.toString(), 10);
        const contaId = data.destino_id as string;

        // Buscar informações do estoque para criar operação
        const { data: estoqueInfo } = await supabase
          .from('estoques')
          .select('tipo, descricao')
          .eq('id', estoqueId)
          .single();

        if (!estoqueInfo) {
          throw new Error('Estoque não encontrado');
        }

        const tipoEstoqueNormalizado = estoqueInfo.tipo?.toString().trim().toUpperCase() || '';
        const tipoEstoqueLabel = tipoEstoqueNormalizado === 'SOI' ? 'SOI' : 'SPPRO';

        // Criar operação de estoque (saída)
        const operacaoEstoqueData = {
          empresa_id: empresaId,
          estoque_id: estoqueId,
          tipo_operacao: 'saida' as const,
          data: data.data,
          fornecedor_id: null,
          conta_bancaria_id: null,
          face_titulos: 0,
          valor_compra: 0,
          despesas: 0,
          recompra: 0,
          liquido_operacao: data.valor,
          historico: data.historico || `Transferência Estoque ${tipoEstoqueLabel} → Conta`,
          documento: null,
          observacoes: `Transferência para conta bancária`,
          created_by: session.user.id,
        };

        // Campos específicos por tipo
        if (tipoEstoqueNormalizado === 'SPPRO') {
          (operacaoEstoqueData as any).ad_valorem = 0;
          (operacaoEstoqueData as any).iss = 0;
          (operacaoEstoqueData as any).iof = 0;
          (operacaoEstoqueData as any).amortizacao_debitos = null;
          (operacaoEstoqueData as any).amortizacao_creditos = null;
        } else {
          (operacaoEstoqueData as any).ad_valorem = null;
          (operacaoEstoqueData as any).iss = null;
          (operacaoEstoqueData as any).iof = null;
          (operacaoEstoqueData as any).amortizacao_debitos = 0;
          (operacaoEstoqueData as any).amortizacao_creditos = 0;
        }

        const { data: operacaoEstoque, error: operacaoError } = await supabase
          .from('operacoes_estoque')
          .insert(operacaoEstoqueData)
          .select()
          .single();

        if (operacaoError) {
          throw new Error(`Erro ao criar operação de estoque: ${operacaoError.message}`);
        }

        // Criar movimentação vinculada à operação
        const { data: movimentacaoCriada, error: movError } = await supabase
          .from('movimentacoes_estoque')
          .insert({
            tipo: 'estoque_para_conta',
            valor: data.valor,
            estoque_origem_id: estoqueId,
            conta_bancaria_id: contaId,
            operacao_estoque_id: operacaoEstoque.id,
            data: data.data,
            historico: data.historico || `Transferência Estoque → Conta`,
          })
          .select('id')
          .single();

        if (movError) throw new Error(`Erro ao criar movimentação: ${movError.message}`);
        if (!movimentacaoCriada?.id) throw new Error('Erro ao criar movimentação: id não retornado');

        const observacoesVinculadas = appendMovimentacaoLancamentoVinculo(
          'Transferência Estoque → Conta',
          Number(movimentacaoCriada.id),
        );

        // Criar lançamento de entrada na conta
        const { error: lancError } = await supabase
          .from('lancamentos_caixa')
          .insert({
            empresa_id: empresaId,
            conta_bancaria_id: contaId,
            data: data.data,
            historico: data.historico || `Transferência do Estoque #${estoqueId}`,
            tipo: 'entrada',
            valor: data.valor,
            observacoes: observacoesVinculadas,
          });

        if (lancError) throw new Error(`Erro ao criar lançamento: ${lancError.message}`);

        // Fonte única de verdade do saldo da conta:
        // o trigger em lancamentos_caixa já aplica o débito/crédito automaticamente.

        // Decrementar estoque
        const { error: estoqueError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: Number(estoqueId),
          amount_column: 'saldo_atual',
          amount: Number(-data.valor),
        });

        if (estoqueError) {
          // Fallback manual
          const { data: estoque } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', estoqueId)
            .single();

          if (estoque) {
            const novoSaldo = Number(estoque.saldo_atual) - data.valor;
            const { error: updateError } = await supabase
              .from('estoques')
              .update({ saldo_atual: novoSaldo })
              .eq('id', estoqueId);
              
            if (updateError) {
              throw new Error(`Erro ao atualizar saldo do estoque: ${updateError.message}`);
            }
          }
        }
      } else if (data.tipo === 'estoque_para_estoque') {
        const origemId = typeof data.origem_id === 'number' ? data.origem_id : Number.parseInt(data.origem_id.toString(), 10);
        const destinoId = typeof data.destino_id === 'number' ? data.destino_id : Number.parseInt(data.destino_id.toString(), 10);

        // Buscar informações dos estoques para criar operação e lançamentos
        const { data: estoqueOrigemInfo } = await supabase
          .from('estoques')
          .select('tipo, descricao')
          .eq('id', origemId)
          .single();

        const { data: estoqueDestinoInfo } = await supabase
          .from('estoques')
          .select('tipo, descricao')
          .eq('id', destinoId)
          .single();

        if (!estoqueOrigemInfo || !estoqueDestinoInfo) {
          throw new Error('Estoques não encontrados');
        }

        const tipoOrigemNormalizado = estoqueOrigemInfo.tipo?.toString().trim().toUpperCase() || '';
        const tipoOrigemLabel = tipoOrigemNormalizado === 'SOI' ? 'SOI' : 'SPPRO';
        const tipoDestinoNormalizado = estoqueDestinoInfo.tipo?.toString().trim().toUpperCase() || '';
        const tipoDestinoLabel = tipoDestinoNormalizado === 'SOI' ? 'SOI' : 'SPPRO';

        // Criar operação de estoque na origem (saída)
        const operacaoOrigemData = {
          empresa_id: empresaId,
          estoque_id: origemId,
          tipo_operacao: 'saida' as const,
          data: data.data,
          fornecedor_id: null,
          conta_bancaria_id: null,
          face_titulos: 0,
          valor_compra: 0,
          despesas: 0,
          recompra: 0,
          liquido_operacao: data.valor,
          historico: data.historico || `Transferência Estoque ${tipoOrigemLabel} → ${tipoDestinoLabel}`,
          documento: null,
          observacoes: `Transferência para ${estoqueDestinoInfo.descricao || `Estoque #${destinoId}`}`,
          created_by: session.user.id,
        };

        // Campos específicos por tipo
        if (tipoOrigemNormalizado === 'SPPRO') {
          (operacaoOrigemData as any).ad_valorem = 0;
          (operacaoOrigemData as any).iss = 0;
          (operacaoOrigemData as any).iof = 0;
          (operacaoOrigemData as any).amortizacao_debitos = null;
          (operacaoOrigemData as any).amortizacao_creditos = null;
        } else {
          (operacaoOrigemData as any).ad_valorem = null;
          (operacaoOrigemData as any).iss = null;
          (operacaoOrigemData as any).iof = null;
          (operacaoOrigemData as any).amortizacao_debitos = 0;
          (operacaoOrigemData as any).amortizacao_creditos = 0;
        }

        const { data: operacaoOrigem, error: operacaoOrigemError } = await supabase
          .from('operacoes_estoque')
          .insert(operacaoOrigemData)
          .select()
          .single();

        if (operacaoOrigemError) {
          throw new Error(`Erro ao criar operação de estoque na origem: ${operacaoOrigemError.message}`);
        }

        // Criar operação de estoque no destino (entrada)
        
        const operacaoDestinoData = {
          empresa_id: empresaId,
          estoque_id: destinoId,
          tipo_operacao: 'entrada' as const,
          data: data.data,
          fornecedor_id: null,
          conta_bancaria_id: null,
          face_titulos: 0,
          valor_compra: 0,
          despesas: 0,
          recompra: 0,
          liquido_operacao: data.valor,
          historico: data.historico || `Transferência de ${estoqueOrigemInfo.tipo} → ${tipoDestinoLabel}`,
          documento: null,
          observacoes: `Transferência recebida de ${estoqueOrigemInfo.descricao || `Estoque #${origemId}`}`,
          created_by: session.user.id,
        };

        // Campos específicos por tipo
        if (tipoDestinoNormalizado === 'SPPRO') {
          (operacaoDestinoData as any).ad_valorem = 0;
          (operacaoDestinoData as any).iss = 0;
          (operacaoDestinoData as any).iof = 0;
          (operacaoDestinoData as any).amortizacao_debitos = null;
          (operacaoDestinoData as any).amortizacao_creditos = null;
        } else {
          (operacaoDestinoData as any).ad_valorem = null;
          (operacaoDestinoData as any).iss = null;
          (operacaoDestinoData as any).iof = null;
          (operacaoDestinoData as any).amortizacao_debitos = 0;
          (operacaoDestinoData as any).amortizacao_creditos = 0;
        }

        logger.debug('📝 Criando operação de estoque no destino:', operacaoDestinoData);

        const { data: operacaoDestino, error: operacaoDestinoError } = await supabase
          .from('operacoes_estoque')
          .insert(operacaoDestinoData)
          .select()
          .single();

        if (operacaoDestinoError) {
          logger.error('❌ Erro ao criar operação de estoque no destino:', operacaoDestinoError);
          throw new Error(`Erro ao criar operação de estoque: ${operacaoDestinoError.message}`);
        }

        // Criar movimentação vinculada à operação de destino
        const { error: movError } = await supabase
          .from('movimentacoes_estoque')
          .insert({
            tipo: 'estoque_para_estoque',
            valor: data.valor,
            estoque_origem_id: origemId,
            estoque_destino_id: destinoId,
            operacao_estoque_id: operacaoDestino.id,
            data: data.data,
            historico: data.historico || `Transferência Estoque #${origemId} → Estoque #${destinoId}`,
          });

        if (movError) throw new Error(`Erro ao criar movimentação: ${movError.message}`);

        // Criar lançamento de caixa para o estoque origem (saída)
        const lancDataOrigem = {
          empresa_id: empresaId,
          conta_bancaria_id: null,
          grupo_contas_id: null,
          data: data.data,
          historico: data.historico || `Transferência do Estoque ${tipoOrigemLabel} #${origemId}`,
          tipo: 'saida' as const,
          valor: data.valor,
          documento: null,
          observacoes: `Transferência de ${tipoOrigemLabel} → ${tipoDestinoLabel} - ${estoqueOrigemInfo.descricao || `Estoque #${origemId}`} → ${estoqueDestinoInfo.descricao || `Estoque #${destinoId}`}`,
        };

        const { error: lancOrigemError } = await supabase
          .from('lancamentos_caixa')
          .insert(lancDataOrigem);

        if (lancOrigemError) {
          logger.error('❌ Erro ao criar lançamento de caixa para origem:', lancOrigemError);
          throw new Error(`Erro ao criar lançamento de caixa: ${lancOrigemError.message}`);
        }

        // Criar lançamento de caixa para o estoque destino (entrada)
        const lancDataDestino = {
          empresa_id: empresaId,
          conta_bancaria_id: null,
          grupo_contas_id: null,
          data: data.data,
          historico: data.historico || `Transferência para Estoque ${tipoDestinoLabel} #${destinoId}`,
          tipo: 'entrada' as const,
          valor: data.valor,
          documento: null,
          observacoes: `Transferência de ${estoqueOrigemInfo.tipo} → ${tipoDestinoLabel} - ${estoqueOrigemInfo.descricao || `Estoque #${origemId}`} → ${estoqueDestinoInfo.descricao || `Estoque #${destinoId}`}`,
        };

        logger.debug('💰 Criando lançamento de caixa para estoque destino:', lancDataDestino);

        const { error: lancDestinoError } = await supabase
          .from('lancamentos_caixa')
          .insert(lancDataDestino);

        if (lancDestinoError) {
          logger.error('❌ Erro ao criar lançamento de caixa para destino:', lancDestinoError);
          throw new Error(`Erro ao criar lançamento de caixa: ${lancDestinoError.message}`);
        }

        // Decrementar origem
        const { error: origemError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: Number(origemId),
          amount_column: 'saldo_atual',
          amount: Number(-data.valor),
        });

        if (origemError) {
          const { data: estoque } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', origemId)
            .single();

          if (estoque) {
            const novoSaldo = Number(estoque.saldo_atual) - data.valor;
            await supabase
              .from('estoques')
              .update({ saldo_atual: novoSaldo })
              .eq('id', origemId);
          }
        }

        // Incrementar destino (já será feito pela operação, mas garantimos aqui também)
        const { error: destinoError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: Number(destinoId),
          amount_column: 'saldo_atual',
          amount: Number(data.valor),
        });

        if (destinoError) {
          const { data: estoque } = await supabase
            .from('estoques')
            .select('saldo_atual')
            .eq('id', destinoId)
            .single();

          if (estoque) {
            const novoSaldo = Number(estoque.saldo_atual) + data.valor;
            await supabase
              .from('estoques')
              .update({ saldo_atual: novoSaldo })
              .eq('id', destinoId);
          }
        }
      } else if (data.tipo === 'conta_para_conta') {
        const contaOrigemId = data.origem_id as string;
        const contaDestinoId = data.destino_id as string;

        // Buscar informações das contas
        const { data: contaOrigem } = await supabase
          .from('contas_bancarias')
          .select('descricao, saldo_atual')
          .eq('id', contaOrigemId)
          .single();

        const { data: contaDestino } = await supabase
          .from('contas_bancarias')
          .select('descricao')
          .eq('id', contaDestinoId)
          .single();

        if (!contaOrigem || !contaDestino) {
          throw new Error('Contas bancárias não encontradas');
        }

        // Validar saldo suficiente na conta de origem
        if (Number(contaOrigem.saldo_atual) < data.valor) {
          throw new Error(`Saldo insuficiente na conta de origem (Saldo: ${Number(contaOrigem.saldo_atual).toFixed(2)})`);
        }

        // Criar movimentação de transferência entre contas
        const { data: movimentacaoCriada, error: movError } = await supabase
          .from('movimentacoes_estoque')
          .insert({
            tipo: 'conta_para_conta',
            valor: data.valor,
            conta_bancaria_id: contaOrigemId,
            conta_bancaria_destino_id: contaDestinoId,
            data: data.data,
            historico: data.historico || `Transferência Conta → Conta`,
          })
          .select('id')
          .single();

        if (movError) throw new Error(`Erro ao criar movimentação: ${movError.message}`);
        if (!movimentacaoCriada?.id) throw new Error('Erro ao criar movimentação: id não retornado');

        const observacoesVinculadas = appendMovimentacaoLancamentoVinculo(
          'Transferência Conta → Conta',
          Number(movimentacaoCriada.id),
        );

        // Criar lançamento de saída na conta origem
        const { error: lancSaidaError } = await supabase
          .from('lancamentos_caixa')
          .insert({
            empresa_id: empresaId,
            conta_bancaria_id: contaOrigemId,
            data: data.data,
            historico: data.historico || `Transferência para ${contaDestino.descricao}`,
            tipo: 'saida',
            valor: data.valor,
            observacoes: observacoesVinculadas,
          });

        if (lancSaidaError) throw new Error(`Erro ao criar lançamento de saída: ${lancSaidaError.message}`);

        // Criar lançamento de entrada na conta destino
        const { error: lancEntradaError } = await supabase
          .from('lancamentos_caixa')
          .insert({
            empresa_id: empresaId,
            conta_bancaria_id: contaDestinoId,
            data: data.data,
            historico: data.historico || `Transferência de ${contaOrigem.descricao}`,
            tipo: 'entrada',
            valor: data.valor,
            observacoes: observacoesVinculadas,
          });

        if (lancEntradaError) throw new Error(`Erro ao criar lançamento de entrada: ${lancEntradaError.message}`);

        // Os triggers do banco vão atualizar os saldos automaticamente
      }

      return { success: true };
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] }),
        queryClient.invalidateQueries({ queryKey: ['estoques'] }),
        queryClient.invalidateQueries({ queryKey: ['estoques-select'] }),
        queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] }),
        queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] }),
        queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] }),
        queryClient.invalidateQueries({ queryKey: ['movimentacoes-estoque'] }),
        queryClient.invalidateQueries({ queryKey: ['movimentacoes-como-lancamentos'] }),
      ]);

      // Força sincronização visual imediata das telas ativas após a transferência.
      await Promise.all([
        queryClient.refetchQueries?.({ queryKey: ['contas-bancarias'], type: 'active' }),
        queryClient.refetchQueries?.({ queryKey: ['dashboard-contas-resumo'], type: 'active' }),
        queryClient.refetchQueries?.({ queryKey: ['lancamentos-conta'], type: 'active' }),
        queryClient.refetchQueries?.({ queryKey: ['lancamentos-caixa'], type: 'active' }),
        queryClient.refetchQueries?.({ queryKey: ['estoques-select'], type: 'active' }),
        queryClient.refetchQueries?.({ queryKey: ['estoques-resumo'], type: 'active' }),
        queryClient.refetchQueries?.({ queryKey: ['movimentacoes-estoque'], type: 'active' }),
        queryClient.refetchQueries?.({ queryKey: ['movimentacoes-como-lancamentos'], type: 'active' }),
      ]);
      toast.success('Transferência registrada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao registrar transferência: ' + error.message);
    },
  });
}

// Hook para atualizar movimentação de estoque
export function useUpdateMovimentacaoEstoque() {
  const queryClient = useQueryClient();
  const { data: empresaId } = useEmpresaId();

  return useMutation({
    mutationFn: async (data: {
      id: number;
      valor?: number;
      data?: string;
      historico?: string;
      conta_bancaria_id?: string | null;
      estoque_origem_id?: number | null;
      estoque_destino_id?: number | null;
      conta_bancaria_destino_id?: string | null;
    }) => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      // Buscar movimentação original
      const { data: movimentacaoOriginal, error: fetchError } = await supabase
        .from('movimentacoes_estoque')
        .select('*')
        .eq('id', data.id)
        .single();

      if (fetchError || !movimentacaoOriginal) {
        throw new Error('Movimentação não encontrada');
      }

      if (isTipoTransferenciaMovimentacao(movimentacaoOriginal.tipo)) {
        if (isTransferenciaEditRpcEnabled()) {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('atualizar_transferencia_estoque', {
            payload: {
              request_id: createTransferenciaEditRequestId(),
              movimentacao_id: data.id,
              valor: data.valor,
              data: data.data,
              historico: data.historico,
              conta_bancaria_id: data.conta_bancaria_id,
              estoque_origem_id: data.estoque_origem_id,
              estoque_destino_id: data.estoque_destino_id,
              conta_bancaria_destino_id: data.conta_bancaria_destino_id,
            },
          });

          if (rpcError) {
            throw new Error(`Erro ao atualizar transferência: ${rpcError.message}`);
          }

          const result = rpcResult as { error?: string; code?: string } | null;
          if (result?.error) {
            throw new Error(`${result.code || 'ERRO_RPC'}: ${result.error}`);
          }

          return { success: true, result: rpcResult };
        }

        throw new Error(
          `EDICAO_TRANSFERENCIA_RPC_DESATIVADA: movimentação #${movimentacaoOriginal.id} é uma transferência financeira. A edição transacional exige aplicar a migration da RPC e ativar VITE_ENABLE_TRANSFERENCIA_EDIT_RPC=true.`,
        );
      }

      // Atualizar movimentação
      const updateData: any = {};
      if (data.valor !== undefined) updateData.valor = data.valor;
      if (data.data !== undefined) updateData.data = data.data;
      if (data.historico !== undefined) updateData.historico = data.historico;
      if (data.conta_bancaria_id !== undefined) updateData.conta_bancaria_id = data.conta_bancaria_id;
      if (data.estoque_origem_id !== undefined) updateData.estoque_origem_id = data.estoque_origem_id;
      if (data.estoque_destino_id !== undefined) updateData.estoque_destino_id = data.estoque_destino_id;
      if (data.conta_bancaria_destino_id !== undefined) updateData.conta_bancaria_destino_id = data.conta_bancaria_destino_id;

      const { error: updateError } = await supabase
        .from('movimentacoes_estoque')
        .update(updateData)
        .eq('id', data.id);

      if (updateError) {
        throw new Error(`Erro ao atualizar movimentação: ${updateError.message}`);
      }

      // Se o valor mudou, precisamos ajustar os saldos
      if (data.valor !== undefined && data.valor !== movimentacaoOriginal.valor) {
        const diferenca = data.valor - Number(movimentacaoOriginal.valor);
        
        // Ajustar saldos conforme o tipo de movimentação
        if (movimentacaoOriginal.tipo === 'estoque_para_conta') {
          // Reverter saldo do estoque origem
          if (movimentacaoOriginal.estoque_origem_id) {
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_origem_id,
              amount_column: 'saldo_atual',
              amount: Number(movimentacaoOriginal.valor), // Reverter valor antigo
            });
            // Aplicar novo valor
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_origem_id,
              amount_column: 'saldo_atual',
              amount: -data.valor, // Aplicar novo valor
            });
          }
        } else if (movimentacaoOriginal.tipo === 'conta_para_estoque') {
          // Reverter saldo do estoque destino
          if (movimentacaoOriginal.estoque_destino_id) {
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_destino_id,
              amount_column: 'saldo_atual',
              amount: -Number(movimentacaoOriginal.valor), // Reverter valor antigo
            });
            // Aplicar novo valor
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_destino_id,
              amount_column: 'saldo_atual',
              amount: data.valor, // Aplicar novo valor
            });
          }
        } else if (movimentacaoOriginal.tipo === 'estoque_para_estoque') {
          // Reverter ambos os saldos
          if (movimentacaoOriginal.estoque_origem_id) {
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_origem_id,
              amount_column: 'saldo_atual',
              amount: Number(movimentacaoOriginal.valor), // Reverter valor antigo
            });
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_origem_id,
              amount_column: 'saldo_atual',
              amount: -data.valor, // Aplicar novo valor
            });
          }
          if (movimentacaoOriginal.estoque_destino_id) {
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_destino_id,
              amount_column: 'saldo_atual',
              amount: -Number(movimentacaoOriginal.valor), // Reverter valor antigo
            });
            await supabase.rpc('increment', {
              table_name: 'estoques',
              id_column: 'id',
              id_value: movimentacaoOriginal.estoque_destino_id,
              amount_column: 'saldo_atual',
              amount: data.valor, // Aplicar novo valor
            });
          }
        }
      }

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-como-lancamentos'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      toast.success('Movimentação atualizada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao atualizar movimentação: ' + error.message);
    },
  });
}

// Hook para deletar movimentação de estoque
export function useDeleteMovimentacaoEstoque() {
  const queryClient = useQueryClient();
  const { data: empresaId } = useEmpresaId();

  return useMutation({
    mutationFn: async (id: number) => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      // Buscar movimentação original para reverter saldos
      const { data: movimentacao, error: fetchError } = await supabase
        .from('movimentacoes_estoque')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !movimentacao) {
        throw new Error('Movimentação não encontrada');
      }

      let lancamentosVinculadosParaExcluir: LancamentoCaixaVinculadoMovimentacao[] = [];

      if (TIPOS_MOVIMENTACAO_COM_LANCAMENTO_CAIXA.has(movimentacao.tipo)) {
        const movimentacaoId = Number(movimentacao.id);
        const vinculo = buildMovimentacaoLancamentoVinculo(movimentacaoId);
        const { data: lancamentosMov, error: lancamentosMovError } = await supabase
          .from('lancamentos_caixa')
          .select('id, observacoes, tipo, valor, data, conta_bancaria_id')
          .eq('empresa_id', empresaId)
          .ilike('observacoes', `%${vinculo}%`);

        if (lancamentosMovError) {
          throw new Error(`Erro ao buscar lançamentos vinculados: ${lancamentosMovError.message}`);
        }

        const lancamentosComVinculoExato = filterLancamentosByMovimentacaoVinculo(
          (lancamentosMov || []) as LancamentoCaixaVinculadoMovimentacao[],
          movimentacaoId,
        );

        lancamentosVinculadosParaExcluir = validarLancamentosVinculadosMovimentacao(
          movimentacao as MovimentacaoComLancamentoCaixa,
          lancamentosComVinculoExato,
        );
      }

      // Se a movimentação está vinculada a uma operação de estoque, deletar a operação também
      if (movimentacao.operacao_estoque_id) {
        // Buscar a operação para verificar se precisa reverter saldos
        const { data: operacao, error: operacaoError } = await supabase
          .from('operacoes_estoque')
          .select('*')
          .eq('id', movimentacao.operacao_estoque_id)
          .single();

        if (!operacaoError && operacao) {
          // IMPORTANTE: Para transferências (estoque_para_conta e conta_para_estoque),
          // o saldo é ajustado DIRETAMENTE na criação, não pela operação.
          // A operação tem face_titulos = 0, então não precisa reverter pela operação.
          // A reversão será feita diretamente na seção específica do tipo de movimentação.
          
          // Apenas reverter pela operação se for uma operação normal (não transferência)
          // e se tiver face_titulos > 0
          const faceTitulos = Number(operacao.face_titulos) || 0;
          const isTransferencia = movimentacao.tipo === 'estoque_para_conta' || 
                                   movimentacao.tipo === 'conta_para_estoque';
          
          if (!isTransferencia && faceTitulos > 0) {
            logger.debug('🔄 Revertendo operação (não transferência):', {
              tipo: operacao.tipo_operacao,
              estoque_id: operacao.estoque_id,
              face_titulos: faceTitulos,
              movimentacao_tipo: movimentacao.tipo
            });
            
            if (operacao.tipo_operacao === 'entrada') {
              // Reverter entrada: subtrair a face dos títulos que foi adicionada
              const { error: revertError } = await supabase.rpc('increment', {
                table_name: 'estoques',
                id_column: 'id',
                id_value: operacao.estoque_id,
                amount_column: 'saldo_atual',
                amount: -faceTitulos,
              });
              
              if (revertError) {
                logger.error('❌ Erro ao reverter saldo via RPC, tentando fallback:', revertError);
                // Fallback manual
                const { data: estoque } = await supabase
                  .from('estoques')
                  .select('saldo_atual')
                  .eq('id', operacao.estoque_id)
                  .single();
                
                if (estoque) {
                  const novoSaldo = Number(estoque.saldo_atual) - faceTitulos;
                  await supabase
                    .from('estoques')
                    .update({ saldo_atual: novoSaldo })
                    .eq('id', operacao.estoque_id);
                  
                  logger.debug('✅ Saldo revertido via fallback:', {
                    estoque_id: operacao.estoque_id,
                    saldo_anterior: estoque.saldo_atual,
                    novo_saldo: novoSaldo,
                    face_titulos_revertida: faceTitulos
                  });
                }
              } else {
                logger.debug('✅ Saldo revertido via RPC para operação entrada (face dos títulos)');
              }
            } else if (operacao.tipo_operacao === 'saida') {
              // Reverter saída: adicionar a face dos títulos que foi subtraída
              const { error: revertError } = await supabase.rpc('increment', {
                table_name: 'estoques',
                id_column: 'id',
                id_value: operacao.estoque_id,
                amount_column: 'saldo_atual',
                amount: faceTitulos,
              });
              
              if (revertError) {
                logger.error('❌ Erro ao reverter saldo via RPC, tentando fallback:', revertError);
                // Fallback manual
                const { data: estoque } = await supabase
                  .from('estoques')
                  .select('saldo_atual')
                  .eq('id', operacao.estoque_id)
                  .single();
                
                if (estoque) {
                  const novoSaldo = Number(estoque.saldo_atual) + faceTitulos;
                  await supabase
                    .from('estoques')
                    .update({ saldo_atual: novoSaldo })
                    .eq('id', operacao.estoque_id);
                  
                  logger.debug('✅ Saldo revertido via fallback:', {
                    estoque_id: operacao.estoque_id,
                    saldo_anterior: estoque.saldo_atual,
                    novo_saldo: novoSaldo,
                    face_titulos_revertida: faceTitulos
                  });
                }
              } else {
                logger.debug('✅ Saldo revertido via RPC para operação saída (face dos títulos)');
              }
            }
          } else if (isTransferencia) {
            logger.debug('ℹ️ Transferência detectada - reversão será feita diretamente na seção específica');
          }

          if (!isTransferencia) {
            // Em transferências, lançamentos de caixa são removidos somente pelo vínculo explícito.
            const { data: lancamentos } = await supabase
              .from('lancamentos_caixa')
              .select('id')
              .eq('empresa_id', empresaId)
              .or(`historico.ilike.%Operação%#${operacao.id}%,historico.ilike.%#${operacao.id}%`);

            if (lancamentos && lancamentos.length > 0) {
              for (const lanc of lancamentos) {
                await supabase
                  .from('lancamentos_caixa')
                  .delete()
                  .eq('id', lanc.id);
              }
            }
          }

          // Deletar a operação de estoque
          const { error: deleteOperacaoError } = await supabase
            .from('operacoes_estoque')
            .delete()
            .eq('id', movimentacao.operacao_estoque_id);

          if (deleteOperacaoError) {
            throw new Error(`Erro ao deletar operação relacionada: ${deleteOperacaoError.message}`);
          }
        }
      }

      // Reverter saldos conforme o tipo de movimentação
      // IMPORTANTE: Se já revertemos via operação acima, não precisamos reverter novamente aqui
      // Mas vamos garantir que a reversão aconteceu corretamente
      if (movimentacao.tipo === 'estoque_para_conta') {
        // Reverter: adicionar valor de volta ao estoque origem
        // IMPORTANTE: Para estoque_para_conta, o saldo foi decrementado DIRETAMENTE na criação
        // (linha 1768-1774), não pela operação. Então sempre precisamos reverter aqui.
        if (movimentacao.estoque_origem_id) {
          const valorParaReverter = Number(movimentacao.valor) || 0;
          
          logger.debug('🔄 Revertendo estoque_para_conta:', {
            estoque_origem_id: movimentacao.estoque_origem_id,
            valor: valorParaReverter,
            tem_operacao: !!movimentacao.operacao_estoque_id
          });
          
          // Sempre reverter, mesmo se há operação (porque o decremento foi direto)
          const { error: revertError } = await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: movimentacao.estoque_origem_id,
            amount_column: 'saldo_atual',
            amount: valorParaReverter,
          });
          
          if (revertError) {
            logger.error('❌ Erro ao reverter saldo via RPC, tentando fallback:', revertError);
            // Fallback manual
            const { data: estoque } = await supabase
              .from('estoques')
              .select('saldo_atual')
              .eq('id', movimentacao.estoque_origem_id)
              .single();
            
            if (estoque) {
              const saldoAtual = Number(estoque.saldo_atual) || 0;
              const novoSaldo = saldoAtual + valorParaReverter;
              await supabase
                .from('estoques')
                .update({ saldo_atual: novoSaldo })
                .eq('id', movimentacao.estoque_origem_id);
              
              logger.debug('✅ Saldo revertido via fallback:', {
                estoque_id: movimentacao.estoque_origem_id,
                saldo_anterior: saldoAtual,
                novo_saldo: novoSaldo,
                valor_revertido: valorParaReverter
              });
            }
          } else {
            logger.debug('✅ Saldo revertido via RPC para estoque_para_conta');
          }
        }
      } else if (movimentacao.tipo === 'conta_para_estoque') {
        // Reverter: subtrair valor do estoque destino
        // IMPORTANTE: Para conta_para_estoque, o saldo foi incrementado DIRETAMENTE na criação
        // (linha 1639-1646), não pela operação. Então sempre precisamos reverter aqui.
        if (movimentacao.estoque_destino_id) {
          const valorParaReverter = Number(movimentacao.valor) || 0;
          
          logger.debug('🔄 Revertendo conta_para_estoque:', {
            estoque_destino_id: movimentacao.estoque_destino_id,
            valor: valorParaReverter,
            tem_operacao: !!movimentacao.operacao_estoque_id
          });
          
          // Sempre reverter, mesmo se há operação (porque o incremento foi direto)
          const { error: revertError } = await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: movimentacao.estoque_destino_id,
            amount_column: 'saldo_atual',
            amount: -valorParaReverter,
          });
          
          if (revertError) {
            logger.error('❌ Erro ao reverter saldo via RPC, tentando fallback:', revertError);
            // Fallback manual
            const { data: estoque } = await supabase
              .from('estoques')
              .select('saldo_atual')
              .eq('id', movimentacao.estoque_destino_id)
              .single();
            
            if (estoque) {
              const saldoAtual = Number(estoque.saldo_atual) || 0;
              const novoSaldo = saldoAtual - valorParaReverter;
              await supabase
                .from('estoques')
                .update({ saldo_atual: novoSaldo })
                .eq('id', movimentacao.estoque_destino_id);
              
              logger.debug('✅ Saldo revertido via fallback:', {
                estoque_id: movimentacao.estoque_destino_id,
                saldo_anterior: saldoAtual,
                novo_saldo: novoSaldo,
                valor_revertido: valorParaReverter
              });
            }
          } else {
            logger.debug('✅ Saldo revertido via RPC para conta_para_estoque');
          }
        }
      } else if (movimentacao.tipo === 'estoque_para_estoque') {
        // Reverter: adicionar valor de volta ao estoque origem e subtrair do destino
        if (movimentacao.estoque_origem_id) {
          await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: movimentacao.estoque_origem_id,
            amount_column: 'saldo_atual',
            amount: Number(movimentacao.valor),
          });
        }
        if (movimentacao.estoque_destino_id) {
          await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: movimentacao.estoque_destino_id,
            amount_column: 'saldo_atual',
            amount: -Number(movimentacao.valor),
          });
        }
      }

      // Deletar lançamentos de caixa relacionados à movimentação somente por vínculo explícito.
      if (lancamentosVinculadosParaExcluir.length > 0) {
        for (const lanc of lancamentosVinculadosParaExcluir) {
          const { error: deleteLancamentoError } = await supabase
            .from('lancamentos_caixa')
            .delete()
            .eq('id', lanc.id);

          if (deleteLancamentoError) {
            throw new Error(`Erro ao deletar lançamento vinculado: ${deleteLancamentoError.message}`);
          }
        }
      }

      // Deletar movimentação
      const { error: deleteError } = await supabase
        .from('movimentacoes_estoque')
        .delete()
        .eq('id', id);

      if (deleteError) {
        throw new Error(`Erro ao deletar movimentação: ${deleteError.message}`);
      }

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-como-lancamentos'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      toast.success('Movimentação excluída com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao excluir movimentação: ' + error.message);
    },
  });
}

// Hook para buscar estoques para select
export function useEstoquesSelect(tipo?: TipoEstoque) {
  const { data: empresaId } = useEmpresaId();
  const normalizedTipo = tipo?.toUpperCase() as TipoEstoque | undefined;

  return useQuery({
    queryKey: ['estoques-select', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data, error } = await supabase
        .from('estoques')
        .select('id, tipo, descricao, saldo_atual, saldo_inicial')
        .eq('empresa_id', empresaId)
        .eq('ativo', true)
        .order('descricao', { ascending: true });

      if (error) {
        throw new Error(`Erro ao buscar estoques: ${error.message}`);
      }

      // Calcular valor exibido: saldo_inicial + saldo_atual (mesma lógica das contas bancárias)
      return (data || []).map((estoque) => {
        const tipoRaw = typeof estoque.tipo === 'string' ? estoque.tipo.trim().toUpperCase() : '';
        let tipoNormalizado: TipoEstoque;
        
        if (tipoRaw === 'SOI') {
          tipoNormalizado = 'SOI';
        } else if (tipoRaw === 'DEVOLUCOES') {
          tipoNormalizado = 'DEVOLUCOES';
        } else {
          tipoNormalizado = 'SPPRO';
        }

        const saldoInicial = Number(estoque.saldo_inicial) || 0;
        const saldoAtual = Number(estoque.saldo_atual) || 0;
        
        // Valor exibido = saldo_inicial + saldo_atual
        // Isso permite que as operações alterem o saldo_atual, e o valor exibido muda dinamicamente
        // Igual às contas bancárias: saldo_exibido = saldo_inicial + (entradas - saídas)
        const valorExibido = saldoInicial + saldoAtual;

        return {
          id: estoque.id,
          tipo: tipoNormalizado,
          descricao: estoque.descricao || null,
          saldo_atual: valorExibido,
        };
      });
    },
    select: (estoques) => {
      if (!normalizedTipo) {
        return estoques;
      }

      return estoques.filter((estoque) => estoque.tipo === normalizedTipo);
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Valores iniciais para SPPRO e SOI
// Estes são os valores BASE INICIAIS, igual às contas bancárias que têm saldo_inicial
// Os valores iniciais (saldo_inicial) agora estão armazenados no banco de dados
// na coluna saldo_inicial da tabela estoques.
// A lógica é: valor_exibido = saldo_inicial + saldo_atual (mesma das contas bancárias)

// Hook para buscar resumo de estoques (saldo por tipo)
// Hook para buscar operações do estoque DEVOLUCOES
export function useOperacoesEstoqueDevolucoes() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['operacoes-estoque-devolucoes', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      // Buscar ou criar estoque de devoluções
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const estoqueDevolucoes = await ensureEstoqueDevolucoes(supabase, empresaId, session.user.id);
      
      if (!estoqueDevolucoes) {
        return [];
      }

      const { data, error } = await supabase
        .from('operacoes_estoque')
        .select(`
          *,
          fornecedores:fornecedor_id (
            id,
            razao_social,
            nome_fantasia
          ),
          contas_bancarias:conta_bancaria_id (
            id,
            descricao
          )
        `)
        .eq('estoque_id', estoqueDevolucoes.id)
        .order('data', { ascending: false })
        .order('id', { ascending: false });

      if (error) {
        throw new Error(`Erro ao buscar operações: ${error.message}`);
      }

      return data || [];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

export function useEstoquesResumo() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['estoques-resumo', empresaId],
    ...READ_DASHBOARD_QUERY_POLICY,
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data, error } = await supabase
        .from('estoques')
        .select('tipo, saldo_atual, saldo_inicial')
        .eq('empresa_id', empresaId)
        .eq('ativo', true);

      if (error) {
        throw new Error(`Erro ao buscar resumo: ${error.message}`);
      }

      const resumo = {
        sppro: 0,
        soi: 0,
        devolucoes: 0,
        devolucoesSppro: 0,
        devolucoesSoi: 0,
      };

      // SPPRO/SOI: saldo_inicial + saldo_atual (mesma lógica das contas bancárias)
      // DEVOLUCOES: apenas saldo_atual (snapshot do saldo disponível)
      // IMPORTANTE: Apenas estoques do tipo 'SOI' são contabilizados no resumo.soi.
      // Apenas estoques do tipo 'SPPRO' são contabilizados no resumo.sppro.
      // O estoque DEVOLUCOES não deve ser incluído nos saldos SOI/SPPRO principais.
      // Devoluções aparecem separadamente nos cards "Devoluções SOI" e "Devoluções SPPRO"
      // e não alteram os saldos dos estoques SOI/SPPRO originais.
      (data || []).forEach((estoque) => {
        const saldoInicial = Number(estoque.saldo_inicial) || 0;
        const saldoAtual = Number(estoque.saldo_atual) || 0;
        const valorTotal = saldoInicial + saldoAtual;

        if (estoque.tipo === 'SPPRO') {
          resumo.sppro += valorTotal;
        } else if (estoque.tipo === 'SOI') {
          resumo.soi += valorTotal;
        } else if (estoque.tipo === 'DEVOLUCOES') {
          // Saldo atual do estoque DEVOLUCOES (mesma semântica do dashboard)
          resumo.devolucoes += saldoAtual;
        }
      });

      // Buscar devoluções detalhadas para separar por tipo de estoque original
      // Nota: tipo_estoque_devolucao não existe na tabela, apenas no CreateDevolucaoEstoque
      // Usamos apenas o tipo do estoque através da relação com operacoes_estoque
      const { data: devolucoes } = await supabase
        .from('devolucoes_estoque')
        .select(`
          valor_devolucao,
          operacoes_estoque:operacao_estoque_id (
            estoques:estoque_id (
              tipo
            )
          )
        `)
        .eq('empresa_id', empresaId);

      // Calcular devoluções por tipo
      (devolucoes || []).forEach((devolucao) => {
        const valor = Number(devolucao.valor_devolucao) || 0;
        
        // Usar o tipo do estoque da operação relacionada
        if (devolucao.operacoes_estoque?.estoques?.tipo) {
          if (devolucao.operacoes_estoque.estoques.tipo === 'SPPRO') {
            resumo.devolucoesSppro += valor;
          } else if (devolucao.operacoes_estoque.estoques.tipo === 'SOI') {
            resumo.devolucoesSoi += valor;
          }
        }
        // Se não tem operação relacionada (devolução direta), não podemos determinar o tipo
        // Nesse caso, não adicionamos ao resumo por tipo específico
      });

      // Os valores já foram calculados usando saldo_inicial + saldo_atual
      // Não precisa mais aplicar offset dinâmico, pois o saldo_inicial já está no banco
      return {
        sppro: resumo.sppro,
        soi: resumo.soi,
        devolucoes: resumo.devolucoes,
        devolucoesSppro: resumo.devolucoesSppro,
        devolucoesSoi: resumo.devolucoesSoi,
        total: resumo.sppro + resumo.soi + resumo.devolucoes,
      };
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para buscar todas as operações sem filtros (para cálculos de receitas/lucro)
export function useOperacoesEstoqueTotais() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['operacoes-estoque-totais', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      // Buscar TODAS as operações SPPRO e SOI sem filtros
      const { data, error } = await supabase
        .from('operacoes_estoque')
        .select(`
          *,
          estoques:estoque_id (
            id,
            tipo,
            descricao,
            saldo_atual
          )
        `)
        .eq('empresa_id', empresaId)
        .order('data', { ascending: false })
        .order('id', { ascending: false });

      if (error) {
        throw new Error(`Erro ao buscar operações: ${error.message}`);
      }

      const operacoes = (data || []) as any[];

      // Separar por tipo de estoque e tipo de operação
      const sppro = {
        entradas: [] as OperacaoEstoqueComRelacoes[],
        saidas: [] as OperacaoEstoqueComRelacoes[],
      };
      const soi = {
        entradas: [] as OperacaoEstoqueComRelacoes[],
        saidas: [] as OperacaoEstoqueComRelacoes[],
      };

      operacoes.forEach((op) => {
        const estoque = Array.isArray(op.estoques) ? op.estoques[0] : op.estoques;
        const tipoEstoque = estoque?.tipo?.toString().trim().toUpperCase();
        
        const operacao: OperacaoEstoqueComRelacoes = {
          ...op,
          estoques: estoque,
          fornecedores: null,
          contas_bancarias: null,
        };

        if (tipoEstoque === 'SPPRO') {
          if (op.tipo_operacao === 'entrada') {
            sppro.entradas.push(operacao);
          } else {
            sppro.saidas.push(operacao);
          }
        } else if (tipoEstoque === 'SOI') {
          if (op.tipo_operacao === 'entrada') {
            soi.entradas.push(operacao);
          } else {
            soi.saidas.push(operacao);
          }
        }
      });

      return { sppro, soi };
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para buscar empresa_id do usuário
export function useEmpresaId() {
  return useQuery({
    queryKey: ['empresa-id'],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const { data: profile, error } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (error) {
        throw new Error(`Erro ao buscar perfil: ${error.message}`);
      }

      // Se perfil não existe, criar automaticamente
      if (!profile) {
        const empresaIdPadrao = '00000000-0000-0000-0000-000000000001';
        const nomeUsuario = session.user.user_metadata?.nome || session.user.email?.split('@')[0] || 'Usuário';
        
        const { error: insertError } = await supabase
          .from('profiles')
          .insert({
            id: session.user.id,
            empresa_id: empresaIdPadrao,
            nome: nomeUsuario,
            email: session.user.email || '',
            perfil: 'Admin',
          });
        
        if (insertError) {
          // Se o erro for 409 (Conflict), o perfil já existe, então buscar novamente
          if (isConflictError(insertError)) {
            // Perfil já existe, buscar novamente
            const { data: existingProfile } = await supabase
              .from('profiles')
              .select('empresa_id')
              .eq('id', session.user.id)
              .maybeSingle();
            
            if (existingProfile?.empresa_id) {
              const empresaIdValue = ensureUUID(existingProfile.empresa_id);
              if (empresaIdValue) {
                logger.debug('useEmpresaId retornando após conflito:', empresaIdValue, 'tipo:', typeof empresaIdValue);
                return empresaIdValue;
              }
            }
            // Se não encontrou o perfil, tentar buscar novamente após um pequeno delay
            await new Promise(resolve => setTimeout(resolve, 100));
            const { data: retryProfile } = await supabase
              .from('profiles')
              .select('empresa_id')
              .eq('id', session.user.id)
              .maybeSingle();
            
            if (retryProfile?.empresa_id) {
              const empresaIdValue = ensureUUID(retryProfile.empresa_id);
              if (empresaIdValue) {
                logger.debug('useEmpresaId retornando após retry:', empresaIdValue, 'tipo:', typeof empresaIdValue);
                return empresaIdValue;
              }
            }
            // Se ainda não encontrou, não lançar erro - perfil pode ter sido criado pelo trigger
            return null;
          }
          
          throw new Error(`Erro ao criar perfil: ${insertError.message}`);
        }
        
        // Após criar, buscar novamente
        const { data: newProfile } = await supabase
          .from('profiles')
          .select('empresa_id')
          .eq('id', session.user.id)
          .maybeSingle();
        
        if (newProfile?.empresa_id) {
          const empresaIdValue = ensureUUID(newProfile.empresa_id);
          if (empresaIdValue) {
            logger.debug('useEmpresaId retornando após criação:', empresaIdValue, 'tipo:', typeof empresaIdValue);
            return empresaIdValue;
          }
        }
        
        throw new Error('Erro ao criar perfil');
      }

      if (!profile.empresa_id) {
        throw new Error('Empresa não encontrada para o usuário');
      }

      // Garantir que seja string UUID válido
      const empresaIdValue = ensureUUID(profile.empresa_id);
      if (!empresaIdValue) {
        throw new Error(`empresa_id inválido: ${profile.empresa_id} (tipo: ${typeof profile.empresa_id})`);
      }

      logger.debug('useEmpresaId retornando:', empresaIdValue, 'tipo:', typeof empresaIdValue);
      return empresaIdValue;
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

// Função para buscar conta SB-S0I2
export async function buscarContaSB_S0I2(empresaId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('contas_bancarias')
    .select('id')
    .eq('empresa_id', empresaId)
    .ilike('descricao', '%SB-S0I2%')
    .maybeSingle();

  if (error) {
    logger.error('Erro ao buscar conta SB-S0I2:', error);
    return null;
  }

  return data?.id || null;
}

// Hook para buscar devoluções de uma operação específica ou todas
export function useDevolucoesEstoque(operacaoId?: number) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['devolucoes-estoque', operacaoId, empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      let query = supabase
        .from('devolucoes_estoque')
        .select(`
          *,
          operacoes_estoque:operacao_estoque_id (
            id,
            face_titulos,
            tipo_operacao,
            data,
            historico,
            fornecedor_id,
            fornecedores:fornecedor_id (
              id,
              razao_social,
              nome_fantasia
            ),
            estoques:estoque_id (
              id,
              tipo,
              descricao
            )
          ),
          contas_bancarias:conta_bancaria_id (
            id,
            descricao
          ),
          lancamentos_caixa:lancamento_caixa_id (
            id,
            valor,
            tipo,
            data
          )
        `)
        .eq('empresa_id', empresaId)
        .order('data_devolucao', { ascending: false })
        .order('id', { ascending: false });

      if (operacaoId) {
        query = query.eq('operacao_estoque_id', operacaoId);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Erro ao buscar devoluções: ${error.message}`);
      }

      return (data || []).map((dev: any) => {
        const operacaoRaw = Array.isArray(dev.operacoes_estoque) ? dev.operacoes_estoque[0] : dev.operacoes_estoque;
        const conta = Array.isArray(dev.contas_bancarias) ? dev.contas_bancarias[0] : dev.contas_bancarias;
        const lancamento = Array.isArray(dev.lancamentos_caixa) ? dev.lancamentos_caixa[0] : dev.lancamentos_caixa;

        // Processar operação com fornecedor e estoque
        let operacao = operacaoRaw;
        if (operacaoRaw) {
          const fornecedor = Array.isArray(operacaoRaw.fornecedores) 
            ? operacaoRaw.fornecedores[0] 
            : operacaoRaw.fornecedores;
          const estoque = Array.isArray(operacaoRaw.estoques) 
            ? operacaoRaw.estoques[0] 
            : operacaoRaw.estoques;
          
          operacao = {
            ...operacaoRaw,
            fornecedores: fornecedor,
            estoques: estoque,
          };
        }

        return {
          ...dev,
          operacoes_estoque: operacao,
          contas_bancarias: conta,
          lancamentos_caixa: lancamento,
        };
      }) as DevolucaoEstoqueComRelacoes[];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

const normalizeHistoricoDevolucao = (value: string | null | undefined): string =>
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

const inferirTipoOrigemPorHistoricoEstrito = (historico: string | null | undefined): TipoOrigemDevolucao => {
  const normalized = normalizeHistoricoDevolucao(historico);
  if (normalized.startsWith('DEVOLUCAO ESTOQUE SPPRO')) {
    return 'SPPRO';
  }
  if (normalized.startsWith('DEVOLUCAO ESTOQUE SOI')) {
    return 'SOI';
  }
  return 'NAO_CLASSIFICADO';
};

const normalizeTipoEstoque = (value: unknown): 'SPPRO' | 'SOI' | 'DEVOLUCOES' | null => {
  const tipoRaw = typeof value === 'string' ? value : null;
  if (tipoRaw === 'SPPRO' || tipoRaw === 'SOI' || tipoRaw === 'DEVOLUCOES') {
    return tipoRaw;
  }
  return null;
};

const resolveTipoOrigemDevolucao = (params: {
  tipoOrigemRaw?: unknown;
  tipoEstoqueRaw?: unknown;
  historicoRaw?: string | null;
}): TipoOrigemDevolucao => {
  if (params.tipoOrigemRaw === 'SPPRO' || params.tipoOrigemRaw === 'SOI' || params.tipoOrigemRaw === 'NAO_CLASSIFICADO') {
    return params.tipoOrigemRaw;
  }

  const tipoEstoque = normalizeTipoEstoque(params.tipoEstoqueRaw);
  if (tipoEstoque === 'SPPRO' || tipoEstoque === 'SOI') {
    return tipoEstoque;
  }

  return inferirTipoOrigemPorHistoricoEstrito(params.historicoRaw);
};

// Hook para listar devoluções efetivamente transferíveis (valor_restante > 0), via RPC determinístico
export function useDevolucoesTransferiveis() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['devolucoes-transferiveis', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        return [];
      }

      const fetchLegacyFallback = async (): Promise<DevolucaoTransferivel[]> => {
        const { data: legacyRows, error: legacyError } = await supabase
          .from('devolucoes_estoque')
          .select(`
            id,
            operacao_estoque_id,
            operacao_entrada_devolucoes_id,
            data_devolucao,
            valor_devolucao,
            valor_transferido,
            status,
            historico,
            operacoes_estoque:operacao_estoque_id (
              estoque_id,
              fornecedor_id,
              estoques:estoque_id (
                tipo,
                descricao
              ),
              fornecedores:fornecedor_id (
                razao_social,
                nome_fantasia
              )
            )
          `)
          .eq('empresa_id', empresaId)
          .or('status.is.null,status.eq.pendente,status.eq.parcialmente_transferida')
          .order('data_devolucao', { ascending: false })
          .order('id', { ascending: false });

        if (legacyError) {
          throw new Error(`Erro no fallback de devoluções transferíveis: ${legacyError.message}`);
        }

        const rows = (legacyRows || []) as Array<Record<string, unknown>>;

        return rows
          .map((row) => {
            const operacaoRaw = Array.isArray(row.operacoes_estoque)
              ? row.operacoes_estoque[0]
              : row.operacoes_estoque;
            const estoqueRaw = Array.isArray((operacaoRaw as any)?.estoques)
              ? (operacaoRaw as any)?.estoques[0]
              : (operacaoRaw as any)?.estoques;
            const fornecedorRaw = Array.isArray((operacaoRaw as any)?.fornecedores)
              ? (operacaoRaw as any)?.fornecedores[0]
              : (operacaoRaw as any)?.fornecedores;

            const valorDevolucao = Number(row.valor_devolucao) || 0;
            const valorTransferido = Math.max(0, Number(row.valor_transferido) || 0);
            const valorRestante = Math.max(0, valorDevolucao - valorTransferido);

            if (valorRestante <= 0.01) {
              return null;
            }

            const statusRaw = String(row.status || '');
            const status_calculado =
              statusRaw === 'transferida' || statusRaw === 'parcialmente_transferida' || statusRaw === 'pendente'
                ? statusRaw
                : valorTransferido > 0
                  ? 'parcialmente_transferida'
                  : 'pendente';

            const tipo_estoque = normalizeTipoEstoque((estoqueRaw as any)?.tipo);
            const tipo_origem_devolucao = resolveTipoOrigemDevolucao({
              tipoEstoqueRaw: tipo_estoque,
              historicoRaw: typeof row.historico === 'string' ? row.historico : null,
            });

            return {
              devolucao_id: Number(row.id),
              data_devolucao: String(row.data_devolucao || ''),
              valor_devolucao: valorDevolucao,
              valor_transferido_calculado: valorTransferido,
              valor_restante: valorRestante,
              valor_transferivel_agora: valorRestante,
              saldo_devolucoes_atual: null,
              status_calculado,
              origem_dados: 'fallback_legacy',
              operacao_estoque_id: row.operacao_estoque_id != null ? Number(row.operacao_estoque_id) : null,
              operacao_entrada_devolucoes_id:
                row.operacao_entrada_devolucoes_id != null ? Number(row.operacao_entrada_devolucoes_id) : null,
              tipo_origem_devolucao,
              historico: row.historico ?? null,
              tipo_estoque,
              estoque_descricao: (estoqueRaw as any)?.descricao ?? null,
              fornecedor_nome: (fornecedorRaw as any)?.razao_social ?? null,
              fornecedor_nome_fantasia: (fornecedorRaw as any)?.nome_fantasia ?? null,
            } as DevolucaoTransferivel;
          })
          .filter((row): row is DevolucaoTransferivel => row !== null);
      };

      const { data, error } = await supabase.rpc('listar_devolucoes_transferiveis', {
        payload: {},
      });

      if (error) {
        logger.warn('Falha no RPC listar_devolucoes_transferiveis; usando fallback legado.', {
          empresaId,
          error: error.message,
        });
        return fetchLegacyFallback();
      }

      const rows = (data || []) as Array<Record<string, unknown>>;

      const rpcRows = rows.map((row) => {
        const statusRaw = String(row.status_calculado || 'pendente');
        const status_calculado =
          statusRaw === 'transferida' || statusRaw === 'parcialmente_transferida'
            ? statusRaw
            : 'pendente';

        const tipo_estoque = normalizeTipoEstoque(row.tipo_estoque);
        const tipo_origem_devolucao = resolveTipoOrigemDevolucao({
          tipoOrigemRaw: row.tipo_origem_devolucao,
          tipoEstoqueRaw: tipo_estoque,
          historicoRaw: typeof row.historico === 'string' ? row.historico : null,
        });

        const valorRestante = Math.max(0, Number(row.valor_restante) || 0);
        const valorTransferivelRaw =
          row.valor_transferivel_agora == null ? valorRestante : Number(row.valor_transferivel_agora) || 0;
        const valorTransferivelAgora = Math.max(
          0,
          Math.min(valorRestante, valorTransferivelRaw),
        );
        const saldoDevolucoesAtual =
          row.saldo_devolucoes_atual == null ? null : Number(row.saldo_devolucoes_atual) || 0;

        return {
          devolucao_id: Number(row.devolucao_id),
          data_devolucao: String(row.data_devolucao || ''),
          valor_devolucao: Number(row.valor_devolucao) || 0,
          valor_transferido_calculado: Number(row.valor_transferido_calculado) || 0,
          valor_restante: valorRestante,
          valor_transferivel_agora: valorTransferivelAgora,
          saldo_devolucoes_atual: saldoDevolucoesAtual,
          status_calculado,
          origem_dados: 'rpc_deterministico',
          operacao_estoque_id: row.operacao_estoque_id != null ? Number(row.operacao_estoque_id) : null,
          operacao_entrada_devolucoes_id:
            row.operacao_entrada_devolucoes_id != null ? Number(row.operacao_entrada_devolucoes_id) : null,
          tipo_origem_devolucao,
          historico: row.historico ?? null,
          tipo_estoque,
          estoque_descricao: row.estoque_descricao ?? null,
          fornecedor_nome: row.fornecedor_nome ?? null,
          fornecedor_nome_fantasia: row.fornecedor_nome_fantasia ?? null,
        } as DevolucaoTransferivel;
      });

      return rpcRows;
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para criar devolução de estoque
export function useCreateDevolucaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateDevolucaoEstoque) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      if (data.valor_devolucao <= 0) {
        throw new Error('Valor da devolução deve ser maior que zero');
      }

      const contaId = await buscarContaSB_S0I2(empresaId);
      if (!contaId) {
        throw new Error(
          'Conta SB-S0I2 não encontrada. Por favor, crie a conta manualmente antes de registrar devoluções.'
        );
      }

      if (data.conta_bancaria_id !== contaId) {
        throw new Error('A devolução deve ser registrada na conta SB-S0I2');
      }

      const payload = {
        request_id: crypto.randomUUID(),
        operacao_estoque_id: data.operacao_estoque_id ?? null,
        tipo_estoque: data.tipo_estoque ?? null,
        data_devolucao: data.data_devolucao,
        valor_devolucao: Number(data.valor_devolucao) || 0,
        conta_bancaria_id: contaId,
        historico: data.historico ?? null,
        observacoes: data.observacoes ?? null,
      };

      logger.info('[DEVOLUCOES_CRIACAO_RPC][REQUEST]', {
        requestId: payload.request_id,
        operacaoEstoqueId: payload.operacao_estoque_id,
        tipoEstoque: payload.tipo_estoque,
        valor: payload.valor_devolucao,
      });

      const { data: result, error } = await supabase.rpc('criar_devolucao_estoque', {
        payload,
      });

      if (error) {
        logger.error('[DEVOLUCOES_CRIACAO_RPC][ERROR]', {
          requestId: payload.request_id,
          error: error.message,
        });
        throw new Error(error.message || 'Erro ao registrar devolução');
      }

      const res = (result || {}) as CriarDevolucaoRpcResult;
      if (res && typeof res === 'object' && 'error' in res && res.error) {
        logger.warn('[DEVOLUCOES_CRIACAO_RPC][BUSINESS_ERROR]', {
          requestId: payload.request_id,
          code: res.code,
          error: res.error,
        });
        throw createCriarDevolucaoError(res);
      }

      const devolucaoId = Number(res.devolucao_id || 0);
      if (!devolucaoId) {
        throw new Error('RPC de criação de devolução não retornou devolucao_id');
      }

      const { data: devolucaoAtualizada, error: devolucaoError } = await supabase
        .from('devolucoes_estoque')
        .select('*')
        .eq('id', devolucaoId)
        .eq('empresa_id', empresaId)
        .single();

      if (devolucaoError || !devolucaoAtualizada) {
        throw new Error(`Erro ao carregar devolução criada: ${devolucaoError?.message || 'Erro desconhecido'}`);
      }

      logger.info('[DEVOLUCOES_CRIACAO_RPC][SUCCESS]', {
        requestId: payload.request_id,
        devolucaoId: res.devolucao_id,
        lancamentoId: res.lancamento_caixa_id,
        operacaoEntradaDevolucoesId: res.operacao_entrada_devolucoes_id,
      });

      return devolucaoAtualizada as DevolucaoEstoque;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devolucoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-transferiveis'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-totais'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      toast.success('Devolução registrada com sucesso!');
    },
    onError: (error: CriarDevolucaoError) => {
      toast.error('Erro ao registrar devolução: ' + error.message);
    },
  });
}

// Hook para atualizar devolução de estoque
export function useUpdateDevolucaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: { id: number } & Partial<CreateDevolucaoEstoque>) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      // Buscar empresa_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      // Se valor_devolucao foi alterado, validar
      if (data.valor_devolucao !== undefined && data.operacao_estoque_id) {
        // Buscar operação para validar
        const { data: operacao } = await supabase
          .from('operacoes_estoque')
          .select('face_titulos')
          .eq('id', data.operacao_estoque_id)
          .eq('empresa_id', empresaId)
          .single();

        if (operacao) {
          // Calcular total já devolvido (excluindo a devolução atual)
          const { data: devolucoesExistentes } = await supabase
            .from('devolucoes_estoque')
            .select('valor_devolucao')
            .eq('operacao_estoque_id', data.operacao_estoque_id)
            .eq('empresa_id', empresaId)
            .neq('id', id);

          const totalDevolvido = (devolucoesExistentes || []).reduce(
            (sum, dev) => sum + (Number(dev.valor_devolucao) || 0),
            0
          );

          const faceTitulos = Number(operacao.face_titulos) || 0;
          const novoTotal = totalDevolvido + data.valor_devolucao;

          if (novoTotal > faceTitulos) {
            throw new Error(
              `Total de devoluções (R$ ${novoTotal.toFixed(2)}) excede a Face dos Títulos (R$ ${faceTitulos.toFixed(2)})`
            );
          }
        }
      }

      // Atualizar devolução
      const updateData: any = {};
      if (data.data_devolucao) updateData.data_devolucao = data.data_devolucao;
      if (data.valor_devolucao !== undefined) updateData.valor_devolucao = data.valor_devolucao;
      if (data.historico !== undefined) updateData.historico = data.historico;
      if (data.observacoes !== undefined) updateData.observacoes = data.observacoes;

      const { data: devolucao, error } = await supabase
        .from('devolucoes_estoque')
        .update(updateData)
        .eq('id', id)
        .eq('empresa_id', empresaId)
        .select()
        .single();

      if (error || !devolucao) {
        throw new Error(`Erro ao atualizar devolução: ${error?.message || 'Erro desconhecido'}`);
      }

      // Se valor foi alterado, atualizar lançamento de caixa também
      if (data.valor_devolucao !== undefined && devolucao.lancamento_caixa_id) {
        const { error: lancError } = await supabase
          .from('lancamentos_caixa')
          .update({
            valor: data.valor_devolucao,
            data: data.data_devolucao || devolucao.data_devolucao,
            historico: data.historico 
              ? `Devolução Operação #${devolucao.operacao_estoque_id} - ${data.historico}`
              : `Devolução Operação #${devolucao.operacao_estoque_id}`,
          })
          .eq('id', devolucao.lancamento_caixa_id);

        if (lancError) {
          throw new Error(`Erro ao atualizar lançamento: ${lancError.message}`);
        }
      }

      return devolucao as DevolucaoEstoque;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devolucoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-transferiveis'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-totais'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      toast.success('Devolução atualizada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao atualizar devolução: ' + error.message);
    },
  });
}

// Hook para deletar devolução de estoque
export function useDeleteDevolucaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const payload = {
        request_id: crypto.randomUUID(),
        devolucao_id: id,
      };

      logger.info('[DEVOLUCAO_EXCLUSAO_RPC][REQUEST]', {
        devolucaoId: id,
        requestId: payload.request_id,
      });

      const { data: rpcResult, error: rpcError } = await supabase.rpc('excluir_devolucao_estoque', {
        payload,
      });

      if (rpcError) {
        logger.error('[DEVOLUCAO_EXCLUSAO_RPC][ERROR]', {
          devolucaoId: id,
          requestId: payload.request_id,
          error: rpcError.message,
        });
        throw new Error(rpcError.message || 'Erro ao excluir devolução');
      }

      const result = (rpcResult || {}) as DeleteDevolucaoRpcResult;

      if (result.error) {
        logger.warn('[DEVOLUCAO_EXCLUSAO_RPC][BUSINESS_ERROR]', {
          devolucaoId: id,
          requestId: payload.request_id,
          code: result.code,
          error: result.error,
        });
        throw createDeleteDevolucaoError(result.code, result.error);
      }

      logger.info('[DEVOLUCAO_EXCLUSAO_RPC][SUCCESS]', {
        devolucaoId: id,
        requestId: payload.request_id,
        operacaoEntradaDevolucoesId: result.operacao_entrada_devolucoes_id,
        totalTransferenciasRevertidas: result.total_transferencias_revertidas,
      });

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devolucoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-transferiveis'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-totais'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      toast.success('Devolução excluída com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao excluir devolução: ' + error.message);
    },
  });
}

export function getMotivoDevolucaoOrfaMessage(motivo: string | undefined): string {
  switch (motivo) {
    case 'SEM_LANCAMENTO':
      return 'Sem lançamento de caixa vinculado.';
    case 'LANCAMENTO_INEXISTENTE':
      return 'Lançamento de caixa não existe mais.';
    case 'SEM_OPERACAO_ENTRADA':
      return 'Sem operação de entrada determinística no estoque DEVOLUCOES.';
    case 'TRANSFERENCIA_SEM_DESTINO_DETERMINISTICO':
      return 'Transferência sem referência determinística de destino.';
    case 'ESTADO_INVALIDO':
      return 'Estado da devolução inválido para exclusão.';
    default:
      return 'Motivo não identificado.';
  }
}

// Hook para limpar devoluções órfãs via RPC em lote (classificando limpáveis vs bloqueadas)
export function useLimparDevolucoesOrfas() {
  const queryClient = useQueryClient();
  const { data: empresaId } = useEmpresaId();

  return useMutation({
    mutationFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const payload = {
        request_id: crypto.randomUUID(),
      };

      logger.info('[DEVOLUCOES_ORFAS][CLEANUP_REQUEST]', {
        requestId: payload.request_id,
      });

      const { data: result, error } = await supabase.rpc('limpar_devolucoes_orfas_estoque', {
        payload,
      });

      if (error) {
        logger.error('[DEVOLUCOES_ORFAS][CLEANUP_RPC_ERROR]', {
          requestId: payload.request_id,
          error: error.message,
        });
        throw new Error(error.message || 'Erro ao limpar devoluções órfãs');
      }

      const res = (result || {}) as (LimpezaDevolucoesOrfasResultado & { error?: string; code?: string });

      if (res.error) {
        throw new Error(res.error);
      }

      const normalized: LimpezaDevolucoesOrfasResultado = {
        total_orfas: Number(res.total_orfas) || 0,
        total_limpaveis: Number(res.total_limpaveis) || 0,
        limpas: Number(res.limpas) || 0,
        falhas: Number(res.falhas) || 0,
        bloqueadas: Array.isArray(res.bloqueadas)
          ? (res.bloqueadas as Array<Record<string, unknown>>).map((item) => ({
              devolucao_id: Number(item?.devolucao_id),
              motivo: String(item?.motivo || 'ESTADO_INVALIDO'),
            }))
          : [],
        erros: Array.isArray(res.erros)
          ? (res.erros as Array<Record<string, unknown>>).map((item) => ({
              devolucao_id: Number(item?.devolucao_id),
              code: String(item?.code || 'ESTADO_INVALIDO'),
              erro: String(item?.erro || 'Erro desconhecido'),
            }))
          : [],
      };

      logger.info('[DEVOLUCOES_ORFAS][CLEANUP_RESULT]', {
        requestId: payload.request_id,
        totalOrfas: normalized.total_orfas,
        totalLimpaveis: normalized.total_limpaveis,
        limpas: normalized.limpas,
        falhas: normalized.falhas,
        bloqueadas: normalized.bloqueadas.length,
      });

      return normalized;
    },
    onSuccess: (resultado) => {
      queryClient.invalidateQueries({ queryKey: ['devolucoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-transferiveis'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-totais'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-orfas'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque-devolucoes'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });

      if (resultado.total_orfas === 0) {
        toast.info('Nenhuma devolução órfã encontrada.');
        return;
      }

      if (resultado.falhas === 0) {
        toast.success(
          `${resultado.limpas} devolução(ões) limpa(s). ` +
          `${resultado.bloqueadas.length} bloqueada(s) para saneamento.`,
        );
        return;
      }

      toast.warning(
        `${resultado.limpas} devolução(ões) limpa(s), ${resultado.falhas} falha(s) e ` +
        `${resultado.bloqueadas.length} bloqueada(s).`,
      );
    },
    onError: (error: Error) => {
      toast.error('Erro ao limpar devoluções órfãs: ' + error.message);
    },
  });
}

// Hook para diagnosticar devoluções órfãs (somente leitura)
export function useDevolucoesOrfas() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['devolucoes-orfas', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        return [];
      }

      const { data, error } = await supabase.rpc('diagnosticar_devolucoes_orfas_estoque');
      if (error) {
        throw new Error(`Erro ao diagnosticar devoluções órfãs: ${error.message}`);
      }

      const rows = (data || []) as Array<Record<string, unknown>>;

      return rows.map((row) => ({
        devolucao_id: Number(row.devolucao_id),
        motivo: String(row.motivo || 'ESTADO_INVALIDO'),
        pode_limpar: Boolean(row.pode_limpar),
        lancamento_caixa_id: row.lancamento_caixa_id ?? null,
        operacao_entrada_devolucoes_id:
          row.operacao_entrada_devolucoes_id != null ? Number(row.operacao_entrada_devolucoes_id) : null,
      })) as DevolucaoOrfaDiagnostico[];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para diagnosticar consistência de devoluções x saldo DEVOLUCOES
export function useDiagnosticarConsistenciaDevolucoesEstoque(empresaIdParam?: string) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['diagnostico-consistencia-devolucoes', empresaId, empresaIdParam],
    queryFn: async () => {
      if (!empresaId && !empresaIdParam) {
        throw new Error('Empresa não encontrada');
      }

      const payload = empresaIdParam ? { empresa_id: empresaIdParam } : {};
      const { data, error } = await supabase.rpc('diagnosticar_consistencia_devolucoes_estoque', {
        payload,
      });

      if (error) {
        throw new Error(`Erro ao diagnosticar consistência de devoluções: ${error.message}`);
      }

      const row = Array.isArray(data) ? data[0] : data;
      if (!row || typeof row !== 'object') {
        return {
          saldo_estoque_atual: 0,
          saldo_operacional_calculado: 0,
          total_restante_deterministico: 0,
          gap_movimentacoes_sem_vinculo: 0,
          devolucoes_sem_operacao_entrada: 0,
          movimentacoes_com_gap: 0,
          gap_por_tipo_sppro: 0,
          gap_por_tipo_soi: 0,
          gap_tipo_indeterminado: 0,
          gap_tipo_inferido_por_destino: 0,
          gap_tipo_inferido_por_conta_mapeada: 0,
          gap_residual_recomponivel: 0,
        } as DiagnosticoConsistenciaDevolucoesEstoque;
      }

      const normalized = row as Record<string, unknown>;
      return {
        saldo_estoque_atual: Number(normalized.saldo_estoque_atual) || 0,
        saldo_operacional_calculado: Number(normalized.saldo_operacional_calculado) || 0,
        total_restante_deterministico: Number(normalized.total_restante_deterministico) || 0,
        gap_movimentacoes_sem_vinculo: Number(normalized.gap_movimentacoes_sem_vinculo) || 0,
        devolucoes_sem_operacao_entrada: Number(normalized.devolucoes_sem_operacao_entrada) || 0,
        movimentacoes_com_gap: Number(normalized.movimentacoes_com_gap) || 0,
        gap_por_tipo_sppro: Number(normalized.gap_por_tipo_sppro) || 0,
        gap_por_tipo_soi: Number(normalized.gap_por_tipo_soi) || 0,
        gap_tipo_indeterminado: Number(normalized.gap_tipo_indeterminado) || 0,
        gap_tipo_inferido_por_destino: Number(normalized.gap_tipo_inferido_por_destino) || 0,
        gap_tipo_inferido_por_conta_mapeada:
          Number(normalized.gap_tipo_inferido_por_conta_mapeada) || 0,
        gap_residual_recomponivel: Number(normalized.gap_residual_recomponivel) || 0,
      } as DiagnosticoConsistenciaDevolucoesEstoque;
    },
    enabled: !!empresaId || !!empresaIdParam,
    retry: false,
  });
}

function parseRepararInconsistenciasDevolucoesResultado(
  result: Record<string, unknown>,
  payload: RepararInconsistenciasDevolucoesPayload,
  requestId: string,
): RepararInconsistenciasDevolucoesResultado {
  const bloqueiosRaw = Array.isArray(result.bloqueios) ? result.bloqueios : [];
  const bloqueios = bloqueiosRaw.map((bloqueio) => {
    const row = (bloqueio || {}) as Record<string, unknown>;
    return {
      movimentacao_id:
        row.movimentacao_id == null ? null : Number(row.movimentacao_id) || null,
      motivo: String(row.motivo || 'SEM_CANDIDATO_SUFICIENTE'),
      gap: Number(row.gap) || 0,
      tipo_origem_movimentacao:
        row.tipo_origem_movimentacao == null ? null : String(row.tipo_origem_movimentacao),
    };
  });

  const statusExecucaoRaw = String(result.status_execucao || 'DONE').toUpperCase();
  const status_execucao =
    statusExecucaoRaw === 'RUNNING_BACKGROUND' || statusExecucaoRaw === 'ERROR'
      ? statusExecucaoRaw
      : 'DONE';

  const saldoFinal = Number(result.saldo_final) || 0;
  const saldoFinalPosRecomposicao =
    result.saldo_final_pos_recomposicao == null
      ? saldoFinal
      : Number(result.saldo_final_pos_recomposicao) || 0;

  return {
    status_execucao,
    mode: (String(result.mode || payload.mode || 'dry_run') as 'dry_run' | 'apply'),
    request_id: (result.request_id as string | null | undefined) || requestId,
    empresa_id: String(result.empresa_id || payload.empresa_id || ''),
    estrategia: String(result.estrategia || payload.estrategia || 'LIFO_TIPO_DATA_STRITO'),
    reconciliar_vinculos:
      result.reconciliar_vinculos == null
        ? payload.reconciliar_vinculos ?? true
        : Boolean(result.reconciliar_vinculos),
    recompor_saldo_residual:
      result.recompor_saldo_residual == null
        ? payload.recompor_saldo_residual ?? true
        : Boolean(result.recompor_saldo_residual),
    estoque_devolucoes_id: Number(result.estoque_devolucoes_id) || 0,
    saldo_antes: Number(result.saldo_antes) || 0,
    saldo_operacional_calculado: Number(result.saldo_operacional_calculado) || 0,
    saldo_final: saldoFinal,
    saldo_final_pos_recomposicao: saldoFinalPosRecomposicao,
    devolucoes_sem_operacao_entrada_antes:
      Number(result.devolucoes_sem_operacao_entrada_antes) || 0,
    devolucoes_backfill_candidatas: Number(result.devolucoes_backfill_candidatas) || 0,
    devolucoes_backfill_aplicadas: Number(result.devolucoes_backfill_aplicadas) || 0,
    devolucoes_sem_operacao_entrada_depois:
      Number(result.devolucoes_sem_operacao_entrada_depois) || 0,
    total_restante_deterministico: Number(result.total_restante_deterministico) || 0,
    gap_movimentacoes_sem_vinculo: Number(result.gap_movimentacoes_sem_vinculo) || 0,
    movimentacoes_com_gap: Number(result.movimentacoes_com_gap) || 0,
    vinculos_criados: Number(result.vinculos_criados) || 0,
    movimentacoes_reconciliadas: Number(result.movimentacoes_reconciliadas) || 0,
    movimentacoes_bloqueadas: Number(result.movimentacoes_bloqueadas) || 0,
    gap_movimentacoes_sem_vinculo_antes:
      Number(result.gap_movimentacoes_sem_vinculo_antes) || 0,
    gap_movimentacoes_sem_vinculo_depois:
      Number(result.gap_movimentacoes_sem_vinculo_depois) || 0,
    gap_remanescente_bloqueado: Number(result.gap_remanescente_bloqueado) || 0,
    gap_residual_antes_recomposicao: Number(result.gap_residual_antes_recomposicao) || 0,
    valor_recomposicao_aplicada: Number(result.valor_recomposicao_aplicada) || 0,
    operacao_ajuste_id:
      result.operacao_ajuste_id == null ? null : Number(result.operacao_ajuste_id) || null,
    bloqueios,
  } as RepararInconsistenciasDevolucoesResultado;
}

// Hook administrativo para reparo determinístico das inconsistências
export function useRepararInconsistenciasDevolucoesEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: RepararInconsistenciasDevolucoesPayload = { mode: 'dry_run' }) => {
      const requestId = payload.request_id || crypto.randomUUID();
      const rpcPayload = {
        mode: payload.mode || 'dry_run',
        request_id: requestId,
        reconciliar_vinculos: payload.reconciliar_vinculos ?? true,
        recompor_saldo_residual: payload.recompor_saldo_residual ?? true,
        estrategia: payload.estrategia || 'LIFO_TIPO_DATA_STRITO',
        ...(payload.empresa_id ? { empresa_id: payload.empresa_id } : {}),
      };

      const { data, error } = await supabase.rpc('reparar_inconsistencias_devolucoes_estoque', {
        payload: rpcPayload,
      });

      if (error) {
        throw new Error(`Erro ao reparar inconsistências de devoluções: ${error.message}`);
      }

      const result = (data || {}) as Record<string, unknown>;
      if (result.error) {
        throw new Error(String(result.error));
      }

      return parseRepararInconsistenciasDevolucoesResultado(result, payload, requestId);
    },
    onSuccess: (resultado, variables) => {
      queryClient.invalidateQueries({ queryKey: ['diagnostico-consistencia-devolucoes'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-transferiveis'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-totais'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['verificar-saldos-estoques'] });

      if (variables?.silent) {
        return;
      }

      if ((variables?.mode || 'dry_run') === 'apply') {
        toast.success(
          `Reparo aplicado. Vínculos: ${resultado.vinculos_criados}; ` +
          `bloqueios: ${resultado.movimentacoes_bloqueadas}; ` +
          `recomposição: ${formatCurrencyValue(resultado.valor_recomposicao_aplicada)}; ` +
          `saldo final DEVOLUCOES: ${formatCurrencyValue(resultado.saldo_final_pos_recomposicao)}.`,
        );
      } else {
        toast.info(
          `Diagnóstico (dry_run): ${resultado.devolucoes_backfill_candidatas} candidata(s) a backfill; ` +
          `gap sem vínculo: ${formatCurrencyValue(resultado.gap_movimentacoes_sem_vinculo_antes)}.`,
        );
      }
    },
    onError: (error: Error) => {
      toast.error('Erro no reparo de inconsistências: ' + error.message);
    },
  });
}

export function useConsultarReconciliacaoDevolucoesEstoque() {
  return useMutation({
    mutationFn: async (
      payload: ConsultarReconciliacaoDevolucoesPayload,
    ): Promise<ConsultarReconciliacaoDevolucoesResultado> => {
      const requestId = payload.request_id;
      if (!requestId) {
        throw new Error('request_id é obrigatório para consultar a reconciliação.');
      }

      const rpcPayload = {
        request_id: requestId,
        ...(payload.empresa_id ? { empresa_id: payload.empresa_id } : {}),
      };

      const { data, error } = await supabase.rpc('consultar_reconciliacao_devolucoes_estoque', {
        payload: rpcPayload,
      });

      if (error) {
        throw new Error(`Erro ao consultar reconciliação de devoluções: ${error.message}`);
      }

      const result = (data || {}) as Record<string, unknown>;
      if (result.error) {
        return {
          status_execucao: String(result.status_execucao || 'ERROR'),
          request_id: String(result.request_id || requestId),
          empresa_id: result.empresa_id == null ? undefined : String(result.empresa_id),
          code: result.code == null ? undefined : String(result.code),
          error: String(result.error),
        };
      }

      const statusExecucao = String(result.status_execucao || 'DONE').toUpperCase();
      if (statusExecucao === 'RUNNING_BACKGROUND') {
        return {
          status_execucao: 'RUNNING_BACKGROUND',
          request_id: String(result.request_id || requestId),
          empresa_id: result.empresa_id == null ? undefined : String(result.empresa_id),
          code: result.code == null ? undefined : String(result.code),
          error: result.error == null ? undefined : String(result.error),
        };
      }

      return parseRepararInconsistenciasDevolucoesResultado(
        result,
        { mode: 'apply', request_id: requestId, empresa_id: payload.empresa_id },
        requestId,
      );
    },
  });
}

// Hook para calcular totais de devoluções disponíveis (valor_restante > 0)
export function useDevolucoesTotais(filtros?: { tipo?: 'SPPRO' | 'SOI'; dataInicio?: string; dataFim?: string }) {
  const transferiveisQuery = useDevolucoesTransferiveis();

  const totais = useMemo<DevolucoesTotais>(() => {
    const base: DevolucoesTotais = {
      total: 0,
      sppro: 0,
      soi: 0,
      naoClassificado: 0,
    };

    const rows = transferiveisQuery.data || [];
    if (rows.length === 0) {
      return base;
    }

    const dataInicioTs = filtros?.dataInicio ? new Date(`${filtros.dataInicio}T00:00:00`).getTime() : null;
    const dataFimTs = filtros?.dataFim ? new Date(`${filtros.dataFim}T23:59:59`).getTime() : null;

    rows.forEach((dev) => {
      const valor = Number(dev.valor_restante) || 0;
      if (valor <= 0.01) {
        return;
      }

      const dataDevTs = new Date(`${dev.data_devolucao}T00:00:00`).getTime();
      if (dataInicioTs !== null && !Number.isNaN(dataDevTs) && dataDevTs < dataInicioTs) {
        return;
      }
      if (dataFimTs !== null && !Number.isNaN(dataDevTs) && dataDevTs > dataFimTs) {
        return;
      }

      const tipoOrigem = dev.tipo_origem_devolucao || 'NAO_CLASSIFICADO';
      if (filtros?.tipo && tipoOrigem !== filtros.tipo) {
        return;
      }

      base.total += valor;
      if (tipoOrigem === 'SPPRO') {
        base.sppro += valor;
      } else if (tipoOrigem === 'SOI') {
        base.soi += valor;
      } else {
        base.naoClassificado += valor;
      }
    });

    return base;
  }, [filtros?.dataFim, filtros?.dataInicio, filtros?.tipo, transferiveisQuery.data]);

  return {
    ...transferiveisQuery,
    data: totais,
  };
}

// Hook para contar apenas devoluções pendentes ou parcialmente transferidas
// Usado no contador da aba "Estoque Devoluções"
export function useDevolucoesPendentesCount() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['devolucoes-pendentes-count', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        return 0;
      }

      const { count, error } = await supabase
        .from('devolucoes_estoque')
        .select('*', { count: 'exact', head: true })
        .eq('empresa_id', empresaId)
        .or('status.is.null,status.eq.pendente,status.eq.parcialmente_transferida');

      if (error) {
        throw new Error(`Erro ao contar devoluções pendentes: ${error.message}`);
      }

      return count || 0;
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// ============================================
// HOOKS DE RECOMPRA DE ESTOQUE
// ============================================

// Hook para listar recompras de estoque
export function useRecomprasEstoque(operacaoId?: number) {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['recompras-estoque', operacaoId, empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      let query = supabase
        .from('recompras_estoque')
        .select(`
          *,
          operacoes_estoque:operacao_estoque_id (
            id,
            face_titulos,
            tipo_operacao,
            data,
            historico,
            fornecedor_id,
            fornecedores:fornecedor_id (
              id,
              razao_social,
              nome_fantasia
            ),
            estoques:estoque_id (
              id,
              tipo,
              descricao
            )
          ),
          lancamentos_saida:lancamento_saida_id (
            id,
            valor,
            tipo,
            data,
            historico
          ),
          lancamentos_entrada:lancamento_entrada_id (
            id,
            valor,
            tipo,
            data,
            historico
          )
        `)
        .eq('empresa_id', empresaId)
        .order('data_recompra', { ascending: false })
        .order('id', { ascending: false });

      if (operacaoId) {
        query = query.eq('operacao_estoque_id', operacaoId);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Erro ao buscar recompras: ${error.message}`);
      }

      // Buscar estoques e contas relacionados
      const estoquesIds = new Set<number>();
      const contasIds = new Set<string>();

      (data || []).forEach((rec: any) => {
        if (rec.origem_tipo === 'estoque') {
          estoquesIds.add(Number(rec.origem_id));
        } else if (rec.origem_tipo === 'conta') {
          contasIds.add(rec.origem_id);
        }
        if (rec.destino_tipo === 'estoque' && rec.destino_id) {
          estoquesIds.add(Number(rec.destino_id));
        } else if (rec.destino_tipo === 'conta' && rec.destino_id) {
          contasIds.add(rec.destino_id);
        }
      });

      // Buscar estoques
      const estoquesMap = new Map<number, any>();
      if (estoquesIds.size > 0) {
        const { data: estoques } = await supabase
          .from('estoques')
          .select('id, tipo, descricao')
          .in('id', Array.from(estoquesIds))
          .eq('empresa_id', empresaId);

        (estoques || []).forEach((e: any) => {
          estoquesMap.set(e.id, e);
        });
      }

      // Buscar contas
      const contasMap = new Map<string, any>();
      if (contasIds.size > 0) {
        const { data: contas } = await supabase
          .from('contas_bancarias')
          .select('id, descricao')
          .in('id', Array.from(contasIds))
          .eq('empresa_id', empresaId);

        (contas || []).forEach((c: any) => {
          contasMap.set(c.id, c);
        });
      }

      return (data || []).map((rec: any) => {
        const operacaoRaw = Array.isArray(rec.operacoes_estoque) ? rec.operacoes_estoque[0] : rec.operacoes_estoque;
        const lancamentoSaida = Array.isArray(rec.lancamentos_saida) ? rec.lancamentos_saida[0] : rec.lancamentos_saida;
        const lancamentoEntrada = Array.isArray(rec.lancamentos_entrada) ? rec.lancamentos_entrada[0] : rec.lancamentos_entrada;

        // Buscar origem e destino baseado no tipo
        const estoqueOrigem = rec.origem_tipo === 'estoque' ? estoquesMap.get(Number(rec.origem_id)) : null;
        const contaOrigem = rec.origem_tipo === 'conta' ? contasMap.get(rec.origem_id) : null;
        const estoqueDestino = rec.destino_tipo === 'estoque' && rec.destino_id ? estoquesMap.get(Number(rec.destino_id)) : null;
        const contaDestino = rec.destino_tipo === 'conta' && rec.destino_id ? contasMap.get(rec.destino_id) : null;

        // Processar operação com fornecedor e estoque
        let operacao = operacaoRaw;
        if (operacaoRaw) {
          const fornecedor = Array.isArray(operacaoRaw.fornecedores) 
            ? operacaoRaw.fornecedores[0] 
            : operacaoRaw.fornecedores;
          const estoque = Array.isArray(operacaoRaw.estoques) 
            ? operacaoRaw.estoques[0] 
            : operacaoRaw.estoques;
          
          operacao = {
            ...operacaoRaw,
            fornecedores: fornecedor,
            estoques: estoque,
          };
        }

        return {
          ...rec,
          operacoes_estoque: operacao,
          estoques_origem: estoqueOrigem || null,
          contas_origem: contaOrigem || null,
          estoques_destino: estoqueDestino || null,
          contas_destino: contaDestino || null,
          lancamentos_saida: lancamentoSaida || null,
          lancamentos_entrada: lancamentoEntrada || null,
        };
      }) as RecompraEstoqueComRelacoes[];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para criar recompra de estoque (saída)
export function useCreateRecompraEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateRecompraEstoque) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      // Buscar empresa_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      // Validar valor
      if (data.valor_recompra <= 0) {
        throw new Error('Valor da recompra deve ser maior que zero');
      }

      // Buscar operação para validar
      const { data: operacao, error: operacaoError } = await supabase
        .from('operacoes_estoque')
        .select('id, face_titulos, tipo_operacao, estoque_id, recompra')
        .eq('id', data.operacao_estoque_id)
        .eq('empresa_id', empresaId)
        .single();

      if (operacaoError || !operacao) {
        throw new Error(`Operação não encontrada: ${operacaoError?.message || 'Operação não existe'}`);
      }

      // Validar saldo da origem
      if (data.origem_tipo === 'estoque') {
        const estoqueId = Number(data.origem_id);
        const { data: estoque, error: estoqueError } = await supabase
          .from('estoques')
          .select('id, saldo_atual, saldo_inicial')
          .eq('id', estoqueId)
          .eq('empresa_id', empresaId)
          .single();

        if (estoqueError || !estoque) {
          throw new Error(`Estoque não encontrado: ${estoqueError?.message || 'Estoque não existe'}`);
        }

        const saldoDisponivel = (Number(estoque.saldo_inicial) || 0) + (Number(estoque.saldo_atual) || 0);
        if (saldoDisponivel < data.valor_recompra) {
          throw new Error(`Saldo insuficiente no estoque. Saldo disponível: R$ ${saldoDisponivel.toFixed(2)}`);
        }

        // Decrementar saldo do estoque
        const { error: decrementError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: estoqueId,
          amount_column: 'saldo_atual',
          amount: -data.valor_recompra,
        });

        if (decrementError) {
          // Fallback manual
          const novoSaldo = saldoDisponivel - data.valor_recompra;
          const { error: fallbackError } = await supabase
            .from('estoques')
            .update({ saldo_atual: novoSaldo - (Number(estoque.saldo_inicial) || 0) })
            .eq('id', estoqueId);

          if (fallbackError) {
            throw new Error(`Erro ao decrementar saldo do estoque: ${fallbackError.message}`);
          }
        }
      } else if (data.origem_tipo === 'conta') {
        const contaId = typeof data.origem_id === 'string' ? data.origem_id : String(data.origem_id);
        const { data: conta, error: contaError } = await supabase
          .from('contas_bancarias')
          .select('id, saldo_atual, saldo_inicial')
          .eq('id', contaId)
          .eq('empresa_id', empresaId)
          .single();

        if (contaError || !conta) {
          throw new Error(`Conta bancária não encontrada: ${contaError?.message || 'Conta não existe'}`);
        }

        // Usar mesma lógica de ContasEstoques: saldo_atual se definido (inclusive zero), senão saldo_inicial
        const saldoDisponivel = conta.saldo_atual !== null && conta.saldo_atual !== undefined
          ? Number(conta.saldo_atual)
          : Number(conta.saldo_inicial ?? 0);
        if (saldoDisponivel < data.valor_recompra) {
          throw new Error(`Saldo insuficiente na conta. Saldo disponível: R$ ${saldoDisponivel.toFixed(2)}`);
        }

        // Decrementar saldo da conta
        const { error: decrementError } = await supabase.rpc('increment', {
          table_name: 'contas_bancarias',
          id_column: 'id',
          id_value: contaId,
          amount_column: 'saldo_atual',
          amount: -data.valor_recompra,
        });

        if (decrementError) {
          // Fallback manual
          const novoSaldo = saldoDisponivel - data.valor_recompra;
          const { error: fallbackError } = await supabase
            .from('contas_bancarias')
            .update({ saldo_atual: novoSaldo - (Number(conta.saldo_inicial) || 0) })
            .eq('id', contaId);

          if (fallbackError) {
            throw new Error(`Erro ao decrementar saldo da conta: ${fallbackError.message}`);
          }
        }
      }

      // Criar lançamento de caixa (saída)
      const historicoLancamento = data.historico 
        ? `Recompra Operação #${data.operacao_estoque_id} - ${data.historico}`
        : `Recompra Operação #${data.operacao_estoque_id}`;

      const lancamentoSaidaData = {
        empresa_id: empresaId,
        conta_bancaria_id: data.origem_tipo === 'conta' ? data.origem_id : null,
        grupo_contas_id: null,
        data: data.data_recompra,
        historico: historicoLancamento,
        tipo: 'saida' as const,
        valor: data.valor_recompra,
        documento: null,
        observacoes: `Recompra da operação de estoque #${data.operacao_estoque_id}`,
      };

      const { data: lancamentoSaida, error: lancSaidaError } = await supabase
        .from('lancamentos_caixa')
        .insert(lancamentoSaidaData)
        .select()
        .single();

      if (lancSaidaError || !lancamentoSaida) {
        // Reverter saldo se necessário
        if (data.origem_tipo === 'estoque') {
          const estoqueId = Number(data.origem_id);
          await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: estoqueId,
            amount_column: 'saldo_atual',
            amount: data.valor_recompra,
          });
        } else if (data.origem_tipo === 'conta') {
          const contaId = typeof data.origem_id === 'string' ? data.origem_id : String(data.origem_id);
          await supabase.rpc('increment', {
            table_name: 'contas_bancarias',
            id_column: 'id',
            id_value: contaId,
            amount_column: 'saldo_atual',
            amount: data.valor_recompra,
          });
        }
        throw new Error(`Erro ao criar lançamento de caixa: ${lancSaidaError?.message || 'Erro desconhecido'}`);
      }

      // Criar registro de recompra
      const recompraData = {
        operacao_estoque_id: data.operacao_estoque_id,
        data_recompra: data.data_recompra,
        valor_recompra: data.valor_recompra,
        status: 'pendente' as const,
        origem_tipo: data.origem_tipo,
        origem_id: String(data.origem_id),
        destino_tipo: null,
        destino_id: null,
        lancamento_saida_id: lancamentoSaida.id,
        lancamento_entrada_id: null,
        historico: data.historico || null,
        observacoes: data.observacoes || null,
        data_pagamento: null,
        created_by: session.user.id,
        empresa_id: empresaId,
      };

      const { data: recompra, error: recompraError } = await supabase
        .from('recompras_estoque')
        .insert(recompraData)
        .select()
        .single();

      if (recompraError || !recompra) {
        // Reverter lançamento e saldo
        await supabase.from('lancamentos_caixa').delete().eq('id', lancamentoSaida.id);
        if (data.origem_tipo === 'estoque') {
          const estoqueId = Number(data.origem_id);
          await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: estoqueId,
            amount_column: 'saldo_atual',
            amount: data.valor_recompra,
          });
        } else if (data.origem_tipo === 'conta') {
          const contaId = typeof data.origem_id === 'string' ? data.origem_id : String(data.origem_id);
          await supabase.rpc('increment', {
            table_name: 'contas_bancarias',
            id_column: 'id',
            id_value: contaId,
            amount_column: 'saldo_atual',
            amount: data.valor_recompra,
          });
        }
        throw new Error(`Erro ao criar recompra: ${recompraError?.message || 'Erro desconhecido'}`);
      }

      // Atualizar campo recompra da operação (acumulativo)
      const totalRecompraAtual = Number(operacao.recompra) || 0;
      const novoTotalRecompra = totalRecompraAtual + data.valor_recompra;

      const { error: updateOperacaoError } = await supabase
        .from('operacoes_estoque')
        .update({ recompra: novoTotalRecompra })
        .eq('id', data.operacao_estoque_id);

      if (updateOperacaoError) {
        // Não reverter tudo, apenas logar erro
        logger.error('Erro ao atualizar campo recompra da operação:', updateOperacaoError);
      }

      return recompra as RecompraEstoque;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recompras-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      toast.success('Recompra criada com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao criar recompra');
    },
  });
}

// Hook para pagar recompra (entrada)
export function usePagarRecompraEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: PagarRecompraEstoque) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      // Buscar empresa_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      // Buscar recompra
      const { data: recompra, error: recompraError } = await supabase
        .from('recompras_estoque')
        .select('*')
        .eq('id', data.recompra_id)
        .eq('empresa_id', empresaId)
        .single();

      if (recompraError || !recompra) {
        throw new Error(`Recompra não encontrada: ${recompraError?.message || 'Recompra não existe'}`);
      }

      // Validar que está pendente
      if (recompra.status !== 'pendente') {
        throw new Error('Apenas recompras pendentes podem ser pagas');
      }

      // Validar data de pagamento
      if (new Date(data.data_pagamento) < new Date(recompra.data_recompra)) {
        throw new Error('Data de pagamento não pode ser anterior à data da recompra');
      }

      // Incrementar saldo do destino
      if (data.destino_tipo === 'estoque') {
        const estoqueId = Number(data.destino_id);
        const { data: estoque, error: estoqueError } = await supabase
          .from('estoques')
          .select('id')
          .eq('id', estoqueId)
          .eq('empresa_id', empresaId)
          .single();

        if (estoqueError || !estoque) {
          throw new Error(`Estoque não encontrado: ${estoqueError?.message || 'Estoque não existe'}`);
        }

        // Incrementar saldo do estoque
        const { error: incrementError } = await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: estoqueId,
          amount_column: 'saldo_atual',
          amount: recompra.valor_recompra,
        });

        if (incrementError) {
          throw new Error(`Erro ao incrementar saldo do estoque: ${incrementError.message}`);
        }
      } else if (data.destino_tipo === 'conta') {
        const contaId = typeof data.destino_id === 'string' ? data.destino_id : String(data.destino_id);
        const { data: conta, error: contaError } = await supabase
          .from('contas_bancarias')
          .select('id')
          .eq('id', contaId)
          .eq('empresa_id', empresaId)
          .single();

        if (contaError || !conta) {
          throw new Error(`Conta bancária não encontrada: ${contaError?.message || 'Conta não existe'}`);
        }

        // Incrementar saldo da conta
        const { error: incrementError } = await supabase.rpc('increment', {
          table_name: 'contas_bancarias',
          id_column: 'id',
          id_value: contaId,
          amount_column: 'saldo_atual',
          amount: recompra.valor_recompra,
        });

        if (incrementError) {
          throw new Error(`Erro ao incrementar saldo da conta: ${incrementError.message}`);
        }
      }

      // Criar lançamento de caixa (entrada)
      const historicoLancamento = data.historico 
        ? `Pagamento Recompra #${data.recompra_id} - ${data.historico}`
        : `Pagamento Recompra #${data.recompra_id}`;

      const lancamentoEntradaData = {
        empresa_id: empresaId,
        conta_bancaria_id: data.destino_tipo === 'conta' ? data.destino_id : null,
        grupo_contas_id: null,
        data: data.data_pagamento,
        historico: historicoLancamento,
        tipo: 'entrada' as const,
        valor: recompra.valor_recompra,
        documento: null,
        observacoes: `Pagamento da recompra #${data.recompra_id}`,
      };

      const { data: lancamentoEntrada, error: lancEntradaError } = await supabase
        .from('lancamentos_caixa')
        .insert(lancamentoEntradaData)
        .select()
        .single();

      if (lancEntradaError || !lancamentoEntrada) {
        // Reverter saldo se necessário
        if (data.destino_tipo === 'estoque') {
          const estoqueId = Number(data.destino_id);
          await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: estoqueId,
            amount_column: 'saldo_atual',
            amount: -recompra.valor_recompra,
          });
        } else if (data.destino_tipo === 'conta') {
          const contaId = typeof data.destino_id === 'string' ? data.destino_id : String(data.destino_id);
          await supabase.rpc('increment', {
            table_name: 'contas_bancarias',
            id_column: 'id',
            id_value: contaId,
            amount_column: 'saldo_atual',
            amount: -recompra.valor_recompra,
          });
        }
        throw new Error(`Erro ao criar lançamento de caixa: ${lancEntradaError?.message || 'Erro desconhecido'}`);
      }

      // Atualizar recompra
      const { data: recompraAtualizada, error: updateError } = await supabase
        .from('recompras_estoque')
        .update({
          status: 'paga',
          data_pagamento: data.data_pagamento,
          destino_tipo: data.destino_tipo,
          destino_id: String(data.destino_id),
          lancamento_entrada_id: lancamentoEntrada.id,
          historico: data.historico || recompra.historico || null,
          observacoes: data.observacoes || recompra.observacoes || null,
        })
        .eq('id', data.recompra_id)
        .select()
        .single();

      if (updateError || !recompraAtualizada) {
        // Reverter lançamento e saldo
        await supabase.from('lancamentos_caixa').delete().eq('id', lancamentoEntrada.id);
        if (data.destino_tipo === 'estoque') {
          const estoqueId = Number(data.destino_id);
          await supabase.rpc('increment', {
            table_name: 'estoques',
            id_column: 'id',
            id_value: estoqueId,
            amount_column: 'saldo_atual',
            amount: -recompra.valor_recompra,
          });
        } else if (data.destino_tipo === 'conta') {
          const contaId = typeof data.destino_id === 'string' ? data.destino_id : String(data.destino_id);
          await supabase.rpc('increment', {
            table_name: 'contas_bancarias',
            id_column: 'id',
            id_value: contaId,
            amount_column: 'saldo_atual',
            amount: -recompra.valor_recompra,
          });
        }
        throw new Error(`Erro ao atualizar recompra: ${updateError?.message || 'Erro desconhecido'}`);
      }

      return recompraAtualizada as RecompraEstoque;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recompras-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      toast.success('Recompra paga com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao pagar recompra');
    },
  });
}

// Hook para deletar recompra (apenas pendentes)
export function useDeleteRecompraEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (recompraId: number) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      // Buscar empresa_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      // Buscar recompra
      const { data: recompra, error: recompraError } = await supabase
        .from('recompras_estoque')
        .select('*')
        .eq('id', recompraId)
        .eq('empresa_id', empresaId)
        .single();

      if (recompraError || !recompra) {
        throw new Error(`Recompra não encontrada: ${recompraError?.message || 'Recompra não existe'}`);
      }

      // Validar que está pendente
      if (recompra.status !== 'pendente') {
        throw new Error('Apenas recompras pendentes podem ser deletadas');
      }

      // Reverter saldo da origem
      if (recompra.origem_tipo === 'estoque') {
        const estoqueId = Number(recompra.origem_id);
        await supabase.rpc('increment', {
          table_name: 'estoques',
          id_column: 'id',
          id_value: estoqueId,
          amount_column: 'saldo_atual',
          amount: recompra.valor_recompra,
        });
      } else if (recompra.origem_tipo === 'conta') {
        const contaId = recompra.origem_id;
        await supabase.rpc('increment', {
          table_name: 'contas_bancarias',
          id_column: 'id',
          id_value: contaId,
          amount_column: 'saldo_atual',
          amount: recompra.valor_recompra,
        });
      }

      // Deletar lançamento de saída
      if (recompra.lancamento_saida_id) {
        await supabase.from('lancamentos_caixa').delete().eq('id', recompra.lancamento_saida_id);
      }

      // Atualizar campo recompra da operação (reverter)
      const { data: operacao } = await supabase
        .from('operacoes_estoque')
        .select('recompra')
        .eq('id', recompra.operacao_estoque_id)
        .single();

      if (operacao) {
        const totalRecompraAtual = Number(operacao.recompra) || 0;
        const novoTotalRecompra = Math.max(0, totalRecompraAtual - recompra.valor_recompra);

        await supabase
          .from('operacoes_estoque')
          .update({ recompra: novoTotalRecompra })
          .eq('id', recompra.operacao_estoque_id);
      }

      // Deletar recompra
      const { error: deleteError } = await supabase
        .from('recompras_estoque')
        .delete()
        .eq('id', recompraId);

      if (deleteError) {
        throw new Error(`Erro ao deletar recompra: ${deleteError.message}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recompras-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      toast.success('Recompra deletada com sucesso!');
    },
    onError: (error) => {
      toast.error(error.message || 'Erro ao deletar recompra');
    },
  });
}

// Hook para transferir devoluções de estoque (via RPC transacional)
export function useTransferirDevolucoesEstoque() {
  const queryClient = useQueryClient();
  const { data: empresaId } = useEmpresaId();

  return useMutation({
    mutationFn: async (data: TransferirDevolucoesInput) => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      if (!data.devolucoes_selecionadas || data.devolucoes_selecionadas.length === 0) {
        throw new Error('Selecione pelo menos uma devolução para transferir');
      }

      const valorTotal = data.devolucoes_selecionadas.reduce(
        (sum, dev) => sum + (Number(dev.valor_transferir) || 0),
        0
      );

      if (valorTotal <= 0) {
        throw new Error('Valor total a transferir deve ser maior que zero');
      }

      const payload = {
        request_id: crypto.randomUUID(),
        data_transferencia: data.data_transferencia,
        historico: data.historico ?? null,
        observacoes: data.observacoes ?? null,
        destino_tipo: data.destino_tipo,
        destino_id: String(data.destino_id),
        devolucoes_selecionadas: data.devolucoes_selecionadas.map((d) => ({
          devolucao_id: d.devolucao_id,
          valor_transferir: Number(d.valor_transferir) || 0,
        })),
      };

      logger.info('[DEVOLUCOES_TRANSFERENCIA_RPC][REQUEST]', {
        requestId: payload.request_id,
        destinoTipo: payload.destino_tipo,
        destinoId: payload.destino_id,
        quantidade: payload.devolucoes_selecionadas.length,
        valorTotal,
      });

      const { data: result, error } = await supabase.rpc('transferir_devolucoes_estoque', {
        payload,
      });

      if (error) {
        logger.error('[DEVOLUCOES_TRANSFERENCIA_RPC][ERROR]', {
          requestId: payload.request_id,
          error: error.message,
        });

        if (error.message?.includes('estoques_saldo_atual_check')) {
          throw createTransferirDevolucoesError({
            code: 'SALDO_DEVOLUCOES_INSUFICIENTE',
            error: 'Saldo insuficiente no estoque DEVOLUCOES para transferir as devoluções selecionadas',
          });
        }

        throw new Error(error.message || 'Erro ao transferir devoluções');
      }

      const res = (result || {}) as TransferirDevolucoesRpcResult;

      if (res && typeof res === 'object' && 'error' in res && res.error) {
        logger.warn('[DEVOLUCOES_TRANSFERENCIA_RPC][BUSINESS_ERROR]', {
          requestId: payload.request_id,
          code: res.code,
          error: res.error,
          saldoAtual: res.saldo_atual,
          valorSolicitado: res.valor_solicitado,
        });
        throw createTransferirDevolucoesError(res);
      }

      logger.info('[DEVOLUCOES_TRANSFERENCIA_RPC][SUCCESS]', {
        requestId: payload.request_id,
        operacaoSaidaId: res.operacao_saida_id,
        movimentacaoId: res.movimentacao_id,
        operacaoEntradaId: res.operacao_entrada_id ?? null,
        lancamentoDestinoId: res.lancamento_destino_id ?? null,
      });

      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devolucoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-transferiveis'] });
      queryClient.invalidateQueries({ queryKey: ['devolucoes-totais'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['operacoes-estoque-devolucoes'] });
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      queryClient.invalidateQueries({ queryKey: ['contas-bancarias'] });
      toast.success('Devoluções transferidas com sucesso!');
    },
    onError: (error: TransferirDevolucoesError) => {
      toast.error('Erro ao transferir devoluções: ' + error.message);
    },
  });
}

// Interface para resultado de verificação de saldos
export interface VerificacaoSaldoEstoque {
  estoque_id: number;
  estoque_descricao: string | null;
  tipo_estoque: string;
  saldo_inicial: number;
  saldo_atual: number;
  saldo_esperado: number;
  diferenca: number;
  total_entradas: number;
  total_saidas: number;
  total_transferencias_entrada: number;
  total_transferencias_saida: number;
  total_recompras: number;
  total_devolucoes: number;
}

// Hook para verificar saldos de estoques
export function useVerificarSaldosEstoques() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['verificar-saldos-estoques', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data, error } = await supabase.rpc('verificar_saldos_estoques', {
        empresa_id_param: empresaId,
      });

      if (error) {
        throw new Error(`Erro ao verificar saldos: ${error.message}`);
      }

      return (data || []) as VerificacaoSaldoEstoque[];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Interface para resultado de recálculo de saldo
export interface RecalculoSaldoEstoque {
  estoque_id: number;
  saldo_anterior: number;
  saldo_novo: number;
}

// Hook para recalcular saldo de um estoque específico
export function useRecalcularSaldoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (estoqueId: number) => {
      const { data, error } = await supabase.rpc('recalcular_saldo_estoque', {
        estoque_id_param: estoqueId,
      });

      if (error) {
        throw new Error(`Erro ao recalcular saldo: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new Error('Nenhum resultado retornado');
      }

      return data[0] as RecalculoSaldoEstoque;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['verificar-saldos-estoques'] });
      toast.success('Saldo do estoque recalculado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao recalcular saldo: ' + error.message);
    },
  });
}

// Interface para resultado de recálculo de todos os saldos
export interface RecalculoTodosSaldosEstoques {
  estoque_id: number;
  estoque_descricao: string | null;
  tipo_estoque: string;
  saldo_anterior: number;
  saldo_novo: number;
}

// Hook para recalcular todos os saldos de estoques de uma empresa
export function useRecalcularTodosSaldosEstoques() {
  const queryClient = useQueryClient();
  const { data: empresaId } = useEmpresaId();

  return useMutation({
    mutationFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const { data, error } = await supabase.rpc('recalcular_todos_saldos_estoques_empresa', {
        empresa_id_param: empresaId,
      });

      if (error) {
        throw new Error(`Erro ao recalcular saldos: ${error.message}`);
      }

      return (data || []) as RecalculoTodosSaldosEstoques[];
    },
    onSuccess: (resultados) => {
      queryClient.invalidateQueries({ queryKey: ['estoques'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-select'] });
      queryClient.invalidateQueries({ queryKey: ['estoques-resumo'] });
      queryClient.invalidateQueries({ queryKey: ['verificar-saldos-estoques'] });
      
      const totalCorrigidos = resultados.length;
      toast.success(`${totalCorrigidos} estoque(s) recalculado(s) com sucesso!`);
    },
    onError: (error: Error) => {
      toast.error('Erro ao recalcular saldos: ' + error.message);
    },
  });
}
