import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useRelatorios } from '@/hooks/useRelatorios';
import { FiltrosRelatorio, RelatorioFechamento } from '@/types/relatorios';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Download, FileText, TrendingUp, TrendingDown } from 'lucide-react';

interface FechamentoCaixaProps {
  readonly filtros: FiltrosRelatorio;
}

export function FechamentoCaixa({ filtros }: FechamentoCaixaProps) {
  const { gerarFechamentoCaixa, loading } = useRelatorios();
  const [relatorio, setRelatorio] = useState<RelatorioFechamento | null>(null);

  const handleGerarRelatorio = async () => {
    try {
      const result = await gerarFechamentoCaixa(filtros);
      if (result.data) {
        setRelatorio(result.data);
      }
    } catch (error) {
      console.error('Erro ao gerar relatório:', error);
    }
  };

  const formatarMoeda = (valor: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(valor);
  };

  const formatarData = (data: string) => {
    return format(new Date(data), 'dd/MM/yyyy', { locale: ptBR });
  };

  return (
    <div className="space-y-6">
      {/* Bloco de Status do Fechamento */}
      <Card className="border-2 border-green-200 bg-green-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-800">
            <FileText className="h-6 w-6" />
            Fechamento de Caixa - {formatarData(filtros.periodo.inicio)} a {formatarData(filtros.periodo.fim)}
            <span className="ml-auto text-sm font-normal bg-green-100 text-green-700 px-2 py-1 rounded-full">
              {relatorio ? 'Relatório Gerado' : 'Pronto para Gerar'}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-green-800">Período:</span>{' '}
                <span className="text-green-700">{formatarData(filtros.periodo.inicio)} - {formatarData(filtros.periodo.fim)}</span>
              </div>
              <div>
                <span className="font-medium text-green-800">Gerado em:</span>{' '}
                <span className="text-green-700">{format(new Date(), 'dd/MM/yyyy HH:mm', { locale: ptBR })}</span>
              </div>
              <div>
                <span className="font-medium text-green-800">Status:</span>{' '}
                <span className="text-green-700">{relatorio ? 'Concluído' : 'Aguardando'}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button 
                onClick={handleGerarRelatorio}
                disabled={loading}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                <Download className="h-4 w-4 mr-2" />
                {(() => {
                  if (loading) return 'Gerando...';
                  if (relatorio) return 'Regenerar Relatório';
                  return 'Gerar Relatório';
                })()}
              </Button>
              {relatorio && (
                <Button 
                  variant="outline" 
                  className="flex-1 border-green-300 text-green-700 hover:bg-green-100"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Exportar PDF
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {relatorio && (
        <div className="space-y-6">
          {/* Resumo */}
          <Card>
            <CardHeader>
              <CardTitle>Resumo do Período</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">
                    {formatarMoeda(relatorio.resumo.total_entradas)}
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                    <TrendingUp className="h-4 w-4" />
                    Total Entradas
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-600">
                    {formatarMoeda(relatorio.resumo.total_saidas)}
                  </div>
                  <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                    <TrendingDown className="h-4 w-4" />
                    Total Saídas
                  </div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${
                    relatorio.resumo.saldo_final >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {formatarMoeda(relatorio.resumo.saldo_final)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Saldo Final
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">
                    {relatorio.resumo.quantidade_lancamentos}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Lançamentos
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Saldo por Conta */}
          <Card>
            <CardHeader>
              <CardTitle>Saldo por Conta Bancária</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {relatorio.saldo_por_conta.map((conta) => (
                  <div key={conta.conta.id} className="flex justify-between items-center p-3 bg-muted rounded-lg">
                    <div>
                      <div className="font-medium">{conta.conta.nome}</div>
                      <div className="text-sm text-muted-foreground">
                        Saldo inicial: {formatarMoeda(conta.saldo_inicial)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">
                        {formatarMoeda(conta.saldo_final)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Movimentação: {formatarMoeda(conta.movimentacao)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Lançamentos */}
          <Card>
            <CardHeader>
              <CardTitle>Lançamentos do Período</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {relatorio.lancamentos.map((lancamento) => (
                  <div key={lancamento.id} className="flex justify-between items-center p-3 border rounded-lg">
                    <div className="flex-1">
                      <div className="font-medium">{lancamento.descricao}</div>
                      <div className="text-sm text-muted-foreground">
                        {lancamento.contas_bancarias?.nome} • {lancamento.grupos_contas?.nome} • {formatarData(lancamento.data)}
                      </div>
                    </div>
                    <div className={`font-medium ${
                      lancamento.tipo === 'entrada' ? 'text-green-600' : 'text-red-600'
                    }`}>
                      {lancamento.tipo === 'entrada' ? '+' : '-'} {formatarMoeda(lancamento.valor)}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Botão de Exportar */}
          <Card>
            <CardContent className="pt-6">
              <Button className="w-full md:w-auto">
                <Download className="h-4 w-4 mr-2" />
                Exportar para PDF
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
