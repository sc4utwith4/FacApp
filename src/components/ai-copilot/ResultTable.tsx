import { Download, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { PageInfo } from '@/hooks/useAICopilot';

interface ResultTableProps {
  rows: Record<string, any>[];
  columns: string[];
  rowCount: number;
  page: PageInfo | null;
  isLoading: boolean;
  onNext?: () => void;
  onPrev?: () => void;
  onExport?: () => void;
}

function formatValue(value: any, column?: string): string {
  if (value === null || value === undefined || value === '') return '—';
  
  // Format booleans
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  
  // Format dates (look for ISO string pattern or column name)
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    try {
      return new Date(value).toLocaleDateString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) { /* ignore */ }
  } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    try {
      // Handle YYYY-MM-DD format carefully to prevent timezone shift issues
      const [year, month, day] = value.split('-');
      return `${day}/${month}/${year}`;
    } catch (e) { /* ignore */ }
  }

  // Format currency/numbers based on column name or type
  const isCurrencyColumn = column && /valor|preco|custo|saldo|total|pagamento|recebimento/i.test(column);
  if (typeof value === 'number') {
    if (isCurrencyColumn) {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL'
      }).format(value);
    }
    return value.toLocaleString('pt-BR');
  }

  // Fallback for strings
  if (typeof value === 'string') return value;
  
  // Objects or arrays
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function ResultTable({
  rows,
  columns,
  rowCount,
  page,
  isLoading,
  onNext,
  onPrev,
  onExport,
}: ResultTableProps) {
  if (!rows.length || !columns.length) return null;

  const start = page ? page.offset + 1 : 1;
  const end = page ? page.offset + rows.length : rows.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          Mostrando {start}–{end} ({rowCount || rows.length} registros na página)
        </span>
        <div className="flex items-center gap-2">
          {onExport ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onExport}
              disabled={isLoading}
              title="Exportar CSV"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              Exportar CSV
            </Button>
          ) : null}
          {onPrev ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onPrev}
              disabled={isLoading}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Anterior
            </Button>
          ) : null}
          {onNext ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={onNext}
              disabled={isLoading}
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="rounded-lg border border-border-light bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} className="whitespace-nowrap">
                  {col}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => (
              <TableRow key={`${idx}-${row?.id || 'row'}`}>
                {columns.map((col) => (
                  <TableCell key={`${idx}-${col}`} className="whitespace-nowrap">
                    {formatValue(row?.[col], col)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
