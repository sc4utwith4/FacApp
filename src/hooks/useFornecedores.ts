import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ensureUUID } from '@/lib/uuid';
import type { 
  Fornecedor, 
  CreateFornecedor, 
  UpdateFornecedor,
  FiltrosFornecedores,
  FornecedorStats,
  HistoricoPagamento,
  FornecedorComIndicadores,
  IndicadoresFornecedor,
  ContratoFornecedor,
  CreateContratoFornecedor,
  DuplicataFornecedor,
  CreateDuplicataFornecedor,
  PagamentoFornecedor,
  CreatePagamentoFornecedor,
  TarifaFornecedor,
  CreateTarifaFornecedor
} from '@/types/fornecedores';

// Hook para listar fornecedores com indicadores (factoring)
export function useFornecedores(filtros?: FiltrosFornecedores) {
  return useQuery({
    queryKey: ['fornecedores', filtros],
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
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada para o usuário');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      // Usar função RPC para buscar fornecedores com indicadores
      const { data, error } = await supabase.rpc('get_fornecedores_with_indicators', {
        p_empresa_id: empresaId,
      });

      if (error) throw error;
      return (data || []) as FornecedorComIndicadores[];
    },
  });
}

// Hook para buscar fornecedor por ID (UUID)
export function useFornecedor(id: string | null) {
  return useQuery({
    queryKey: ['fornecedor', id],
    queryFn: async () => {
      if (!id || !ensureUUID(id)) {
        throw new Error('ID de fornecedor inválido');
      }

      const { data, error } = await supabase
        .from('fornecedores')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Fornecedor;
    },
    enabled: !!id && ensureUUID(id) !== null,
  });
}

// Hook para buscar indicadores de um fornecedor
export function useIndicadoresFornecedor(fornecedorId: string | null) {
  return useQuery({
    queryKey: ['indicadores-fornecedor', fornecedorId],
    queryFn: async () => {
      if (!fornecedorId || !ensureUUID(fornecedorId)) {
        throw new Error('ID de fornecedor inválido');
      }

      // Buscar empresa_id do usuário logado
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
        throw new Error('Empresa não encontrada para o usuário');
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      const { data, error } = await supabase.rpc('calcular_indicadores_fornecedor', {
        p_fornecedor_id: fornecedorId,
        p_empresa_id: empresaId,
      });

      if (error) throw error;
      return (data?.[0] || null) as IndicadoresFornecedor | null;
    },
    enabled: !!fornecedorId && ensureUUID(fornecedorId) !== null,
  });
}

