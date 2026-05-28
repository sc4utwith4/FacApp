'use client';

import { cn } from '@/lib/utils';

export interface MessageSummaryData {
  items: { label: string; value: string | number }[];
  title?: string;
}

export interface MessageSummaryProps {
  data: MessageSummaryData;
  className?: string;
}

export function MessageSummary({ data, className }: MessageSummaryProps) {
  const { items, title } = data;
  if (!items?.length) return null;

  return (
    <div className={cn('rounded-lg border border-border bg-muted/30 p-3', className)}>
      {title && <p className="mb-2 text-sm font-medium text-foreground">{title}</p>}
      <dl className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex justify-between gap-4 text-sm">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="font-medium text-foreground">{String(item.value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
