import { LineChart as RechartsLineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { UiRenderErrorBoundary } from '@/components/ui/ui-render-error-boundary';

interface ChartDataPoint {
  name: string;
  [key: string]: string | number;
}

interface LineChartProps {
  readonly data: ChartDataPoint[];
  readonly dataKey: string;
  readonly name: string;
  readonly color?: string;
  readonly height?: number;
}

export function LineChart({ data, dataKey, name, color = "hsl(var(--chart-1))", height = 300 }: LineChartProps) {
  const firstPoint = data[0]?.name ?? "empty";
  const lastPoint = data[data.length - 1]?.name ?? "empty";
  const chartKey = `line:${dataKey}:${data.length}:${String(firstPoint)}:${String(lastPoint)}`;

  return (
    <UiRenderErrorBoundary scope="charts/LineChart" resetKey={chartKey}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsLineChart key={chartKey} data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
          <Line
            isAnimationActive={false}
            animationDuration={0}
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={{ fill: color, strokeWidth: 2, r: 4 }}
            activeDot={{ r: 6 }}
          />
        </RechartsLineChart>
      </ResponsiveContainer>
    </UiRenderErrorBoundary>
  );
}
