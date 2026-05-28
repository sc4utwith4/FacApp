'use client';

import { useMemo } from 'react';
import { PromptSuggestion } from '@/components/ui/prompt-suggestion';
import { generateContextualSuggestions, type SuggestionContext } from '@/lib/bank-reconciliation/suggestionEngine';

export interface ReconciliationContextualSuggestionsProps extends SuggestionContext {
  onSelect: (text: string) => void;
}

export function ReconciliationContextualSuggestions({
  onSelect,
  ...context
}: ReconciliationContextualSuggestionsProps) {
  const suggestions = useMemo(
    () => generateContextualSuggestions(context),
    [
      context.contaId,
      context.contaLabel,
      context.dataReferencia,
      context.importId,
      context.parseStatus,
      context.statusCounts?.pendente,
      context.statusCounts?.sugerido,
      context.statusCounts?.conciliado,
      context.statusCounts?.divergente,
      context.pendenciasCriticas,
      context.hasContaAndDate,
      context.canRunImportActions,
    ]
  );

  return (
    <div className="flex flex-wrap gap-2">
      {suggestions.map(({ label, text }) => (
        <PromptSuggestion
          key={text}
          variant="ghost"
          size="sm"
          onClick={() => onSelect(text)}
        >
          {label}
        </PromptSuggestion>
      ))}
    </div>
  );
}
