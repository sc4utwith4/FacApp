'use client';

import { cn } from '@/lib/utils';

export interface MessageChartData {
  type: 'bar' | 'pie';
  labels: string[];
  values: number[];
  title?: string;
}

export interface MessageChartProps {
  data: MessageChartData;
  className?: string;
}

export function MessageChart({ data, className }: MessageChartProps) {
  const { type, labels, values, title } = data;
  if (!labels?.length || !values?.length) return null;

  const total = values.reduce((a, b) => a + b, 0);

  if (type === 'pie') {
    return (
      <div className={cn('space-y-2', className)}>
        {title && <p className="text-sm font-medium text-foreground">{title}</p>}
        <div className="flex flex-wrap gap-3">
          {labels.map((label, i) => {
            const v = values[i] ?? 0;
            const pct = total ? Math.round((v / total) * 100) : 0;
            return (
              <div key={i} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-medium text-foreground">{v}</span>
                <span className="text-xs text-muted-foreground">({pct}%)</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const maxVal = Math.max(...values, 1);
  return (
    <div className={cn('space-y-2', className)}>
      {title && <p className="text-sm font-medium text-foreground">{title}</p>}
      <div className="space-y-1.5">
        {labels.map((label, i) => {
          const v = values[i] ?? 0;
          const pct = (v / maxVal) * 100;
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-24 shrink-0 truncate text-sm text-muted-foreground" title={label}>
                {label}
              </span>
              <div className="min-w-[60px] flex-1 rounded bg-muted">
                <div
                  className="h-5 rounded bg-primary/70 transition-all"
                  style={{ width: `${Math.max(pct, 4)}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-sm font-medium text-foreground">{v}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
