/**
 * Motor de sugestões contextuais para o chat de conciliação bancária.
 * Gera perguntas sugeridas com base em conta, data, status do import e contagens.
 */

export interface SuggestionContext {
  contaId: string | null;
  contaLabel?: string;
  dataReferencia: string | null;
  importId: string | null;
  parseStatus: string | null;
  statusCounts: { pendente: number; sugerido: number; conciliado: number; divergente: number };
  pendenciasCriticas?: number;
  hasContaAndDate?: boolean;
  canRunImportActions?: boolean;
}

export interface SuggestionItem {
  label: string;
  text: string;
  /** Prioridade para ordenação (maior = mais relevante) */
  priority?: number;
}

const BASE_SUGGESTIONS: SuggestionItem[] = [
  { label: 'Quais lançamentos estão pendentes hoje?', text: 'Quais lançamentos estão pendentes hoje?', priority: 0 },
  { label: 'Quais divergências bloqueiam o fechamento?', text: 'Quais divergências ainda bloqueiam o fechamento?', priority: 0 },
  { label: 'Resuma o dia da conta selecionada', text: 'Resuma o dia da conta selecionada.', priority: 0 },
];

/**
 * Gera sugestões de pergunta conforme o contexto atual (conta, data, status, contagens).
 * Inclui sempre algumas sugestões base e adiciona/prioriza conforme contexto.
 */
export function generateContextualSuggestions(ctx: SuggestionContext): SuggestionItem[] {
  const list: SuggestionItem[] = [];
  const { statusCounts, pendenciasCriticas = 0, hasContaAndDate, dataReferencia, contaLabel } = ctx;

  if (!hasContaAndDate) {
    list.push({
      label: 'Selecione uma conta e data para ver sugestões',
      text: 'Quando eu selecionar conta e data, quais perguntas posso fazer?',
      priority: 10,
    });
    return list;
  }

  // Sugestões contextuais por estado
  if (statusCounts.divergente > 0 || pendenciasCriticas > 0) {
    list.push({
      label: 'Quais divergências bloqueiam o fechamento?',
      text: 'Quais divergências ainda bloqueiam o fechamento?',
      priority: 50,
    });
  }
  if (statusCounts.pendente > 0) {
    list.push({
      label: 'Quais lançamentos estão pendentes hoje?',
      text: 'Quais lançamentos estão pendentes hoje?',
      priority: 40,
    });
  }
  if (statusCounts.sugerido > 0) {
    list.push({
      label: 'Mostre as sugestões da IA para conciliar',
      text: 'Mostre as sugestões da IA para conciliar.',
      priority: 45,
    });
  }

  const dataLabel = dataReferencia
    ? dataReferencia.slice(0, 10).replace(/(\d{4})-(\d{2})-(\d{2})/, '$3/$2/$1')
    : 'esta data';
  const contaDesc = contaLabel || 'esta conta';
  list.push({
    label: `Resuma o dia (${contaDesc} - ${dataLabel})`,
    text: `Resuma o dia da conta selecionada para ${dataLabel}.`,
    priority: 30,
  });

  // Incluir base que ainda não foram adicionadas (por texto)
  const addedTexts = new Set(list.map((s) => s.text));
  for (const s of BASE_SUGGESTIONS) {
    if (!addedTexts.has(s.text)) {
      list.push({ ...s, priority: s.priority ?? 5 });
      addedTexts.add(s.text);
    }
  }

  list.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  return list.slice(0, 6);
}
