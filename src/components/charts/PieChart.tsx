import { PieChart as RechartsPieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { UiRenderErrorBoundary } from '@/components/ui/ui-render-error-boundary';

interface PieChartDataPoint {
  [key: string]: string | number;
}

interface PieChartProps {
  readonly data: PieChartDataPoint[];
  readonly dataKey: string;
  readonly nameKey: string;
  readonly colors?: string[];
  readonly height?: number;
}

const COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-1))'
];

export function PieChart({ data, dataKey, nameKey, colors = COLORS, height = 300 }: PieChartProps) {
  const firstPoint = data[0]?.[nameKey] ?? "empty";
  const lastPoint = data[data.length - 1]?.[nameKey] ?? "empty";
  const chartKey = `pie:${dataKey}:${nameKey}:${data.length}:${String(firstPoint)}:${String(lastPoint)}`;

  return (
    <UiRenderErrorBoundary scope="charts/PieChart" resetKey={chartKey}>
      <ResponsiveContainer width="100%" height={height}>
        <RechartsPieChart key={chartKey}>
          <Pie
            isAnimationActive={false}
            animationDuration={0}
            data={data}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
            outerRadius={80}
            fill="hsl(var(--chart-1))"
            dataKey={dataKey}
            nameKey={nameKey}
          >
            {data.map((entry, index) => {
              const name = String(entry[nameKey] ?? `item-${index}`);
              const value = String(entry[dataKey] ?? "0");
              return <Cell key={`cell-${name}-${value}-${index}`} fill={colors[index % colors.length]} />;
            })}
          </Pie>
          <Tooltip
            isAnimationActive={false}
            formatter={(value: number | string) => [
              new Intl.NumberFormat('pt-BR', {
                style: 'currency',
                currency: 'BRL',
              }).format(Number(value)),
              'Valor'
            ]}
          />
          <Legend />
        </RechartsPieChart>
      </ResponsiveContainer>
    </UiRenderErrorBoundary>
  );
}
