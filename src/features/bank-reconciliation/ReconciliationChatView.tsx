'use client';

import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  History,
  Loader2,
  Paperclip,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAnimatedText } from '@/components/ui/animated-text';
import { Tiles } from '@/components/ui/tiles';
import { PromptInput } from '@/components/ui/prompt-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  ChatAiProcessingStatus,
  ChatLastExecutionSummary,
  ChatMessage,
  ChatHistoryGroup,
  ChatMessageInteraction,
  ChatReviewDecision,
  ChatReviewGuidance,
  ChatReconciliationPlan,
  ChatSessionListItem,
  ChatSuggestedNextAction,
} from '@/types/bank-reconciliation';
import { ActionPreview, type ActionPreviewKind } from '@/features/bank-reconciliation/ActionPreview';
import { ChatMessageRich } from '@/features/bank-reconciliation/chat/ChatMessageRich';

export type { ChatMessage };

interface ContaOption {
  id: string;
  descricao: string;
}

export interface ReconciliationChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (text: string, options?: { files?: File[]; interaction?: ChatMessageInteraction | null }) => void;
  onSubmitStub?: (message: string) => void;
  empresaId: string | null;
  contaId: string | null;
  contaLabel?: string;
  contas?: ContaOption[];
  onContaChange?: (contaId: string) => void;
  importId: string | null;
  dataReferencia: string | null;
  onDataReferenciaChange?: (date: string) => void;
  parseStatus: string | null;
  statusCounts: { pendente: number; sugerido: number; conciliado: number; divergente: number };
  pendenciasCriticas?: number;
  onRunMatching?: () => void;
  onTriggerAi?: () => void;
  onRefreshDailySummary?: () => void;
  onConfirmAction?: (
    kind: ActionPreviewKind,
    options?: {
      selection_mode?: 'all' | 'include_only' | 'exclude_some';
      include_suggestion_ids?: string[];
      exclude_suggestion_ids?: string[];
      plan_id?: string | null;
    }
  ) => Promise<void> | void;
  canRunImportActions?: boolean;
  importBlockMessage?: string;
  matchPending?: boolean;
  triggerPending?: boolean;
  refreshSummaryPending?: boolean;
  actionConfirmPending?: boolean;
  sendingMessage?: boolean;
  hasContaAndDate?: boolean;
  frontendBuildId?: string | null;
  serverBuildId?: string | null;
  buildMismatchDetected?: boolean;
  composerValue: string;
  onComposerValueChange: (value: string) => void;
  onClearConversation?: () => void;
  chatSessions?: ChatSessionListItem[];
  onSelectSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  activeRowContext?: {
    descricao: string;
    dataMovimento: string;
    valorCentavos: number;
  } | null;
  mode?: 'default' | 'copilot';
  className?: string;
}

type PlanSelectionState = Record<string, string[]>;

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const dateOnly = String(value).slice(0, 10);
  const [year, month, day] = dateOnly.split('-');
  if (!year || !month || !day) return String(value);
  return `${day}/${month}/${year}`;
};

const formatTime = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatCurrencyCentavos = (value: number | null | undefined): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return (n / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
};

const formatCorrelationId = (value: unknown): string => {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  return raw.length > 20 ? `${raw.slice(0, 20)}…` : raw;
};

const AI_STATUS_LABEL: Record<string, string> = {
  triggered: 'Aguardando IA',
  polling: 'Aguardando IA',
  processing: 'Aguardando IA',
  agent_processing: 'Aguardando IA',
  completed: 'IA concluída',
  no_pending: 'IA concluiu sem sugestões',
  timeout: 'Tempo de espera local expirou',
  failed: 'Falha na IA',
};

const getAiStatusLabel = (status: ChatAiProcessingStatus | null | undefined): string =>
  AI_STATUS_LABEL[String(status?.state || '')] || 'Status indisponível';

const PREVIEW_ACTIONS: ActionPreviewKind[] = [
  'matching',
  'trigger_ai',
  'refresh_summary',
  'run_daily_reconciliation',
  'apply_reconciliation_plan',
  'daily_close',
  'daily_reopen',
];

const isPreviewActionKind = (value: unknown): value is ActionPreviewKind => {
  return typeof value === 'string' && PREVIEW_ACTIONS.includes(value as ActionPreviewKind);
};

const ACTION_LABELS: Record<ActionPreviewKind, string> = {
  matching: 'Conciliar',
  trigger_ai: 'Conciliar',
  refresh_summary: 'Atualizar resumo',
  run_daily_reconciliation: 'Conciliar',
  apply_reconciliation_plan: 'Aplicar plano de conciliação',
  daily_close: 'Fechar dia',
  daily_reopen: 'Reabrir dia',
};

const isPlanAllNeedsReview = (plan: ChatReconciliationPlan | null | undefined): boolean => {
  if (!plan) return false;
  const total = Number(plan.totals?.total || 0);
  const needsReview = Number(plan.totals?.needs_review || 0);
  return total > 0 && total === needsReview;
};

const BALANCE_MUTATION_BLOCKED = !['0', 'false', 'off', 'no'].includes(
  String(import.meta.env.VITE_BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION ?? 'true')
    .trim()
    .toLowerCase()
);

const isCreateNewBlockedForPhase = (action: string): boolean =>
  BALANCE_MUTATION_BLOCKED && action === 'create_new';

const REVIEW_DECISION_LABEL: Record<Exclude<ChatReviewDecision, 'phase2_blocked'>, string> = {
  approve_ignore: 'Marcar divergência',
  approve_match: 'Aprovar vínculo',
  keep_pending: 'Pular por enquanto',
  open_manual_review: 'Enviar para revisão manual',
};

const PLAN_ACTION_LABELS: Record<string, string> = {
  match_existing: 'Vincular lançamento existente',
  create_new: 'Sem vínculo automático',
  ignore: 'Ignorar',
  needs_review: 'Revisão necessária',
};

const getPlanActionLabel = (action: string): string =>
  PLAN_ACTION_LABELS[action] || action;

const getDefaultReviewJustification = (item: ChatReviewGuidance['current_case']): string => {
  if (!item) return '';
  if (item.action === 'create_new') {
    return `Sem vínculo automático confiável para "${item.descricao || item.extrato_transacao_id}" nesta fase.`;
  }
  if (item.action === 'ignore') {
    return `Divergência confirmada para "${item.descricao || item.extrato_transacao_id}" após revisão.`;
  }
  return '';
};

