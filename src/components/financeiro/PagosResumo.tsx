import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Pagamento, ResumoPagos } from '@/types/pagos';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface PagosResumoProps {
  pagamentos: Pagamento[];
  dataInicio: string;
  dataFim: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

export function PagosResumo({ pagamentos, dataInicio, dataFim }: PagosResumoProps) {
  const resumo = useMemo<ResumoPagos>(() => {
    const hoje = new Date();
    const inicioMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    const fimMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0);
    const inicioAno = new Date(hoje.getFullYear(), 0, 1);
    const fimAno = new Date(hoje.getFullYear(), 11, 31);

    // Converter datas para formato YYYY-MM-DD
    const inicioMesStr = format(inicioMes, 'yyyy-MM-dd');
    const fimMesStr = format(fimMes, 'yyyy-MM-dd');
    const inicioAnoStr = format(inicioAno, 'yyyy-MM-dd');
    const fimAnoStr = format(fimAno, 'yyyy-MM-dd');

    // Filtrar pagamentos do mês atual
    const pagamentosMes = pagamentos.filter((p) => {
      const dataPagamento = p.data;
      return dataPagamento >= inicioMesStr && dataPagamento <= fimMesStr;
    });

    // Filtrar pagamentos do ano atual
    const pagamentosAno = pagamentos.filter((p) => {
      const dataPagamento = p.data;
      return dataPagamento >= inicioAnoStr && dataPagamento <= fimAnoStr;
    });

    // Pagamentos do período filtrado
    const pagamentosPeriodo = pagamentos.filter((p) => {
      const dataPagamento = p.data;
      return dataPagamento >= dataInicio && dataPagamento <= dataFim;
    });

    // Calcular totais
    const totalMes = pagamentosMes.reduce((sum, p) => sum + p.valor, 0);
    const totalAno = pagamentosAno.reduce((sum, p) => sum + p.valor, 0);
    const totalPeriodo = pagamentosPeriodo.reduce((sum, p) => sum + p.valor, 0);
    const quantidade = pagamentosPeriodo.length;

    // Calcular média diária
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim);
    const diasPeriodo = Math.max(1, Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const mediaDiaria = totalPeriodo / diasPeriodo;

    // Maior pagamento do período
    const maiorPagamento = pagamentosPeriodo.length > 0
      ? Math.max(...pagamentosPeriodo.map((p) => p.valor))
      : 0;

    return {
      totalMes,
      totalAno,
      totalPeriodo,
      quantidade,
      mediaDiaria,
      maiorPagamento,
    };
  }, [pagamentos, dataInicio, dataFim]);

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <Card variant="glass">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Total do Mês</p>
            <p className="text-2xl font-semibold">{formatCurrency(resumo.totalMes)}</p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {format(new Date(), 'MMMM yyyy', { locale: ptBR })}
          </p>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Total do Ano</p>
            <p className="text-2xl font-semibold">{formatCurrency(resumo.totalAno)}</p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {format(new Date(), 'yyyy', { locale: ptBR })}
          </p>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Total do Período</p>
            <p className="text-2xl font-semibold">{formatCurrency(resumo.totalPeriodo)}</p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {format(new Date(dataInicio), 'dd/MM/yyyy', { locale: ptBR })} - {format(new Date(dataFim), 'dd/MM/yyyy', { locale: ptBR })}
          </p>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Quantidade</p>
            <p className="text-2xl font-semibold">{resumo.quantidade}</p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Pagamentos no período</p>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Média Diária</p>
            <p className="text-2xl font-semibold">{formatCurrency(resumo.mediaDiaria)}</p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Média do período</p>
        </CardContent>
      </Card>

      <Card variant="glass">
        <CardHeader className="flex flex-row items-start justify-between pb-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Maior Pagamento</p>
            <p className="text-2xl font-semibold">{formatCurrency(resumo.maiorPagamento)}</p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Do período filtrado</p>
        </CardContent>
      </Card>
    </div>
  );
}