// Hook para criar fornecedor
export function useCreateFornecedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateFornecedor) => {
      // Mapear 'nome' para 'razao_social' se necessário
      const insertData: any = { ...data };
      if (insertData.nome && !insertData.razao_social) {
        insertData.razao_social = insertData.nome;
        delete insertData.nome;
      }
      
      // Mapear 'ativo' para 'status' se necessário
      if ('ativo' in insertData && !('status' in insertData)) {
        insertData.status = insertData.ativo;
        delete insertData.ativo;
      }
      
      // Garantir que razao_social existe (obrigatório)
      if (!insertData.razao_social && insertData.nome) {
        insertData.razao_social = insertData.nome;
        delete insertData.nome;
      }
      
      // OBRIGATÓRIO: Garantir que observacoes seja sempre uma string (mesmo que vazia) e esteja presente
      // IMPORTANTE: Não usar || "" aqui porque pode sobrescrever valores válidos (incluindo string vazia)
      if (!('observacoes' in insertData) || insertData.observacoes === undefined || insertData.observacoes === null) {
        insertData.observacoes = '';
      } else {
        // Se existe, garantir que é string (mesmo que vazia)
        insertData.observacoes = String(insertData.observacoes);
      }
      
      // Construir objeto endereco JSONB a partir dos campos separados
      const enderecoData: any = {};
      
      // Se houver endereco como string, usar como base
      if (insertData.endereco && typeof insertData.endereco === 'string') {
        if (insertData.endereco.trim() !== '') {
          try {
            enderecoData.texto = insertData.endereco;
          } catch {
            enderecoData.texto = insertData.endereco;
          }
        }
      }
      
      // Adicionar cidade, estado, cep ao objeto endereco se existirem
      if (insertData.cidade && insertData.cidade.trim() !== '') {
        enderecoData.cidade = insertData.cidade;
      }
      if (insertData.estado && insertData.estado.trim() !== '') {
        enderecoData.estado = insertData.estado;
      }
      if (insertData.cep && insertData.cep.trim() !== '') {
        enderecoData.cep = insertData.cep;
      }
      
      // Se houver dados de endereço, salvar como JSONB
      if (Object.keys(enderecoData).length > 0) {
        insertData.endereco = enderecoData;
      } else {
        delete insertData.endereco;
      }
      
      // Campos que não existem na tabela (devem ser removidos após salvar no endereco)
      const camposNaoExistentes = ['cidade', 'estado', 'cep', 'celular', 'cpf', 'inscricao_municipal'];
      camposNaoExistentes.forEach(campo => {
        if (campo in insertData) {
          delete insertData[campo];
        }
      });
      
      // Remover campos opcionais vazios ou undefined (exceto valores numéricos 0 e booleanos)
      // NÃO remover campos que estão sendo salvos corretamente: nome, nome_fantasia, cnpj, limite_credito, observacoes
      const camposQueDevemSerMantidos = ['nome', 'razao_social', 'nome_fantasia', 'cnpj', 'limite_credito', 'taxa_antecipacao', 'observacoes', 'endereco', 'email', 'telefone', 'inscricao_estadual'];
      
      Object.keys(insertData).forEach(key => {
        const value = insertData[key];
        // Manter campos importantes mesmo se vazios
        if (camposQueDevemSerMantidos.includes(key)) {
          return; // Não remover esses campos
        }
        if (value === '' || value === undefined || value === null) {
          // Manter valores numéricos 0 e booleanos false
          if (typeof value !== 'number' && typeof value !== 'boolean') {
            delete insertData[key];
          }
        }
      });

      // Criar objeto final garantindo que observacoes está explicitamente incluído como OBRIGATÓRIO
      // IMPORTANTE: Sempre incluir observacoes, mesmo que seja string vazia
      // Usar o valor já tratado acima (garantido como string)
      const observacoesValue = insertData.observacoes ?? '';
      
      const finalInsertData: any = {
        ...insertData,
      };
      
      // FORÇAR inclusão explícita de observacoes (garantir que está presente e é string)
      finalInsertData['observacoes'] = String(observacoesValue);

      if (process.env.NODE_ENV === 'development') {
        console.log('Dados sendo inseridos:', JSON.stringify(finalInsertData, null, 2));
        console.log('Campo observacoes:', finalInsertData.observacoes, typeof finalInsertData.observacoes);
        console.log('observacoes está no objeto?', 'observacoes' in finalInsertData);
        console.log('Valor de observacoes:', finalInsertData.observacoes);
      }

      const { data: result, error } = await supabase
        .from('fornecedores')
        .insert(finalInsertData)
        .select()
        .single();

      if (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Erro ao criar fornecedor:', error, 'Dados enviados:', finalInsertData);
        }
        // Criar um erro mais descritivo
        const errorMessage = error.message || error.details || 'Erro desconhecido ao criar fornecedor';
        const enhancedError = new Error(errorMessage);
        (enhancedError as any).originalError = error;
        throw enhancedError;
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      toast.success('Fornecedor criado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao criar fornecedor: ' + error.message);
    },
  });
}

