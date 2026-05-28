import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Recebimento, FiltrosRecebidos, RecebimentoCaixa, RecebimentoEstoque } from '@/types/recebidos';
import { ensureUUID, isValidUUID } from '@/lib/uuid';

export function useRecebidos(filtros: FiltrosRecebidos, incluirTodos: boolean = false) {
  return useQuery({
    queryKey: ['recebidos', filtros, incluirTodos],
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
      if (!empresaId || !isValidUUID(empresaId)) {
        throw new Error('Empresa ID inválido');
      }

      const recebimentos: Recebimento[] = [];

      // 1. Buscar recebimentos de lancamentos_caixa (tipo="entrada")
      // Nota: Removendo clientes da query pois a tabela pode não ter cliente_id
      let queryCaixa = supabase
        .from('lancamentos_caixa')
        .select(`
          *,
          grupos_contas (
            id,
            nome,
            natureza
          ),
          contas_bancarias (
            id,
            descricao,
            agencia,
            conta,
            bancos (
              nome
            )
          )
        `)
        .eq('empresa_id', empresaId)
        .eq('tipo', 'entrada')
        .order('data', { ascending: false });

      // Aplicar filtros de período (apenas se não for para buscar todos)
      if (!incluirTodos) {
        if (filtros.data_inicio) {
          queryCaixa = queryCaixa.gte('data', filtros.data_inicio);
        }

        if (filtros.data_fim) {
          queryCaixa = queryCaixa.lte('data', filtros.data_fim);
        }
      }

      if (filtros.conta_bancaria_id) {
        queryCaixa = queryCaixa.eq('conta_bancaria_id', filtros.conta_bancaria_id);
      }

      if (filtros.grupo_contas_id) {
        queryCaixa = queryCaixa.eq('grupo_contas_id', filtros.grupo_contas_id);
      }

      // Filtro de cliente removido - campo cliente_id pode não existir na tabela lancamentos_caixa
      // if (filtros.cliente_id) {
      //   queryCaixa = queryCaixa.eq('cliente_id', filtros.cliente_id);
      // }

      const { data: lancamentosCaixa, error: errorCaixa } = await queryCaixa;

      if (errorCaixa) throw errorCaixa;

      // Adicionar recebimentos de caixa com origem marcada
      if (lancamentosCaixa) {
        const caixaRecebimentos: RecebimentoCaixa[] = lancamentosCaixa.map((lc: any) => ({
          ...lc,
          origem: 'caixa' as const,
        }));
        recebimentos.push(...caixaRecebimentos);
      }

      // 2. Buscar recebíveis de estoque (campo status foi removido - mostrar todos)
      let queryEstoque = supabase
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
        .eq('empresa_id', empresaId)
        .order('data_vencimento', { ascending: false, nullsFirst: false });

      // Aplicar filtros de período (apenas se não for para buscar todos)
      if (!incluirTodos) {
        if (filtros.data_inicio) {
          queryEstoque = queryEstoque.gte('data_vencimento', filtros.data_inicio);
        }

        if (filtros.data_fim) {
          queryEstoque = queryEstoque.lte('data_vencimento', filtros.data_fim);
        }
      }

      if (filtros.tipo_estoque && filtros.tipo_estoque !== 'todos') {
        queryEstoque = queryEstoque.eq('tipo_estoque', filtros.tipo_estoque);
      }

      const { data: recebiveisEstoque, error: errorEstoque } = await queryEstoque;

      if (errorEstoque) throw errorEstoque;

      // Adicionar recebíveis de estoque com origem marcada
      if (recebiveisEstoque) {
        const estoqueRecebimentos: RecebimentoEstoque[] = recebiveisEstoque.map((re: any) => {
          const operacaoRaw = Array.isArray(re.operacoes_estoque)
            ? re.operacoes_estoque[0]
            : re.operacoes_estoque;

          const fornecedorRaw = operacaoRaw?.fornecedores
            ? (Array.isArray(operacaoRaw.fornecedores)
                ? operacaoRaw.fornecedores[0]
                : operacaoRaw.fornecedores)
            : null;

          return {
            ...re,
            origem: 'estoque' as const,
            operacoes_estoque: operacaoRaw
              ? {
                  id: operacaoRaw.id,
                  data: operacaoRaw.data,
                  historico: operacaoRaw.historico,
                  fornecedores: fornecedorRaw,
                }
              : undefined,
          };
        });
        recebimentos.push(...estoqueRecebimentos);
      }

      // Aplicar busca por texto (case insensitive)
      if (filtros.busca && filtros.busca.trim()) {
        const buscaLower = filtros.busca.toLowerCase().trim();
        return recebimentos.filter((r) => {
          if (r.origem === 'caixa') {
            const historico = (r.historico || '').toLowerCase();
            const documento = (r.documento || '').toLowerCase();
            return historico.includes(buscaLower) || documento.includes(buscaLower);
          } else {
            const descricao = (r.descricao || '').toLowerCase();
            const historico = (r.operacoes_estoque?.historico || '').toLowerCase();
            return descricao.includes(buscaLower) || historico.includes(buscaLower);
          }
        });
      }

      return recebimentos;
    },
    enabled: incluirTodos || (!!filtros.data_inicio && !!filtros.data_fim),
  });
}

