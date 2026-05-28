'use client';

import type { ReactNode } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCheck, Lock, RefreshCcw, RotateCcw, Sparkles, Wand2 } from 'lucide-react';

export type ActionPreviewKind =
  | 'matching'
  | 'trigger_ai'
  | 'refresh_summary'
  | 'run_daily_reconciliation'
  | 'apply_reconciliation_plan'
  | 'daily_close'
  | 'daily_reopen';

export interface ActionPreviewContext {
  contaLabel?: string | null;
  dataReferencia?: string | null;
  importId?: string | null;
}

function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  return y && m && day ? `${day}/${m}/${y}` : d;
}

const ACTION_CONFIG: Record<
  ActionPreviewKind,
  { title: string; description: string; Icon: typeof Wand2 }
> = {
  matching: {
    title: 'Conciliar',
    description: 'Ação legada redirecionada: será executada a conciliação completa (matching + IA + resumo diário).',
    Icon: Wand2,
  },
  trigger_ai: {
    title: 'Conciliar',
    description: 'Ação legada redirecionada: será executada a conciliação completa (matching + IA + resumo diário).',
    Icon: Sparkles,
  },
  refresh_summary: {
    title: 'Atualizar Resumo do Dia',
    description: 'O resumo do dia será recalculado para a conta e data de referência.',
    Icon: RefreshCcw,
  },
  run_daily_reconciliation: {
    title: 'Conciliar',
    description: 'Executa matching, dispara IA de sugestões e atualiza o resumo diário do contexto selecionado.',
    Icon: Wand2,
  },
  apply_reconciliation_plan: {
    title: 'Aplicar Plano de Conciliação',
    description:
      'Aplica as sugestões da IA com confirmação humana e auditoria. Nesta fase, itens de criação de lançamento podem estar bloqueados.',
    Icon: CheckCheck,
  },
  daily_close: {
    title: 'Fechar Dia',
    description: 'Tenta fechar o dia da conta selecionada. A operação falha se houver pendências críticas.',
    Icon: Lock,
  },
  daily_reopen: {
    title: 'Reabrir Dia',
    description: 'Reabre o fechamento diário da conta e data selecionadas com auditoria.',
    Icon: RotateCcw,
  },
};

export interface ActionPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ActionPreviewKind;
  context: ActionPreviewContext;
  onConfirm: () => void;
  pending?: boolean;
  children?: ReactNode;
  confirmDisabled?: boolean;
  warningNotice?: string | null;
}

export function ActionPreview({
  open,
  onOpenChange,
  kind,
  context,
  onConfirm,
  pending = false,
  children,
  confirmDisabled = false,
  warningNotice = null,
}: ActionPreviewProps) {
  const config = ACTION_CONFIG[kind];
  const Icon = config.Icon;

  const handleConfirm = () => {
    onConfirm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-background border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            {config.title}
          </DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <p><strong>Conta:</strong> {context.contaLabel ?? '—'}</p>
          <p><strong>Data referência:</strong> {formatDate(context.dataReferencia ?? undefined)}</p>
          {context.importId && (
            <p><strong>Import:</strong> {String(context.importId).slice(0, 8)}…</p>
          )}
        </div>
        {warningNotice ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {warningNotice}
          </div>
        ) : null}
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={pending || confirmDisabled}>
            {pending ? 'Executando…' : 'Executar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
