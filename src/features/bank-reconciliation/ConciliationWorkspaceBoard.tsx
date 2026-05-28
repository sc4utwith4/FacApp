'use client';

import {
  ArrowRightLeft,
  Link2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn, formatCurrency } from '@/lib/utils';
import type {
  ConciliationWorkspaceResponse,
  ConciliationWorkspaceRow,
  ConciliationWorkspaceRowState,
} from '@/types/bank-reconciliation';

export type WorkspaceViewState = 'no_context' | 'loading' | 'error' | 'empty' | 'ready';

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const [year, month, day] = String(value).slice(0, 10).split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
};

const STATE_LABELS: Record<ConciliationWorkspaceRowState, string> = {
  conciliado: 'Conciliado',
  pendente: 'Pendente',
  divergente: 'Divergente',
  em_revisao: 'Em revisão',
  ignorado: 'Ignorado',
};

const STATE_BADGE_CLASS: Record<ConciliationWorkspaceRowState, string> = {
  conciliado: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  pendente: 'border-slate-200 bg-slate-50 text-slate-700',
  divergente: 'border-amber-200 bg-amber-50 text-amber-700',
  em_revisao: 'border-blue-200 bg-blue-50 text-blue-700',
  ignorado: 'border-zinc-200 bg-zinc-50 text-zinc-700',
};

const ROW_ACCENT_CLASS: Record<ConciliationWorkspaceRowState, string> = {
  conciliado: 'border-l-emerald-500',
  pendente: 'border-l-slate-300',
  divergente: 'border-l-amber-500',
  em_revisao: 'border-l-blue-500',
  ignorado: 'border-l-zinc-400',
};

interface ConciliationWorkspaceBoardProps {
  workspace: ConciliationWorkspaceResponse | null;
  viewState: WorkspaceViewState;
  activeRowId?: string | null;
  emptyTitle?: string;
  emptyDescription?: string;
  errorMessage?: string | null;
  actionPending?: boolean;
  onRetry?: () => void;
  onSelectRow?: (row: ConciliationWorkspaceRow) => void;
  onOpenSearch: (row: ConciliationWorkspaceRow) => void;
  onOpenAdd: (row: ConciliationWorkspaceRow) => void;
  onOpenEdit: (row: ConciliationWorkspaceRow) => void;
  onIgnore: (row: ConciliationWorkspaceRow) => void;
  onUndo: (row: ConciliationWorkspaceRow) => void;
  onQuickConciliate: (row: ConciliationWorkspaceRow) => void;
}

const statusPriority: Record<ConciliationWorkspaceRowState, number> = {
  em_revisao: 0,
  pendente: 1,
  divergente: 2,
  ignorado: 3,
  conciliado: 4,
};

const getSystemSummary = (
  row: ConciliationWorkspaceRow,
  mode: ConciliationWorkspaceResponse['summary']['presentation_mode']
) => {
  if (mode === 'pre_conciliation') {
    return {
      title: 'Aguardando conciliação',
      subtitle: 'Clique em Conciliar para buscar vínculos, sugerir exceções e abrir a revisão operacional.',
      meta: [] as string[],
      tone: 'empty' as const,
    };
  }

  if (row.conciliation) {
    return {
      title:
        row.conciliation.lancamento_caixa_id ||
        row.conciliation.item_financeiro_id ||
        'Conciliação registrada',
      subtitle: row.conciliation.explanation || 'Este item já possui trilha de conciliação.',
      meta: [
        `Método ${row.conciliation.method}`,
        row.conciliation.item_financeiro_id ? `Código ${row.conciliation.item_financeiro_id}` : null,
      ].filter(Boolean) as string[],
      tone: 'confirmed' as const,
    };
  }

  if (row.suggested_candidate) {
    return {
      title: row.suggested_candidate.descricao,
      subtitle: row.suggested_candidate.documento || 'Candidato sugerido pelo sistema.',
      meta: [
        `Código ${row.suggested_candidate.item_financeiro_id}`,
        `${formatDate(row.suggested_candidate.data)}`,
        formatCurrency(row.suggested_candidate.valor_centavos / 100),
      ],
      tone: row.suggested_candidate.strict_value_date_direction_match ? ('safe' as const) : ('candidate' as const),
    };
  }

  if (row.ai_suggestion) {
    return {
      title: 'Sugestão IA em revisão',
      subtitle:
        row.ai_suggestion.explanation ||
        'A confiança da IA não confirma vínculo automático sem candidato elegível.',
      meta: [
        row.ai_suggestion.confidence != null
          ? `Confiança IA ${Math.round(Number(row.ai_suggestion.confidence) * 100)}% (revisão manual)`
          : null,
      ].filter(Boolean) as string[],
      tone: 'warning' as const,
    };
  }

  return {
    title: 'Nenhum lançamento vinculado',
    subtitle: 'Use Buscar para localizar um lançamento existente ou trate a exceção.',
    meta: [],
    tone: 'empty' as const,
  };
};

