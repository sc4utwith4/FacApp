import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';
import type { 
  ContaFixa, 
  CreateContaFixa, 
  UpdateContaFixa, 
  LancamentoPrevisto,
  FiltrosPrevistos,
  PrevistoAction,
  GerarPrevistos
} from '@/types/contas-fixas';
import {
  buildCreateContaFixaRpcPayload,
  buildUpdateContaFixaRpcPayload,
  extractContaFixaRpcErrorDetails,
  formatContaFixaRpcError,
} from './contasFixasRpcPayload';

// Hook para listar contas fixas
export function useContasFixas() {
  return useQuery({
    queryKey: ['contas-fixas'],
    queryFn: async () => {
      // Buscar empresa_id do usuário logado
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        throw new Error('Usuário não autenticado');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada para o usuário');
      }

      const { data, error } = await supabase
        .from('contas_fixas')
        .select(`
          *,
          grupos_contas:grupo_contas_id(nome, natureza),
          contas_bancarias:conta_bancaria_id(descricao, agencia, conta)
        `)
        .eq('empresa_id', profile.empresa_id)
        .order('descricao');

      if (error) throw error;
      return data as (ContaFixa & {
        grupos_contas: { nome: string; natureza: string };
        contas_bancarias: { descricao: string; agencia: string; conta: string };
      })[];
    },
  });
}

// Hook para criar conta fixa
export function useCreateContaFixa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateContaFixa) => {
      const rpcPayload = buildCreateContaFixaRpcPayload(data);

      // Usar função RPC do PostgreSQL para garantir tratamento correto de data
      // A função RPC usa TO_DATE() que trata a data como local sem conversão de timezone
      const { data: result, error } = await supabase.rpc('criar_conta_fixa', rpcPayload);

      if (error) throw error;
      
      // A função RPC retorna um array, pegar o primeiro elemento
      if (Array.isArray(result) && result.length > 0) {
        return result[0];
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas-fixas'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      toast.success('Conta fixa criada com sucesso!');
    },
    onError: (error: unknown) => {
      const message = formatContaFixaRpcError(error);
      const details = extractContaFixaRpcErrorDetails(error);
      logger.error('[contas-fixas][create]', JSON.stringify(details));
      toast.error(message);
    },
  });
}

// Hook para atualizar conta fixa
export function useUpdateContaFixa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateContaFixa) => {
      const rpcPayload = buildUpdateContaFixaRpcPayload(data);

      // Usar função RPC do PostgreSQL para garantir tratamento correto de data
      const { data: result, error } = await supabase.rpc('atualizar_conta_fixa', rpcPayload);

      if (error) throw error;
      
      // A função RPC retorna um array, pegar o primeiro elemento
      if (Array.isArray(result) && result.length > 0) {
        return result[0];
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas-fixas'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      toast.success('Conta fixa atualizada com sucesso!');
    },
    onError: (error: unknown) => {
      const message = formatContaFixaRpcError(error);
      const details = extractContaFixaRpcErrorDetails(error);
      logger.error('[contas-fixas][update]', JSON.stringify(details));
      toast.error(message);
    },
  });
}

// Hook para deletar conta fixa
export function useDeleteContaFixa() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase
        .from('contas_fixas')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contas-fixas'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      toast.success('Conta fixa excluída com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao excluir conta fixa: ' + error.message);
    },
  });
}

// Hook para listar lançamentos previstos
export function useLancamentosPrevistos(filtros?: FiltrosPrevistos) {
  return useQuery({
    queryKey: ['lancamentos-previstos', filtros],
    queryFn: async () => {
      let query = supabase
        .from('lancamentos_previstos')
        .select(`
          *,
          contas_fixas:fixa_id(descricao, periodicidade),
          grupos_contas:grupo_contas_id(nome, natureza),
          contas_bancarias:conta_bancaria_id(descricao, agencia, conta)
        `);

      // Aplicar filtros
      if (filtros?.competencia) {
        query = query.eq('competencia', filtros.competencia);
      }
      if (filtros?.status) {
        query = query.eq('status', filtros.status);
      }
      if (filtros?.tipo) {
        query = query.eq('tipo', filtros.tipo);
      }
      if (filtros?.conta_bancaria_id) {
        query = query.eq('conta_bancaria_id', filtros.conta_bancaria_id);
      }
      if (filtros?.grupo_contas_id) {
        query = query.eq('grupo_contas_id', filtros.grupo_contas_id);
      }
      if (filtros?.data_inicio) {
        query = query.gte('vencimento', filtros.data_inicio);
      }
      if (filtros?.data_fim) {
        query = query.lte('vencimento', filtros.data_fim);
      }

      const { data, error } = await query.order('vencimento');

      if (error) throw error;
      return data as (LancamentoPrevisto & {
        contas_fixas: { descricao: string; periodicidade: string };
        grupos_contas: { nome: string; natureza: string };
        contas_bancarias: { descricao: string; agencia: string; conta: string };
      })[];
    },
  });
}

