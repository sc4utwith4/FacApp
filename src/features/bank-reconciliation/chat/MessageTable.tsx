'use client';

import { cn } from '@/lib/utils';

export interface MessageTableData {
  headers: string[];
  rows: (string | number)[][];
}

export interface MessageTableProps {
  data: MessageTableData;
  className?: string;
}

export function MessageTable({ data, className }: MessageTableProps) {
  const { headers, rows } = data;
  if (!headers?.length) return null;

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-muted/30', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            {headers.map((h, i) => (
              <th key={i} className="px-3 py-2 text-left font-medium text-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map((row, ri) => (
            <tr key={ri} className="border-b border-border/70 last:border-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-muted-foreground">
                  {String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