// Hook para atualizar fornecedor
export function useUpdateFornecedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...data }: UpdateFornecedor) => {
      // Aplicar as mesmas transformações do create
      const updateData: any = { ...data };
      
      // Mapear 'nome' para 'razao_social' se necessário
      if (updateData.nome && !updateData.razao_social) {
        updateData.razao_social = updateData.nome;
        delete updateData.nome;
      }
      
      // Mapear 'ativo' para 'status' se necessário
      if ('ativo' in updateData && !('status' in updateData)) {
        updateData.status = updateData.ativo;
        delete updateData.ativo;
      }
      
      // Garantir que razao_social existe (obrigatório)
      if (!updateData.razao_social && updateData.nome) {
        updateData.razao_social = updateData.nome;
        delete updateData.nome;
      }
      
      // OBRIGATÓRIO: Garantir que observacoes seja sempre uma string (mesmo que vazia) e esteja presente
      // IMPORTANTE: Não usar || "" aqui porque pode sobrescrever valores válidos (incluindo string vazia)
      if (!('observacoes' in updateData) || updateData.observacoes === undefined || updateData.observacoes === null) {
        updateData.observacoes = '';
      } else {
        // Se existe, garantir que é string (mesmo que vazia)
        updateData.observacoes = String(updateData.observacoes);
      }
      
      // Construir objeto endereco JSONB a partir dos campos separados
      const enderecoData: any = {};
      
      // Se houver endereco como string, usar como base
      if (updateData.endereco && typeof updateData.endereco === 'string') {
        if (updateData.endereco.trim() !== '') {
          enderecoData.texto = updateData.endereco;
        }
      }
      
      // Adicionar cidade, estado, cep ao objeto endereco se existirem
      if (updateData.cidade && updateData.cidade.trim() !== '') {
        enderecoData.cidade = updateData.cidade;
      }
      if (updateData.estado && updateData.estado.trim() !== '') {
        enderecoData.estado = updateData.estado;
      }
      if (updateData.cep && updateData.cep.trim() !== '') {
        enderecoData.cep = updateData.cep;
      }
      
      // Se houver dados de endereço, salvar como JSONB
      if (Object.keys(enderecoData).length > 0) {
        updateData.endereco = enderecoData;
      } else if (updateData.endereco === '') {
        // Se endereco for string vazia, remover
        delete updateData.endereco;
      }
      
      // Campos que não existem na tabela (devem ser removidos após salvar no endereco)
      const camposNaoExistentes = ['cidade', 'estado', 'cep', 'celular', 'cpf', 'inscricao_municipal'];
      camposNaoExistentes.forEach(campo => {
        if (campo in updateData) {
          delete updateData[campo];
        }
      });
      
      // Remover campos opcionais vazios ou undefined (exceto valores numéricos 0 e booleanos)
      // NÃO remover campos que estão sendo salvos corretamente: nome, nome_fantasia, cnpj, limite_credito, observacoes
      const camposQueDevemSerMantidos = ['nome', 'razao_social', 'nome_fantasia', 'cnpj', 'limite_credito', 'taxa_antecipacao', 'observacoes', 'endereco', 'email', 'telefone', 'inscricao_estadual'];
      
      Object.keys(updateData).forEach(key => {
        const value = updateData[key];
        // Manter campos importantes mesmo se vazios
        if (camposQueDevemSerMantidos.includes(key)) {
          return; // Não remover esses campos
        }
        if (value === '' || value === undefined || value === null) {
          // Manter valores numéricos 0 e booleanos false
          if (typeof value !== 'number' && typeof value !== 'boolean') {
            delete updateData[key];
          }
        }
      });

      // Criar objeto final garantindo que observacoes está explicitamente incluído como OBRIGATÓRIO
      // IMPORTANTE: Sempre incluir observacoes, mesmo que seja string vazia
      // Usar o valor já tratado acima (garantido como string)
      const observacoesValue = updateData.observacoes ?? '';
      
      const finalUpdateData: any = {
        ...updateData,
      };
      
      // FORÇAR inclusão explícita de observacoes (garantir que está presente e é string)
      finalUpdateData['observacoes'] = String(observacoesValue);

      if (process.env.NODE_ENV === 'development') {
        console.log('Dados sendo atualizados:', JSON.stringify(finalUpdateData, null, 2));
        console.log('Campo observacoes:', finalUpdateData.observacoes, typeof finalUpdateData.observacoes);
        console.log('observacoes está no objeto?', 'observacoes' in finalUpdateData);
        console.log('Valor de observacoes:', finalUpdateData.observacoes);
      }

      const { data: result, error } = await supabase
        .from('fornecedores')
        .update(finalUpdateData)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Erro ao atualizar fornecedor:', error, 'Dados enviados:', finalUpdateData);
        }
        // Criar um erro mais descritivo
        const errorMessage = error.message || error.details || 'Erro desconhecido ao atualizar fornecedor';
        const enhancedError = new Error(errorMessage);
        (enhancedError as any).originalError = error;
        throw enhancedError;
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      toast.success('Fornecedor atualizado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao atualizar fornecedor: ' + error.message);
    },
  });
}

