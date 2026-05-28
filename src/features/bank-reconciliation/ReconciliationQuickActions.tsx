'use client';

import { RefreshCcw, Sparkles, Wand2 } from 'lucide-react';
import { PromptSuggestion } from '@/components/ui/prompt-suggestion';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface ReconciliationQuickActionsProps {
  /** Executar Matching no import selecionado */
  onRunMatching: () => void;
  /** Disparar fluxo de IA no import selecionado */
  onTriggerAi: () => void;
  /** Atualizar resumo do dia (conta + data referência) */
  onRefreshDailySummary: () => void;
  /** Preencher o campo de mensagem do composer (sugestões de pergunta) */
  onFillMessage: (text: string) => void;
  /** Import está parsed → habilitar Matching e IA */
  canRunImportActions: boolean;
  /** Mensagem de bloqueio quando import não está parsed (ex: status atual) */
  importBlockMessage?: string;
  matchPending?: boolean;
  triggerPending?: boolean;
  refreshSummaryPending?: boolean;
  /** Conta e data selecionadas (para desabilitar "Atualizar Resumo" se faltar) */
  hasContaAndDate?: boolean;
  className?: string;
}

const SUGGESTIONS_FILL: { label: string; text: string }[] = [
  { label: 'Quais lançamentos estão pendentes hoje?', text: 'Quais lançamentos estão pendentes hoje?' },
  { label: 'Quais divergências bloqueiam o fechamento?', text: 'Quais divergências ainda bloqueiam o fechamento?' },
  { label: 'Resuma o dia da conta selecionada', text: 'Resuma o dia da conta selecionada.' },
];

export function ReconciliationQuickActions({
  onRunMatching,
  onTriggerAi,
  onRefreshDailySummary,
  onFillMessage,
  canRunImportActions,
  importBlockMessage = 'Importação precisa estar processada (parsed).',
  matchPending = false,
  triggerPending = false,
  refreshSummaryPending = false,
  hasContaAndDate = true,
  className,
}: ReconciliationQuickActionsProps) {
  const matchingDisabled = !canRunImportActions || matchPending;
  const triggerDisabled = !canRunImportActions || triggerPending;
  const refreshDisabled = !hasContaAndDate || refreshSummaryPending;

  return (
    <div className={className}>
      <p className="mb-2 text-sm font-medium text-muted-foreground">
        Ações rápidas
      </p>
      <div className="flex flex-wrap gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <PromptSuggestion
                variant="outline"
                size="sm"
                onClick={onRunMatching}
                disabled={matchingDisabled}
              >
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                Conciliar (alias legado)
              </PromptSuggestion>
            </span>
          </TooltipTrigger>
          {!canRunImportActions ? (
            <TooltipContent>{importBlockMessage}</TooltipContent>
          ) : null}
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <PromptSuggestion
                variant="outline"
                size="sm"
                onClick={onTriggerAi}
                disabled={triggerDisabled}
              >
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Conciliar (alias legado)
              </PromptSuggestion>
            </span>
          </TooltipTrigger>
          {!canRunImportActions ? (
            <TooltipContent>{importBlockMessage}</TooltipContent>
          ) : null}
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <PromptSuggestion
                variant="outline"
                size="sm"
                onClick={onRefreshDailySummary}
                disabled={refreshDisabled}
              >
                <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
                Atualizar Resumo do Dia
              </PromptSuggestion>
            </span>
          </TooltipTrigger>
          {!hasContaAndDate ? (
            <TooltipContent>Selecione conta e data de referência.</TooltipContent>
          ) : null}
        </Tooltip>
      </div>

      <p className="mt-3 mb-2 text-sm font-medium text-muted-foreground">
        Sugestões de pergunta
      </p>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS_FILL.map(({ label, text }) => (
          <PromptSuggestion
            key={text}
            variant="ghost"
            size="sm"
            onClick={() => onFillMessage(text)}
          >
            {label}
          </PromptSuggestion>
        ))}
      </div>
    </div>
  );
}