const renderSkeletonRows = () =>
  Array.from({ length: 6 }).map((_, index) => (
    <div
      key={`workspace-skeleton-${index}`}
      className="grid animate-pulse gap-3 border-b border-border/60 px-4 py-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px_230px]"
    >
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-muted" />
        <div className="h-4 w-4/5 rounded bg-muted" />
        <div className="h-3 w-32 rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-40 rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-6 w-20 rounded-full bg-muted" />
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="h-8 w-20 rounded bg-muted" />
        <div className="h-8 w-20 rounded bg-muted" />
        <div className="h-8 w-20 rounded bg-muted" />
      </div>
    </div>
  ));

const StateSurface = ({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) => (
  <div className="flex h-full min-h-[360px] items-center justify-center px-6 py-12">
    <div className="max-w-md space-y-3 text-center">
      <p className="text-base font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
      {actionLabel && onAction ? (
        <Button type="button" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  </div>
);

export function ConciliationWorkspaceBoard({
  workspace,
  viewState,
  activeRowId = null,
  emptyTitle = 'Nenhuma linha disponível',
  emptyDescription = 'O import selecionado não gerou linhas elegíveis para conciliação.',
  errorMessage,
  actionPending = false,
  onRetry,
  onSelectRow,
  onOpenSearch,
  onOpenAdd,
  onOpenEdit,
  onIgnore,
  onUndo,
  onQuickConciliate,
}: ConciliationWorkspaceBoardProps) {
  const rows = [...(workspace?.rows || [])].sort((a, b) => {
    const priorityDiff = statusPriority[a.state] - statusPriority[b.state];
    if (priorityDiff !== 0) return priorityDiff;
    const dateDiff = String(a.data_movimento || '').localeCompare(String(b.data_movimento || ''));
    if (dateDiff !== 0) return dateDiff;
    return a.line_number - b.line_number;
  });

  if (viewState === 'no_context') {
    return <StateSurface title={emptyTitle} description={emptyDescription} />;
  }

  if (viewState === 'error') {
    return (
      <StateSurface
        title="Não foi possível carregar a conciliação"
        description={errorMessage || 'O workspace não respondeu corretamente para o contexto selecionado.'}
        actionLabel="Tentar novamente"
        onAction={onRetry}
      />
    );
  }

  if (viewState === 'loading') {
    return <div className="min-h-[360px]">{renderSkeletonRows()}</div>;
  }

  if (viewState === 'empty') {
    return <StateSurface title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hidden shrink-0 border-b border-border/70 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px_230px] xl:gap-3">
        <div>Extrato bancário</div>
        <div>{workspace?.summary.presentation_mode === 'pre_conciliation' ? 'Próximo passo' : 'Lançamento no sistema'}</div>
        <div>Status</div>
        <div>Ações</div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((row) => {
          const isPreConciliation = workspace?.summary.presentation_mode === 'pre_conciliation';
          const systemSummary = getSystemSummary(
            row,
            workspace?.summary.presentation_mode || 'pre_conciliation'
          );
          const primaryActionIsSearch = !row.suggested_candidate && row.actions_allowed.includes('buscar');
          const isActive = activeRowId === row.extrato_transacao_id;

          return (
            <div
              key={row.extrato_transacao_id}
              role="button"
              tabIndex={0}
              className={cn(
                'grid gap-3 border-b border-border/60 border-l-4 px-4 py-4 transition-colors hover:bg-muted/20 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_120px_230px]',
                isActive && 'bg-muted/30',
                ROW_ACCENT_CLASS[row.state]
              )}
              onClick={() => onSelectRow?.(row)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectRow?.(row);
                }
              }}
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Linha {row.line_number}</span>
                  <span>{formatDate(row.data_movimento)}</span>
                  <span>{row.group_label}</span>
                </div>
                <p className="truncate text-sm font-medium text-foreground">{row.descricao}</p>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{formatCurrency(row.valor_centavos / 100)}</span>
                  <span>{row.tipo === 'credit' ? 'Entrada' : row.tipo === 'debit' ? 'Saída' : 'Outro'}</span>
                  {row.documento_ref ? <span>Doc. {row.documento_ref}</span> : null}
                </div>
              </div>

              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-medium text-foreground">{systemSummary.title}</p>
                  {row.safe_auto_match ? (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                      Seguro
                    </Badge>
                  ) : null}
                  {row.suggested_candidate?.strict_value_date_direction_match ? (
                    <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">
                      Match estrito
                    </Badge>
                  ) : row.ai_suggestion ? (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                      Revisão IA
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-muted-foreground">{systemSummary.subtitle}</p>
                {systemSummary.meta.length > 0 ? (
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {systemSummary.meta.map((meta) => (
                      <span key={`${row.extrato_transacao_id}-${meta}`} className="rounded-md bg-muted/50 px-2 py-0.5">
                        {meta}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="space-y-2">
                <Badge variant="outline" className={cn('border', STATE_BADGE_CLASS[row.state])}>
                  {STATE_LABELS[row.state]}
                </Badge>
                {!isPreConciliation && row.suggested_candidate ? (
                  <p className="text-[11px] text-muted-foreground">
                    score {Math.round(row.suggested_candidate.score * 100)}%
                  </p>
                ) : !isPreConciliation && row.ai_suggestion?.confidence != null ? (
                  <p className="text-[11px] text-muted-foreground">
                    IA {Math.round(Number(row.ai_suggestion.confidence) * 100)}% · revisão manual
                  </p>
                ) : isPreConciliation ? (
                  <p className="text-[11px] text-muted-foreground">Import pronto para análise</p>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2 xl:justify-start">
                {isPreConciliation ? (
                  <span className="self-center text-[11px] text-muted-foreground">
                    Use o botão Conciliar para gerar vínculos e exceções.
                  </span>
                ) : null}

                {!isPreConciliation && primaryActionIsSearch ? (
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSearch(row);
                    }}
                  >
                    <Search className="h-4 w-4" />
                    Buscar
                  </Button>
                ) : null}

                {!isPreConciliation && row.actions_allowed.includes('conciliar') ? (
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1.5"
                    variant={primaryActionIsSearch ? 'outline' : 'default'}
                    disabled={actionPending || !row.suggested_candidate}
                    onClick={(event) => {
                      event.stopPropagation();
                      onQuickConciliate(row);
                    }}
                  >
                    <Link2 className="h-4 w-4" />
                    Conciliar
                  </Button>
                ) : null}

                {!isPreConciliation && row.actions_allowed.includes('buscar') && !primaryActionIsSearch ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSearch(row);
                    }}
                  >
                    <Search className="h-4 w-4" />
                    Buscar
                  </Button>
                ) : null}

                {!isPreConciliation && row.actions_allowed.includes('ignorar') ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onIgnore(row);
                    }}
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                    Ignorar
                  </Button>
                ) : null}

                {!isPreConciliation && row.actions_allowed.includes('adicionar') ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenAdd(row);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    Adicionar
                  </Button>
                ) : null}

                {!isPreConciliation && row.actions_allowed.includes('editar') ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenEdit(row);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </Button>
                ) : null}

                {!isPreConciliation && row.actions_allowed.includes('desfazer') ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    disabled={actionPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      onUndo(row);
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                    Desfazer
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {workspace && !workspace.summary.manual_creation_allowed ? (
        <div className="shrink-0 border-t border-border/60 px-4 py-3 text-xs text-amber-700">
          Criação manual continua protegida pela política atual do ambiente. Vínculo, busca, divergência e desfazer seguem disponíveis.
        </div>
      ) : null}
    </div>
  );
}
