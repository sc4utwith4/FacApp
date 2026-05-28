import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, History, MessageSquareText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatCurrency } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import {
  useBankReconciliation,
  type BankAiSuggestionWithTransaction,
  type BankTransactionWithConciliation,
} from '@/hooks/useBankReconciliation';
import {
  ReconciliationChatView,
  type ChatMessage,
  type ReconciliationChatViewProps,
} from '@/features/bank-reconciliation/ReconciliationChatView';
import {
  ConciliationWorkspaceBoard,
  type WorkspaceViewState,
} from '@/features/bank-reconciliation/ConciliationWorkspaceBoard';
import { FinanceiroWorkspaceShell } from '@/components/financeiro/FinanceiroWorkspaceShell';
import { ConciliationCandidateSearchDialog } from '@/features/bank-reconciliation/ConciliationCandidateSearchDialog';
import {
  resolveBestImportForDateAccount,
  type ExtratoImportRow,
} from '@/lib/bank-reconciliation/reconciliationHistory';
import {
  buildOfxUploadContentTypeRetrySequence,
  isRetryableStorageUploadStatus,
  parseStorageUploadErrorDetails,
} from '@/lib/bank-reconciliation/ofxMime';
import { loadChatSession, saveChatSession, listChatSessions } from '@/lib/bank-reconciliation/chatStorage';
import { useSearchParams } from 'react-router-dom';
import { isValidUUID } from '@/lib/uuid';
import type {
  BankReconciliationChatActionConfirmRequest,
  BankReconciliationChatActionConfirmResponse,
  ChatAttachmentInput,
  ChatImportResult,
  BankReconciliationChatMessageRequest,
  BankReconciliationChatMessageResponse,
  BankReconciliationChatSessionRow,
  BankReconciliationChatStoredMessage,
  ChatActionKind,
  ChatSession,
  CreateReconciliationRuleRequest,
  DailyReconciliationSummary,
  ReconciliationRuleRow,
  RichMessageContent,
  ChatClarifyingQuestion,
  ChatPendingCase,
  ChatMessageInteraction,
  ChatReconciliationPlan,
  ChatSessionListItem,
  ConciliationCandidateSearchResult,
  ConciliationHistoryResponse,
  ConciliationWorkspaceResponse,
  ConciliationWorkspaceRow,
} from '@/types/bank-reconciliation';

const formatDate = (isoDate: string | null | undefined): string => {
  if (!isoDate) return '-';
  const [y, m, d] = String(isoDate).split('-');
  if (!y || !m || !d) return String(isoDate);
  return `${d}/${m}/${y}`;
};

const buildChatContextKey = (
  empresaId: string | null | undefined,
  contaId: string | null | undefined,
  dataReferencia: string | null | undefined
): string => `${empresaId || 'no-empresa'}::${contaId || 'no-conta'}::${(dataReferencia || '').slice(0, 10)}`;

const parseStatusLabel: Record<string, string> = {
  received: 'Recebido',
  processing: 'Processando',
  parsed: 'Processado',
  duplicate: 'Duplicado',
  failed: 'Falhou',
};

const parseStatusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  received: 'secondary',
  processing: 'outline',
  parsed: 'default',
  duplicate: 'secondary',
  failed: 'destructive',
};

const viewStatusLabel: Record<string, string> = {
  pendente: 'Pendente',
  sugerido: 'Sugerido',
  conciliado: 'Conciliado',
  divergente: 'Divergente',
};

const aiStatusLabel: Record<string, string> = {
  triggered: 'Aguardando IA',
  polling: 'Aguardando IA',
  processing: 'Aguardando IA',
  agent_processing: 'Aguardando IA',
  completed: 'Concluída',
  no_pending: 'Sem sugestões',
  timeout: 'Aguardando atualização',
  failed: 'Falha',
};

const conciliationHistoryStatusLabel: Record<string, string> = {
  suggested: 'Sugerido',
  confirmed: 'Confirmado',
  rejected: 'Divergente',
};

const conciliationHistoryMethodLabel: Record<string, string> = {
  manual: 'Manual',
  deterministic: 'Seguro',
  rule: 'Regra',
  ai: 'IA',
};

const guidedDecisionLabel: Record<string, string> = {
  approve_match: 'Vínculo aprovado',
  approve_ignore: 'Divergência registrada',
  keep_pending: 'Mantido para depois',
  open_manual_review: 'Enviado para revisão manual',
};

interface ContaBancariaOption {
  id: string;
  descricao: string;
}

interface GrupoContaOption {
  id: string;
  nome: string;
  natureza: 'entrada' | 'saida';
}

interface SplitItemForm {
  id: string;
  tipo: 'entrada' | 'saida';
  data: string;
  valor: string;
  historico: string;
  documento: string;
  grupo_contas_id: string;
  observacoes: string;
}

interface CreateDialogTxContext {
  id: string;
  conta_bancaria_id: string;
  data_movimento: string;
  tipo: 'credit' | 'debit' | 'other';
  valor_centavos: number;
  descricao_raw: string;
  documento_ref: string | null;
  line_number: number;
}

interface WorkspaceEditDialogState {
  extrato_transacao_id: string;
  lancamento_caixa_id: string;
  conta_bancaria_id: string;
  item_financeiro_id?: string | null;
}

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

class ChatAttachmentUploadError extends Error {
  readonly fileName: string;
  readonly storageKey: string;
  readonly status: number | null;
  readonly errorCode: string | null;
  readonly contentType: string | null;
  readonly buildId: string;
  readonly operationalMessage: string;
  readonly failureContext: Record<string, unknown> | null;

  constructor(
    message: string,
    args: {
      fileName: string;
      storageKey: string;
      status?: number | null;
      errorCode?: string | null;
      contentType?: string | null;
      buildId: string;
      operationalMessage?: string;
      failureContext?: Record<string, unknown> | null;
    }
  ) {
    super(message);
    this.name = 'ChatAttachmentUploadError';
    this.fileName = args.fileName;
    this.storageKey = args.storageKey;
    this.status = typeof args.status === 'number' ? args.status : null;
    this.errorCode = args.errorCode ?? null;
    this.contentType = args.contentType ?? null;
    this.buildId = args.buildId;
    this.operationalMessage = args.operationalMessage || 'Falha no upload OFX ao storage.';
    this.failureContext = args.failureContext || null;
  }
}

const parseMoneyToCentavos = (value: string): number => {
  const normalized = String(value || '').trim().replace(/\./g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100);
};

const buildSplitItem = (tx: BankTransactionWithConciliation): SplitItemForm => ({
  id: `split-${Date.now()}`,
  tipo: tx.tipo === 'credit' ? 'entrada' : 'saida',
  data: tx.data_movimento,
  valor: (tx.valor_centavos / 100).toFixed(2),
  historico: tx.descricao_raw,
  documento: tx.documento_ref || '',
  grupo_contas_id: '',
  observacoes: `Split conciliacao (linha ${tx.line_number}).`,
});

const sanitizeAttachmentFileName = (fileName: string): string =>
  String(fileName || 'extrato.ofx')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+/, '') || `extrato-${Date.now()}.ofx`;

const inferAttachmentSourceAndFormat = (
  file: File
): { source: 'ofx_generic'; file_format: 'ofx' } => ({
  source: 'ofx_generic',
  file_format: 'ofx',
});

const OFX_ONLY_FRONTEND = !['0', 'false', 'off', 'no'].includes(
  String(import.meta.env.VITE_BANK_RECONCILIATION_IMPORT_OFX_ONLY ?? 'true')
    .trim()
    .toLowerCase()
);

const FRONTEND_BUILD_ID = String(
  (typeof __APP_BUILD_ID__ !== 'undefined' && __APP_BUILD_ID__) ||
  import.meta.env.VITE_APP_BUILD_ID ||
  'frontend-dev'
).trim();

const normalizeBuildId = (value: string | null | undefined): string => {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 12) : '';
};

const toIsoDateOrNull = (value: unknown): string | null => {
  const date = String(value || '').trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date;
};

const isSyntheticDevBuildId = (value: string | null | undefined): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === 'frontend-dev' ||
    normalized === 'runtime-dev' ||
    normalized === 'dev' ||
    normalized.endsWith('-dev') ||
    normalized.startsWith('dev-')
  );
};

const looksLikeRealBuildId = (value: string | null | undefined): boolean => {
  const normalized = String(value || '').trim();
  if (!normalized || isSyntheticDevBuildId(normalized)) return false;
  return normalized.startsWith('dpl_') || /^[a-f0-9]{7,40}$/i.test(normalized);
};

const areBuildIdsEquivalent = (frontendBuildId: string | null | undefined, serverBuildId: string | null | undefined): boolean => {
  if (!looksLikeRealBuildId(frontendBuildId) || !looksLikeRealBuildId(serverBuildId)) {
    return true;
  }
  const front = normalizeBuildId(frontendBuildId);
  const server = normalizeBuildId(serverBuildId);
  if (!front || !server) return true;
  return front === server || front.startsWith(server) || server.startsWith(front);
};