export function ReconciliationChatView({
  messages,
  onSendMessage,
  onSubmitStub,
  empresaId,
  contaId,
  contaLabel,
  contas = [],
  onContaChange,
  importId,
  dataReferencia,
  onDataReferenciaChange,
  parseStatus,
  statusCounts,
  pendenciasCriticas = 0,
  onRunMatching,
  onTriggerAi,
  onRefreshDailySummary,
  onConfirmAction,
  canRunImportActions = false,
  importBlockMessage = 'Importação precisa estar processada.',
  matchPending = false,
  triggerPending = false,
  refreshSummaryPending = false,
  actionConfirmPending = false,
  sendingMessage = false,
  hasContaAndDate = true,
  frontendBuildId = null,
  serverBuildId = null,
  buildMismatchDetected = false,
  composerValue,
  onComposerValueChange,
  onClearConversation,
  chatSessions = [],
  onSelectSession,
  onDeleteSession,
  activeRowContext = null,
  mode = 'default',
  className,
}: ReconciliationChatViewProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [actionPreviewKind, setActionPreviewKind] = useState<ActionPreviewKind | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [activePreviewPlan, setActivePreviewPlan] = useState<ChatReconciliationPlan | null>(null);
  const [planSelections, setPlanSelections] = useState<PlanSelectionState>({});
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [reviewNotesByCase, setReviewNotesByCase] = useState<Record<string, string>>({});
  const [reviewItemFinanceiroByCase, setReviewItemFinanceiroByCase] = useState<Record<string, string>>({});
  const [reviewManualLinkByCase, setReviewManualLinkByCase] = useState<Record<string, boolean>>({});
  const [reviewBatchNotesByMessage, setReviewBatchNotesByMessage] = useState<Record<string, string>>({});
  const lastComposerContextRef = useRef<string>('');

  const actionPreviewContext = {
    contaLabel: contaLabel ?? null,
    dataReferencia,
    importId,
  };

  useEffect(() => {
    const current = `${contaId || 'no-conta'}::${(dataReferencia || '').slice(0, 10)}`;
    const previous = lastComposerContextRef.current;
    if (!previous) {
      lastComposerContextRef.current = current;
      return;
    }
    if (previous === current) return;
    lastComposerContextRef.current = current;
    if (attachedFiles.length > 0) {
      setAttachedFiles([]);
      toast.info('Anexos removidos ao trocar conta/data.');
    }
  }, [contaId, dataReferencia, attachedFiles.length]);

  const getPlanSelection = (plan: ChatReconciliationPlan | null): string[] => {
    if (!plan) return [];
    const key = plan.plan_id;
    const current = planSelections[key];
    const selectableIds = new Set(
      plan.items
        .filter((item) => !isCreateNewBlockedForPhase(item.action) && item.action !== 'needs_review')
        .map((item) => item.suggestion_id || '')
        .filter(Boolean)
    );
    if (current?.length) {
      return current.filter((id) => selectableIds.has(id));
    }
    return plan.items
      .filter((item) => !isCreateNewBlockedForPhase(item.action) && item.action !== 'needs_review')
      .map((item) => item.suggestion_id || '')
      .filter(Boolean);
  };

  const setPlanSelection = (plan: ChatReconciliationPlan, ids: string[]) => {
    const selectableIds = new Set(
      plan.items
        .filter((item) => !isCreateNewBlockedForPhase(item.action) && item.action !== 'needs_review')
        .map((item) => item.suggestion_id || '')
        .filter(Boolean)
    );
    const deduped = Array.from(new Set(ids.filter((id) => Boolean(id) && selectableIds.has(id))));
    setPlanSelections((prev) => ({ ...prev, [plan.plan_id]: deduped }));
  };

  const handleSubmit = () => {
    const trimmed = composerValue.trim();
    const hasAttachments = attachedFiles.length > 0;
    if (!trimmed && !hasAttachments) return;

    const finalMessage = trimmed || 'Anexei um OFX para abrir o contexto do extrato.';
    onComposerValueChange('');
    onSendMessage(finalMessage, hasAttachments ? { files: attachedFiles } : undefined);
    setAttachedFiles([]);
    onSubmitStub?.(finalMessage);
  };

  const handleSuggestionClick = (text: string) => {
    onSendMessage(text);
  };

  const getMessagePlan = (msg: ChatMessage): ChatReconciliationPlan | null => {
    const candidate = msg.metadata?.reconciliation_plan;
    if (!candidate || typeof candidate !== 'object') return null;
    const plan = candidate as ChatReconciliationPlan;
    if (!plan.plan_id || !Array.isArray(plan.items)) return null;
    return plan;
  };

  const getMessageAiStatus = (msg: ChatMessage): ChatAiProcessingStatus | null => {
    const candidate = msg.metadata?.ai_processing_status;
    return candidate && typeof candidate === 'object' ? (candidate as ChatAiProcessingStatus) : null;
  };

  const getMessageLastExecution = (msg: ChatMessage): ChatLastExecutionSummary | null => {
    const candidate = msg.metadata?.last_execution_summary;
    return candidate && typeof candidate === 'object' ? (candidate as ChatLastExecutionSummary) : null;
  };

  const getMessageNextActions = (msg: ChatMessage): ChatSuggestedNextAction[] => {
    const candidate = msg.metadata?.suggested_next_actions;
    return Array.isArray(candidate) ? (candidate as ChatSuggestedNextAction[]) : [];
  };

  const getMessageReviewGuidance = (msg: ChatMessage): ChatReviewGuidance | null => {
    const candidate = msg.metadata?.review_guidance;
    return candidate && typeof candidate === 'object' ? (candidate as ChatReviewGuidance) : null;
  };

  const handleReviewDecision = (
    msg: ChatMessage,
    decision: Exclude<ChatReviewDecision, 'phase2_blocked'>
  ) => {
    const guidance = getMessageReviewGuidance(msg);
    const currentCase = guidance?.current_case;
    if (!guidance || !currentCase) return;

    const caseId = currentCase.case_id;
    const suggestedJustification = getDefaultReviewJustification(currentCase);
    const justification = (reviewNotesByCase[caseId] ?? suggestedJustification).trim();
    const itemFinanceiroId = (reviewItemFinanceiroByCase[caseId] || '').trim();
    const hasSuggestedItem = Boolean(currentCase.suggested_item_financeiro_id);
    const manualLinkEnabled = Boolean(reviewManualLinkByCase[caseId]) || !hasSuggestedItem;

    if (decision === 'approve_ignore' && !justification) {
      toast.error('Informe a justificativa para ignorar este item.');
      return;
    }

    if (decision === 'approve_match' && manualLinkEnabled && !itemFinanceiroId) {
      toast.error('Informe o código do lançamento para aprovar o vínculo.');
      return;
    }

    const actionLabel =
      (guidance.next_actions || []).find((action) => action.decision === decision)?.label ||
      REVIEW_DECISION_LABEL[decision];

    onSendMessage(`Revisão guiada: ${actionLabel}`, {
      interaction: {
        kind: 'review_answer',
        case_id: caseId,
        decision,
        justification: justification || null,
        item_financeiro_id:
          decision === 'approve_match'
            ? (manualLinkEnabled ? itemFinanceiroId || null : null)
            : itemFinanceiroId || null,
      },
    });
  };

  const handleReviewBatchConfirm = (msg: ChatMessage) => {
    const guidance = getMessageReviewGuidance(msg);
    const offer = guidance?.batch_offer;
    if (!guidance || !offer) return;

    const noteFromInput = String(reviewBatchNotesByMessage[msg.id] || '').trim();
    const defaultNote = String(offer.global_justification_suggestion || '').trim();
    const effectiveJustification = noteFromInput || defaultNote || null;

    onSendMessage('Revisão guiada: aplicar decisões rápidas', {
      interaction: {
        kind: 'review_batch_confirm',
        strategy: 'strict_date_value',
        apply_safe_matches: offer.apply_safe_matches !== false,
        apply_auto_divergence: offer.apply_auto_divergence !== false,
        global_justification: effectiveJustification,
      },
    });
  };

  const handleReviewNext = () => {
    onSendMessage('Continuar revisão guiada', {
      interaction: {
        kind: 'review_next',
      },
    });
  };

  const handleReviewUndoLast = () => {
    onSendMessage('Revisão guiada: desfazer última decisão', {
      interaction: {
        kind: 'review_undo_last',
      },
    });
  };

  const commandForSuggestedAction = (action: ChatSuggestedNextAction['action']): string => {
    if (action === 'apply_reconciliation_plan') return 'Aplicar plano de conciliação';
    if (action === 'run_daily_reconciliation') return 'Conciliar';
    if (action === 'trigger_ai') return 'Conciliar';
    if (action === 'refresh_summary') return 'Atualizar resumo do dia';
    if (action === 'resolve_pending_issues') return 'Corrija essas pendências';
    if (action === 'import_ofx') return 'Importar OFX';
    if (action === 'update_plan_status') return 'Atualizar plano';
    return 'Quais pendências críticas?';
  };

  const openActionPreviewForMessage = (msg: ChatMessage, kind: ActionPreviewKind) => {
    setActionPreviewKind(kind);
    if (kind === 'apply_reconciliation_plan') {
      const plan = getMessagePlan(msg);
      setActivePreviewPlan(plan);
      if (plan && !planSelections[plan.plan_id]) {
        setPlanSelection(
          plan,
          plan.items
            .filter((item) => !isCreateNewBlockedForPhase(item.action) && item.action !== 'needs_review')
            .map((item) => item.suggestion_id || '')
            .filter(Boolean)
        );
      }
    } else {
      setActivePreviewPlan(null);
    }
  };

  const handleAttachmentInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const incoming = Array.from(event.target.files || []);
    if (!incoming.length) return;

    setAttachedFiles((prev) => {
      const next = [...prev];
      for (const file of incoming) {
        if (!file.name.toLowerCase().endsWith('.ofx')) {
          toast.error('Nesta etapa, o chat aceita apenas OFX.');
          continue;
        }
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!next.some((it) => `${it.name}:${it.size}:${it.lastModified}` === key)) {
          next.push(file);
        }
      }
      return next.slice(0, 5);
    });

    event.target.value = '';
  };

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleActionConfirm = async () => {
    if (!actionPreviewKind) return;

    let actionOptions:
      | {
        selection_mode?: 'all' | 'include_only' | 'exclude_some';
        include_suggestion_ids?: string[];
        exclude_suggestion_ids?: string[];
        plan_id?: string | null;
      }
      | undefined;

    if (actionPreviewKind === 'apply_reconciliation_plan' && activePreviewPlan) {
      if (isPlanAllNeedsReview(activePreviewPlan)) {
        toast.info('Plano bloqueado: todas as sugestões exigem revisão item a item.');
        return;
      }

      const allIds = activePreviewPlan.items
        .filter((item) => !isCreateNewBlockedForPhase(item.action) && item.action !== 'needs_review')
        .map((item) => item.suggestion_id || '')
        .filter(Boolean);
      const selectedIds = getPlanSelection(activePreviewPlan);

      if (selectedIds.length === 0) {
        return;
      }

      actionOptions = {
        plan_id: activePreviewPlan.plan_id,
        ...(selectedIds.length === allIds.length
          ? { selection_mode: 'all' as const }
          : { selection_mode: 'include_only' as const, include_suggestion_ids: selectedIds }),
      };
    }

    if (onConfirmAction) {
      await onConfirmAction(actionPreviewKind, actionOptions);
      return;
    }

    if (actionPreviewKind === 'matching') {
      onRunMatching?.();
      handleSuggestionClick('Conciliar');
    } else if (actionPreviewKind === 'trigger_ai') {
      onTriggerAi?.();
      handleSuggestionClick('Conciliar');
    } else if (actionPreviewKind === 'refresh_summary') {
      onRefreshDailySummary?.();
      handleSuggestionClick('Atualizar Resumo do Dia');
    }
  };

  const pendingByKind =
    actionConfirmPending
      ? true
      : actionPreviewKind === 'matching'
        ? matchPending
        : actionPreviewKind === 'trigger_ai'
          ? triggerPending
          : actionPreviewKind === 'refresh_summary'
            ? refreshSummaryPending
            : false;

  const lastAssistantMessage = useMemo(() => {
    const assistant = messages.filter((m) => m.role === 'assistant');
    return assistant[assistant.length - 1] ?? null;
  }, [messages]);
  const lastAssistantAiState =
    (lastAssistantMessage ? getMessageLastExecution(lastAssistantMessage)?.ai_processing_status?.state : null) ||
    (lastAssistantMessage ? getMessageAiStatus(lastAssistantMessage)?.state : null);
  const showAwaitingAiBadge =
    matchPending ||
    triggerPending ||
    lastAssistantAiState === 'triggered' ||
    lastAssistantAiState === 'polling' ||
    lastAssistantAiState === 'processing' ||
    lastAssistantAiState === 'agent_processing';
  const animatedAssistantContent = useAnimatedText(lastAssistantMessage?.content ?? '', ' ');

  const historyGroups = useMemo<ChatHistoryGroup[]>(() => {
    const map = new Map<string, ChatSessionListItem[]>();
    const sorted = [...chatSessions].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    for (const item of sorted) {
      const key = (item.dataReferencia || '').slice(0, 10) || 'sem-data';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, items]) => ({ date, items }));
  }, [chatSessions]);

  const canSubmit = Boolean(composerValue.trim() || attachedFiles.length > 0) && !sendingMessage;
  const isCopilot = mode === 'copilot';
  const applyPlanBlockedByNeedsReview =
    actionPreviewKind === 'apply_reconciliation_plan' && isPlanAllNeedsReview(activePreviewPlan);
  const applyPlanConfirmDisabled =
    actionPreviewKind === 'apply_reconciliation_plan' && activePreviewPlan
      ? getPlanSelection(activePreviewPlan).length === 0 || applyPlanBlockedByNeedsReview
      : false;
  const applyPlanHasBlockedCreateNew =
    actionPreviewKind === 'apply_reconciliation_plan' &&
    !!activePreviewPlan &&
    BALANCE_MUTATION_BLOCKED &&
    Number(activePreviewPlan.totals.create_new || 0) > 0;
  const applyPlanHasNeedsReview =
    actionPreviewKind === 'apply_reconciliation_plan' &&
    !!activePreviewPlan &&
    Number(activePreviewPlan.totals.needs_review || 0) > 0;
  const applyPlanWarningNotice = applyPlanBlockedByNeedsReview
    ? 'Aplicação bloqueada: este plano contém apenas itens de revisão necessária. Resolva esses itens antes de aplicar.'
    : applyPlanHasBlockedCreateNew && applyPlanHasNeedsReview
      ? 'Itens sem vínculo automático ficam fora da aplicação em lote, e revisões necessárias são tratadas 1 a 1 no chat.'
      : applyPlanHasBlockedCreateNew
        ? 'Itens sem vínculo automático ficam fora da aplicação em lote. Aqui você aplica apenas vínculo existente e ignorar.'
        : applyPlanHasNeedsReview
          ? 'Itens de revisão necessária são tratados na revisão guiada (1 por vez). Aqui você aplica vínculo existente e ignorar.'
          : null;

  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-background', className)}>
      <div
        className={cn(
          'flex shrink-0 items-center justify-between border-b border-border',
          isCopilot ? 'px-3 py-3' : 'px-4 py-4'
        )}
      >
        <div className="min-w-0">
          <h1 className={cn('text-foreground', isCopilot ? 'text-sm font-semibold' : 'text-2xl font-bold tracking-tight')}>
            {isCopilot ? 'Copiloto' : 'Conciliação Bancária'}
          </h1>
          <p className={cn('text-muted-foreground', isCopilot ? 'mt-0.5 text-[11px]' : 'mt-1 text-xs')}>
            {isCopilot
              ? 'Resumos, dúvidas e exceções.'
              : 'Anexe o OFX do dia, peça a conciliação e confirme apenas as ações que quiser aplicar.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {showAwaitingAiBadge && (
            <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Aguardando IA…
            </span>
          )}
          {onClearConversation && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onClearConversation} className="gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" />
                  Nova conversa
                </Button>
              </TooltipTrigger>
              <TooltipContent>Iniciar uma nova conversa neste contexto</TooltipContent>
            </Tooltip>
          )}
          {onSelectSession && chatSessions.length > 0 && (
            <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  Ver histórico
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 w-[380px] overflow-y-auto p-2">
                <div className="space-y-2">
                  {historyGroups.map((group) => (
                    <div key={group.date} className="space-y-1">
                      <div className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group.date === 'sem-data' ? 'Sem data' : formatDate(group.date)}
                      </div>
                      {group.items.map((session) => {
                        const contaDisplay =
                          session.title ||
                          session.contaLabel ||
                          (session.contaId ? `${session.contaId.slice(0, 8)}…` : 'Conta não identificada');
                        return (
                          <div
                            key={session.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border/60 px-2 py-1.5"
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => {
                                onSelectSession(session.id);
                                setHistoryOpen(false);
                              }}
                            >
                              <div className="truncate text-sm font-medium text-foreground">{contaDisplay}</div>
                              <div className="text-[11px] text-muted-foreground">
                                Atualizada às {formatTime(session.updatedAt)}
                              </div>
                            </button>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  onSelectSession(session.id);
                                  setHistoryOpen(false);
                                }}
                              >
                                Carregar
                              </Button>
                              {onDeleteSession ? (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                  disabled={deletingSessionId === session.id}
                                  onClick={async (event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    if (!window.confirm('Excluir esta sessão do histórico? A auditoria será preservada.')) {
                                      return;
                                    }
                                    try {
                                      setDeletingSessionId(session.id);
                                      await onDeleteSession(session.id);
                                    } finally {
                                      setDeletingSessionId(null);
                                    }
                                  }}
                                >
                                  Excluir
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {isCopilot && activeRowContext ? (
        <div className="shrink-0 border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">Contexto ativo:</span>{' '}
          {activeRowContext.descricao} · {formatDate(activeRowContext.dataMovimento)} ·{' '}
          {formatCurrencyCentavos(activeRowContext.valorCentavos)}
        </div>
      ) : null}

      <div className={cn('relative flex-1 min-h-0 overflow-y-auto', isCopilot ? 'px-3 py-3' : 'px-4')}>
        {!isCopilot ? (
          <Tiles rows={20} cols={8} tileSize="sm" className="hidden opacity-[0.06] sm:block" />
        ) : null}
        <div
          className={cn(
            'relative z-10 flex min-h-full flex-col',
            isCopilot ? 'mx-0 max-w-none' : 'mx-auto max-w-3xl'
          )}
        >
          {!isCopilot ? <div className="flex-1" /> : null}
          <div className={cn('space-y-4', isCopilot ? 'py-1' : 'py-6 pb-12')}>
            {messages.map((msg) => {
              const previewAction = msg.metadata?.action_preview?.action;
              const hasPreviewAction = isPreviewActionKind(previewAction);
              const messagePlan = getMessagePlan(msg);
              const messageAiStatus = getMessageAiStatus(msg);
              const messageLastExecution = getMessageLastExecution(msg);
              const messageNextActions = getMessageNextActions(msg);
              const messageReviewGuidance = getMessageReviewGuidance(msg);
              const uiShowOperationalCards = msg.metadata?.ui_show_operational_cards === true;
              const uiShowGuidedCardOverride = msg.metadata?.ui_show_guided_card;
              const uiShowPlanCardOverride = msg.metadata?.ui_show_plan_card;
              const isRunDailyPreviewMessage =
                msg.metadata?.action_preview?.action === 'run_daily_reconciliation' &&
                msg.metadata?.pending_action_state?.step === 'preview';
              const shouldRenderGuidedReviewCardFallback =
                Boolean(messageReviewGuidance) &&
                !isRunDailyPreviewMessage &&
                (Number(messageReviewGuidance?.queue_total || 0) > 0 ||
                  Boolean(messageReviewGuidance?.current_case) ||
                  Boolean(messageReviewGuidance?.batch_offer) ||
                  messageReviewGuidance?.display_mode === 'guided_completed');
              const shouldRenderGuidedReviewCard =
                typeof uiShowGuidedCardOverride === 'boolean'
                  ? uiShowGuidedCardOverride
                  : shouldRenderGuidedReviewCardFallback;
              const shouldRenderPlanCardFallback = Boolean(messagePlan) && !shouldRenderGuidedReviewCard;
              const shouldRenderPlanCard =
                typeof uiShowPlanCardOverride === 'boolean'
                  ? uiShowPlanCardOverride
                  : shouldRenderPlanCardFallback;
              const effectiveAiStatus = messageLastExecution?.ai_processing_status || messageAiStatus;
              const effectiveCorrelationId =
                effectiveAiStatus?.correlation_id || messageLastExecution?.correlation_id || '';

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div className="space-y-2">
                    <ChatMessageRich
                      message={msg}
                      displayContent={lastAssistantMessage?.id === msg.id ? animatedAssistantContent : undefined}
                    />
                    {msg.role === 'assistant' && hasPreviewAction ? (
                      <div className="px-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => openActionPreviewForMessage(msg, previewAction)}
                          disabled={actionConfirmPending}
                        >
                          {ACTION_LABELS[previewAction]}
                        </Button>
                      </div>
                    ) : null}
                    {msg.role === 'assistant' && (
                      shouldRenderGuidedReviewCard ||
                      shouldRenderPlanCard ||
                      (uiShowOperationalCards &&
                        (Boolean(effectiveAiStatus) || Boolean(messageLastExecution) || messageNextActions.length > 0))
                    ) ? (
                      <div className="space-y-2 px-1">
                        {uiShowOperationalCards && effectiveAiStatus ? (
                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <p className="text-sm font-medium">Status atual da IA</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {getAiStatusLabel(effectiveAiStatus)}
                              {effectiveAiStatus.message ? ` · ${effectiveAiStatus.message}` : ''}
                            </p>
                            {effectiveAiStatus.message ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                Próximo passo: {messageNextActions.length > 0 ? 'use uma ação sugerida abaixo.' : 'continue a conversa pelo chat.'}
                              </p>
                            ) : null}
                            {messageNextActions.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {messageNextActions.slice(0, 4).map((nextAction, idx) => (
                                  <Button
                                    key={`${nextAction.action}-${idx}`}
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    onClick={() => handleSuggestionClick(commandForSuggestedAction(nextAction.action))}
                                  >
                                    {nextAction.label}
                                  </Button>
                                ))}
                              </div>
                            ) : null}
                            <details className="mt-2 rounded-md border border-border/60 bg-background/60 p-2">
                              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                                Ver detalhes técnicos
                              </summary>
                              <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                                <div>Estado bruto: {effectiveAiStatus.state || '—'}</div>
                                <div>
                                  Correlação:{' '}
                                  <span title={String(effectiveCorrelationId || '')}>
                                    {formatCorrelationId(effectiveCorrelationId)}
                                  </span>
                                </div>
                                <div>
                                  Atualizado em:{' '}
                                  {effectiveAiStatus.last_updated_at ? formatDate(effectiveAiStatus.last_updated_at) : '—'}
                                </div>
                                <div>
                                  Sugestões: {effectiveAiStatus.counts?.sugestoes_total ?? '—'}
                                </div>
                              </div>
                            </details>
                          </div>
                        ) : null}

                        {uiShowOperationalCards && messageLastExecution?.action ? (
                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <p className="text-sm font-medium">Última execução</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {ACTION_LABELS[messageLastExecution.action] || messageLastExecution.action} ·{' '}
                              {messageLastExecution.status === 'processing'
                                ? 'Em andamento'
                                : messageLastExecution.status === 'ok'
                                  ? 'Concluída'
                                  : messageLastExecution.status === 'warning'
                                    ? 'Concluída com atenção'
                                    : 'Falhou'}
                            </p>
                            {messageLastExecution.summary ? (
                              <p className="mt-2 text-xs text-muted-foreground">{messageLastExecution.summary}</p>
                            ) : null}
                            {messageLastExecution.stale_reason ? (
                              <p className="mt-1 text-xs text-amber-700">
                                {messageLastExecution.stale_reason}
                              </p>
                            ) : null}
                            <details className="mt-2 rounded-md border border-border/60 bg-background/60 p-2">
                              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                                Ver detalhes técnicos
                              </summary>
                              <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                                <div>Ação: {messageLastExecution.action}</div>
                                <div>Status da execução: {messageLastExecution.status || '—'}</div>
                                <div>Estado IA (consolidado): {messageLastExecution.ai_processing_status?.state || '—'}</div>
                                <div>
                                  Executado em:{' '}
                                  {messageLastExecution.executed_at ? formatDate(messageLastExecution.executed_at) : '—'}
                                </div>
                                <div>
                                  Correlação:{' '}
                                  <span title={String(messageLastExecution.correlation_id || '')}>
                                    {formatCorrelationId(messageLastExecution.correlation_id)}
                                  </span>
                                </div>
                              </div>
                            </details>
                          </div>
                        ) : null}

                        {shouldRenderGuidedReviewCard && messageReviewGuidance ? (
                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <p className="text-sm font-medium">Revisão guiada</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {messageReviewGuidance.display_mode === 'guided_completed'
                                ? 'Revisão concluída'
                                : messageReviewGuidance.queue_phase === 'pre_batch'
                                  ? 'Decisões rápidas disponíveis'
                                  : messageReviewGuidance.current_position &&
                                    Number(messageReviewGuidance.queue_total_active || messageReviewGuidance.queue_total || 0) > 0
                                    ? `Item ${messageReviewGuidance.current_position} de ${messageReviewGuidance.queue_total_active || messageReviewGuidance.queue_total
                                    }`
                                    : `Fila ativa: ${messageReviewGuidance.queue_remaining}/${messageReviewGuidance.queue_total_active || messageReviewGuidance.queue_total
                                    }`}
                            </p>

                            {messageReviewGuidance.queue_phase === 'pre_batch' && messageReviewGuidance.batch_offer ? (
                              <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-xs">
                                <p className="font-medium text-foreground">
                                  {messageReviewGuidance.batch_offer.summary || 'Aplicar decisões rápidas em lote'}
                                </p>
                                <div className="mt-1 grid grid-cols-1 gap-1 text-muted-foreground sm:grid-cols-3">
                                  <div>Vínculos seguros: {messageReviewGuidance.batch_offer.safe_match_count}</div>
                                  <div>Divergências: {messageReviewGuidance.batch_offer.auto_divergence_count}</div>
                                  <div>Exceções 1x1: {messageReviewGuidance.batch_offer.exceptions_count}</div>
                                </div>
                                <Input
                                  value={
                                    reviewBatchNotesByMessage[msg.id] ??
                                    String(messageReviewGuidance.batch_offer.global_justification_suggestion || '')
                                  }
                                  onChange={(event) =>
                                    setReviewBatchNotesByMessage((prev) => ({
                                      ...prev,
                                      [msg.id]: event.target.value,
                                    }))
                                  }
                                  placeholder="Justificativa global da divergência (editável)"
                                  className="mt-2 h-8 text-xs"
                                />
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-7 text-xs"
                                    disabled={sendingMessage || actionConfirmPending}
                                    onClick={() => handleReviewBatchConfirm(msg)}
                                  >
                                    {messageReviewGuidance.batch_offer.cta_label || 'Aplicar decisões rápidas'}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-7 text-xs"
                                    disabled={sendingMessage || actionConfirmPending}
                                    onClick={handleReviewNext}
                                  >
                                    Ir para revisão 1x1
                                  </Button>
                                </div>
                              </div>
                            ) : null}

                            {messageReviewGuidance.display_mode === 'guided_completed' ? (
                              <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-xs">
                                <p className="font-medium text-foreground">Resumo final</p>
                                <div className="mt-1 grid grid-cols-1 gap-1 text-muted-foreground sm:grid-cols-4">
                                  <div>Total: {Number(messageReviewGuidance.final_summary?.total || 0)}</div>
                                  <div>Resolvidos: {Number(messageReviewGuidance.final_summary?.resolved || 0)}</div>
                                  <div>Pendentes: {Number(messageReviewGuidance.final_summary?.unresolved || 0)}</div>
                                  <div>
                                    Revisão manual:{' '}
                                    {Number(messageReviewGuidance.final_summary?.manual_review_count || 0)}
                                  </div>
                                </div>
                              </div>
                            ) : messageReviewGuidance.current_case ? (
                              <>
                                <p className="mt-2 text-sm font-medium">
                                  {messageReviewGuidance.current_case.question}
                                </p>
                                {messageReviewGuidance.current_case.rationale ? (
                                  <p className="mt-1 text-xs text-muted-foreground">
                                    {messageReviewGuidance.current_case.rationale}
                                  </p>
                                ) : null}
                                <div className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                                  <div>
                                    Valor:{' '}
                                    {formatCurrencyCentavos(messageReviewGuidance.current_case.valor_centavos ?? null)}
                                  </div>
                                  <div>
                                    Data: {formatDate(messageReviewGuidance.current_case.data_movimento)}
                                  </div>
                                  <div>
                                    Confiança:{' '}
                                    {typeof messageReviewGuidance.current_case.confidence === 'number'
                                      ? `${Math.round(messageReviewGuidance.current_case.confidence * 100)}%`
                                      : '—'}
                                  </div>
                                </div>

                                {messageReviewGuidance.current_case.suggested_item_financeiro_id ? (
                                  <div className="mt-2 rounded-md border border-border/60 bg-background/60 p-2 text-xs">
                                    <p className="text-muted-foreground">
                                      Vínculo sugerido pela IA:{' '}
                                      <span className="font-medium text-foreground">
                                        {messageReviewGuidance.current_case.suggested_item_financeiro_id}
                                      </span>
                                    </p>
                                    {!reviewManualLinkByCase[messageReviewGuidance.current_case.case_id] ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="ghost"
                                        className="mt-1 h-7 px-2 text-xs"
                                        onClick={() =>
                                          setReviewManualLinkByCase((prev) => ({
                                            ...prev,
                                            [messageReviewGuidance.current_case.case_id]: true,
                                          }))
                                        }
                                      >
                                        Trocar vínculo
                                      </Button>
                                    ) : null}
                                  </div>
                                ) : null}

                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                  <Input
                                    value={
                                      reviewNotesByCase[messageReviewGuidance.current_case.case_id] ??
                                      getDefaultReviewJustification(messageReviewGuidance.current_case)
                                    }
                                    onChange={(event) =>
                                      setReviewNotesByCase((prev) => ({
                                        ...prev,
                                        [messageReviewGuidance.current_case?.case_id || '']: event.target.value,
                                      }))
                                    }
                                    placeholder="Justificativa (sugerida, editável)"
                                    className="h-8 text-xs"
                                  />
                                  {(!messageReviewGuidance.current_case.suggested_item_financeiro_id ||
                                    reviewManualLinkByCase[messageReviewGuidance.current_case.case_id]) ? (
                                    <Input
                                      value={reviewItemFinanceiroByCase[messageReviewGuidance.current_case.case_id] || ''}
                                      onChange={(event) =>
                                        setReviewItemFinanceiroByCase((prev) => ({
                                          ...prev,
                                          [messageReviewGuidance.current_case?.case_id || '']: event.target.value,
                                        }))
                                      }
                                      placeholder="Código do lançamento (quando necessário)"
                                      className="h-8 text-xs"
                                    />
                                  ) : null}
                                </div>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  {(messageReviewGuidance.next_actions || [])
                                    .filter((action) => action.decision !== 'phase2_blocked')
                                    .map((action) => (
                                      <Button
                                        key={`${messageReviewGuidance.current_case?.case_id}-${action.decision}`}
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 text-xs"
                                        disabled={sendingMessage || actionConfirmPending}
                                        onClick={() =>
                                          handleReviewDecision(
                                            msg,
                                            action.decision as Exclude<ChatReviewDecision, 'phase2_blocked'>
                                          )
                                        }
                                      >
                                        {action.label || REVIEW_DECISION_LABEL[action.decision as Exclude<ChatReviewDecision, 'phase2_blocked'>]}
                                      </Button>
                                    ))}
                                  {messageReviewGuidance.can_undo_last ? (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 text-xs"
                                      disabled={sendingMessage || actionConfirmPending}
                                      onClick={handleReviewUndoLast}
                                    >
                                      Desfazer última decisão
                                    </Button>
                                  ) : null}
                                </div>
                              </>
                            ) : messageReviewGuidance.queue_phase !== 'pre_batch' ? (
                              <p className="mt-2 text-xs text-muted-foreground">
                                Não há mais perguntas pendentes na fila guiada para este contexto.
                              </p>
                            ) : null}

                            {messageReviewGuidance.create_new_summary &&
                              messageReviewGuidance.create_new_summary.total > 0 ? (
                              <details className="mt-2 rounded-md border border-border/60 bg-background/60 p-2">
                                <summary className="cursor-pointer text-xs font-medium text-amber-700">
                                  Sem vínculo automático nesta fase ({messageReviewGuidance.create_new_summary.total})
                                </summary>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  Valor total potencial:{' '}
                                  {formatCurrencyCentavos(messageReviewGuidance.create_new_summary.valor_total_centavos)}
                                </p>
                                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                                  {messageReviewGuidance.create_new_summary.top_items.map((item, idx) => (
                                    <li key={`${item.suggestion_id || idx}`} className="rounded border border-border/50 px-2 py-1">
                                      <p className="font-medium text-foreground">{item.descricao}</p>
                                      <p>{formatCurrencyCentavos(item.valor_centavos)}</p>
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            ) : null}
                          </div>
                        ) : null}

                        {shouldRenderPlanCard && messagePlan ? (
                          <div className="rounded-lg border border-border bg-muted/20 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">Plano de conciliação</p>
                                <p className="text-xs text-muted-foreground">
                                  {messagePlan.totals.total} sugestão(ões) · {messagePlan.totals.needs_review} em revisão necessária
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={actionConfirmPending || isPlanAllNeedsReview(messagePlan)}
                                onClick={() => openActionPreviewForMessage(msg, 'apply_reconciliation_plan')}
                              >
                                Revisar e aplicar
                              </Button>
                            </div>
                            {isPlanAllNeedsReview(messagePlan) ? (
                              <p className="mb-2 text-xs text-amber-700">
                                Plano bloqueado para aplicação automática: somente itens de revisão necessária.
                              </p>
                            ) : null}
                            {BALANCE_MUTATION_BLOCKED && Number(messagePlan.totals.create_new || 0) > 0 ? (
                              <p className="mb-2 text-xs text-amber-700">
                                Itens sem vínculo automático ficam fora da aplicação em lote nesta fase.
                              </p>
                            ) : null}
                            <details className="rounded-md border border-border/60 bg-background/60 p-2">
                              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                                Ver itens do plano
                              </summary>
                              <div className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1">
                                {messagePlan.items
                                  .filter((item) => item.action !== 'create_new')
                                  .slice(0, 8)
                                  .map((item) => (
                                    <div
                                      key={item.id}
                                      className="flex items-start gap-2 rounded-md border border-border/60 bg-background/70 px-2 py-1.5 text-xs"
                                    >
                                      <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-1">
                                          <span className="font-medium">{getPlanActionLabel(item.action)}</span>
                                          {item.action === 'needs_review' ? (
                                            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                                              tratado na revisão guiada
                                            </span>
                                          ) : null}
                                          {typeof item.confidence === 'number' ? (
                                            <span className="text-muted-foreground">
                                              {Math.round(item.confidence * 100)}%
                                            </span>
                                          ) : null}
                                        </div>
                                        <p className="truncate text-muted-foreground">
                                          {item.extrato_descricao_raw || item.extrato_transacao_id}
                                        </p>
                                      </div>
                                    </div>
                                  ))}
                                {messagePlan.items.length > 8 ? (
                                  <p className="text-xs text-muted-foreground">
                                    Mostrando 8 de {messagePlan.items.length} itens. Use “Revisar e aplicar” para ver o plano completo.
                                  </p>
                                ) : null}
                              </div>
                            </details>
                          </div>
                        ) : null}

                      </div>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>

      <div
        className={cn(
          'shrink-0 border-t border-border bg-background',
          isCopilot ? 'px-3 py-3' : 'px-4 pt-8 pb-8 sm:pt-10 sm:pb-10'
        )}
      >
        <div className={cn(isCopilot ? 'space-y-2' : 'mx-auto max-w-3xl')}>
          <ActionPreview
            open={actionPreviewKind !== null}
            onOpenChange={(open) => !open && setActionPreviewKind(null)}
            kind={actionPreviewKind ?? 'matching'}
            context={actionPreviewContext}
            onConfirm={() => {
              void handleActionConfirm();
            }}
            pending={pendingByKind}
            confirmDisabled={applyPlanConfirmDisabled}
            warningNotice={applyPlanWarningNotice}
          >
            {actionPreviewKind === 'apply_reconciliation_plan' && activePreviewPlan ? (
              <div className="max-h-60 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Escolha o que aplicar agora</p>
                    <p className="text-xs text-muted-foreground">
                      Selecione apenas os itens que deseja aplicar nesta etapa.
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() =>
                        setPlanSelection(
                          activePreviewPlan,
                          activePreviewPlan.items
                            .filter((item) => !isCreateNewBlockedForPhase(item.action) && item.action !== 'needs_review')
                            .map((item) => item.suggestion_id || '')
                            .filter(Boolean)
                        )
                      }
                    >
                      Todos
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setPlanSelection(activePreviewPlan, [])}
                    >
                      Nenhum
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  {activePreviewPlan.items.map((item) => {
                    const suggestionId = item.suggestion_id || '';
                    const selected = suggestionId ? getPlanSelection(activePreviewPlan).includes(suggestionId) : false;
                    const createNewBlocked = isCreateNewBlockedForPhase(item.action);
                    const managedByGuidedReview = item.action === 'needs_review';
                    return (
                      <label
                        key={item.id}
                        className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 bg-background px-2 py-1.5 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!suggestionId || pendingByKind || createNewBlocked || managedByGuidedReview}
                          onChange={(event) => {
                            if (!suggestionId) return;
                            const current = getPlanSelection(activePreviewPlan);
                            const next = event.target.checked
                              ? [...current, suggestionId]
                              : current.filter((id) => id !== suggestionId);
                            setPlanSelection(activePreviewPlan, next);
                          }}
                        />
                        <div className="min-w-0">
                          <p className="font-medium">
                            {getPlanActionLabel(item.action)}
                            {createNewBlocked ? ' · fora desta etapa' : ''}
                            {managedByGuidedReview ? ' · revisão guiada' : ''}
                            {typeof item.confidence === 'number' ? ` · ${Math.round(item.confidence * 100)}%` : ''}
                          </p>
                          <p className="truncate text-muted-foreground">
                            {item.extrato_descricao_raw || item.extrato_transacao_id}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Selecionados: {getPlanSelection(activePreviewPlan).length} / {activePreviewPlan.items.length}
                </p>
              </div>
            ) : null}
          </ActionPreview>

          {!isCopilot ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <div className="mr-2 flex flex-wrap items-center gap-2">
                <select
                  value={contaId || ''}
                  onChange={(event) => onContaChange?.(event.target.value)}
                  className="h-8 min-w-[180px] rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  aria-label="Conta bancária do chat"
                >
                  <option value="">Selecione a conta</option>
                  {contas.map((conta) => (
                    <option key={conta.id} value={conta.id}>
                      {conta.descricao}
                    </option>
                  ))}
                </select>

                <Input
                  type="date"
                  value={dataReferencia ? dataReferencia.slice(0, 10) : ''}
                  onChange={(event) => onDataReferenciaChange?.(event.target.value)}
                  className="h-8 w-[150px] text-xs"
                />
              </div>

              <span className="rounded-md border bg-muted/40 px-2 py-0.5">
                Data {formatDate(dataReferencia)}
              </span>
              <span className="rounded-md border bg-muted/40 px-2 py-0.5">
                Conta {contaId ? (contaLabel || contaId) : '—'}
              </span>
              <span className="rounded-md border bg-muted/40 px-2 py-0.5">
                Pendências {pendenciasCriticas}
              </span>
              <details className="rounded-md border bg-muted/40 px-2 py-0.5">
                <summary className="cursor-pointer select-none">Ver contexto técnico</summary>
                <div className="mt-2 grid grid-cols-1 gap-1 pb-1 sm:grid-cols-2">
                  <span>Importação: {importId ? `${importId.slice(0, 8)}…` : '—'}</span>
                  <span>Status do processamento: {parseStatus || '—'}</span>
                  <span>
                    Situação: P:{statusCounts.pendente} S:{statusCounts.sugerido} C:{statusCounts.conciliado} D:
                    {statusCounts.divergente}
                  </span>
                  {empresaId ? <span>Empresa: {empresaId.slice(0, 8)}…</span> : null}
                  <span>
                    Build UI:{' '}
                    {frontendBuildId
                      ? (() => {
                        const build = String(frontendBuildId);
                        return build.length > 12 ? `${build.slice(0, 12)}…` : build;
                      })()
                      : '—'}
                  </span>
                  <span>
                    Build API:{' '}
                    {serverBuildId
                      ? (() => {
                        const build = String(serverBuildId);
                        return build.length > 12 ? `${build.slice(0, 12)}…` : build;
                      })()
                      : '—'}
                  </span>
                  {buildMismatchDetected ? (
                    <span className="text-amber-700">
                      Versão desatualizada detectada. Faça hard refresh (Ctrl+Shift+R).
                    </span>
                  ) : null}
                </div>
              </details>
            </div>
          ) : null}

          <PromptInput
            value={composerValue}
            onValueChange={onComposerValueChange}
            onSubmit={handleSubmit}
            disabled={sendingMessage}
            className="rounded-lg border bg-background"
          >
            <PromptInput.Textarea
              placeholder={
                isCopilot
                  ? 'Peça um resumo ou explique uma exceção...'
                  : 'Anexe o OFX e peça para conciliar o dia...'
              }
            />

            {attachedFiles.length > 0 ? (
              <div className="flex flex-wrap gap-2 px-2 pb-1">
                {attachedFiles.map((file, index) => (
                  <div
                    key={`${file.name}-${file.size}-${file.lastModified}`}
                    className="flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs"
                  >
                    <span className="max-w-[220px] truncate">{file.name}</span>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remover anexo ${file.name}`}
                      onClick={() => removeAttachedFile(index)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <PromptInput.Actions>
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                accept=".ofx,application/ofx,application/x-ofx,text/plain"
                className="hidden"
                onChange={handleAttachmentInputChange}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={sendingMessage}
                className="gap-1.5"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Anexar OFX
              </Button>

              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="gap-1.5"
              >
                {sendingMessage ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {sendingMessage ? 'Enviando…' : 'Enviar'}
              </Button>
            </PromptInput.Actions>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
