import { useMemo } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Recebimento, ResumoRecebidos } from '@/types/recebidos';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RecebidosResumoProps {
  recebimentos: Recebimento[];
  dataInicio: string;
  dataFim: string;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);

const getDataRecebimento = (recebimento: Recebimento): string => {
  if (recebimento.origem === 'caixa') {
    return recebimento.data;
  } else {
    return recebimento.data_vencimento;
  }
};

const getValorRecebimento = (recebimento: Recebimento): number => {
  return recebimento.valor;
};

export function RecebidosResumo({ recebimentos, dataInicio, dataFim }: RecebidosResumoProps) {
  const resumo = useMemo<ResumoRecebidos>(() => {
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

    // Filtrar recebimentos do mês atual
    const recebimentosMes = recebimentos.filter((r) => {
      const dataRecebimento = getDataRecebimento(r);
      return dataRecebimento >= inicioMesStr && dataRecebimento <= fimMesStr;
    });

    // Filtrar recebimentos do ano atual
    const recebimentosAno = recebimentos.filter((r) => {
      const dataRecebimento = getDataRecebimento(r);
      return dataRecebimento >= inicioAnoStr && dataRecebimento <= fimAnoStr;
    });

    // Recebimentos do período filtrado
    const recebimentosPeriodo = recebimentos.filter((r) => {
      const dataRecebimento = getDataRecebimento(r);
      return dataRecebimento >= dataInicio && dataRecebimento <= dataFim;
    });

    // Calcular totais
    const totalMes = recebimentosMes.reduce((sum, r) => sum + getValorRecebimento(r), 0);
    const totalAno = recebimentosAno.reduce((sum, r) => sum + getValorRecebimento(r), 0);
    const totalPeriodo = recebimentosPeriodo.reduce((sum, r) => sum + getValorRecebimento(r), 0);
    const quantidade = recebimentosPeriodo.length;

    // Calcular média diária
    const inicio = new Date(dataInicio);
    const fim = new Date(dataFim);
    const diasPeriodo = Math.max(1, Math.ceil((fim.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1);
    const mediaDiaria = totalPeriodo / diasPeriodo;

    // Maior recebimento do período
    const maiorRecebimento = recebimentosPeriodo.length > 0
      ? Math.max(...recebimentosPeriodo.map((r) => getValorRecebimento(r)))
      : 0;

    return {
      totalMes,
      totalAno,
      totalPeriodo,
      quantidade,
      mediaDiaria,
      maiorRecebimento,
    };
  }, [recebimentos, dataInicio, dataFim]);

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
          <p className="text-xs text-muted-foreground">Recebimentos no período</p>
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
            <p className="text-xs font-medium text-muted-foreground">Maior Recebimento</p>
            <p className="text-2xl font-semibold">{formatCurrency(resumo.maiorRecebimento)}</p>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Do período filtrado</p>
        </CardContent>
      </Card>
    </div>
  );
}