async function callAuthenticatedBankApi<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'DELETE';
    body?: unknown;
  } = {}
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error('Sessao expirada. Faca login novamente.');
  }

  const method = options.method || 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  let body: string | undefined;
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, {
    method,
    headers,
    body,
  });

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const rawBody = await response.text().catch(() => '');
  const bodyPreview = String(rawBody || '').replace(/\s+/g, ' ').trim().slice(0, 220);
  const payload = (() => {
    if (!rawBody) return null;
    const looksJson =
      contentType.includes('application/json') || rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[');
    if (!looksJson) return null;
    try {
      const parsed = JSON.parse(rawBody);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();

  if (import.meta.env.DEV && (response.status === 401 || response.status === 403)) {
    console.warn('[bank-chat][auth]', {
      path,
      method,
      status: response.status,
      hint: 'Sessao/token invalido ou expirado.',
    });
  }

  const likelyProxyInfraFailure =
    response.status === 500 && !contentType.includes('application/json') && !rawBody.trim();

  if (!response.ok) {
    if (likelyProxyInfraFailure) {
      console.error('[bank-chat][proxy-500]', {
        path,
        method,
        status: response.status,
        contentType: contentType || '(ausente)',
        body: '(vazio)',
        hint: 'Possivel falha de proxy local. Execute `npm run dev:chat-local`.',
      });
      throw new Error(
        `Falha de conectividade local ao chamar ${path}. Verifique a API em http://localhost:3100 e execute \`npm run dev:chat-local\`.`
      );
    }

    if (response.status >= 500) {
      console.error('[bank-chat][handler-500]', {
        path,
        method,
        status: response.status,
        contentType: contentType || '(ausente)',
        body: bodyPreview || '(vazio)',
      });
    }

    const message = String(payload?.message || payload?.error || 'Falha na API de chat da conciliacao bancaria.');
    throw new Error(message);
  }

  return (payload || {}) as T;
}

const mapStoredMessageToChatMessage = (
  row: BankReconciliationChatStoredMessage
): ChatMessage => {
  const richContentCandidate = row.rich_content;
  const richContent =
    richContentCandidate && typeof richContentCandidate === 'object'
      ? (richContentCandidate as RichMessageContent)
      : undefined;

  const contextCandidate = row.context && typeof row.context === 'object'
    ? row.context
    : {};

  const metadataCandidate = row.metadata && typeof row.metadata === 'object'
    ? row.metadata
    : {};

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    timestamp: row.created_at,
    context: {
      contaId: String((contextCandidate as Record<string, unknown>).conta_bancaria_id || '') || undefined,
      dataReferencia: String((contextCandidate as Record<string, unknown>).data_referencia || '') || undefined,
      importId: String((contextCandidate as Record<string, unknown>).import_id || '') || undefined,
      activeExtratoTransacaoId:
        String((contextCandidate as Record<string, unknown>).active_extrato_transacao_id || '') || undefined,
    },
    metadata: {
      actionType: ((metadataCandidate as Record<string, unknown>).action as ChatMessage['metadata']['actionType']) || undefined,
      resultData: (metadataCandidate as Record<string, unknown>).execution_result,
      action_preview: ((metadataCandidate as Record<string, unknown>).action_preview || null) as
        | ChatMessage['metadata']['action_preview']
        | null,
      reconciliation_plan: (((metadataCandidate as Record<string, unknown>).reconciliation_plan || null) as ChatReconciliationPlan | null),
      clarifying_questions: (Array.isArray((metadataCandidate as Record<string, unknown>).clarifying_questions)
        ? ((metadataCandidate as Record<string, unknown>).clarifying_questions as ChatClarifyingQuestion[])
        : null),
      pending_cases: (Array.isArray((metadataCandidate as Record<string, unknown>).pending_cases)
        ? ((metadataCandidate as Record<string, unknown>).pending_cases as ChatPendingCase[])
        : null),
      execution_summary: (((metadataCandidate as Record<string, unknown>).execution_summary || null) as ChatMessage['metadata']['execution_summary'] | null),
      affected_counts: (((metadataCandidate as Record<string, unknown>).affected_counts || null) as Record<string, number> | null),
      pending_action_state: (((metadataCandidate as Record<string, unknown>).pending_action_state || null) as ChatMessage['metadata']['pending_action_state'] | null),
      ai_processing_status: (((metadataCandidate as Record<string, unknown>).ai_processing_status || null) as ChatMessage['metadata']['ai_processing_status'] | null),
      ai_polling: (((metadataCandidate as Record<string, unknown>).ai_polling || null) as ChatMessage['metadata']['ai_polling'] | null),
      correlation_id: (typeof (metadataCandidate as Record<string, unknown>).correlation_id === 'string'
        ? String((metadataCandidate as Record<string, unknown>).correlation_id)
        : null),
      last_execution_summary: (((metadataCandidate as Record<string, unknown>).last_execution_summary || null) as ChatMessage['metadata']['last_execution_summary'] | null),
      suggested_next_actions: (Array.isArray((metadataCandidate as Record<string, unknown>).suggested_next_actions)
        ? ((metadataCandidate as Record<string, unknown>).suggested_next_actions as NonNullable<ChatMessage['metadata']>['suggested_next_actions'])
        : null),
      suggested_intent: (typeof (metadataCandidate as Record<string, unknown>).suggested_intent === 'string'
        ? ((metadataCandidate as Record<string, unknown>).suggested_intent as NonNullable<ChatMessage['metadata']>['suggested_intent'])
        : null),
      suggested_parameters: (((metadataCandidate as Record<string, unknown>).suggested_parameters || null) as Record<string, unknown> | null),
      review_guidance: (((metadataCandidate as Record<string, unknown>).review_guidance || null) as
        ChatMessage['metadata']['review_guidance'] | null),
      ui_show_operational_cards:
        typeof (metadataCandidate as Record<string, unknown>).ui_show_operational_cards === 'boolean'
          ? Boolean((metadataCandidate as Record<string, unknown>).ui_show_operational_cards)
          : undefined,
      ui_show_plan_card:
        typeof (metadataCandidate as Record<string, unknown>).ui_show_plan_card === 'boolean'
          ? Boolean((metadataCandidate as Record<string, unknown>).ui_show_plan_card)
          : undefined,
      ui_show_guided_card:
        typeof (metadataCandidate as Record<string, unknown>).ui_show_guided_card === 'boolean'
          ? Boolean((metadataCandidate as Record<string, unknown>).ui_show_guided_card)
          : undefined,
    },
    ...(richContent ? { richContent } : {}),
  };
};

export default function ConciliacaoBancariaPage() {
  const [searchParams] = useSearchParams();
  const [selectedImportId, setSelectedImportId] = useState<string>('');
  const [selectedContaId, setSelectedContaId] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadType, setUploadType] = useState<'ofx_generic'>('ofx_generic');
  const [dailyReferenceDate, setDailyReferenceDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const activeTab: 'pendente' | 'sugerido' | 'conciliado' | 'divergente' = 'pendente';
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);

  const [createDialogTx, setCreateDialogTx] = useState<CreateDialogTxContext | null>(null);
  const [createDialogAiSuggestionId, setCreateDialogAiSuggestionId] = useState<string | null>(null);
  const [splitDialogTx, setSplitDialogTx] = useState<BankTransactionWithConciliation | null>(null);

  const [createForm, setCreateForm] = useState({
    tipo: 'saida' as 'entrada' | 'saida',
    data: '',
    valor: '',
    historico: '',
    documento: '',
    grupo_contas_id: '',
    observacoes: '',
  });

  const [splitItems, setSplitItems] = useState<SplitItemForm[]>([]);

  const [ruleForm, setRuleForm] = useState<CreateReconciliationRuleRequest>({
    match_type: 'contains',
    pattern: '',
    direction: 'both',
    auto_create: false,
    auto_confirm: false,
    active: true,
    priority: 0,
    conta_bancaria_id: null,
    default_grupo_contas_id: null,
    default_centro_custo: null,
  });

  const [composerMessage, setComposerMessage] = useState('');

  const createInitialAssistantMessage = (): ChatMessage => ({
    id: `welcome-${Date.now()}`,
    role: 'assistant',
    content: 'Olá! 😊 Sou seu assistente de conciliação. Para começar, anexe o arquivo OFX aqui mesmo ou selecione uma importação pendente ao lado. Analisarei as transações para sugerir os melhores vínculos e ajudar você a fechar o dia com precisão.',
    timestamp: new Date().toISOString(),
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => [createInitialAssistantMessage()]);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [chatSessionsServer, setChatSessionsServer] = useState<BankReconciliationChatSessionRow[]>([]);
  const [pendingHistorySessionSelection, setPendingHistorySessionSelection] = useState<{
    sessionId: string;
    contaId: string;
    dataReferencia: string;
  } | null>(null);
  const [chatLoadingMessages, setChatLoadingMessages] = useState(false);
  const [chatSendingMessage, setChatSendingMessage] = useState(false);
  const [chatActionPending, setChatActionPending] = useState(false);
  const [serverBuildId, setServerBuildId] = useState<string | null>(null);
  const [lastUploadFailureContext, setLastUploadFailureContext] = useState<Record<string, unknown> | null>(null);
  const chatSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextParamsAppliedRef = useRef(false);
  const chatDraftsByContextRef = useRef<Record<string, string>>({});
  const activeChatContextKeyRef = useRef<string>('');
  const autoSyncedReferenceImportIdRef = useRef<string>('');
  const suppressAutoSyncImportIdRef = useRef<string>('');
  const chatMode = String(import.meta.env.VITE_BANK_RECONCILIATION_CHAT_MODE || 'hybrid').toLowerCase();
  const chatEnabled = chatMode !== 'legacy' && chatMode !== 'operations';
  const [conciliarConfirmOpen, setConciliarConfirmOpen] = useState(false);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<ConciliationHistoryResponse | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyContextKey, setHistoryContextKey] = useState<string>('');
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [duplicateNoticeAckByImport, setDuplicateNoticeAckByImport] = useState<Record<string, boolean>>({});
  const [candidateSearchOpen, setCandidateSearchOpen] = useState(false);
  const [candidateSearchRow, setCandidateSearchRow] = useState<ConciliationWorkspaceRow | null>(null);
  const [candidateSearchTerm, setCandidateSearchTerm] = useState('');
  const [candidateSearchResults, setCandidateSearchResults] = useState<ConciliationCandidateSearchResult[]>([]);
  const [candidateSearchLoading, setCandidateSearchLoading] = useState(false);
  const [activeWorkspaceRowId, setActiveWorkspaceRowId] = useState<string | null>(null);
  const [editDialogState, setEditDialogState] = useState<WorkspaceEditDialogState | null>(null);
  const [editForm, setEditForm] = useState({
    tipo: 'saida' as 'entrada' | 'saida',
    data: '',
    valor: '',
    historico: '',
    documento: '',
    grupo_contas_id: '',
    observacoes: '',
  });
  const [editSaving, setEditSaving] = useState(false);

  const {
    empresaId,
    importsQuery,
    transactionsQuery,
    contasQuery,
    gruposContasQuery,
    aiSuggestionsQuery,
    rulesQuery,
    uploadImportMutation,
    matchImportMutation,
    confirmConciliationMutation,
    rejectConciliationMutation,
    createAndReconcileMutation,
    splitAndReconcileMutation,
    reprocessImportMutation,
    triggerAiWorkflowMutation,
    reviewAiSuggestionMutation,
    createRuleMutation,
    updateRuleMutation,
    deleteRuleMutation,
    dailySummaryMutation,
    dailyCloseMutation,
    dailyReopenMutation,
    linkExistingMutation,
    ignoreExtratoMutation,
    statusCounts,
  } = useBankReconciliation(selectedImportId || undefined, selectedContaId || undefined);

  const imports = useMemo(() => importsQuery.data || [], [importsQuery.data]);
  const transactions = useMemo(() => transactionsQuery.data || [], [transactionsQuery.data]);
  const contas = useMemo(
    () => ((contasQuery.data || []) as ContaBancariaOption[]),
    [contasQuery.data]
  );
  const gruposContas = useMemo(
    () => ((gruposContasQuery.data || []) as GrupoContaOption[]),
    [gruposContasQuery.data]
  );
  const aiSuggestions = useMemo(
    () => (aiSuggestionsQuery.data || []) as BankAiSuggestionWithTransaction[],
    [aiSuggestionsQuery.data]
  );
  const rules = (rulesQuery.data || []) as ReconciliationRuleRow[];
  const selectedImport = useMemo(
    () => imports.find((item) => item.id === selectedImportId) || null,
    [imports, selectedImportId]
  );
  const selectedImportRecord = selectedImport as Record<string, unknown> | null;
  const selectedImportContaId = selectedImportRecord?.conta_bancaria_id
    ? String(selectedImportRecord.conta_bancaria_id)
    : '';
  const selectedImportMatchesConta =
    !selectedImportId || !selectedContaId
      ? true
      : Boolean(selectedImportContaId) && selectedImportContaId === selectedContaId;
  const selectedImportParseStatus = selectedImport?.parse_status || null;
  const selectedImportParseError = selectedImport?.error_message || null;
  const selectedImportFileFormat = String(selectedImportRecord?.file_format || '').trim().toLowerCase() || null;
  const selectedImportIsCsvLegacy = selectedImportFileFormat === 'csv';
  const buildMismatchDetected = useMemo(
    () => !areBuildIdsEquivalent(FRONTEND_BUILD_ID, serverBuildId),
    [serverBuildId]
  );
  const canRunImportActions =
    selectedImportMatchesConta &&
    selectedImportParseStatus === 'parsed' &&
    (!OFX_ONLY_FRONTEND || selectedImportFileFormat === 'ofx');
  const canLoadWorkspace =
    Boolean(selectedContaId && selectedImportId) &&
    selectedImportMatchesConta &&
    selectedImportParseStatus === 'parsed' &&
    (!OFX_ONLY_FRONTEND || selectedImportFileFormat === 'ofx');
  const importBlockMessage =
    !selectedImportId
      ? 'Selecione uma importação OFX.'
      : !selectedImportMatchesConta
        ? 'A importação selecionada pertence a outra conta. Troque a conta ou selecione o OFX correto.'
      : OFX_ONLY_FRONTEND && selectedImportIsCsvLegacy
        ? 'Importação CSV está em quarentena (somente leitura). Selecione ou importe um OFX para conciliar.'
        : `Importação precisa estar em parsed. Status atual: ${selectedImportParseStatus || '-'}.${
            selectedImportParseError ? ` Erro: ${selectedImportParseError}` : ''
          }`;
  const headerContaLabel = contas.find((c) => c.id === selectedContaId)?.descricao || '-';
  const selectedImportPeriodoInicioIso = toIsoDateOrNull(selectedImportRecord?.periodo_inicio);
  const selectedImportPeriodoFimIso = toIsoDateOrNull(selectedImportRecord?.periodo_fim);
  const selectedImportDefaultReferenceDate = selectedImportPeriodoFimIso || selectedImportPeriodoInicioIso;
  const selectedImportPeriodo = useMemo(() => {
    const inicio = String(selectedImportRecord?.periodo_inicio || '').trim();
    const fim = String(selectedImportRecord?.periodo_fim || '').trim();
    if (!inicio && !fim) return '-';
    if (inicio && fim) return `${formatDate(inicio)} - ${formatDate(fim)}`;
    return formatDate(inicio || fim);
  }, [selectedImportRecord]);
  const selectedImportSaldoCentavos = useMemo(() => {
    const direct = Number(selectedImportRecord?.saldo_final_centavos);
    if (Number.isFinite(direct)) return direct;
    const fallback = Number(selectedImportRecord?.saldo_final);
    if (Number.isFinite(fallback)) return Math.round(fallback * 100);
    return null;
  }, [selectedImportRecord]);

  const handleReferenceDateChange = useCallback((value: string) => {
    const next = toIsoDateOrNull(value);
    if (!next) return;
    setDailyReferenceDate(next);
  }, []);

  const contaSaldoLabel = useMemo(() => {
    const conta = contasQuery.data?.find((c: any) => c.id === selectedContaId) as
      | (ContaBancariaOption & { saldo_atual?: number | null; saldo_inicial?: number | null })
      | undefined;
    if (!conta) return null;
    const saldoAtualRaw =
      conta.saldo_atual !== null && conta.saldo_atual !== undefined
        ? Number(conta.saldo_atual)
        : Number(conta.saldo_inicial ?? 0);
    return Number.isFinite(saldoAtualRaw) ? saldoAtualRaw : null;
  }, [contasQuery.data, selectedContaId]);

  const workspaceQuery = useQuery({
    queryKey: ['bank-conciliation-workspace', selectedContaId, selectedImportId],
    queryFn: async () => {
      const params = new URLSearchParams({
        conta_bancaria_id: selectedContaId,
        import_id: selectedImportId,
      });
      return await callAuthenticatedBankApi<{
        ok: boolean;
        data: ConciliationWorkspaceResponse;
      }>(`/api/bank-statement/conciliation/workspace?${params.toString()}`, {
        method: 'GET',
      });
    },
    enabled: canLoadWorkspace,
    staleTime: 1000 * 15,
    retry: 1,
  });

  const workspaceData = workspaceQuery.data?.data || null;
  const workspaceErrorMessage = workspaceQuery.isError
    ? getErrorMessage(workspaceQuery.error, 'O workspace não respondeu corretamente.')
    : null;
  const workspaceViewState: WorkspaceViewState = useMemo(() => {
    if (!selectedContaId) return 'no_context';
    if (importsQuery.isLoading && !selectedImportId) return 'loading';
    if (!selectedImportId) return 'no_context';
    if (!canLoadWorkspace) return 'no_context';
    if (workspaceQuery.isLoading || (workspaceQuery.isFetching && !workspaceData)) return 'loading';
    if (workspaceQuery.isError) return 'error';
    if (!workspaceData || workspaceData.rows.length === 0) return 'empty';
    return 'ready';
  }, [
    canLoadWorkspace,
    importsQuery.isLoading,
    selectedContaId,
    selectedImportId,
    workspaceData,
    workspaceQuery.isError,
    workspaceQuery.isFetching,
    workspaceQuery.isLoading,
  ]);
  const workspaceEmptyTitle = !selectedContaId
    ? 'Selecione a conta bancária'
    : !selectedImportId
      ? 'Selecione ou importe um OFX'
      : !canLoadWorkspace
        ? 'Importação ainda não está pronta'
        : 'Nenhuma linha disponível';
  const workspaceEmptyDescription = !selectedContaId
    ? 'Escolha a conta no topo do chat para abrir a conciliação.'
    : !selectedImportId
      ? 'Anexe um OFX no copiloto para abrir a lista operacional.'
      : !canLoadWorkspace
        ? importBlockMessage
        : 'O import selecionado não gerou linhas elegíveis para a conciliação.';
  const activeWorkspaceRow = useMemo(
    () => workspaceData?.rows.find((row) => row.extrato_transacao_id === activeWorkspaceRowId) || null,
    [activeWorkspaceRowId, workspaceData]
  );

  const latestAssistantMessage = useMemo(() => {
    for (let idx = chatMessages.length - 1; idx >= 0; idx -= 1) {
      if (chatMessages[idx]?.role === 'assistant') return chatMessages[idx];
    }
    return null;
  }, [chatMessages]);

  const latestAiState = String(
    latestAssistantMessage?.metadata?.ai_processing_status?.state ||
      latestAssistantMessage?.metadata?.last_execution_summary?.ai_processing_status?.state ||
      ''
  ).trim();
  const latestAiStatusLabel = aiStatusLabel[latestAiState] || 'Sem execução';
  const workspaceAiStatusLabel =
    workspaceData?.summary.ai_status && aiStatusLabel[String(workspaceData.summary.ai_status)]
      ? aiStatusLabel[String(workspaceData.summary.ai_status)]
      : latestAiStatusLabel;

  const duplicateSuspectInfo = useMemo(() => {
    if (!selectedImportRecord) return null;
    const hash = String(selectedImportRecord.file_sha256 || '').trim();
    const periodoInicio = String(selectedImportRecord.periodo_inicio || '').trim();
    const periodoFim = String(selectedImportRecord.periodo_fim || '').trim();
    const contaId = String(selectedImportRecord.conta_bancaria_id || '').trim();
    const importId = String(selectedImportRecord.id || '').trim();

    if (!hash || !periodoInicio || !periodoFim || !contaId || !importId) return null;

    const matching = imports
      .filter((row) => {
        const candidate = row as Record<string, unknown>;
        return (
          String(candidate.conta_bancaria_id || '').trim() === contaId &&
          String(candidate.file_sha256 || '').trim() === hash &&
          String(candidate.periodo_inicio || '').trim() === periodoInicio &&
          String(candidate.periodo_fim || '').trim() === periodoFim
        );
      })
      .sort((a, b) => String((b as Record<string, unknown>).created_at || '').localeCompare(String((a as Record<string, unknown>).created_at || '')));

    if (matching.length < 2) return null;
    const latestMatch = String((matching[0] as Record<string, unknown>).id || '').trim();
    if (!latestMatch || latestMatch !== importId) return null;

    return {
      importId,
      contaId,
      periodoInicio,
      periodoFim,
      duplicateCount: matching.length,
    };
  }, [imports, selectedImportRecord]);

  const duplicateNoticeVisible = Boolean(
    duplicateSuspectInfo && !duplicateNoticeAckByImport[duplicateSuspectInfo.importId]
  );

  const getStubResponse = (userMessage: string): { content: string; richContent?: RichMessageContent } => {
    const lower = userMessage.toLowerCase();
    if (lower.includes('matching') || lower.includes('executar')) {
      return { content: 'Não foi possível acessar o backend agora. Posso executar matching assim que a conexão normalizar.' };
    }
    if (lower.includes('disparar') || lower.includes('ia')) {
      return { content: 'Não foi possível acessar o backend agora. Posso disparar a IA assim que a conexão normalizar.' };
    }
    return {
      content: 'Não foi possível acessar o backend do chat agora. O modo offline foi mantido para não bloquear a operação.',
    };
  };

  const loadServerChatSessions = useCallback(async () => {
    if (!empresaId) return;

    try {
      const response = await callAuthenticatedBankApi<{
        ok: boolean;
        data: BankReconciliationChatSessionRow[];
        runtime_build_id?: string | null;
      }>(
        '/api/bank-statement/chat/sessions?limit=50',
        { method: 'GET' }
      );
      setChatSessionsServer(response.data || []);
      if (response.runtime_build_id) {
        setServerBuildId(String(response.runtime_build_id));
      }
    } catch {
      // fallback local continua disponível
    }
  }, [empresaId]);

  const loadConciliationHistory = useCallback(
    async (options?: { cursor?: string | null; append?: boolean }) => {
      if (!selectedContaId) return;

      const params = new URLSearchParams({
        conta_bancaria_id: selectedContaId,
        limit: '30',
      });
      if (dailyReferenceDate) {
        params.set('data_inicio', dailyReferenceDate);
        params.set('data_fim', dailyReferenceDate);
      }
      if (options?.cursor) {
        params.set('cursor', options.cursor);
      }

      if (options?.append) {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }

      try {
        const response = await callAuthenticatedBankApi<{
          ok: boolean;
          data: ConciliationHistoryResponse;
        }>(`/api/bank-statement/conciliation/history?${params.toString()}`, {
          method: 'GET',
        });

        const data = response.data;
        setHistoryCursor(data.next_cursor || null);
        setHistoryData((prev) => {
          if (!options?.append || !prev) return data;
          return {
            imports: [...prev.imports, ...data.imports],
            conciliacoes: [...prev.conciliacoes, ...data.conciliacoes],
            guided_decisions: [...prev.guided_decisions, ...data.guided_decisions],
            next_cursor: data.next_cursor || null,
          };
        });
        setHistoryContextKey(`${selectedContaId}::${dailyReferenceDate || ''}`);
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, 'Falha ao carregar histórico da conciliação.'));
      } finally {
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
      }
    },
    [dailyReferenceDate, selectedContaId]
  );

  const handleOpenHistoryDrawer = useCallback(() => {
    setHistoryDrawerOpen(true);
    const currentKey = `${selectedContaId || ''}::${dailyReferenceDate || ''}`;
    const shouldReload = currentKey !== historyContextKey || !historyData;
    if (shouldReload) {
      void loadConciliationHistory();
    }
  }, [dailyReferenceDate, historyContextKey, historyData, loadConciliationHistory, selectedContaId]);

  const handleAcknowledgeDuplicateNotice = useCallback(async () => {
    if (!duplicateSuspectInfo) return;
    try {
      await callAuthenticatedBankApi<{ ok: boolean }>(
        '/api/bank-statement/import/notice/ack',
        {
          method: 'POST',
          body: {
            extrato_import_id: duplicateSuspectInfo.importId,
            notice_type: 'duplicate_suspect',
          },
        }
      );
      setDuplicateNoticeAckByImport((prev) => ({
        ...prev,
        [duplicateSuspectInfo.importId]: true,
      }));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao registrar confirmação do aviso.'));
    }
  }, [duplicateSuspectInfo]);

  const openNewConversationForCurrentContext = useCallback((options?: { clearComposer?: boolean }) => {
    setActiveChatSessionId(null);
    setChatMessages([createInitialAssistantMessage()]);
    if (options?.clearComposer) {
      setComposerMessage('');
      const key = buildChatContextKey(empresaId, selectedContaId, dailyReferenceDate);
      chatDraftsByContextRef.current[key] = '';
    }
  }, [empresaId, selectedContaId, dailyReferenceDate]);

  const loadChatMessagesBySessionId = useCallback(async (sessionId: string) => {
    const query = new URLSearchParams({ session_id: sessionId }).toString();
    const response = await callAuthenticatedBankApi<{
      ok: boolean;
      data: {
        session: BankReconciliationChatSessionRow | null;
        messages: BankReconciliationChatStoredMessage[];
      };
      runtime_build_id?: string | null;
    }>(`/api/bank-statement/chat/messages?${query}`, { method: 'GET' });

    const serverSession = response.data?.session || null;
    const serverMessages = response.data?.messages || [];
    if (response.runtime_build_id) {
      setServerBuildId(String(response.runtime_build_id));
    }
    if (serverSession) {
      setActiveChatSessionId(serverSession.id);
    } else {
      setActiveChatSessionId(null);
    }
    const lastImportId =
      [...serverMessages]
        .reverse()
        .map((item) => {
          const context = item.context && typeof item.context === 'object'
            ? (item.context as Record<string, unknown>)
            : null;
          const candidate = String(context?.import_id || '').trim();
          return candidate || null;
        })
        .find(Boolean) || null;
    const lastActiveRowId =
      [...serverMessages]
        .reverse()
        .map((item) => {
          const context = item.context && typeof item.context === 'object'
            ? (item.context as Record<string, unknown>)
            : null;
          const candidate = String(context?.active_extrato_transacao_id || '').trim();
          return candidate || null;
        })
        .find(Boolean) || null;
    setSelectedImportId((currentImportId) => {
      const nextImportId = lastImportId || '';
      if (nextImportId && currentImportId !== nextImportId) {
        suppressAutoSyncImportIdRef.current = nextImportId;
      } else {
        suppressAutoSyncImportIdRef.current = '';
      }
      return nextImportId;
    });
    setActiveWorkspaceRowId(lastActiveRowId || null);
    setChatMessages(
      serverMessages.length > 0 ? serverMessages.map(mapStoredMessageToChatMessage) : [createInitialAssistantMessage()]
    );
  }, []);

  const handleDeleteChatSession = useCallback(async (sessionId: string) => {
    await callAuthenticatedBankApi<{ ok: boolean; data?: { id: string } }>(
      `/api/bank-statement/chat/sessions?${new URLSearchParams({ session_id: sessionId }).toString()}`,
      { method: 'DELETE' }
    );

    setChatSessionsServer((prev) => prev.filter((session) => session.id !== sessionId));
    if (activeChatSessionId === sessionId) {
      openNewConversationForCurrentContext({ clearComposer: false });
    }
  }, [activeChatSessionId, openNewConversationForCurrentContext]);

  const handleChatSendMessage = async (
    text: string,
    options?: { files?: File[]; interaction?: ChatMessageInteraction | null }
  ) => {
    const trimmed = text.trim();
    const files = options?.files || [];
    const interaction = options?.interaction || null;
    const openingNewImportSession = files.length > 0;
    if (!trimmed && files.length === 0 && !interaction) return;

    if (!selectedContaId) {
      toast.error('Selecione uma conta antes de enviar mensagem no chat.');
      return;
    }
    if (!empresaId) {
      toast.error('Empresa não identificada para enviar mensagem no chat.');
      return;
    }

    if (openingNewImportSession) {
      setActiveChatSessionId(null);
      setChatMessages([createInitialAssistantMessage()]);
      setSelectedImportId('');
      setActiveWorkspaceRowId(null);
    }

    setChatSendingMessage(true);
    try {
      let attachments: ChatAttachmentInput[] | undefined;

      if (files.length > 0) {
        if (buildMismatchDetected) {
          throw new ChatAttachmentUploadError(
            'Build desatualizado detectado. Atualize a página antes de anexar OFX.',
            {
              fileName: files[0]?.name || 'anexo.ofx',
              storageKey: 'n/a',
              buildId: FRONTEND_BUILD_ID,
              operationalMessage:
                'Seu navegador está com uma versão antiga da tela. Faça um hard refresh (Ctrl+Shift+R) e tente novamente.',
              failureContext: {
                reason: 'build_mismatch_detected',
                frontend_build_id: FRONTEND_BUILD_ID,
                server_build_id: serverBuildId,
              },
            }
          );
        }

        if (!isValidUUID(empresaId) || !isValidUUID(selectedContaId)) {
          throw new ChatAttachmentUploadError(
            'Contexto inválido para montar chave do storage.',
            {
              fileName: files[0]?.name || 'anexo.ofx',
              storageKey: 'n/a',
              buildId: FRONTEND_BUILD_ID,
              operationalMessage:
                'Contexto inválido (empresa/conta). Recarregue a página e selecione a conta novamente.',
              failureContext: {
                reason: 'invalid_storage_context',
                empresa_id: empresaId,
                conta_bancaria_id: selectedContaId,
                frontend_build_id: FRONTEND_BUILD_ID,
                server_build_id: serverBuildId,
              },
            }
          );
        }

        attachments = [];

        for (const file of files) {
          if (OFX_ONLY_FRONTEND && !file.name.toLowerCase().endsWith('.ofx')) {
            throw new ChatAttachmentUploadError(
              `Anexo inválido (${file.name}). Nesta etapa, use apenas OFX para conciliação confiável.`,
              {
                fileName: file.name,
                storageKey: 'n/a',
                buildId: FRONTEND_BUILD_ID,
                operationalMessage: 'Anexo inválido. Nesta etapa, envie somente arquivo OFX.',
                failureContext: {
                  reason: 'invalid_attachment_extension',
                  file_name: file.name,
                  frontend_build_id: FRONTEND_BUILD_ID,
                  server_build_id: serverBuildId,
                },
              }
            );
          }

          const safeName = sanitizeAttachmentFileName(file.name);
          const storageKey = `${empresaId}/${selectedContaId}/${Date.now()}-${safeName}`;
          const inferred = inferAttachmentSourceAndFormat(file);
          const contentTypeCandidates = buildOfxUploadContentTypeRetrySequence(file.name, file.type);
          let uploadSucceeded = false;
          let lastFailureContext: Record<string, unknown> | null = null;

          for (let attempt = 0; attempt < contentTypeCandidates.length; attempt += 1) {
            const contentType = contentTypeCandidates[attempt];
            const { error: uploadError } = await supabase.storage
              .from('extratos-bancarios')
              .upload(storageKey, file, {
                upsert: false,
                contentType,
              });

            if (!uploadError) {
              uploadSucceeded = true;
              break;
            }

            const details = parseStorageUploadErrorDetails(uploadError);
            const retryable = isRetryableStorageUploadStatus(details.status);
            lastFailureContext = {
              status: details.status,
              error: details.error,
              message: details.message,
              storageKey,
              contentType,
              buildId: FRONTEND_BUILD_ID,
              attempt: attempt + 1,
              maxAttempts: contentTypeCandidates.length,
              retryable,
              fileName: file.name,
            };

            if (!retryable || attempt === contentTypeCandidates.length - 1) {
              break;
            }
          }

          if (!uploadSucceeded) {
            const statusValue = Number(lastFailureContext?.status);
            const status = Number.isFinite(statusValue) ? statusValue : null;
            const technicalMessage = String(lastFailureContext?.message || 'Erro no upload do arquivo OFX.');
            throw new ChatAttachmentUploadError(
              `Falha no upload OFX ao storage (${status ?? 'sem status'}): ${technicalMessage}`,
              {
                fileName: file.name,
                storageKey,
                status,
                errorCode: String(lastFailureContext?.error || '') || null,
                contentType: String(lastFailureContext?.contentType || '') || null,
                buildId: FRONTEND_BUILD_ID,
                operationalMessage: 'Falha no upload OFX ao storage. Verifique o arquivo e tente novamente.',
                failureContext: lastFailureContext,
              }
            );
          }

          attachments.push({
            file_storage_bucket: 'extratos-bancarios',
            file_storage_key: storageKey,
            original_filename: file.name,
            source: inferred.source,
            file_format: inferred.file_format,
          });
        }
      }

      const payload: BankReconciliationChatMessageRequest = {
        message:
          trimmed ||
          (interaction
            ? interaction.kind === 'review_batch_confirm'
              ? 'Revisão guiada: aplicar decisões rápidas'
              : interaction.kind === 'review_next'
                ? 'Revisão guiada: próximo item'
                : interaction.kind === 'review_undo_last'
                  ? 'Revisão guiada: desfazer última decisão'
                  : `Revisao guiada: ${interaction.decision}`
            : openingNewImportSession
              ? 'Anexei um OFX para abrir o contexto do extrato.'
              : 'Conciliar o extrato anexado do dia.'),
        conta_bancaria_id: selectedContaId,
        data_referencia: dailyReferenceDate,
        import_id: openingNewImportSession ? null : selectedImportId || null,
        session_id: openingNewImportSession ? null : activeChatSessionId || null,
        active_extrato_transacao_id: openingNewImportSession ? null : activeWorkspaceRowId || null,
        attachments,
        interaction,
        client_build_id: FRONTEND_BUILD_ID,
        client_upload_failure_context: lastUploadFailureContext,
      };

      const response = await callAuthenticatedBankApi<BankReconciliationChatMessageResponse>(
        '/api/bank-statement/chat/message',
        {
          method: 'POST',
          body: payload,
        }
      );

      const data = response.data;
      if (response.runtime_build_id) {
        setServerBuildId(String(response.runtime_build_id));
      }
      setLastUploadFailureContext(null);
      const importResult = (data.import_result || null) as ChatImportResult | null;
      const userMessageCreatedAt = data.user_message?.created_at || new Date().toISOString();

      setActiveChatSessionId(data.session.id);
      const mappedUser = mapStoredMessageToChatMessage(data.user_message);
      const mappedAssistant = mapStoredMessageToChatMessage(data.assistant_message);
      const assistantWithTopLevelState: ChatMessage =
        data.ai_processing_status && mappedAssistant.role === 'assistant'
          ? {
              ...mappedAssistant,
              metadata: {
                ...(mappedAssistant.metadata || {}),
                ai_processing_status: mappedAssistant.metadata?.ai_processing_status || data.ai_processing_status,
                suggested_next_actions: mappedAssistant.metadata?.suggested_next_actions || data.suggested_next_actions || null,
                last_execution_summary: mappedAssistant.metadata?.last_execution_summary || data.last_execution_summary || null,
                correlation_id: mappedAssistant.metadata?.correlation_id || data.correlation_id || null,
                review_guidance: mappedAssistant.metadata?.review_guidance || data.review_guidance || null,
                ui_show_operational_cards:
                  typeof mappedAssistant.metadata?.ui_show_operational_cards === 'boolean'
                    ? mappedAssistant.metadata?.ui_show_operational_cards
                    : data.ui_show_operational_cards,
                ui_show_plan_card:
                  typeof mappedAssistant.metadata?.ui_show_plan_card === 'boolean'
                    ? mappedAssistant.metadata?.ui_show_plan_card
                    : data.ui_show_plan_card,
                ui_show_guided_card:
                  typeof mappedAssistant.metadata?.ui_show_guided_card === 'boolean'
                    ? mappedAssistant.metadata?.ui_show_guided_card
                    : data.ui_show_guided_card,
              },
            }
          : mappedAssistant;

      setChatMessages((prev) => [...prev, mappedUser, assistantWithTopLevelState]);

      const isAgentProcessing = data.ai_processing_status?.state === 'agent_processing';
      if (isAgentProcessing && data.session?.id) {
        const sessionId = data.session.id;
        const maxAttempts = 30;
        const intervalMs = 2000;
        let attempts = 0;
        const pollForAgentResponse = async () => {
          if (attempts >= maxAttempts) return;
          attempts += 1;
          try {
            const query = new URLSearchParams({
              session_id: sessionId,
            }).toString();
            const pollRes = await callAuthenticatedBankApi<{
              ok: boolean;
              data: { session: BankReconciliationChatSessionRow | null; messages: BankReconciliationChatStoredMessage[] };
            }>(`/api/bank-statement/chat/messages?${query}`, { method: 'GET' });
            const messages = pollRes.data?.messages || [];
            const newAssistantAfterUser = messages.some((m) => {
              if (m.role !== 'assistant') return false;
              if (!m.created_at) return false;
              return new Date(m.created_at).getTime() > new Date(userMessageCreatedAt).getTime();
            });
            if (newAssistantAfterUser && messages.length > 0) {
              setChatMessages(messages.map(mapStoredMessageToChatMessage));
              return;
            }
          } catch {
            // ignore poll errors
          }
          setTimeout(pollForAgentResponse, intervalMs);
        };
        setTimeout(pollForAgentResponse, intervalMs);
      }

      if (importResult?.selected_import_id) {
        setSelectedImportId(importResult.selected_import_id);
      }

      const shouldRefreshReconciliationState =
        Boolean(interaction) ||
        Boolean(attachments?.length) ||
        Boolean(assistantWithTopLevelState.metadata?.affected_counts) ||
        Boolean(assistantWithTopLevelState.metadata?.execution_summary) ||
        assistantWithTopLevelState.metadata?.actionType === 'run_daily_reconciliation' ||
        assistantWithTopLevelState.metadata?.actionType === 'resolve_pending_issues' ||
        assistantWithTopLevelState.metadata?.actionType === 'matching';

      if (shouldRefreshReconciliationState) {
        const refetches: Array<Promise<unknown>> = [
          importsQuery.refetch(),
          transactionsQuery.refetch(),
          workspaceQuery.refetch(),
        ];

        if (!attachments?.length || Boolean(interaction)) {
          refetches.push(aiSuggestionsQuery.refetch());
        }

        if (attachments?.length && !interaction) {
          void Promise.allSettled(refetches);
        } else {
          await Promise.all(refetches);
        }
      }

      void loadServerChatSessions();
    } catch (error: unknown) {
      if (error instanceof ChatAttachmentUploadError) {
        const now = new Date().toISOString();
        const userContent = trimmed || `Anexar OFX: ${error.fileName}`;
        const userMsg: ChatMessage = {
          id: `user-upload-failed-${Date.now()}`,
          role: 'user',
          content: userContent,
          timestamp: now,
          context: {
            contaId: selectedContaId || undefined,
            dataReferencia: dailyReferenceDate || undefined,
            importId: selectedImportId || undefined,
          },
        };
        const assistantMsg: ChatMessage = {
          id: `assistant-upload-failed-${Date.now()}`,
          role: 'assistant',
          content: error.operationalMessage,
          timestamp: now,
        };
        setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
        setLastUploadFailureContext({
          ...(error.failureContext || {}),
          buildId: error.buildId,
          fileName: error.fileName,
          storageKey: error.storageKey,
          status: error.status,
          error: error.errorCode,
          contentType: error.contentType,
        });
        console.error('[bank-reconciliation][chat-attachment-upload-failed]', {
          build_id: error.buildId,
          server_build_id: serverBuildId,
          file_name: error.fileName,
          storage_key: error.storageKey,
          conta_bancaria_id: selectedContaId,
          data_referencia: dailyReferenceDate,
          status: error.status,
          error_code: error.errorCode,
          content_type: error.contentType,
          message: error.message,
          failure_context: error.failureContext,
        });
        toast.error(error.message);
        return;
      }

      const now = new Date().toISOString();
      const userMsg: ChatMessage = {
        id: `user-offline-${Date.now()}`,
        role: 'user',
        content: trimmed || 'Mensagem enviada',
        timestamp: now,
        context: {
          contaId: selectedContaId || undefined,
          dataReferencia: dailyReferenceDate || undefined,
          importId: selectedImportId || undefined,
        },
      };
      const fallback = getStubResponse(trimmed);
      const assistantMsg: ChatMessage = {
        id: `assistant-offline-${Date.now()}`,
        role: 'assistant',
        content: fallback.content,
        timestamp: now,
        ...(fallback.richContent ? { richContent: fallback.richContent } : {}),
      };
      setChatMessages((prev) => [...prev, userMsg, assistantMsg]);
      toast.warning(getErrorMessage(error, 'Falha no backend do chat. Operando em modo local.'));
    } finally {
      setChatSendingMessage(false);
    }
  };

  const chatSessions = useMemo<ChatSessionListItem[]>(() => {
    const contaLabelById = new Map(contas.map((conta) => [conta.id, conta.descricao]));

    if (chatSessionsServer.length > 0) {
      return chatSessionsServer.map((session) => ({
        id: session.id,
        contaId: session.conta_bancaria_id || undefined,
        contaLabel: session.conta_bancaria_id ? contaLabelById.get(session.conta_bancaria_id) : undefined,
        dataReferencia: session.data_referencia || undefined,
        title: session.title || null,
        updatedAt: session.last_message_at || session.updated_at,
        archivedAt: session.archived_at || null,
      }));
    }

    return listChatSessions(empresaId ?? '').map((session) => ({
      id: session.id,
      contaId: session.contaId,
      contaLabel: session.contaId ? contaLabelById.get(session.contaId) : undefined,
      dataReferencia: session.dataReferencia,
      importId: session.importId,
      updatedAt: session.updatedAt,
      archivedAt: null,
    }));
  }, [chatSessionsServer, empresaId, contas]);

  const handleClearConversation = () => {
    openNewConversationForCurrentContext({ clearComposer: true });
  };

  const handleContaChange = useCallback(
    (contaId: string) => {
      if (!contaId || contaId === selectedContaId) return;
      setSelectedContaId(contaId);
      setSelectedImportId('');
      setSelectedSuggestionIds([]);
      setPendingHistorySessionSelection(null);
      setActiveWorkspaceRowId(null);
    },
    [selectedContaId]
  );

  const importsAsExtratoImport = useMemo((): ExtratoImportRow[] => {
    return (imports || []).map((i: Record<string, unknown>) => ({
      id: String(i.id),
      conta_bancaria_id: String(i.conta_bancaria_id),
      parse_status: String(i.parse_status ?? ''),
      file_format: i.file_format != null ? String(i.file_format) : null,
      periodo_inicio: i.periodo_inicio != null ? String(i.periodo_inicio) : null,
      periodo_fim: i.periodo_fim != null ? String(i.periodo_fim) : null,
      created_at: String(i.created_at ?? ''),
    }));
  }, [imports]);

  const handleSelectSession = (sessionId: string) => {
    const session = chatSessionsServer.find((item) => item.id === sessionId);
    if (!session || !session.conta_bancaria_id || !session.data_referencia) {
      toast.error('Sessão de chat inválida para carregar.');
      return;
    }

    const contaId = session.conta_bancaria_id;
    const dataReferencia = String(session.data_referencia).slice(0, 10);
    setPendingHistorySessionSelection({
      sessionId,
      contaId,
      dataReferencia,
    });

    setSelectedContaId(contaId);
    setDailyReferenceDate(dataReferencia);
    setSelectedImportId('');
    setActiveWorkspaceRowId(null);
  };

  useEffect(() => {
    if (contextParamsAppliedRef.current) return;

    const contextContaId = String(searchParams.get('conta') || '');
    const contextDate = String(searchParams.get('data') || '');
    const contextItem = String(searchParams.get('item') || '');
    const contextOrigemKey = String(searchParams.get('origem_key') || '');
    const hasContext = Boolean(contextContaId || contextDate || contextItem || contextOrigemKey);

    if (!hasContext) {
      contextParamsAppliedRef.current = true;
      return;
    }

    if (contextContaId && contasQuery.isLoading) return;

    if (contextContaId && contas.some((conta) => conta.id === contextContaId)) {
      setSelectedContaId(contextContaId);
    }

    if (contextDate && /^\d{4}-\d{2}-\d{2}$/.test(contextDate)) {
      setDailyReferenceDate(contextDate);
    }

    if (contextItem || contextOrigemKey) {
      const hints: string[] = [];
      if (contextItem) hints.push(`item ${contextItem}`);
      if (contextOrigemKey) hints.push(`origem ${contextOrigemKey}`);
      toast.info(
        `Contexto recebido de Lançamentos${hints.length ? `: ${hints.join(' | ')}` : ''}.`
      );
    }

    contextParamsAppliedRef.current = true;
  }, [contas, contasQuery.isLoading, searchParams]);

  useEffect(() => {
    if (selectedContaId || contas.length === 0) return;
    setSelectedContaId(contas[0].id);
  }, [selectedContaId, contas]);

  useEffect(() => {
    if (!selectedContaId || !selectedImportId) return;
    if (selectedImportMatchesConta) return;
    setSelectedImportId('');
    setActiveWorkspaceRowId(null);
  }, [selectedContaId, selectedImportId, selectedImportMatchesConta]);

  useEffect(() => {
    if (!selectedImportId) {
      autoSyncedReferenceImportIdRef.current = '';
      suppressAutoSyncImportIdRef.current = '';
      return;
    }
    if (pendingHistorySessionSelection) return;
    if (!selectedImportMatchesConta) return;
    if (suppressAutoSyncImportIdRef.current === selectedImportId) {
      autoSyncedReferenceImportIdRef.current = selectedImportId;
      suppressAutoSyncImportIdRef.current = '';
      return;
    }
    if (autoSyncedReferenceImportIdRef.current === selectedImportId) return;
    if (!selectedImportDefaultReferenceDate) return;

    setDailyReferenceDate((current) =>
      current === selectedImportDefaultReferenceDate ? current : selectedImportDefaultReferenceDate
    );
    autoSyncedReferenceImportIdRef.current = selectedImportId;
  }, [
    pendingHistorySessionSelection,
    selectedImportId,
    selectedImportMatchesConta,
    selectedImportDefaultReferenceDate,
  ]);

  useEffect(() => {
    if (!selectedContaId || !dailyReferenceDate) return;
    if (selectedImportId) return;
    const resolved = resolveBestImportForDateAccount(
      importsAsExtratoImport,
      selectedContaId,
      dailyReferenceDate,
      { ofxOnly: OFX_ONLY_FRONTEND }
    );
    if (resolved !== selectedImportId) {
      setSelectedImportId(resolved ?? '');
    }
  }, [importsAsExtratoImport, selectedContaId, dailyReferenceDate, selectedImportId]);

  useEffect(() => {
    if (workspaceViewState !== 'ready' || !workspaceData) {
      setActiveWorkspaceRowId(null);
      return;
    }

    if (
      activeWorkspaceRowId &&
      workspaceData.rows.some((row) => row.extrato_transacao_id === activeWorkspaceRowId)
    ) {
      return;
    }

    setActiveWorkspaceRowId(workspaceData.default_row_id || workspaceData.rows[0]?.extrato_transacao_id || null);
  }, [activeWorkspaceRowId, workspaceData, workspaceViewState]);

  useEffect(() => {
    void loadServerChatSessions();
  }, [loadServerChatSessions]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!duplicateSuspectInfo) return;
      if (duplicateNoticeAckByImport[duplicateSuspectInfo.importId] !== undefined) return;
      try {
        const params = new URLSearchParams({
          extrato_import_id: duplicateSuspectInfo.importId,
          notice_type: 'duplicate_suspect',
        });
        const response = await callAuthenticatedBankApi<{
          ok: boolean;
          data?: { acknowledged?: boolean };
        }>(`/api/bank-statement/import/notice/ack?${params.toString()}`, {
          method: 'GET',
        });
        if (cancelled) return;
        setDuplicateNoticeAckByImport((prev) => ({
          ...prev,
          [duplicateSuspectInfo.importId]: Boolean(response.data?.acknowledged),
        }));
      } catch {
        if (cancelled) return;
        setDuplicateNoticeAckByImport((prev) => ({
          ...prev,
          [duplicateSuspectInfo.importId]: false,
        }));
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [duplicateNoticeAckByImport, duplicateSuspectInfo]);

  // Troca de contexto (conta/data) => salva rascunho e abre nova conversa vazia (sem auto-carregar histórico)
  useEffect(() => {
    const currentKey = buildChatContextKey(empresaId, selectedContaId, dailyReferenceDate);
    const previousKey = activeChatContextKeyRef.current;

    if (!previousKey) {
      activeChatContextKeyRef.current = currentKey;
      return;
    }

    if (previousKey === currentKey) return;

    chatDraftsByContextRef.current[previousKey] = composerMessage;
    activeChatContextKeyRef.current = currentKey;

    const restoredDraft = chatDraftsByContextRef.current[currentKey] || '';
    setComposerMessage(restoredDraft);
    setChatLoadingMessages(false);
    setActiveChatSessionId(null);
    setChatMessages([createInitialAssistantMessage()]);
  }, [empresaId, selectedContaId, dailyReferenceDate]);

  // Seleção explícita de histórico => carregar sessão por session_id
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!pendingHistorySessionSelection) return;
      if (!selectedContaId || !dailyReferenceDate) return;

      const sameContext =
        pendingHistorySessionSelection.contaId === selectedContaId &&
        pendingHistorySessionSelection.dataReferencia.slice(0, 10) === dailyReferenceDate.slice(0, 10);

      if (!sameContext) return;

      setChatLoadingMessages(true);
      try {
        await loadChatMessagesBySessionId(pendingHistorySessionSelection.sessionId);
      } catch (error: unknown) {
        if (!cancelled) {
          toast.error(getErrorMessage(error, 'Falha ao carregar sessão do histórico.'));
        }
      } finally {
        if (!cancelled) {
          setChatLoadingMessages(false);
          setPendingHistorySessionSelection(null);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [pendingHistorySessionSelection, selectedContaId, dailyReferenceDate, loadChatMessagesBySessionId]);

  // Salvar sessão com debounce ao alterar mensagens
  useEffect(() => {
    if (!empresaId) return;
    if (chatSaveTimeoutRef.current) clearTimeout(chatSaveTimeoutRef.current);
    chatSaveTimeoutRef.current = setTimeout(() => {
      chatSaveTimeoutRef.current = null;
      const sessionId = activeChatSessionId || `session-${empresaId}-${selectedContaId ?? ''}-${dailyReferenceDate ?? ''}`;
      const now = new Date().toISOString();
      const session: ChatSession = {
        id: sessionId,
        empresaId,
        contaId: selectedContaId || undefined,
        dataReferencia: dailyReferenceDate || undefined,
        importId: selectedImportId || undefined,
        messages: chatMessages,
        createdAt: now,
        updatedAt: now,
      };
      saveChatSession(session);
    }, 500);
    return () => {
      if (chatSaveTimeoutRef.current) clearTimeout(chatSaveTimeoutRef.current);
    };
  }, [empresaId, selectedContaId, dailyReferenceDate, activeChatSessionId, chatMessages]);

  const dailySummaryData =
    ((dailySummaryMutation.data as
      | { data?: { summary?: DailyReconciliationSummary | null; fechamento?: { status?: string } | null } }
      | undefined)?.data?.summary as DailyReconciliationSummary | null | undefined) || null;
  const dailyFechamentoStatusRaw =
    ((dailySummaryMutation.data as
      | { data?: { summary?: DailyReconciliationSummary | null; fechamento?: { status?: string } | null } }
      | undefined)?.data?.fechamento?.status as string | undefined) || null;
  const dailyFechamentoStatus =
    dailyFechamentoStatusRaw === 'closed' || dailyFechamentoStatusRaw === 'reopened'
      ? dailyFechamentoStatusRaw
      : 'open';
  const workspacePendenciasTotal = workspaceData
    ? workspaceData.counters.em_revisao + workspaceData.counters.pendente + workspaceData.counters.divergente
    : dailySummaryData?.pendencias_criticas_total ?? 0;

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => tx.view_status === activeTab);
  }, [transactions, activeTab]);

  const selectedSuggestions = useMemo(() => {
    const map = new Set(selectedSuggestionIds);
    return filteredTransactions
      .map((tx) => tx.conciliacoes.find((item) => item.status === 'suggested'))
      .filter((item): item is NonNullable<typeof item> => !!item)
      .filter((item) => map.has(item.id));
  }, [filteredTransactions, selectedSuggestionIds]);

  const splitTotalCentavos = useMemo(() => {
    return splitItems.reduce((acc, item) => acc + parseMoneyToCentavos(item.valor), 0);
  }, [splitItems]);

  const handleSelectImport = (importId: string) => {
    setSelectedImportId(importId);
    setSelectedSuggestionIds([]);
    setActiveWorkspaceRowId(null);
    const nextImport = imports.find((item) => item.id === importId);
    if (nextImport?.conta_bancaria_id) {
      setSelectedContaId(nextImport.conta_bancaria_id);
    }
  };

  const refreshDailySummary = async () => {
    if (!selectedContaId || !dailyReferenceDate) return;
    try {
      await dailySummaryMutation.mutateAsync({
        conta_bancaria_id: selectedContaId,
        data_referencia: dailyReferenceDate,
      });
    } catch {
      // toast handled in hook
    }
  };

  const handleDailyClose = async () => {
    if (!selectedContaId || !dailyReferenceDate) {
      toast.error('Selecione conta e data para fechar o dia.');
      return;
    }

    try {
      await dailyCloseMutation.mutateAsync({
        conta_bancaria_id: selectedContaId,
        data_referencia: dailyReferenceDate,
      });
      await refreshDailySummary();
    } catch {
      // toast handled in hook
    }
  };

  const handleDailyReopen = async () => {
    if (!selectedContaId || !dailyReferenceDate) {
      toast.error('Selecione conta e data para reabrir o dia.');
      return;
    }

    try {
      await dailyReopenMutation.mutateAsync({
        conta_bancaria_id: selectedContaId,
        data_referencia: dailyReferenceDate,
      });
      await refreshDailySummary();
    } catch {
      // toast handled in hook
    }
  };

  useEffect(() => {
    if (!selectedContaId || !dailyReferenceDate) return;
    refreshDailySummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedContaId, dailyReferenceDate]);

  const handleUpload = async () => {
    if (!selectedContaId) {
      toast.error('Selecione a conta bancaria do extrato antes do upload.');
      return;
    }

    if (!selectedFile) {
      toast.error('Selecione um arquivo para importar.');
      return;
    }

    try {
      if (OFX_ONLY_FRONTEND && !selectedFile.name.toLowerCase().endsWith('.ofx')) {
        toast.error('Nesta etapa, apenas OFX é aceito para conciliação.');
        return;
      }
      const result = await uploadImportMutation.mutateAsync({
        file: selectedFile,
        conta_bancaria_id: selectedContaId,
        source: 'ofx_generic',
        file_format: 'ofx',
      });

      setSelectedImportId(result.import_row.id);
      setSelectedFile(null);
      toast.success('Extrato enviado e processado com sucesso.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao importar extrato.'));
    }
  };

  const handleRunMatching = async () => {
    toast.info('Ação legada detectada: executando fluxo canônico "Conciliar".');
    await handleChatActionConfirm('run_daily_reconciliation');
  };

  const handleReprocess = async () => {
    if (!selectedImportId) {
      toast.error('Selecione uma importacao para reprocessar.');
      return;
    }

    try {
      await reprocessImportMutation.mutateAsync(selectedImportId);
      toast.success('Importacao reprocessada com sucesso.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao reprocessar importacao.'));
    }
  };

  const handleTriggerAiWorkflow = async () => {
    toast.info('Ação legada detectada: executando fluxo canônico "Conciliar".');
    await handleChatActionConfirm('run_daily_reconciliation');
  };

  const handleChatActionConfirm: NonNullable<ReconciliationChatViewProps['onConfirmAction']> = async (kind, options) => {
    const canonicalKind = kind === 'matching' || kind === 'trigger_ai'
      ? 'run_daily_reconciliation'
      : kind;

    if (!selectedContaId) {
      toast.error('Selecione uma conta antes de confirmar a ação.');
      return;
    }

    if (canonicalKind === 'run_daily_reconciliation' && !selectedImportId) {
      toast.error('Selecione uma importação para confirmar esta ação.');
      return;
    }

    if (
      canonicalKind === 'run_daily_reconciliation' &&
      (!selectedImportId || !canRunImportActions)
    ) {
      toast.error('Anexe ou selecione um OFX pronto antes de executar a conciliação.');
      return;
    }

    setChatActionPending(true);
    try {
      const payload: BankReconciliationChatActionConfirmRequest = {
        action: canonicalKind,
        conta_bancaria_id: selectedContaId,
        data_referencia: dailyReferenceDate,
        import_id: selectedImportId || null,
        session_id: activeChatSessionId || null,
        plan_id: options?.plan_id || null,
        selection_mode: options?.selection_mode,
        include_suggestion_ids: options?.include_suggestion_ids,
        exclude_suggestion_ids: options?.exclude_suggestion_ids,
        idempotency_key: `chat-ui:${activeChatSessionId || 'sessionless'}:${canonicalKind}:${selectedContaId}:${dailyReferenceDate}:${selectedImportId || 'none'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      };

      const response = await callAuthenticatedBankApi<BankReconciliationChatActionConfirmResponse>(
        '/api/bank-statement/chat/action/confirm',
        {
          method: 'POST',
          body: payload,
        }
      );

      const data = response.data;
      if (response.runtime_build_id) {
        setServerBuildId(String(response.runtime_build_id));
      }
      setActiveChatSessionId(data.session.id);
      setChatMessages((prev) => [
        ...prev,
        mapStoredMessageToChatMessage(data.user_message),
        mapStoredMessageToChatMessage(data.assistant_message),
      ]);

      await Promise.all([
        importsQuery.refetch(),
        transactionsQuery.refetch(),
        aiSuggestionsQuery.refetch(),
        workspaceQuery.refetch(),
        dailySummaryMutation.mutateAsync({
          conta_bancaria_id: selectedContaId,
          data_referencia: dailyReferenceDate,
        }).catch(() => null),
      ]);
      void loadServerChatSessions();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao confirmar ação no chat.'));
    } finally {
      setChatActionPending(false);
    }
  };

  const handleConciliarViaTopCta = async () => {
    if (!selectedContaId) {
      toast.error('Selecione uma conta antes de executar a conciliação.');
      return;
    }
    if (!selectedImportId || !canRunImportActions) {
      toast.error('Anexe ou selecione um OFX pronto antes de executar a conciliação.');
      return;
    }
    setConciliarConfirmOpen(false);
    await handleChatActionConfirm('run_daily_reconciliation');
  };

  const refreshOperationalState = useCallback(async () => {
    await Promise.all([
      importsQuery.refetch(),
      transactionsQuery.refetch(),
      aiSuggestionsQuery.refetch(),
      workspaceQuery.refetch(),
      selectedContaId && dailyReferenceDate
        ? dailySummaryMutation
            .mutateAsync({
              conta_bancaria_id: selectedContaId,
              data_referencia: dailyReferenceDate,
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);
  }, [
    aiSuggestionsQuery,
    dailyReferenceDate,
    dailySummaryMutation,
    importsQuery,
    selectedContaId,
    transactionsQuery,
    workspaceQuery,
  ]);

  const openCreateDialogFromWorkspaceRow = (row: ConciliationWorkspaceRow) => {
    const inferredTipo = row.tipo === 'credit' ? 'entrada' : 'saida';
    setCreateDialogAiSuggestionId(null);
    setCreateDialogTx({
      id: row.extrato_transacao_id,
      conta_bancaria_id: selectedContaId,
      data_movimento: row.data_movimento,
      tipo: row.tipo,
      valor_centavos: row.valor_centavos,
      descricao_raw: row.descricao,
      documento_ref: row.documento_ref || null,
      line_number: row.line_number,
    });
    setCreateForm({
      tipo: inferredTipo,
      data: row.data_movimento,
      valor: (row.valor_centavos / 100).toFixed(2),
      historico: row.descricao,
      documento: row.documento_ref || '',
      grupo_contas_id: '',
      observacoes: `Criado na conciliação bancária (linha ${row.line_number}).`,
    });
  };

  const loadCandidateSearch = useCallback(
    async (row: ConciliationWorkspaceRow, queryOverride?: string) => {
      setCandidateSearchLoading(true);
      try {
        const params = new URLSearchParams({
          extrato_transacao_id: row.extrato_transacao_id,
          limit: '10',
        });
        const effectiveQuery = String(queryOverride ?? candidateSearchTerm).trim();
        if (effectiveQuery) {
          params.set('query', effectiveQuery);
        }
        const response = await callAuthenticatedBankApi<{
          ok: boolean;
          data: {
            candidates: ConciliationCandidateSearchResult[];
          };
        }>(`/api/bank-statement/reconcile/search-existing?${params.toString()}`, {
          method: 'GET',
        });
        setCandidateSearchResults(response.data?.candidates || []);
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, 'Falha ao buscar lançamentos existentes.'));
      } finally {
        setCandidateSearchLoading(false);
      }
    },
    [candidateSearchTerm]
  );

  const handleOpenCandidateSearch = useCallback(
    (row: ConciliationWorkspaceRow) => {
      setCandidateSearchRow(row);
      const initialTerm = row.descricao.slice(0, 80);
      setCandidateSearchTerm(initialTerm);
      setCandidateSearchResults([]);
      setCandidateSearchOpen(true);
      void loadCandidateSearch(row, initialTerm);
    },
    [loadCandidateSearch]
  );

  const handleSelectSearchCandidate = async (candidate: ConciliationCandidateSearchResult) => {
    if (!candidateSearchRow) return;
    try {
      await linkExistingMutation.mutateAsync({
        extrato_transacao_id: candidateSearchRow.extrato_transacao_id,
        item_financeiro_id: candidate.item_financeiro_id,
        idempotency_key: `${candidateSearchRow.extrato_transacao_id}:search-link:${candidate.item_financeiro_id}`,
        valor_alocado_centavos: candidateSearchRow.valor_centavos,
        method: 'manual',
        confidence: candidate.score,
        explanation: 'Vinculado manualmente via busca contextual do workspace.',
      });
      setCandidateSearchOpen(false);
      setCandidateSearchRow(null);
      setCandidateSearchResults([]);
      await refreshOperationalState();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao vincular o candidato selecionado.'));
    }
  };

  const handleQuickConciliateWorkspaceRow = async (row: ConciliationWorkspaceRow) => {
    const suggested = row.suggested_candidate;
    if (!suggested) {
      toast.error('Nenhum candidato sugerido disponível para esta linha.');
      return;
    }

    try {
      await linkExistingMutation.mutateAsync({
        extrato_transacao_id: row.extrato_transacao_id,
        item_financeiro_id: suggested.item_financeiro_id,
        idempotency_key: `${row.extrato_transacao_id}:workspace-link:${suggested.item_financeiro_id}`,
        valor_alocado_centavos: row.valor_centavos,
        method: suggested.strict_value_date_direction_match ? 'deterministic' : 'manual',
        confidence: suggested.score,
        explanation: suggested.strict_value_date_direction_match
          ? 'Vínculo seguro aplicado no workspace (valor + data + direção).'
          : 'Vínculo aplicado manualmente no workspace.',
      });
      await refreshOperationalState();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao conciliar esta linha.'));
    }
  };

  const handleIgnoreWorkspaceRow = async (row: ConciliationWorkspaceRow) => {
    const justificativa = window.prompt(
      `Informe a justificativa para marcar divergência em "${row.descricao}":`,
      `Divergência confirmada para "${row.descricao}".`
    );

    if (!justificativa || !justificativa.trim()) return;

    try {
      await ignoreExtratoMutation.mutateAsync({
        extrato_transacao_id: row.extrato_transacao_id,
        justificativa: justificativa.trim(),
      });
      await refreshOperationalState();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao registrar divergência.'));
    }
  };

  const handleUndoWorkspaceRow = async (row: ConciliationWorkspaceRow) => {
    if (!row.conciliation?.id) {
      toast.error('Nenhuma conciliação reversível encontrada para esta linha.');
      return;
    }

    try {
      if (row.conciliation.status === 'confirmed') {
        await rejectConciliationMutation.mutateAsync({
          conciliacao_id: row.conciliation.id,
          explanation: 'Vínculo desfeito manualmente no workspace da conciliação.',
        });
      } else if (row.conciliation.status === 'rejected') {
        await callAuthenticatedBankApi<{ ok: boolean }>(
          '/api/bank-statement/reconcile/unignore',
          {
            method: 'POST',
            body: {
              conciliacao_id: row.conciliation.id,
              justificativa_undo: 'Divergência desfeita manualmente no workspace da conciliação.',
            },
          }
        );
      } else {
        await rejectConciliationMutation.mutateAsync({
          conciliacao_id: row.conciliation.id,
          explanation: 'Sugestão desfeita manualmente no workspace da conciliação.',
        });
      }

      await refreshOperationalState();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao desfazer esta decisão.'));
    }
  };

  const handleUndoHistoryConciliation = async (args: { conciliacaoId: string; status: 'confirmed' | 'rejected' }) => {
    try {
      if (args.status === 'confirmed') {
        await rejectConciliationMutation.mutateAsync({
          conciliacao_id: args.conciliacaoId,
          explanation: 'Vínculo desfeito pelo histórico operacional da conciliação.',
        });
      } else {
        await callAuthenticatedBankApi<{ ok: boolean }>(
          '/api/bank-statement/reconcile/unignore',
          {
            method: 'POST',
            body: {
              conciliacao_id: args.conciliacaoId,
              justificativa_undo: 'Divergência desfeita pelo histórico operacional da conciliação.',
            },
          }
        );
      }

      await refreshOperationalState();
      await loadConciliationHistory();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao desfazer a ação do histórico.'));
    }
  };

  const handleOpenEditWorkspaceRow = async (row: ConciliationWorkspaceRow) => {
    const lancamentoCaixaId =
      row.conciliation?.lancamento_caixa_id ||
      row.suggested_candidate?.lancamento_caixa_id ||
      row.ai_suggestion?.lancamento_caixa_id ||
      null;

    if (!lancamentoCaixaId) {
      toast.error('Nenhum lançamento de caixa editável foi encontrado para esta linha.');
      return;
    }

    try {
      const { data, error } = await supabase
        .from('lancamentos_caixa')
        .select('id,data,tipo,valor,historico,documento,grupo_contas_id,observacoes,conta_bancaria_id')
        .eq('empresa_id', empresaId)
        .eq('id', lancamentoCaixaId)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        toast.error('Lançamento não encontrado para edição.');
        return;
      }

      setEditDialogState({
        extrato_transacao_id: row.extrato_transacao_id,
        lancamento_caixa_id: String(data.id),
        conta_bancaria_id: String(data.conta_bancaria_id || selectedContaId),
        item_financeiro_id: row.conciliation?.item_financeiro_id || row.suggested_candidate?.item_financeiro_id || null,
      });
      setEditForm({
        tipo: data.tipo === 'entrada' || data.tipo === 'saida' ? data.tipo : 'saida',
        data: String(data.data || ''),
        valor: Number(data.valor || 0).toFixed(2),
        historico: String(data.historico || ''),
        documento: String(data.documento || ''),
        grupo_contas_id: String(data.grupo_contas_id || ''),
        observacoes: String(data.observacoes || ''),
      });
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao carregar lançamento para edição.'));
    }
  };

  const handleSaveWorkspaceEdit = async () => {
    if (!editDialogState || !empresaId) {
      toast.error('Nenhum lançamento selecionado para edição.');
      return;
    }

    const valor = Number.parseFloat(editForm.valor.replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error('Informe um valor válido para o lançamento.');
      return;
    }

    setEditSaving(true);
    try {
      const { error } = await supabase
        .from('lancamentos_caixa')
        .update({
          data: editForm.data,
          tipo: editForm.tipo,
          valor,
          historico: editForm.historico,
          documento: editForm.documento || null,
          grupo_contas_id: editForm.grupo_contas_id || null,
          observacoes: editForm.observacoes || null,
          conta_bancaria_id: editDialogState.conta_bancaria_id,
          updated_at: new Date().toISOString(),
        })
        .eq('empresa_id', empresaId)
        .eq('id', editDialogState.lancamento_caixa_id);

      if (error) throw error;

      setEditDialogState(null);
      toast.success('Lançamento atualizado com sucesso.');
      await refreshOperationalState();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao salvar alterações do lançamento.'));
    } finally {
      setEditSaving(false);
    }
  };

  const handleConfirmSuggestion = async (tx: BankTransactionWithConciliation) => {
    const suggested = tx.conciliacoes.find((item) => item.status === 'suggested');
    if (!suggested) {
      toast.error('Nao existe sugestao pendente para esta transacao.');
      return;
    }

    try {
      await confirmConciliationMutation.mutateAsync({
        conciliacao_id: suggested.id,
        explanation: 'Confirmado manualmente na tela de conciliacao bancaria.',
      });

      toast.success('Sugestao confirmada com sucesso.');
      setSelectedSuggestionIds((prev) => prev.filter((id) => id !== suggested.id));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao confirmar sugestao.'));
    }
  };

  const handleRejectSuggestion = async (tx: BankTransactionWithConciliation) => {
    const suggested = tx.conciliacoes.find((item) => item.status === 'suggested');
    if (!suggested) {
      toast.error('Nao existe sugestao pendente para esta transacao.');
      return;
    }

    try {
      await rejectConciliationMutation.mutateAsync({
        conciliacao_id: suggested.id,
        explanation: 'Rejeitado manualmente na tela de conciliacao bancaria.',
      });

      toast.success('Sugestao rejeitada.');
      setSelectedSuggestionIds((prev) => prev.filter((id) => id !== suggested.id));
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao rejeitar sugestao.'));
    }
  };

  const handleBatchConfirm = async () => {
    if (!selectedSuggestions.length) {
      toast.error('Selecione ao menos uma sugestao para confirmar em lote.');
      return;
    }

    try {
      for (const suggestion of selectedSuggestions) {
        await confirmConciliationMutation.mutateAsync({
          conciliacao_id: suggestion.id,
          explanation: 'Confirmado em lote na tela de conciliacao bancaria.',
        });
      }
      toast.success(`${selectedSuggestions.length} sugestao(oes) confirmadas em lote.`);
      setSelectedSuggestionIds([]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha na confirmacao em lote.'));
    }
  };

  const handleBatchReject = async () => {
    if (!selectedSuggestions.length) {
      toast.error('Selecione ao menos uma sugestao para rejeitar em lote.');
      return;
    }

    try {
      for (const suggestion of selectedSuggestions) {
        await rejectConciliationMutation.mutateAsync({
          conciliacao_id: suggestion.id,
          explanation: 'Rejeitado em lote na tela de conciliacao bancaria.',
        });
      }
      toast.success(`${selectedSuggestions.length} sugestao(oes) rejeitadas em lote.`);
      setSelectedSuggestionIds([]);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha na rejeicao em lote.'));
    }
  };

  const toggleSuggestionSelection = (conciliacaoId: string, checked: boolean) => {
    setSelectedSuggestionIds((prev) => {
      if (checked) {
        if (prev.includes(conciliacaoId)) return prev;
        return [...prev, conciliacaoId];
      }
      return prev.filter((id) => id !== conciliacaoId);
    });
  };

  const openCreateDialog = (tx: BankTransactionWithConciliation) => {
    const inferredTipo = tx.tipo === 'credit' ? 'entrada' : 'saida';
    setCreateDialogAiSuggestionId(null);
    setCreateDialogTx({
      id: tx.id,
      conta_bancaria_id: tx.conta_bancaria_id,
      data_movimento: tx.data_movimento,
      tipo: tx.tipo,
      valor_centavos: tx.valor_centavos,
      descricao_raw: tx.descricao_raw,
      documento_ref: tx.documento_ref,
      line_number: tx.line_number,
    });
    setCreateForm({
      tipo: inferredTipo,
      data: tx.data_movimento,
      valor: (tx.valor_centavos / 100).toFixed(2),
      historico: tx.descricao_raw,
      documento: tx.documento_ref || '',
      grupo_contas_id: '',
      observacoes: `Criado na conciliacao bancaria (extrato linha ${tx.line_number}).`,
    });
  };

  const handleOpenCreateFromAiSuggestion = async (suggestion: BankAiSuggestionWithTransaction) => {
    const tx = suggestion.extrato_transacoes;
    if (!tx) {
      toast.error('Sugestao IA sem transacao vinculada.');
      return;
    }

    const proposed =
      suggestion.proposed_lancamento && typeof suggestion.proposed_lancamento === 'object'
        ? (suggestion.proposed_lancamento as Record<string, unknown>)
        : {};

    const suggestedTipo = proposed?.tipo === 'entrada' || proposed?.tipo === 'saida'
      ? (proposed.tipo as 'entrada' | 'saida')
      : tx.tipo === 'credit'
        ? 'entrada'
        : 'saida';

    const suggestedValorCentavosRaw = Number(proposed?.valor_centavos || tx.valor_centavos);
    const suggestedValorCentavos = Number.isFinite(suggestedValorCentavosRaw) && suggestedValorCentavosRaw > 0
      ? Math.round(suggestedValorCentavosRaw)
      : tx.valor_centavos;

    const suggestedDate = String(proposed?.data || tx.data_movimento || '').trim() || tx.data_movimento;
    const suggestedHistorico =
      String(proposed?.descricao || tx.descricao_raw || '').trim() || tx.descricao_raw;
    const suggestedDocumento = String(tx.documento_ref || '').trim();
    const suggestedGrupoContas = String(proposed?.categoria_id || '').trim();
    const suggestedObservacao = String(
      proposed?.observacao || suggestion.explanation || 'Sugestao IA aprovada para criacao de lancamento.'
    ).trim();

    if (suggestion.status !== 'approved') {
      try {
        await reviewAiSuggestionMutation.mutateAsync({
          suggestion_id: suggestion.id,
          status: 'approved',
          explanation: 'Sugestao IA aprovada para prefill de criacao de lancamento.',
        });
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, 'Falha ao aprovar sugestao IA.'));
        return;
      }
    }

    setCreateDialogAiSuggestionId(suggestion.id);
    setCreateDialogTx({
      id: tx.id,
      conta_bancaria_id: tx.conta_bancaria_id,
      data_movimento: tx.data_movimento,
      tipo: tx.tipo,
      valor_centavos: tx.valor_centavos,
      descricao_raw: tx.descricao_raw,
      documento_ref: tx.documento_ref,
      line_number: 0,
    });
    setCreateForm({
      tipo: suggestedTipo,
      data: suggestedDate,
      valor: (suggestedValorCentavos / 100).toFixed(2),
      historico: suggestedHistorico,
      documento: suggestedDocumento,
      grupo_contas_id: suggestedGrupoContas,
      observacoes: suggestedObservacao,
    });
  };

  const handleRejectAiSuggestion = async (suggestionId: string) => {
    try {
      await reviewAiSuggestionMutation.mutateAsync({
        suggestion_id: suggestionId,
        status: 'rejected',
        explanation: 'Sugestao IA rejeitada manualmente.',
      });
      toast.success('Sugestao IA rejeitada.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao rejeitar sugestao IA.'));
    }
  };

  const handleCreateAndReconcile = async () => {
    if (!createDialogTx || !empresaId) {
      toast.error('Dados insuficientes para criar conciliacao.');
      return;
    }

    const valor = Number.parseFloat(createForm.valor.replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error('Informe um valor valido para o lancamento.');
      return;
    }

    try {
      await createAndReconcileMutation.mutateAsync({
        empresa_id: empresaId,
        conta_bancaria_id: createDialogTx.conta_bancaria_id,
        extrato_transacao_id: createDialogTx.id,
        idempotency_key: `${createDialogTx.id}:${createForm.tipo}:${Math.round(valor * 100)}:${createForm.data}`,
        tipo: createForm.tipo,
        valor,
        valor_centavos: Math.round(valor * 100),
        data: createForm.data,
        historico: createForm.historico,
        descricao: createForm.historico,
        documento: createForm.documento || null,
        grupo_contas_id: createForm.grupo_contas_id || null,
        observacoes: createForm.observacoes || null,
        method: 'manual',
        explanation: 'Lancamento criado manualmente via conciliacao bancaria.',
      });

      if (createDialogAiSuggestionId) {
        try {
          await reviewAiSuggestionMutation.mutateAsync({
            suggestion_id: createDialogAiSuggestionId,
            status: 'applied',
            explanation: 'Sugestao IA aplicada com criacao de lancamento e conciliacao.',
          });
        } catch {
          toast.warning('Lancamento conciliado, mas nao foi possivel marcar sugestao IA como aplicada.');
        }
      }

      setCreateDialogTx(null);
      setCreateDialogAiSuggestionId(null);
      toast.success('Lancamento criado e conciliado com sucesso.');
      await refreshOperationalState();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao criar lancamento conciliado.'));
    }
  };

  const handleIgnoreExtrato = async (tx: BankTransactionWithConciliation) => {
    const justificativa = window.prompt(
      'Informe a justificativa para ignorar esta transacao do extrato:'
    );

    if (!justificativa || !justificativa.trim()) {
      return;
    }

    try {
      await ignoreExtratoMutation.mutateAsync({
        extrato_transacao_id: tx.id,
        justificativa: justificativa.trim(),
      });
      toast.success('Transacao marcada como ignorada com justificativa.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao ignorar transacao de extrato.'));
    }
  };

  const handleLinkExistingByItemId = async (tx: BankTransactionWithConciliation) => {
    const itemFinanceiroId = window.prompt(
      'Informe o Código do lançamento para vincular manualmente esta transação:'
    );

    if (!itemFinanceiroId || !itemFinanceiroId.trim()) {
      return;
    }

    try {
      await linkExistingMutation.mutateAsync({
        extrato_transacao_id: tx.id,
        item_financeiro_id: itemFinanceiroId.trim(),
        idempotency_key: `${tx.id}:link-existing:${itemFinanceiroId.trim()}`,
        valor_alocado_centavos: tx.valor_centavos,
        method: 'manual',
        confidence: 1,
        explanation: 'Vinculado manualmente por código do lançamento.',
      });
      toast.success('Transacao vinculada e conciliada com item existente.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao vincular item financeiro existente.'));
    }
  };

  const openSplitDialog = (tx: BankTransactionWithConciliation) => {
    setSplitDialogTx(tx);
    setSplitItems([buildSplitItem(tx)]);
  };

  const addSplitItem = () => {
    if (!splitDialogTx) return;
    setSplitItems((prev) => [
      ...prev,
      {
        ...buildSplitItem(splitDialogTx),
        id: `split-${Date.now()}-${prev.length + 1}`,
        valor: '0,00',
      },
    ]);
  };

  const updateSplitItem = (itemId: string, patch: Partial<SplitItemForm>) => {
    setSplitItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  };

  const removeSplitItem = (itemId: string) => {
    setSplitItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleSplitAndReconcile = async () => {
    if (!splitDialogTx || !empresaId) {
      toast.error('Dados insuficientes para aplicar split.');
      return;
    }

    if (splitItems.length === 0) {
      toast.error('Adicione ao menos um item no split.');
      return;
    }

    if (splitTotalCentavos !== splitDialogTx.valor_centavos) {
      toast.error(
        `A soma do split (${formatCurrency(splitTotalCentavos / 100)}) deve ser igual ao extrato (${formatCurrency(
          splitDialogTx.valor_centavos / 100
        )}).`
      );
      return;
    }

    try {
      await splitAndReconcileMutation.mutateAsync({
        empresa_id: empresaId,
        conta_bancaria_id: splitDialogTx.conta_bancaria_id,
        extrato_transacao_id: splitDialogTx.id,
        idempotency_key: `${splitDialogTx.id}:split:${splitItems
          .map((item) => `${item.tipo}-${parseMoneyToCentavos(item.valor)}-${item.data}`)
          .join('|')}`,
        items: splitItems.map((item) => ({
          tipo: item.tipo,
          valor_centavos: parseMoneyToCentavos(item.valor),
          data: item.data,
          historico: item.historico,
          descricao: item.historico,
          documento: item.documento || null,
          grupo_contas_id: item.grupo_contas_id || null,
          observacoes: item.observacoes || null,
          explanation: 'Split confirmado manualmente na tela de conciliacao bancaria.',
        })),
      });

      setSplitDialogTx(null);
      setSplitItems([]);
      toast.success('Split aplicado e conciliado com sucesso.');
      await refreshOperationalState();
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao aplicar split.'));
    }
  };

  const handleCreateRule = async () => {
    if (!ruleForm.pattern || !ruleForm.pattern.trim()) {
      toast.error('Informe o pattern da regra.');
      return;
    }

    try {
      await createRuleMutation.mutateAsync({
        ...ruleForm,
        conta_bancaria_id: selectedContaId || null,
      });

      setRuleForm((prev) => ({
        ...prev,
        pattern: '',
      }));

      toast.success('Regra criada com sucesso.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao criar regra.'));
    }
  };

  const handleToggleRuleActive = async (rule: ReconciliationRuleRow) => {
    try {
      await updateRuleMutation.mutateAsync({
        id: rule.id,
        data: {
          active: !rule.active,
        },
      });
      toast.success(`Regra ${!rule.active ? 'ativada' : 'desativada'} com sucesso.`);
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao atualizar regra.'));
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deleteRuleMutation.mutateAsync(ruleId);
      toast.success('Regra removida com sucesso.');
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Falha ao remover regra.'));
    }
  };

  const copilotProps: ReconciliationChatViewProps = {
    messages: chatMessages,
    onSendMessage: (text, options) => {
      void handleChatSendMessage(text, options);
    },
    empresaId: empresaId || null,
    contaId: selectedContaId || null,
    contaLabel: contas.find((c) => c.id === selectedContaId)?.descricao,
    contas,
    onContaChange: handleContaChange,
    importId: selectedImportId || null,
    dataReferencia: dailyReferenceDate || null,
    onDataReferenciaChange: (value) => {
      handleReferenceDateChange(value);
      setSelectedSuggestionIds([]);
      setPendingHistorySessionSelection(null);
    },
    parseStatus: selectedImportParseStatus,
    statusCounts,
    pendenciasCriticas: dailySummaryData?.pendencias_criticas_total ?? 0,
    onRunMatching: handleRunMatching,
    onTriggerAi: handleTriggerAiWorkflow,
    onRefreshDailySummary: refreshDailySummary,
    onConfirmAction: handleChatActionConfirm,
    canRunImportActions,
    importBlockMessage,
    matchPending: matchImportMutation.isPending,
    triggerPending: triggerAiWorkflowMutation.isPending,
    refreshSummaryPending: dailySummaryMutation.isPending,
    actionConfirmPending: chatActionPending,
    sendingMessage: chatSendingMessage,
    hasContaAndDate: !!(selectedContaId && dailyReferenceDate),
    frontendBuildId: FRONTEND_BUILD_ID,
    serverBuildId,
    buildMismatchDetected,
    composerValue: composerMessage,
    onComposerValueChange: setComposerMessage,
    onClearConversation: handleClearConversation,
    chatSessions: chatSessionsServer.length > 0 ? chatSessions : [],
    onSelectSession: chatSessionsServer.length > 0 ? handleSelectSession : undefined,
    onDeleteSession: chatSessionsServer.length > 0 ? (sessionId) => handleDeleteChatSession(sessionId) : undefined,
    activeRowContext: activeWorkspaceRow
      ? {
          descricao: activeWorkspaceRow.descricao,
          dataMovimento: activeWorkspaceRow.data_movimento,
          valorCentavos: activeWorkspaceRow.valor_centavos,
        }
      : null,
    mode: 'copilot',
  };

  return (
    <>
      <FinanceiroWorkspaceShell
        sidebar={
          chatEnabled ? (
            <ReconciliationChatView {...copilotProps} className="h-full min-h-0" />
          ) : undefined
        }
      >
            <div className="shrink-0 border-b border-border/70 px-4 py-4">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-lg font-semibold text-foreground">Conciliação bancária</h1>
                      {selectedImportRecord?.original_filename ? (
                        <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                          {String(selectedImportRecord.original_filename)}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <span>Conta</span>
                        <Select
                          value={selectedContaId || ''}
                          onValueChange={handleContaChange}
                        >
                          <SelectTrigger className="h-7 w-[220px] text-xs">
                            <SelectValue placeholder="Selecione a conta" />
                          </SelectTrigger>
                          <SelectContent>
                            {contas.map((conta) => (
                              <SelectItem key={conta.id} value={conta.id}>
                                {conta.descricao}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="flex items-center gap-1">
                        <span>Data ref.</span>
                        <Input
                          type="date"
                          value={dailyReferenceDate || ''}
                          onChange={(event) => handleReferenceDateChange(event.target.value)}
                          className="h-7 w-[150px] text-xs"
                        />
                      </div>
                      <span>Saldo {selectedImportSaldoCentavos == null ? '—' : formatCurrency(selectedImportSaldoCentavos / 100)}</span>
                      <span>Período {selectedImportPeriodo}</span>
                      <span>Pendências {workspacePendenciasTotal}</span>
                      <span>Status IA {workspaceAiStatusLabel}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {chatEnabled ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 xl:hidden"
                        onClick={() => setChatDrawerOpen(true)}
                      >
                        <MessageSquareText className="h-4 w-4" />
                        Copiloto
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleOpenHistoryDrawer}
                      disabled={!selectedContaId}
                    >
                      <History className="mr-1 h-4 w-4" />
                      Ver histórico
                    </Button>
                    {selectedImportId && canRunImportActions ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setConciliarConfirmOpen(true)}
                        disabled={!selectedContaId || chatActionPending}
                      >
                        Conciliar
                      </Button>
                    ) : null}
                  </div>
                </div>

                {duplicateNoticeVisible && duplicateSuspectInfo ? (
                  <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="font-medium">Possível duplicidade neste import.</p>
                        <p>
                          Mesmo arquivo e período já apareceram {duplicateSuspectInfo.duplicateCount} vez(es). Se for
                          realmente duplicado, trate uma das ocorrências como divergência (Ignorar com justificativa) e
                          mantenha apenas a outra conciliação ativa.
                        </p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        void handleAcknowledgeDuplicateNotice();
                      }}
                    >
                      Ok, entendi
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              <ConciliationWorkspaceBoard
                workspace={workspaceData}
                viewState={workspaceViewState}
                activeRowId={activeWorkspaceRowId}
                emptyTitle={workspaceEmptyTitle}
                emptyDescription={workspaceEmptyDescription}
                errorMessage={workspaceErrorMessage}
                actionPending={
                  chatActionPending ||
                  linkExistingMutation.isPending ||
                  ignoreExtratoMutation.isPending ||
                  rejectConciliationMutation.isPending ||
                  createAndReconcileMutation.isPending ||
                  editSaving
                }
                onRetry={() => {
                  void workspaceQuery.refetch();
                }}
                onSelectRow={(row) => {
                  setActiveWorkspaceRowId(row.extrato_transacao_id);
                }}
                onOpenSearch={handleOpenCandidateSearch}
                onOpenAdd={openCreateDialogFromWorkspaceRow}
                onOpenEdit={(row) => {
                  void handleOpenEditWorkspaceRow(row);
                }}
                onIgnore={(row) => {
                  void handleIgnoreWorkspaceRow(row);
                }}
                onUndo={(row) => {
                  void handleUndoWorkspaceRow(row);
                }}
                onQuickConciliate={(row) => {
                  void handleQuickConciliateWorkspaceRow(row);
                }}
              />
            </div>
      </FinanceiroWorkspaceShell>

      <Dialog open={conciliarConfirmOpen} onOpenChange={setConciliarConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Executar conciliação do dia</DialogTitle>
            <DialogDescription>
              Esta ação sincroniza o contexto e executa a conciliação para a data de referência selecionada.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p>
              Conta: <span className="font-medium">{headerContaLabel}</span>
            </p>
            <p>
              Período OFX: <span className="font-medium">{selectedImportPeriodo}</span>
            </p>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Data de referência usada na execução</p>
              <Input
                type="date"
                value={dailyReferenceDate || ''}
                onChange={(event) => handleReferenceDateChange(event.target.value)}
                className="h-9 w-[190px] text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Selecionada: <span className="font-medium text-foreground">{formatDate(dailyReferenceDate)}</span>
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Nesta fase, o fluxo altera apenas tags/divergências. Não cria lançamento nem altera saldo.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConciliarConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleConciliarViaTopCta()} disabled={chatActionPending}>
              Confirmar e executar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={historyDrawerOpen} onOpenChange={setHistoryDrawerOpen}>
        <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Histórico da conciliação</SheetTitle>
            <SheetDescription>
              Imports, conciliações aplicadas e decisões guiadas da conta selecionada.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            {historyLoading ? (
              <div className="text-sm text-muted-foreground">Carregando histórico...</div>
            ) : null}

            {!historyLoading && !historyData ? (
              <div className="text-sm text-muted-foreground">Nenhum histórico carregado.</div>
            ) : null}

            {historyData ? (
              <>
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Imports</h3>
                  {historyData.imports.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem registros de importação neste período.</p>
                  ) : (
                    <div className="space-y-1">
                      {historyData.imports.map((item) => (
                        <div key={item.id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                          <p className="font-medium text-foreground">{item.original_filename || item.id}</p>
                          <p className="text-muted-foreground">
                            {formatDate(item.periodo_inicio || null)} - {formatDate(item.periodo_fim || null)} ·{' '}
                            {item.parse_status}
                            {item.file_format ? ` · ${String(item.file_format).toUpperCase()}` : ''}
                          </p>
                          <p className="text-muted-foreground">
                            {formatDate(item.created_at)}
                            {item.duplicate_suspect ? ' · possível duplicidade' : ''}
                          </p>
                          {String(item.file_format || '').toLowerCase() === 'csv' ? (
                            <p className="mt-1 text-amber-700">
                              CSV legado (somente leitura, fora da conciliação por chat).
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Conciliações aplicadas</h3>
                  {historyData.conciliacoes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem conciliações no período selecionado.</p>
                  ) : (
                    <div className="space-y-1">
                      {historyData.conciliacoes.map((item) => (
                        <div key={item.id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-foreground">
                                {conciliationHistoryStatusLabel[item.status] || item.status} ·{' '}
                                {conciliationHistoryMethodLabel[item.method] || item.method}
                              </p>
                              <p className="text-muted-foreground">Extrato: {item.extrato_transacao_id}</p>
                              <p className="text-muted-foreground">
                                Item: {item.item_financeiro_id || '—'} · {formatDate(item.confirmed_at || item.created_at)}
                              </p>
                              {item.explanation ? (
                                <p className="text-muted-foreground">{item.explanation}</p>
                              ) : null}
                            </div>
                            {(item.status === 'confirmed' || item.status === 'rejected') ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() =>
                                  void handleUndoHistoryConciliation({
                                    conciliacaoId: item.id,
                                    status: item.status,
                                  })
                                }
                              >
                                Desfazer
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Decisões guiadas</h3>
                  {historyData.guided_decisions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Sem decisões guiadas registradas.</p>
                  ) : (
                    <div className="space-y-1">
                      {historyData.guided_decisions.map((item) => (
                        <div key={item.id} className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs">
                          <p className="font-medium text-foreground">
                            {guidedDecisionLabel[item.decision] || item.decision}
                            {item.reversed_at ? ' · desfeito' : ''}
                          </p>
                          <p className="text-muted-foreground">Extrato: {item.extrato_transacao_id}</p>
                          <p className="text-muted-foreground">
                            Item: {item.item_financeiro_id || '—'} · {formatDate(item.created_at)}
                          </p>
                          {item.justification ? (
                            <p className="text-muted-foreground">{item.justification}</p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {historyCursor ? (
                  <div className="pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs"
                      disabled={historyLoadingMore}
                      onClick={() => {
                        void loadConciliationHistory({ cursor: historyCursor, append: true });
                      }}
                    >
                      {historyLoadingMore ? 'Carregando...' : 'Carregar mais'}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={chatDrawerOpen} onOpenChange={setChatDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full p-0 sm:max-w-[380px]"
          title="Copiloto da conciliação"
          description="Resumo operacional, dúvidas e exceções do contexto selecionado."
        >
          <ReconciliationChatView {...copilotProps} className="h-full min-h-0" />
        </SheetContent>
      </Sheet>

      <ConciliationCandidateSearchDialog
        open={candidateSearchOpen}
        row={candidateSearchRow}
        searchValue={candidateSearchTerm}
        results={candidateSearchResults}
        loading={candidateSearchLoading}
        onOpenChange={(open) => {
          setCandidateSearchOpen(open);
          if (!open) {
            setCandidateSearchRow(null);
            setCandidateSearchResults([]);
          }
        }}
        onSearchValueChange={setCandidateSearchTerm}
        onSearch={() => {
          if (candidateSearchRow) {
            void loadCandidateSearch(candidateSearchRow);
          }
        }}
        onSelectCandidate={(candidate) => {
          void handleSelectSearchCandidate(candidate);
        }}
      />

      <Dialog open={!!editDialogState} onOpenChange={(open) => !open && setEditDialogState(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar lançamento vinculado</DialogTitle>
            <DialogDescription>
              Ajuste o lançamento de caixa sem sair do workspace da conciliação.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={editForm.tipo}
                  onValueChange={(value) => {
                    if (value === 'entrada' || value === 'saida') {
                      setEditForm((prev) => ({ ...prev, tipo: value }));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entrada">Entrada</SelectItem>
                    <SelectItem value="saida">Saída</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={editForm.data}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, data: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Valor</Label>
                <Input
                  value={editForm.valor}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, valor: event.target.value }))}
                />
              </div>

              <div className="space-y-2">
                <Label>Documento</Label>
                <Input
                  value={editForm.documento}
                  onChange={(event) => setEditForm((prev) => ({ ...prev, documento: event.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Histórico</Label>
              <Input
                value={editForm.historico}
                onChange={(event) => setEditForm((prev) => ({ ...prev, historico: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Grupo de contas</Label>
              <Select
                value={editForm.grupo_contas_id || '__none__'}
                onValueChange={(value) =>
                  setEditForm((prev) => ({
                    ...prev,
                    grupo_contas_id: value === '__none__' ? '' : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem grupo</SelectItem>
                  {gruposContas
                    .filter((grupo) => grupo.natureza === editForm.tipo)
                    .map((grupo) => (
                      <SelectItem key={`edit-${grupo.id}`} value={grupo.id}>
                        {grupo.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              Código do lançamento: <span className="font-medium text-foreground">{editDialogState?.lancamento_caixa_id || '—'}</span>
              {editDialogState?.item_financeiro_id ? (
                <>
                  {' '}· Código de conciliação:{' '}
                  <span className="font-medium text-foreground">{editDialogState.item_financeiro_id}</span>
                </>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogState(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSaveWorkspaceEdit()} disabled={editSaving}>
              Salvar alterações
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!createDialogTx}
        onOpenChange={(open) => {
          if (!open) {
            setCreateDialogTx(null);
            setCreateDialogAiSuggestionId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar Lancamento e Conciliar</DialogTitle>
            <DialogDescription>
              Cria um lancamento de caixa e confirma conciliacao na mesma transacao (RPC idempotente).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Tipo</Label>
                <Select
                  value={createForm.tipo}
                  onValueChange={(value) => {
                    if (value === 'entrada' || value === 'saida') {
                      setCreateForm((prev) => ({ ...prev, tipo: value }));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="entrada">Entrada</SelectItem>
                    <SelectItem value="saida">Saida</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Data</Label>
                <Input
                  type="date"
                  value={createForm.data}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, data: event.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Historico</Label>
              <Input
                value={createForm.historico}
                onChange={(event) => setCreateForm((prev) => ({ ...prev, historico: event.target.value }))}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Valor</Label>
                <Input
                  value={createForm.valor}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, valor: event.target.value }))}
                  placeholder="0,00"
                />
              </div>

              <div className="space-y-2">
                <Label>Documento</Label>
                <Input
                  value={createForm.documento}
                  onChange={(event) => setCreateForm((prev) => ({ ...prev, documento: event.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Grupo de Contas</Label>
              <Select
                value={createForm.grupo_contas_id || '__none__'}
                onValueChange={(value) =>
                  setCreateForm((prev) => ({
                    ...prev,
                    grupo_contas_id: value === '__none__' ? '' : value,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Opcional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sem grupo</SelectItem>
                  {gruposContas
                    .filter((grupo) => grupo.natureza === createForm.tipo)
                    .map((grupo) => (
                      <SelectItem key={grupo.id} value={grupo.id}>
                        {grupo.nome}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogTx(null);
                setCreateDialogAiSuggestionId(null);
              }}
            >
              Cancelar
            </Button>
            <Button onClick={handleCreateAndReconcile} disabled={createAndReconcileMutation.isPending}>
              Salvar e Conciliar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!splitDialogTx} onOpenChange={(open) => !open && setSplitDialogTx(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Split de Conciliacao</DialogTitle>
            <DialogDescription>
              Divida 1 transacao de extrato em N lancamentos. A soma dos itens deve fechar exatamente em centavos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-md border p-3 text-sm">
              <div>Valor do extrato: {formatCurrency((splitDialogTx?.valor_centavos || 0) / 100)}</div>
              <div>Soma atual do split: {formatCurrency(splitTotalCentavos / 100)}</div>
              <div>
                Diferenca: {formatCurrency(((splitDialogTx?.valor_centavos || 0) - splitTotalCentavos) / 100)}
              </div>
            </div>

            {splitItems.map((item, index) => (
              <div key={item.id} className="space-y-3 rounded-md border p-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">Item {index + 1}</div>
                  {splitItems.length > 1 && (
                    <Button size="sm" variant="outline" onClick={() => removeSplitItem(item.id)}>
                      Remover
                    </Button>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Tipo</Label>
                    <Select
                      value={item.tipo}
                      onValueChange={(value) =>
                        updateSplitItem(item.id, {
                          tipo: value as 'entrada' | 'saida',
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="entrada">Entrada</SelectItem>
                        <SelectItem value="saida">Saida</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Data</Label>
                    <Input
                      type="date"
                      value={item.data}
                      onChange={(event) => updateSplitItem(item.id, { data: event.target.value })}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Valor</Label>
                    <Input
                      value={item.valor}
                      placeholder="0,00"
                      onChange={(event) => updateSplitItem(item.id, { valor: event.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Documento</Label>
                    <Input
                      value={item.documento}
                      onChange={(event) => updateSplitItem(item.id, { documento: event.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Historico</Label>
                  <Input
                    value={item.historico}
                    onChange={(event) => updateSplitItem(item.id, { historico: event.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Grupo de Contas</Label>
                  <Select
                    value={item.grupo_contas_id || '__none__'}
                    onValueChange={(value) =>
                      updateSplitItem(item.id, {
                        grupo_contas_id: value === '__none__' ? '' : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Opcional" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem grupo</SelectItem>
                      {gruposContas
                        .filter((grupo) => grupo.natureza === item.tipo)
                        .map((grupo) => (
                          <SelectItem key={`${item.id}-${grupo.id}`} value={grupo.id}>
                            {grupo.nome}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" onClick={addSplitItem}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Item
            </Button>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitDialogTx(null)}>
              Cancelar
            </Button>
            <Button onClick={handleSplitAndReconcile} disabled={splitAndReconcileMutation.isPending}>
              Salvar Split e Conciliar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
