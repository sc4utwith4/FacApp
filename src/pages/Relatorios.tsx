import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar, Download, FileText, TrendingUp, Banknote, PieChart } from 'lucide-react';
import { useRelatorios } from '@/hooks/useRelatorios';
import { FiltrosRelatorio } from '@/types/relatorios';
import { FechamentoCaixa } from '@/components/relatorios/FechamentoCaixa';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Link } from 'react-router-dom';

export function Relatorios() {
  const { gerarFechamentoCaixa, gerarExtratoBancario, gerarReceitasDespesas, loading } = useRelatorios();
  const [filtros, setFiltros] = useState<FiltrosRelatorio>({
    periodo: {
      inicio: format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd'),
      fim: format(new Date(), 'yyyy-MM-dd')
    }
  });

  const [tipoRelatorio, setTipoRelatorio] = useState<'fechamento' | 'extrato' | 'receitas-despesas' | null>(null);

  const handleGerarRelatorio = async (tipo: 'fechamento' | 'extrato' | 'receitas-despesas') => {
    setTipoRelatorio(tipo);
    try {
      if (tipo === 'fechamento') {
        const result = await gerarFechamentoCaixa(filtros);
        if (result.data && process.env.NODE_ENV === 'development') {
          console.log('Relatório de Fechamento:', result.data);
        }
      } else if (tipo === 'extrato') {
        // Extrato bancário disponível no Dashboard Avançado
        // Redirecionar ou mostrar mensagem
      } else if (tipo === 'receitas-despesas') {
        const result = await gerarReceitasDespesas(filtros);
        if (result.data && process.env.NODE_ENV === 'development') {
          console.log('Receitas vs Despesas:', result.data);
        }
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Erro ao gerar relatório:', error);
      }
    }
  };

  const formatarPeriodo = () => {
    const inicio = format(new Date(filtros.periodo.inicio), 'dd/MM/yyyy', { locale: ptBR });
    const fim = format(new Date(filtros.periodo.fim), 'dd/MM/yyyy', { locale: ptBR });
    return `${inicio} - ${fim}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Relatórios Financeiros</h1>
        <p className="text-muted-foreground">
          Visualize e exporte relatórios financeiros do sistema
        </p>
      </div>

      {/* Bloco de Informações Rápidas */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-blue-800">Fechamento de Caixa</p>
                <p className="text-xs text-blue-600">Relatório principal</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-green-600" />
              <div>
                <p className="text-sm font-medium text-green-800">Extrato Bancário</p>
                <p className="text-xs text-green-600">Por conta</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="bg-purple-50 border-purple-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-purple-600" />
              <div>
                <p className="text-sm font-medium text-purple-800">Receitas vs Despesas</p>
                <p className="text-xs text-purple-600">Análise comparativa</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filtros de Período */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Período do Relatório
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="data-inicio" className="text-sm font-medium">Data Início</label>
              <input
                id="data-inicio"
                type="date"
                value={filtros.periodo.inicio}
                onChange={(e) => setFiltros(prev => ({
                  ...prev,
                  periodo: { ...prev.periodo, inicio: e.target.value }
                }))}
                className="w-full mt-1 px-3 py-2 border border-input rounded-md"
              />
            </div>
            <div>
              <label htmlFor="data-fim" className="text-sm font-medium">Data Fim</label>
              <input
                id="data-fim"
                type="date"
                value={filtros.periodo.fim}
                onChange={(e) => setFiltros(prev => ({
                  ...prev,
                  periodo: { ...prev.periodo, fim: e.target.value }
                }))}
                className="w-full mt-1 px-3 py-2 border border-input rounded-md"
              />
            </div>
            <div className="flex items-end">
              <Button 
                variant="outline" 
                onClick={() => {
                  const hoje = new Date();
                  const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
                  setFiltros(prev => ({
                    ...prev,
                    periodo: {
                      inicio: format(primeiroDiaMes, 'yyyy-MM-dd'),
                      fim: format(hoje, 'yyyy-MM-dd')
                    }
                  }));
                }}
                className="w-full"
              >
                Este Mês
              </Button>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Período selecionado: {formatarPeriodo()}
          </p>
        </CardContent>
      </Card>

      {/* Bloco Principal - Fechamento de Caixa */}
      <Card className="border-2 border-blue-200 bg-blue-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-800">
            <FileText className="h-6 w-6" />
            Fechamento de Caixa
            <span className="ml-auto text-sm font-normal bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
              Relatório Principal
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-blue-700">
            <strong>Relatório consolidado</strong> com todas as movimentações financeiras do período selecionado. 
            Inclui resumo de entradas, saídas, saldo final e detalhamento por conta bancária.
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <h4 className="font-medium text-blue-800">Funcionalidades:</h4>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Resumo financeiro completo</li>
                <li>• Saldo por conta bancária</li>
                <li>• Lista detalhada de lançamentos</li>
                <li>• Exportação para PDF</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="font-medium text-blue-800">Período Atual:</h4>
              <p className="text-sm text-blue-700 font-medium">
                {formatarPeriodo()}
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button 
              className="flex-1 bg-blue-600 hover:bg-blue-700"
              onClick={() => handleGerarRelatorio('fechamento')}
              disabled={loading}
            >
              <Download className="h-4 w-4 mr-2" />
              {loading ? 'Gerando...' : 'Gerar Fechamento de Caixa'}
            </Button>
            <Button 
              variant="outline" 
              className="flex-1 border-blue-300 text-blue-700 hover:bg-blue-100"
              disabled={loading}
            >
              <FileText className="h-4 w-4 mr-2" />
              Exportar PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Outros Relatórios */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Extrato Bancário */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5 text-green-600" />
              Extrato Bancário
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Movimentações por conta bancária no período
            </p>
            <div className="space-y-2">
              <Button 
                className="w-full"
                onClick={() => handleGerarRelatorio('extrato')}
                disabled={loading}
              >
                <Banknote className="h-4 w-4 mr-2" />
                Visualizar Extrato
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                disabled={loading}
              >
                <Download className="h-4 w-4 mr-2" />
                Exportar PDF
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Receitas vs Despesas */}
        <Card className="hover:shadow-md transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-purple-600" />
              Receitas vs Despesas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Comparativo mensal com gráficos e análises
            </p>
            <div className="space-y-2">
              <Button 
                className="w-full"
                onClick={() => handleGerarRelatorio('receitas-despesas')}
                disabled={loading}
              >
                <TrendingUp className="h-4 w-4 mr-2" />
                Ver Gráfico
              </Button>
              <Button 
                variant="outline" 
                className="w-full"
                disabled={loading}
              >
                <Download className="h-4 w-4 mr-2" />
                Exportar Excel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Informações Adicionais */}
      <Card>
        <CardHeader>
          <CardTitle>Informações sobre os Relatórios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>• <strong>Fechamento de Caixa:</strong> Relatório consolidado com todas as movimentações do período</p>
          <p>• <strong>Extrato Bancário:</strong> Movimentações detalhadas por conta bancária</p>
          <p>• <strong>Receitas vs Despesas:</strong> Análise comparativa com gráficos visuais</p>
          <p>• Todos os relatórios podem ser exportados em PDF ou Excel</p>
          <p>• Os dados são atualizados em tempo real conforme os lançamentos</p>
        </CardContent>
      </Card>

      {/* Renderização dos Relatórios */}
      {tipoRelatorio === 'fechamento' && (
        <FechamentoCaixa filtros={filtros} />
      )}

      {tipoRelatorio === 'extrato' && (
        <Card>
          <CardHeader>
            <CardTitle>Extrato Bancário</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              O extrato bancário detalhado está disponível no <strong>Dashboard Avançado</strong>.
              Acesse a aba "Lançamentos" para visualizar todas as movimentações por conta bancária.
            </p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/">Ir para Dashboard Avançado</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tipoRelatorio === 'receitas-despesas' && (
        <Card>
          <CardHeader>
            <CardTitle>Receitas vs Despesas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-muted-foreground">
              Análise comparativa de receitas e despesas com gráficos está disponível no <strong>Dashboard Avançado</strong>.
              Acesse a seção "Contas & Estoque" para visualizar gráficos e análises detalhadas.
            </p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/">Ir para Dashboard Avançado</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
  );
}