// Hook para deletar fornecedor
export function useDeleteFornecedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!ensureUUID(id)) {
        throw new Error('ID de fornecedor inválido');
      }

      const { error } = await supabase
        .from('fornecedores')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fornecedores'] });
      toast.success('Fornecedor excluído com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao excluir fornecedor: ' + error.message);
    },
  });
}

// Hook para buscar histórico de pagamentos de um fornecedor
export function useHistoricoPagamentos(fornecedorId: string | null, filtros?: { data_inicio?: string; data_fim?: string }) {
  return useQuery({
    queryKey: ['historico-pagamentos', fornecedorId, filtros],
    queryFn: async () => {
      if (!fornecedorId || !ensureUUID(fornecedorId)) {
        throw new Error('ID de fornecedor inválido');
      }

      const { data, error } = await supabase
        .from('pagamentos_fornecedor')
        .select(`
          *,
          contas_bancarias(descricao),
          duplicatas_fornecedor(numero_duplicata)
        `)
        .eq('fornecedor_id', fornecedorId)
        .order('data_pagamento', { ascending: false });

      if (error) throw error;
      return (data || []) as PagamentoFornecedor[];
    },
    enabled: !!fornecedorId && ensureUUID(fornecedorId) !== null,
  });
}

// Hook para buscar movimentações completas de um fornecedor (duplicatas, pagamentos, tarifas)
export function useMovimentacoesFornecedor(fornecedorId: string | null) {
  return useQuery({
    queryKey: ['movimentacoes-fornecedor', fornecedorId],
    queryFn: async () => {
      if (!fornecedorId || !ensureUUID(fornecedorId)) {
        throw new Error('ID de fornecedor inválido');
      }

      // Buscar duplicatas
      const { data: duplicatas, error: errorDuplicatas } = await supabase
        .from('duplicatas_fornecedor')
        .select('*')
        .eq('fornecedor_id', fornecedorId)
        .order('data_vencimento', { ascending: false });

      if (errorDuplicatas) throw errorDuplicatas;

      // Buscar pagamentos
      const { data: pagamentos, error: errorPagamentos } = await supabase
        .from('pagamentos_fornecedor')
        .select('*')
        .eq('fornecedor_id', fornecedorId)
        .order('data_pagamento', { ascending: false });

      if (errorPagamentos) throw errorPagamentos;

      // Buscar tarifas
      const { data: tarifas, error: errorTarifas } = await supabase
        .from('tarifas_fornecedor')
        .select('*')
        .eq('fornecedor_id', fornecedorId)
        .order('data_aplicacao', { ascending: false });

      if (errorTarifas) throw errorTarifas;

      return {
        duplicatas: (duplicatas || []) as DuplicataFornecedor[],
        pagamentos: (pagamentos || []) as PagamentoFornecedor[],
        tarifas: (tarifas || []) as TarifaFornecedor[],
      };
    },
    enabled: !!fornecedorId && ensureUUID(fornecedorId) !== null,
  });
}

// Hook para buscar fornecedores para select
export function useFornecedoresSelect() {
  return useQuery({
    queryKey: ['fornecedores-select'],
    queryFn: async () => {
      // Buscar empresa_id do usuário logado
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        return [];
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('empresa_id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!profile?.empresa_id) {
        return [];
      }

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        return [];
      }

      const { data, error } = await supabase
        .from('fornecedores')
        .select('id, razao_social, nome_fantasia, cnpj')
        .eq('status', true)
        .eq('empresa_id', empresaId)
        .order('razao_social');

      if (error) {
        console.error('Erro ao carregar fornecedores:', error);
        return [];
      }
      
      return (data || []) as Array<{
        id: string;
        razao_social: string;
        nome_fantasia: string | null;
        cnpj: string | null;
      }>;
    },
  });
}