// Hook para gerar lançamentos previstos
export function useGerarPrevistos() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: GerarPrevistos) => {
      const payload: Record<string, unknown> = {
        p_competencia: data.competencia,
      };

      if (data.empresa_id) {
        payload.p_empresa_id = data.empresa_id;
      }

      const { data: result, error } = await supabase.rpc('gerar_previstos_mes', payload);

      if (error) throw error;
      return result;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      queryClient.invalidateQueries({ queryKey: ['contas-fixas'] });
      toast.success(`${count} lançamentos previstos gerados com sucesso!`);
    },
    onError: (error: Error) => {
      toast.error('Erro ao gerar previstos: ' + error.message);
    },
  });
}

// Hook para ações em lançamentos previstos
export function usePrevistoActions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (action: PrevistoAction) => {
      let result: { action: string; lancamentoId?: unknown } | undefined;
      
      switch (action.action) {
        case 'marcar_pago': {
          const { data: lancamentoId, error: pagoError } = await supabase.rpc('marcar_previsto_pago', {
            p_previsto_id: action.id,
            p_data_pagamento: action.data_pagamento || new Date().toISOString().split('T')[0],
            p_observacoes: action.observacoes || null,
          });
          if (pagoError) throw pagoError;
          result = { lancamentoId, action: 'marcar_pago' };
          break;
        }

        case 'reagendar': {
          const { error: reagendarError } = await supabase
            .from('lancamentos_previstos')
            .update({ 
              vencimento: action.nova_data_vencimento,
              observacoes: action.observacoes,
              status: 'agendado'
            })
            .eq('id', action.id);
          if (reagendarError) throw reagendarError;
          result = { action: 'reagendar' };
          break;
        }

        case 'cancelar': {
          const { error: cancelarError } = await supabase
            .from('lancamentos_previstos')
            .update({ 
              status: 'previsto',
              observacoes: action.observacoes 
            })
            .eq('id', action.id);
          if (cancelarError) throw cancelarError;
          result = { action: 'cancelar' };
          break;
        }

        default:
          throw new Error('Ação não reconhecida');
      }
      
      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-caixa'] });
      
      switch (result.action) {
        case 'marcar_pago':
          toast.success('Lançamento marcado como pago!');
          break;
        case 'reagendar':
          toast.success('Lançamento reagendado!');
          break;
        case 'cancelar':
          toast.success('Lançamento cancelado!');
          break;
      }
    },
    onError: (error: Error) => {
      toast.error('Erro na ação: ' + error.message);
    },
  });
}

// Hook para estatísticas de previstos
export function usePrevistosStats(competencia?: string) {
  return useQuery({
    queryKey: ['previstos-stats', competencia],
    queryFn: async () => {
      let query = supabase
        .from('lancamentos_previstos')
        .select('status, tipo, valor');

      if (competencia) {
        query = query.eq('competencia', competencia);
      }

      const { data, error } = await query;
      if (error) throw error;

      const stats = {
        total: data.length,
        porStatus: data.reduce((acc, item) => {
          acc[item.status] = (acc[item.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        porTipo: data.reduce((acc, item) => {
          acc[item.tipo] = (acc[item.tipo] || 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        valorTotal: data.reduce((acc, item) => acc + item.valor, 0),
        valorPorTipo: data.reduce((acc, item) => {
          acc[item.tipo] = (acc[item.tipo] || 0) + item.valor;
          return acc;
        }, {} as Record<string, number>),
      };

      return stats;
    },
  });
}




