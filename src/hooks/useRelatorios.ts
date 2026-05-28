import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  FiltrosRelatorio, 
  RelatorioFechamento, 
  RelatorioExtrato, 
  RelatorioReceitasDespesas,
  LancamentoCaixa 
} from '@/types/relatorios';

export function useRelatorios() {
  // Buscar lançamentos para fechamento de caixa
  const buscarLancamentos = useQuery({
    queryKey: ['lancamentos-relatorio'],
    queryFn: async (filtros: FiltrosRelatorio) => {
      let query = supabase
        .from('lancamentos_caixa')
        .select(`
          *,
          contas_bancarias (
            id,
            nome,
            saldo_atual,
            saldo_inicial,
            bancos (nome)
          ),
          grupos_contas (
            id,
            nome,
            natureza
          ),
          clientes (
            id,
            nome
          )
        `)
        .gte('data', filtros.periodo.inicio)
        .lte('data', filtros.periodo.fim)
        .order('data', { ascending: false });

      if (filtros.conta_bancaria_id) {
        query = query.eq('conta_bancaria_id', filtros.conta_bancaria_id);
      }

      if (filtros.grupo_conta_id) {
        query = query.eq('grupo_conta_id', filtros.grupo_conta_id);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as LancamentoCaixa[];
    }
  });

  // Gerar relatório de fechamento de caixa
  const gerarFechamentoCaixa = useQuery({
    queryKey: ['fechamento-caixa'],
    queryFn: async (filtros: FiltrosRelatorio): Promise<RelatorioFechamento> => {
      const lancamentos = await buscarLancamentos.queryFn(filtros);

      // Calcular totais
      const totalEntradas = lancamentos
        .filter(l => l.tipo === 'entrada')
        .reduce((sum, l) => sum + l.valor, 0);

      const totalSaidas = lancamentos
        .filter(l => l.tipo === 'saida')
        .reduce((sum, l) => sum + l.valor, 0);

      const saldoFinal = totalEntradas - totalSaidas;

      // Agrupar por conta bancária
      const saldoPorConta = lancamentos.reduce((acc, lancamento) => {
        const contaId = lancamento.conta_bancaria_id;
        const contaNome = lancamento.contas_bancarias?.nome || 'Conta não encontrada';
        
        if (!acc[contaId]) {
          // Usar mesma lógica de ContasEstoques: saldo_atual se definido (inclusive zero), senão saldo_inicial
          const saldoConta = lancamento.contas_bancarias?.saldo_atual !== null && 
                             lancamento.contas_bancarias?.saldo_atual !== undefined
            ? lancamento.contas_bancarias.saldo_atual
            : (lancamento.contas_bancarias?.saldo_inicial ?? 0);
          
          acc[contaId] = {
            conta: {
              id: contaId,
              nome: contaNome,
              saldo_atual: saldoConta
            },
            movimentacao: 0,
            saldo_inicial: saldoConta
          };
        }

        acc[contaId].movimentacao += lancamento.tipo === 'entrada' ? lancamento.valor : -lancamento.valor;
        return acc;
      }, {} as Record<string, any>);

      return {
        periodo: filtros.periodo,
        resumo: {
          total_entradas: totalEntradas,
          total_saidas: totalSaidas,
          saldo_final: saldoFinal,
          quantidade_lancamentos: lancamentos.length
        },
        lancamentos,
        saldo_por_conta: Object.values(saldoPorConta).map(item => ({
          ...item,
          saldo_final: item.saldo_inicial + item.movimentacao
        }))
      };
    }
  });

  // Gerar extrato bancário
  const gerarExtratoBancario = {
    refetch: async (contaId: string, filtros: FiltrosRelatorio): Promise<RelatorioExtrato> => {
      const { data: conta, error: contaError } = await supabase
        .from('contas_bancarias')
        .select(`
          *,
          bancos (nome)
        `)
        .eq('id', contaId)
        .single();

      if (contaError) throw contaError;

      const lancamentos = await buscarLancamentos.queryFn({
        ...filtros,
        conta_bancaria_id: contaId
      });

      const movimentacaoTotal = lancamentos.reduce((sum, l) => {
        return sum + (l.tipo === 'entrada' ? l.valor : -l.valor);
      }, 0);

      // Usar mesma lógica de ContasEstoques: saldo_atual se definido (inclusive zero), senão saldo_inicial
      const saldoFinal = conta.saldo_atual !== null && conta.saldo_atual !== undefined
        ? conta.saldo_atual
        : (conta.saldo_inicial ?? 0);

      return {
        conta,
        periodo: filtros.periodo,
        saldo_inicial: saldoFinal - movimentacaoTotal,
        saldo_final: saldoFinal,
        lancamentos
      };
    },
    isLoading: false,
  };

  // Gerar relatório de receitas vs despesas
  const gerarReceitasDespesas = {
    refetch: async (filtros: FiltrosRelatorio): Promise<RelatorioReceitasDespesas> => {
      const lancamentos = await buscarLancamentos.queryFn(filtros);

      // Agrupar por grupo de conta
      const receitas = lancamentos
        .filter(l => l.grupos_contas?.natureza === 'receita')
        .reduce((acc, l) => {
          const grupoNome = l.grupos_contas?.nome || 'Sem grupo';
          if (!acc[grupoNome]) {
            acc[grupoNome] = { grupo: grupoNome, total: 0, quantidade: 0 };
          }
          acc[grupoNome].total += l.valor;
          acc[grupoNome].quantidade += 1;
          return acc;
        }, {} as Record<string, { grupo: string; total: number; quantidade: number }>);

      const despesas = lancamentos
        .filter(l => l.grupos_contas?.natureza === 'despesa')
        .reduce((acc, l) => {
          const grupoNome = l.grupos_contas?.nome || 'Sem grupo';
          if (!acc[grupoNome]) {
            acc[grupoNome] = { grupo: grupoNome, total: 0, quantidade: 0 };
          }
          acc[grupoNome].total += l.valor;
          acc[grupoNome].quantidade += 1;
          return acc;
        }, {} as Record<string, { grupo: string; total: number; quantidade: number }>);

      const totalReceitas = Object.values(receitas).reduce((sum, item) => sum + item.total, 0);
      const totalDespesas = Object.values(despesas).reduce((sum, item) => sum + item.total, 0);

      return {
        periodo: filtros.periodo,
        receitas: Object.values(receitas),
        despesas: Object.values(despesas),
        total_receitas: totalReceitas,
        total_despesas: totalDespesas,
        saldo_periodo: totalReceitas - totalDespesas
      };
    },
    isLoading: false,
  };

  return {
    buscarLancamentos: buscarLancamentos.refetch,
    gerarFechamentoCaixa: gerarFechamentoCaixa.refetch,
    gerarExtratoBancario: gerarExtratoBancario.refetch,
    gerarReceitasDespesas: gerarReceitasDespesas.refetch,
    loading: buscarLancamentos.isLoading || gerarFechamentoCaixa.isLoading || 
             gerarExtratoBancario.isLoading || gerarReceitasDespesas.isLoading
  };
}





