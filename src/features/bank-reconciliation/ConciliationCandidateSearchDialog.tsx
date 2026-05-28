'use client';

import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatCurrency } from '@/lib/utils';
import type { ConciliationCandidateSearchResult, ConciliationWorkspaceRow } from '@/types/bank-reconciliation';

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
};

interface ConciliationCandidateSearchDialogProps {
  open: boolean;
  row: ConciliationWorkspaceRow | null;
  searchValue: string;
  results: ConciliationCandidateSearchResult[];
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onSearchValueChange: (value: string) => void;
  onSearch: () => void;
  onSelectCandidate: (candidate: ConciliationCandidateSearchResult) => void;
}

export function ConciliationCandidateSearchDialog({
  open,
  row,
  searchValue,
  results,
  loading = false,
  onOpenChange,
  onSearchValueChange,
  onSearch,
  onSelectCandidate,
}: ConciliationCandidateSearchDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Buscar lançamento existente</DialogTitle>
          <DialogDescription>
            Use a busca contextual para localizar o item financeiro correto e conciliar esta linha do extrato.
          </DialogDescription>
        </DialogHeader>

        {row ? (
          <div className="rounded-lg border bg-muted/20 px-3 py-2 text-sm">
            <p className="font-medium">{row.descricao}</p>
            <p className="text-xs text-muted-foreground">
              {formatDate(row.data_movimento)} · {formatCurrency(row.valor_centavos / 100)}
            </p>
          </div>
        ) : null}

        <div className="flex gap-2">
          <Input
            value={searchValue}
            onChange={(event) => onSearchValueChange(event.target.value)}
            placeholder="Pesquisar por histórico, documento ou código"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                onSearch();
              }
            }}
          />
          <Button type="button" variant="outline" className="gap-1.5" onClick={onSearch} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Buscar
          </Button>
        </div>

        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {results.length === 0 && !loading ? (
            <div className="rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground">
              Nenhum candidato encontrado. Ajuste a busca ou use “Adicionar”.
            </div>
          ) : null}

          {results.map((candidate) => (
            <div key={candidate.item_financeiro_id} className="rounded-lg border px-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{candidate.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    Código {candidate.item_financeiro_id} · {formatDate(candidate.data)} ·{' '}
                    {formatCurrency(candidate.valor_centavos / 100)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Documento: {candidate.documento || '—'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {candidate.strict_value_date_direction_match ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      Match estrito
                    </Badge>
                  ) : null}
                  {candidate.exact_amount_match ? <Badge variant="outline">mesmo valor</Badge> : null}
                  {candidate.exact_date_match ? <Badge variant="outline">mesma data</Badge> : null}
                </div>
              </div>
              <DialogFooter className="mt-3">
                <Button type="button" onClick={() => onSelectCandidate(candidate)}>
                  Vincular este item
                </Button>
              </DialogFooter>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