// Hook para estatísticas gerais de fornecedores
export function useFornecedoresStats(periodo?: { data_inicio: string; data_fim: string }) {
  return useQuery({
    queryKey: ['fornecedores-stats', periodo],
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
        .single();

      if (!profile?.empresa_id) {
        throw new Error('Empresa não encontrada para o usuário');
      }

      const { data: fornecedores, error: errorFornecedores } = await supabase.rpc('get_fornecedores_with_stats', {
        p_empresa_id: profile.empresa_id,
        p_data_inicio: periodo?.data_inicio || null,
        p_data_fim: periodo?.data_fim || null,
      });

      if (errorFornecedores) throw errorFornecedores;

      const stats = {
        total: fornecedores?.length || 0,
        ativos: fornecedores?.filter(f => f.status).length || 0,
        inativos: fornecedores?.filter(f => !f.status).length || 0,
        comPagamentos: fornecedores?.filter(f => f.qtd_pagamentos > 0).length || 0,
        totalPagamentos: fornecedores?.reduce((acc, f) => acc + f.total_pagamentos, 0) || 0,
        mediaPagamentos: fornecedores?.filter(f => f.qtd_pagamentos > 0).length > 0 
          ? fornecedores?.filter(f => f.qtd_pagamentos > 0).reduce((acc, f) => acc + f.total_pagamentos, 0) / fornecedores?.filter(f => f.qtd_pagamentos > 0).length || 0
          : 0,
        topFornecedores: fornecedores
          ?.filter(f => f.qtd_pagamentos > 0)
          .sort((a, b) => b.total_pagamentos - a.total_pagamentos)
          .slice(0, 5) || [],
      };

      return stats;
    },
  });
}

// Hook para buscar fornecedores por cidade
export function useFornecedoresPorCidade() {
  return useQuery({
    queryKey: ['fornecedores-por-cidade'],
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

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      const { data, error } = await supabase
        .from('fornecedores')
        .select('endereco')
        .not('endereco', 'is', null)
        .eq('status', true)
        .eq('empresa_id', empresaId);

      if (error) throw error;

      interface Endereco {
        cidade?: string;
        estado?: string;
      }

      const porCidade = data?.reduce((acc, fornecedor) => {
        const endereco = (fornecedor.endereco as Endereco | null) || {};
        const cidade = endereco.cidade || 'Sem cidade';
        const estado = endereco.estado || 'Sem estado';
        const chave = `${cidade} - ${estado}`;
        acc[chave] = (acc[chave] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      return Object.entries(porCidade)
        .map(([cidade, quantidade]) => ({ cidade, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade);
    },
  });
}

// Hook para buscar fornecedores por estado
export function useFornecedoresPorEstado() {
  return useQuery({
    queryKey: ['fornecedores-por-estado'],
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

      const empresaId = ensureUUID(profile.empresa_id);
      if (!empresaId) {
        throw new Error('Empresa ID inválido');
      }

      const { data, error } = await supabase
        .from('fornecedores')
        .select('endereco')
        .not('endereco', 'is', null)
        .eq('status', true)
        .eq('empresa_id', empresaId);

      if (error) throw error;

      interface Endereco {
        estado?: string;
      }

      const porEstado = data?.reduce((acc, fornecedor) => {
        const endereco = (fornecedor.endereco as Endereco | null) || {};
        const estado = endereco.estado || 'Sem estado';
        acc[estado] = (acc[estado] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};

      return Object.entries(porEstado)
        .map(([estado, quantidade]) => ({ estado, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade);
    },
  });
}

// ============================================
// HOOKS PARA FACTORING - Contratos
// ============================================

// Hook para buscar contratos de um fornecedor
export function useContratosFornecedor(fornecedorId: string | null) {
  return useQuery({
    queryKey: ['contratos-fornecedor', fornecedorId],
    queryFn: async () => {
      if (!fornecedorId || !ensureUUID(fornecedorId)) {
        throw new Error('ID de fornecedor inválido');
      }

      const { data, error } = await supabase
        .from('contratos_fornecedor')
        .select('*')
        .eq('fornecedor_id', fornecedorId)
        .order('data_inicio', { ascending: false });

      if (error) throw error;
      return (data || []) as ContratoFornecedor[];
    },
    enabled: !!fornecedorId && ensureUUID(fornecedorId) !== null,
  });
}

// Hook para criar contrato
export function useCreateContratoFornecedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateContratoFornecedor) => {
      const { data: result, error } = await supabase
        .from('contratos_fornecedor')
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return result as ContratoFornecedor;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contratos-fornecedor'] });
      toast.success('Contrato criado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao criar contrato: ' + error.message);
    },
  });
}

// ============================================
// HOOKS PARA FACTORING - Duplicatas
// ============================================

// Hook para buscar duplicatas de um fornecedor
export function useDuplicatasFornecedor(fornecedorId: string | null, filtros?: { status?: string; vencidas?: boolean }) {
  return useQuery({
    queryKey: ['duplicatas-fornecedor', fornecedorId, filtros],
    queryFn: async () => {
      if (!fornecedorId || !ensureUUID(fornecedorId)) {
        throw new Error('ID de fornecedor inválido');
      }

      let query = supabase
        .from('duplicatas_fornecedor')
        .select('*')
        .eq('fornecedor_id', fornecedorId);

      if (filtros?.status) {
        query = query.eq('status', filtros.status);
      }

      if (filtros?.vencidas) {
        query = query.lt('data_vencimento', new Date().toISOString().split('T')[0])
          .neq('status', 'paga')
          .neq('status', 'cancelada');
      }

      const { data, error } = await query.order('data_vencimento', { ascending: false });

      if (error) throw error;
      return (data || []) as DuplicataFornecedor[];
    },
    enabled: !!fornecedorId && ensureUUID(fornecedorId) !== null,
  });
}

// Hook para criar duplicata
export function useCreateDuplicataFornecedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateDuplicataFornecedor) => {
      const { data: result, error } = await supabase
        .from('duplicatas_fornecedor')
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return result as DuplicataFornecedor;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['duplicatas-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['indicadores-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-fornecedor'] });
      toast.success('Duplicata criada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao criar duplicata: ' + error.message);
    },
  });
}

