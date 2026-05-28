import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useMemo, useRef } from "react";
import { UiRenderErrorBoundary } from "@/components/ui/ui-render-error-boundary";

interface ChartDataPoint {
  name: string;
  entradas: number;
  saidas: number;
}

interface RevenueExpenseChartProps {
  data: ChartDataPoint[];
  loading?: boolean;
}

export function RevenueExpenseChart({ data, loading = false }: RevenueExpenseChartProps) {
  const lastStableDataRef = useRef<ChartDataPoint[]>([]);
  if (data.length > 0) {
    lastStableDataRef.current = data;
  }

  const chartData = data.length > 0 ? data : lastStableDataRef.current;
  const hasData = chartData.length > 0;
  const chartKey = useMemo(() => {
    const firstPoint = chartData[0]?.name ?? "empty";
    const lastPoint = chartData[chartData.length - 1]?.name ?? "empty";
    return `revenue-expense:${chartData.length}:${String(firstPoint)}:${String(lastPoint)}`;
  }, [chartData]);

  return (
    <Card className="col-span-full">
      <CardHeader>
        <CardTitle className="text-lg">Receitas vs Despesas (Últimos 6 meses)</CardTitle>
      </CardHeader>
      <CardContent>
        {loading && !hasData ? (
          <div className="flex items-center justify-center h-80">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : !hasData ? (
          <div className="flex items-center justify-center h-80 text-muted-foreground">
            <p className="text-sm">Nenhum dado disponível</p>
          </div>
        ) : (
          <div className="relative">
            <UiRenderErrorBoundary scope="dashboard/RevenueExpenseChart" resetKey={chartKey}>
              <ResponsiveContainer width="100%" height={320}>
                <RechartsBarChart key={chartKey} data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip
                    isAnimationActive={false}
                    formatter={(value: number | string, name: string) => [
                      new Intl.NumberFormat('pt-BR', {
                        style: 'currency',
                        currency: 'BRL',
                      }).format(Number(value)),
                      name === 'entradas' ? 'Receitas' : 'Despesas'
                    ]}
                  />
                  <Legend
                    formatter={(value: string) => value === 'entradas' ? 'Receitas' : 'Despesas'}
                  />
                  <Bar isAnimationActive={false} animationDuration={0} dataKey="entradas" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} name="Receitas" />
                  <Bar isAnimationActive={false} animationDuration={0} dataKey="saidas" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Despesas" />
                </RechartsBarChart>
              </ResponsiveContainer>
            </UiRenderErrorBoundary>
            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-background/60 backdrop-blur-[1px]">
                <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
