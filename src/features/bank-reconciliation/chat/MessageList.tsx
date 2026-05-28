'use client';

import { cn } from '@/lib/utils';

export interface MessageListItem {
  title: string;
  subtitle?: string;
}

export interface MessageListData {
  items: string[] | MessageListItem[];
  title?: string;
}

export interface MessageListProps {
  data: MessageListData;
  className?: string;
}

export function MessageList({ data, className }: MessageListProps) {
  const { items, title } = data;
  if (!items?.length) return null;

  const normalized = items.map((it) =>
    typeof it === 'string' ? { title: it, subtitle: undefined } : it
  );

  return (
    <div className={cn('rounded-lg border border-border bg-muted/30 p-3', className)}>
      {title && <p className="mb-2 text-sm font-medium text-foreground">{title}</p>}
      <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
        {normalized.map((item, i) => (
          <li key={i}>
            <span className="text-foreground">{item.title}</span>
            {item.subtitle && (
              <span className="ml-1 text-muted-foreground">— {item.subtitle}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