// ============================================
// HOOKS PARA FACTORING - Pagamentos
// ============================================

// Hook para criar pagamento
export function useCreatePagamentoFornecedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreatePagamentoFornecedor) => {
      const { data: result, error } = await supabase
        .from('pagamentos_fornecedor')
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return result as PagamentoFornecedor;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pagamentos-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['historico-pagamentos'] });
      queryClient.invalidateQueries({ queryKey: ['indicadores-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-fornecedor'] });
      toast.success('Pagamento registrado com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao registrar pagamento: ' + error.message);
    },
  });
}

// ============================================
// HOOKS PARA FACTORING - Tarifas
// ============================================

// Hook para buscar tarifas de um fornecedor
export function useTarifasFornecedor(fornecedorId: string | null) {
  return useQuery({
    queryKey: ['tarifas-fornecedor', fornecedorId],
    queryFn: async () => {
      if (!fornecedorId || !ensureUUID(fornecedorId)) {
        throw new Error('ID de fornecedor inválido');
      }

      const { data, error } = await supabase
        .from('tarifas_fornecedor')
        .select('*')
        .eq('fornecedor_id', fornecedorId)
        .order('data_aplicacao', { ascending: false });

      if (error) throw error;
      return (data || []) as TarifaFornecedor[];
    },
    enabled: !!fornecedorId && ensureUUID(fornecedorId) !== null,
  });
}

// Hook para criar tarifa
export function useCreateTarifaFornecedor() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTarifaFornecedor) => {
      const { data: result, error } = await supabase
        .from('tarifas_fornecedor')
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return result as TarifaFornecedor;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarifas-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['indicadores-fornecedor'] });
      queryClient.invalidateQueries({ queryKey: ['movimentacoes-fornecedor'] });
      toast.success('Tarifa registrada com sucesso!');
    },
    onError: (error: Error) => {
      toast.error('Erro ao registrar tarifa: ' + error.message);
    },
  });
}





