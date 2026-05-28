import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ensureUUID } from '@/lib/uuid';
import { useEmpresaId } from './useEstoque';
import type {
  RecebivelOperacaoEstoque,
  CreateRecebivelOperacaoEstoque,
  UpdateRecebivelOperacaoEstoque,
} from '@/types/recebiveis-estoque';

// Hook para buscar recebíveis de uma operação específica
export function useRecebiveisPorOperacao(operacaoId?: number) {
  return useQuery({
    queryKey: ['recebiveis-operacao', operacaoId],
    queryFn: async () => {
      if (!operacaoId) {
        return [];
      }

      const { data, error } = await supabase
        .from('recebiveis_operacoes_estoque')
        .select('*')
        .eq('operacao_estoque_id', operacaoId)
        .order('data_vencimento', { ascending: true });

      if (error) {
        throw new Error(`Erro ao buscar recebíveis: ${error.message}`);
      }

      return (data || []) as RecebivelOperacaoEstoque[];
    },
    enabled: !!operacaoId,
    retry: false,
  });
}

// Hook para listar todos os recebíveis de uma empresa
export function useRecebiveisEstoque() {
  const { data: empresaId } = useEmpresaId();

  return useQuery({
    queryKey: ['recebiveis-estoque', empresaId],
    queryFn: async () => {
      if (!empresaId) {
        throw new Error('Empresa não encontrada');
      }

      const empresaIdUUID = ensureUUID(empresaId);
      if (!empresaIdUUID) {
        throw new Error('Empresa ID inválido');
      }

      const { data, error } = await supabase
        .from('recebiveis_operacoes_estoque')
        .select(`
          *,
          operacoes_estoque:operacao_estoque_id (
            id,
            data,
            historico,
            fornecedores:fornecedor_id (
              razao_social,
              nome_fantasia
            )
          )
        `)
        .eq('empresa_id', empresaIdUUID)
        .order('data_vencimento', { ascending: true })
        .order('created_at', { ascending: false });

      if (error) {
        throw new Error(`Erro ao buscar recebíveis: ${error.message}`);
      }

      return (data || []).map((item: any) => {
        const operacaoRaw = Array.isArray(item.operacoes_estoque) 
          ? item.operacoes_estoque[0] 
          : item.operacoes_estoque;
        
        const fornecedorRaw = operacaoRaw?.fornecedores 
          ? (Array.isArray(operacaoRaw.fornecedores) 
              ? operacaoRaw.fornecedores[0] 
              : operacaoRaw.fornecedores)
          : null;

        return {
          ...item,
          operacoes_estoque: operacaoRaw ? {
            id: operacaoRaw.id,
            data: operacaoRaw.data,
            historico: operacaoRaw.historico,
            fornecedores: fornecedorRaw,
          } : undefined,
        };
      }) as (RecebivelOperacaoEstoque & {
        operacoes_estoque?: {
          id: number;
          data: string;
          historico: string | null;
          fornecedores?: {
            razao_social: string | null;
            nome_fantasia: string | null;
          } | null;
        };
      })[];
    },
    enabled: !!empresaId,
    retry: false,
  });
}

// Hook para criar recebível
export function useCreateRecebivelOperacaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateRecebivelOperacaoEstoque) => {
      const { data: result, error } = await supabase
        .from('recebiveis_operacoes_estoque')
        .insert({
          operacao_estoque_id: data.operacao_estoque_id,
          empresa_id: data.empresa_id,
          valor: data.valor,
          data_vencimento: data.data_vencimento || null,
          descricao: data.descricao || null,
          tipo_estoque: data.tipo_estoque,
        })
        .select()
        .single();

      if (error) {
        throw new Error(`Erro ao criar recebível: ${error.message}`);
      }

      return result as RecebivelOperacaoEstoque;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['recebiveis-operacao', variables.operacao_estoque_id] });
      queryClient.invalidateQueries({ queryKey: ['recebiveis-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
    },
    onError: (error: Error) => {
      toast.error(`Erro ao criar recebível: ${error.message}`);
    },
  });
}

// Hook para atualizar recebível
export function useUpdateRecebivelOperacaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateRecebivelOperacaoEstoque) => {
      const { id, ...updateData } = data;

      const { data: result, error } = await supabase
        .from('recebiveis_operacoes_estoque')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        throw new Error(`Erro ao atualizar recebível: ${error.message}`);
      }

      return result as RecebivelOperacaoEstoque;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['recebiveis-operacao', result.operacao_estoque_id] });
      queryClient.invalidateQueries({ queryKey: ['recebiveis-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      toast.success('Recebível atualizado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao atualizar recebível: ${error.message}`);
    },
  });
}

// Hook para deletar recebível
export function useDeleteRecebivelOperacaoEstoque() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      // Buscar operacao_estoque_id antes de deletar para invalidar cache
      const { data: recebivel } = await supabase
        .from('recebiveis_operacoes_estoque')
        .select('operacao_estoque_id')
        .eq('id', id)
        .single();

      const { error } = await supabase
        .from('recebiveis_operacoes_estoque')
        .delete()
        .eq('id', id);

      if (error) {
        throw new Error(`Erro ao deletar recebível: ${error.message}`);
      }

      return { id, operacao_estoque_id: recebivel?.operacao_estoque_id };
    },
    onSuccess: (result) => {
      if (result.operacao_estoque_id) {
        queryClient.invalidateQueries({ queryKey: ['recebiveis-operacao', result.operacao_estoque_id] });
      }
      queryClient.invalidateQueries({ queryKey: ['recebiveis-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
      toast.success('Recebível deletado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error(`Erro ao deletar recebível: ${error.message}`);
    },
  });
}

// Hook para deletar recebíveis de uma operação (usado ao deletar operação)
export function useDeleteRecebiveisPorOperacao() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (operacaoId: number) => {
      const { error } = await supabase
        .from('recebiveis_operacoes_estoque')
        .delete()
        .eq('operacao_estoque_id', operacaoId);

      if (error) {
        throw new Error(`Erro ao deletar recebíveis: ${error.message}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recebiveis-estoque'] });
      queryClient.invalidateQueries({ queryKey: ['lancamentos-previstos'] });
    },
    onError: (error: Error) => {
      if (process.env.NODE_ENV === 'development') {
        console.error('Erro ao deletar recebíveis:', error);
      }
      // Não mostrar toast aqui pois é chamado durante deleção de operação
    },
  });
}

