import { BarChart as RechartsBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { UiRenderErrorBoundary } from '@/components/ui/ui-render-error-boundary';

interface ChartDataPoint {
  name: string;
  [key: string]: string | number;
}

interface BarChartProps {
  readonly data: ChartDataPoint[];
  readonly dataKey: string;
  readonly name: string;
  readonly color?: string;
  readonly height?: number;
}

export function BarChart({ data, dataKey, name, color = "hsl(var(--chart-1))", height = 300 }: BarChartProps) {
  const firstPoint = data[0]?.name ?? "empty";
  const lastPoint = data[data.length - 1]?.name ?? "empty";
  const chartKey = `bar:${dataKey}:${data.length}:${String(firstPoint)}:${String(lastPoint)}`;

  return (
    <UiRenderErrorBoundary scope="charts/BarChart" resetKey={chartKey}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsBarChart key={chartKey} data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip
            isAnimationActive={false}
            formatter={(value: number | string) => [
              new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(Number(value)),
              name
            ]}
          />
          <Legend />
          <Bar isAnimationActive={false} animationDuration={0} dataKey={dataKey} fill={color} radius={[4, 4, 0, 0]} />
        </RechartsBarChart>
      </ResponsiveContainer>
    </UiRenderErrorBoundary>
  );
}
