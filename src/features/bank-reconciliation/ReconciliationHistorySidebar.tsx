'use client';

import { useMemo } from 'react';
import { ChevronRight, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ReconciliationHistoryDay } from '@/types/bank-reconciliation';

export interface ReconciliationHistorySidebarProps {
  days: ReconciliationHistoryDay[];
  selectedContaId: string | null;
  selectedDate: string | null;
  onSelectConta: (contaId: string, dataReferencia: string) => void;
  /** Filtro por data: quando preenchido, lista mostra apenas o dia correspondente */
  filterDate?: string | null;
  onFilterDateChange?: (date: string | null) => void;
  isLoading?: boolean;
  className?: string;
}

export function ReconciliationHistorySidebar({
  days,
  selectedContaId,
  selectedDate,
  onSelectConta,
  filterDate = null,
  onFilterDateChange,
  isLoading = false,
  className,
}: ReconciliationHistorySidebarProps) {
  const toDateKey = (d: string | null) => (d ? d.slice(0, 10) : '');

  const filteredDays = useMemo(() => {
    if (!filterDate || !toDateKey(filterDate)) return days;
    const key = toDateKey(filterDate);
    return days.filter((d) => toDateKey(d.dataReferencia) === key);
  }, [days, filterDate]);

  return (
    <aside
      className={cn(
        'flex flex-col border-r border-border bg-muted/20',
        className
      )}
      aria-label="Conciliações feitas"
    >
      <div className="border-b border-border px-3 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          Conciliações feitas
        </h2>
      </div>
      {onFilterDateChange && (
        <div className="border-b border-border px-3 py-3">
          <Label className="text-xs text-muted-foreground">Filtrar por data:</Label>
          <Input
            type="date"
            value={filterDate ?? ''}
            onChange={(e) => onFilterDateChange(e.target.value ? e.target.value : null)}
            className="mt-1.5 h-8 text-sm"
          />
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            Carregando…
          </p>
        ) : filteredDays.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {filterDate ? 'Nenhum fechamento nesta data.' : 'Nenhum fechamento encontrado.'}
          </p>
        ) : (
          <ul className="space-y-1">
            {filteredDays.map((day) => {
              const isSelectedDay = toDateKey(selectedDate) === toDateKey(day.dataReferencia);
              const hasSelectedInDay =
                isSelectedDay &&
                day.accounts.some((a) => a.conta_bancaria_id === selectedContaId);

              return (
                <li key={day.dataReferencia}>
                  <Collapsible
                    defaultOpen={isSelectedDay || hasSelectedInDay}
                    className="group"
                  >
                    <CollapsibleTrigger
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors',
                        'hover:bg-muted/60',
                        isSelectedDay && 'bg-muted/50 font-medium'
                      )}
                    >
                      <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
                      <span className="truncate">
                        Conciliação {day.label}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="ml-4 mt-1 space-y-0.5 border-l border-border pl-2">
                        {day.accounts.map((acc) => {
                          const isSelected =
                            acc.conta_bancaria_id === selectedContaId &&
                            toDateKey(day.dataReferencia) === toDateKey(selectedDate);

                          return (
                            <li key={acc.conta_bancaria_id}>
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectConta(acc.conta_bancaria_id, day.dataReferencia)
                                }
                                className={cn(
                                  'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                                  'hover:bg-muted/60',
                                  isSelected && 'bg-primary/10 text-primary font-medium'
                                )}
                              >
                                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                <span className="truncate">
                                  {acc.descricao || acc.conta_bancaria_id}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
