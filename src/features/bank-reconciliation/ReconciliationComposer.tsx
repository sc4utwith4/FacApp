'use client';

import * as React from 'react';
import { Send } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PromptInput } from '@/components/ui/prompt-input';
import { Button } from '@/components/ui/button';

export interface ReconciliationComposerContextPayload {
  empresa_id: string;
  conta_id: string | null;
  data_referencia: string | null;
  import_id: string | null;
  parse_status: string | null;
  status_counts: { pendente: number; sugerido: number; conciliado: number; divergente: number };
  pendencias_criticas?: number;
}

export interface ReconciliationComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Chamado ao enviar: payload local + toast; não chama backend */
  onSubmitStub?: (payload: ReconciliationComposerContextPayload, message: string) => void;
  empresaId: string | null;
  contaId: string | null;
  contaLabel?: string;
  importId: string | null;
  dataReferencia: string | null;
  parseStatus: string | null;
  statusCounts: { pendente: number; sugerido: number; conciliado: number; divergente: number };
  pendenciasCriticas?: number;
  className?: string;
}

function formatDateChip(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
}

export function ReconciliationComposer({
  value,
  onValueChange,
  onSubmitStub,
  empresaId,
  contaId,
  contaLabel,
  importId,
  dataReferencia,
  parseStatus,
  statusCounts,
  pendenciasCriticas = 0,
  className,
}: ReconciliationComposerProps) {
  const handleSubmit = React.useCallback(() => {
    const trimmed = value.trim();
    const payload: ReconciliationComposerContextPayload = {
      empresa_id: empresaId || '',
      conta_id: contaId,
      data_referencia: dataReferencia,
      import_id: importId,
      parse_status: parseStatus,
      status_counts: statusCounts,
      pendencias_criticas: pendenciasCriticas,
    };
    if (onSubmitStub) {
      onSubmitStub(payload, trimmed);
    }
  }, [
    value,
    empresaId,
    contaId,
    dataReferencia,
    importId,
    parseStatus,
    statusCounts,
    pendenciasCriticas,
    onSubmitStub,
  ]);

  const missingContext = [!contaId && 'Conta', !importId && 'Import'].filter(Boolean) as string[];

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Contexto:</span>
        <span
          className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
          title="Data de referência"
        >
          Data {formatDateChip(dataReferencia)}
        </span>
        <span
          className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
          title="Conta"
        >
          Conta {contaId ? (contaLabel || contaId) : '—'}
        </span>
        <span
          className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
          title="Import"
        >
          Import {importId ? importId.slice(0, 8) + '…' : '—'}
        </span>
        <span
          className="rounded-md border bg-muted/40 px-2 py-0.5 text-xs"
          title="Status do parse"
        >
          Status {parseStatus || '—'}
        </span>
      </div>
      {missingContext.length > 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Falta: {missingContext.join(', ')}. Selecione na sidebar ou na área principal.
        </p>
      )}
      <PromptInput
        value={value}
        onValueChange={onValueChange}
        onSubmit={handleSubmit}
        disabled={false}
        className="rounded-lg border bg-background"
      >
        <PromptInput.Textarea placeholder="Digite uma mensagem ou clique numa sugestão..." />
        <PromptInput.Actions>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={handleSubmit}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            Enviar
          </Button>
        </PromptInput.Actions>
      </PromptInput>
    </div>
  );
}
