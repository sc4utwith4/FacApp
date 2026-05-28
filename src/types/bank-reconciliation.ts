export type BankTransactionType = 'credit' | 'debit' | 'other';

export type BankImportParseStatus =
  | 'received'
  | 'processing'
  | 'parsed'
  | 'failed'
  | 'duplicate';

export type BankReconciliationStatus = 'suggested' | 'confirmed' | 'rejected';
export type ConciliacaoItemStatus = 'nao_conciliado' | 'parcial' | 'verificado' | 'divergente';
export type ConciliacaoItemOrigem = 'lancamento_caixa' | 'movimentacao_estoque';

export interface ExtratoTransacaoRow {
  id: string;
  empresa_id: string;
  extrato_import_id: string;
  conta_bancaria_id: string;
  fit_id: string | null;
  hash_fallback: string;
  line_number: number;
  dedupe_ordinal: number;
  data_movimento: string;
  data_compensacao: string | null;
  descricao_raw: string;
  descricao_norm: string;
  valor_centavos: number;
  tipo: BankTransactionType;
  documento_ref: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MatchingLancamentoCandidate {
  id: string;
  data: string;
  tipo: 'entrada' | 'saida';
  valor: number;
  historico: string | null;
  documento: string | null;
  conta_bancaria_id: string;
  item_financeiro_id?: string | null;
  origem_tipo?: ConciliacaoItemOrigem;
  origem_id_uuid?: string | null;
  origem_id_bigint?: number | null;
}

export interface MatchScoreDetail {
  amount_score: number;
  date_score: number;
  text_score: number;
  final_score: number;
}

export interface MatchingSuggestion {
  extrato_transacao_id: string;
  lancamento_caixa_id: string;
  confidence: number;
  method: 'deterministic';
  explanation: string;
  score: MatchScoreDetail;
}

export interface ParsedBankStatementTransactionInput {
  data_movimento: string;
  data_compensacao: string | null;
  descricao_raw: string;
  descricao_norm: string;
  valor_centavos: number;
  tipo: BankTransactionType;
  documento_ref: string | null;
  fit_id: string | null;
  metadata: Record<string, unknown>;
}

export interface ParsedBankStatementTransaction extends ParsedBankStatementTransactionInput {
  line_number: number;
  dedupe_ordinal: number;
  hash_fallback: string;
}

export interface ParsedBankStatementResult {
  source: 'bradesco' | 'itau' | 'ofx_generic';
  format: 'csv' | 'ofx';
  transactions: ParsedBankStatementTransaction[];
  periodo_inicio: string | null;
  periodo_fim: string | null;
  warnings: string[];
  errors: string[];
}

export type ParsedBradescoCsvResult = ParsedBankStatementResult & {
  source: 'bradesco';
  format: 'csv';
};

export type ParsedOfxResult = ParsedBankStatementResult & {
  source: 'ofx_generic';
  format: 'ofx';
};

export interface AiSuggestionPendingItem {
  extrato_tx: {
    id: string;
    data: string;
    tipo: BankTransactionType;
    valor_centavos: number;
    descricao_raw: string;
    descricao_norm: string;
  };
  conta_bancaria: {
    id: string;
    nome: string;
  };
  candidatos_lancamentos: Array<{
    id: string;
    item_financeiro_id?: string;
    lancamento_caixa_id?: string | null;
    data: string;
    tipo: 'entrada' | 'saida';
    valor_centavos: number;
    descricao: string;
  }>;
}

export interface AiSuggestionCreatePayload {
  extrato_transacao_id: string;
  action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
  confidence?: number;
  match?: {
    item_financeiro_id?: string | null;
    lancamento_caixa_id: string | null;
  };
  create?: {
    tipo?: 'entrada' | 'saida';
    valor_centavos?: number;
    data?: string;
    descricao?: string;
    categoria_id?: string | null;
    centro_custo_id?: string | null;
    observacao?: string | null;
    [key: string]: unknown;
  } | null;
  explanation?: string;
  warnings?: string[];
}

export interface AiIntegrationPendingRequest {
  empresa_id: string;
  conta_bancaria_id: string;
  import_id?: string;
  limit?: number;
}

export interface AiIntegrationSuggestRequest {
  empresa_id: string;
  conta_bancaria_id: string;
  extrato_import_id?: string;
  correlation_id?: string;
  suggestions: AiSuggestionCreatePayload[];
}

export interface AiIntegrationTriggerRequest {
  empresa_id?: string;
  conta_bancaria_id?: string;
  extrato_import_id?: string;
  import_id?: string;
  correlation_id?: string;
  source?: string;
  reason?: string | null;
  triggered_at?: string;
}

export type BankAiExecutionRunStatus =
  | 'triggered'
  | 'processing'
  | 'completed'
  | 'no_pending'
  | 'failed'
  | 'timeout';

export interface BankAiExecutionRunRow {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  extrato_import_id: string;
  correlation_id: string;
  trigger_source: string;
  status: BankAiExecutionRunStatus;
  sugestoes_total: number;
  match_existing_count: number;
  create_new_count: number;
  ignore_count: number;
  needs_review_count: number;
  error_message?: string | null;
  metadata?: Record<string, unknown> | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface AiExecutionStatusCallbackRequest {
  empresa_id: string;
  conta_bancaria_id: string;
  extrato_import_id: string;
  correlation_id: string;
  status: Extract<BankAiExecutionRunStatus, 'processing' | 'completed' | 'no_pending' | 'failed'>;
  counts?: {
    sugestoes_total?: number;
    match_existing_count?: number;
    create_new_count?: number;
    ignore_count?: number;
    needs_review_count?: number;
  };
  error_message?: string | null;
  metadata?: Record<string, unknown>;
}

export type AiSuggestionReviewAction = 'approved' | 'rejected' | 'applied';

export interface AiSuggestionReviewRequest {
  suggestion_id: string;
  status: AiSuggestionReviewAction;
  explanation?: string;
}

export type RuleMatchType = 'contains' | 'startswith' | 'regex' | 'exact';
export type RuleDirection = 'credit' | 'debit' | 'both';

export interface ReconciliationRuleRow {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string | null;
  match_type: RuleMatchType;
  pattern: string;
  direction: RuleDirection;
  default_grupo_contas_id: string | null;
  default_centro_custo: string | null;
  auto_create: boolean;
  auto_confirm: boolean;
  active: boolean;
  priority: number;
  created_at: string;
  updated_at: string;
}

export interface CreateReconciliationRuleRequest {
  conta_bancaria_id?: string | null;
  match_type: RuleMatchType;
  pattern: string;
  direction: RuleDirection;
  auto_create: boolean;
  auto_confirm: boolean;
  default_grupo_contas_id?: string | null;
  default_centro_custo?: string | null;
  active?: boolean;
  priority?: number;
}

export interface UpdateReconciliationRuleRequest {
  id?: string;
  conta_bancaria_id?: string | null;
  match_type?: RuleMatchType;
  pattern?: string;
  direction?: RuleDirection;
  auto_create?: boolean;
  auto_confirm?: boolean;
  default_grupo_contas_id?: string | null;
  default_centro_custo?: string | null;
  active?: boolean;
  priority?: number;
}

export interface BankMatchRequest {
  import_id: string;
  auto_confirm?: boolean;
}

export interface BankCreateReconcileRequest {
  conta_bancaria_id: string;
  extrato_transacao_id: string;
  idempotency_key: string;
  tipo: 'entrada' | 'saida';
  valor: number;
  valor_centavos?: number;
  data: string;
  historico?: string;
  descricao?: string;
  documento?: string | null;
  observacoes?: string | null;
  grupo_contas_id?: string | null;
  method?: 'manual' | 'deterministic' | 'rule' | 'ai';
  explanation?: string | null;
}

export interface BankConfirmRequest {
  conciliacao_id: string;
  explanation?: string | null;
}

export interface BankRejectRequest {
  conciliacao_id: string;
  explanation?: string;
}

export interface SplitReconciliationItem {
  tipo: 'entrada' | 'saida';
  valor_centavos?: number;
  valor?: number;
  data?: string;
  historico?: string;
  descricao?: string;
  documento?: string | null;
  grupo_contas_id?: string | null;
  observacoes?: string | null;
  explanation?: string | null;
}

export interface SplitReconciliationRequest {
  conta_bancaria_id: string;
  extrato_transacao_id: string;
  idempotency_key: string;
  items: SplitReconciliationItem[];
}

export interface ConciliacaoItemFinanceiro {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  data: string;
  tipo: 'entrada' | 'saida';
  valor_centavos: number;
  origem_tipo: ConciliacaoItemOrigem;
  origem_id_uuid: string | null;
  origem_id_bigint: number | null;
  origem_key: string;
  descricao_exibicao: string | null;
  documento: string | null;
  metadata: Record<string, unknown>;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConciliacaoItemStatusRow extends ConciliacaoItemFinanceiro {
  confirmado_centavos: number;
  status_verificacao: ConciliacaoItemStatus;
}

export interface DailyReconciliationSummary {
  empresa_id: string;
  conta_bancaria_id: string;
  data_referencia: string;
  total_itens: number;
  itens_verificados: number;
  itens_parciais: number;
  itens_nao_conciliados: number;
  itens_divergentes: number;
  item_pendencias_criticas: number;
  total_extrato_transacoes: number;
  extrato_pendencias_criticas: number;
  pendencias_criticas_total: number;
}

export interface DailyCloseRequest {
  conta_bancaria_id: string;
  data_referencia: string;
  observacoes?: string | null;
}

export interface DailyCloseResponse {
  ok: boolean;
  empresa_id: string;
  conta_bancaria_id: string;
  data_referencia: string;
  status: 'closed';
  summary: DailyReconciliationSummary;
}

export interface DailyReopenRequest {
  conta_bancaria_id: string;
  data_referencia: string;
  observacoes?: string | null;
}

export interface DailyReopenResponse {
  ok: boolean;
  empresa_id: string;
  conta_bancaria_id: string;
  data_referencia: string;
  status: 'reopened';
  summary: DailyReconciliationSummary;
}

export interface LinkExistingReconciliationRequest {
  extrato_transacao_id: string;
  item_financeiro_id: string;
  idempotency_key?: string;
  valor_alocado_centavos?: number;
  method?: 'manual' | 'deterministic' | 'rule' | 'ai';
  confidence?: number;
  explanation?: string;
}

export interface IgnoreExtratoRequest {
  extrato_transacao_id: string;
  justificativa: string;
}

export interface UnignoreExtratoRequest {
  conciliacao_id: string;
  justificativa_undo?: string | null;
}

export interface ImportNoticeAckRequest {
  extrato_import_id: string;
  notice_type: 'duplicate_suspect';
}

export interface AiPendingCandidate {
  id: string;
  item_financeiro_id: string;
  lancamento_caixa_id: string | null;
  data: string;
  tipo: 'entrada' | 'saida';
  valor_centavos: number;
  descricao: string;
}

/** Fechamento diário (conciliacao_fechamentos_diarios) para sidebar de histórico */
export interface DailyClosingRow {
  id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  data_referencia: string;
  status: string;
  created_at?: string;
  updated_at?: string;
}

/** Item de conta na sidebar por data */
export interface ReconciliationHistoryAccountItem {
  conta_bancaria_id: string;
  descricao: string;
}

/** Dia agrupado na sidebar (data + contas) */
export interface ReconciliationHistoryDay {
  dataReferencia: string;
  label: string;
  accounts: ReconciliationHistoryAccountItem[];
}

/** Mensagem do chat de conciliação (com contexto e metadata opcionais) */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
  context?: {
    contaId?: string;
    dataReferencia?: string;
    importId?: string;
    activeExtratoTransacaoId?: string;
  };
  metadata?: {
    actionType?:
      | 'matching'
      | 'trigger_ai'
      | 'refresh_summary'
      | 'run_daily_reconciliation'
      | 'apply_reconciliation_plan'
      | 'daily_close'
      | 'daily_reopen'
      | 'summary'
      | 'question';
    resultData?: unknown;
    action_preview?: ChatActionPreviewPayload | null;
    reconciliation_plan?: ChatReconciliationPlan | null;
    clarifying_questions?: ChatClarifyingQuestion[] | null;
    pending_cases?: ChatPendingCase[] | null;
    execution_summary?: ChatActionExecutionSummary | null;
    affected_counts?: Record<string, number> | null;
    pending_action_state?: ChatPendingActionState | null;
    ai_processing_status?: ChatAiProcessingStatus | null;
    ai_polling?: {
      attempts: number;
      elapsed_ms: number;
      outcome: 'completed' | 'timeout' | 'no_pending' | 'failed';
    } | null;
    correlation_id?: string | null;
    last_execution_summary?: ChatLastExecutionSummary | null;
    suggested_next_actions?: ChatSuggestedNextAction[] | null;
    ui_show_operational_cards?: boolean;
    ui_show_plan_card?: boolean;
    ui_show_guided_card?: boolean;
    suggested_intent?: ChatAgentSuggestedIntent | null;
    suggested_parameters?: Record<string, unknown> | null;
    review_guidance?: ChatReviewGuidance | null;
  };
  /** Conteúdo rico (tabela, gráfico, resumo, lista) */
  richContent?: RichMessageContent;
}

/** Conteúdo rico em mensagem (tabela, gráfico, resumo, lista) */
export interface RichMessageContent {
  type: 'text' | 'table' | 'chart' | 'summary' | 'list';
  data: unknown;
  metadata?: Record<string, unknown>;
}

/** Mensagem com conteúdo rico (alias; richContent já está em ChatMessage) */
export interface ChatMessageRich extends ChatMessage {}

/** Sessão de chat persistida (localStorage) */
export interface ChatSession {
  id: string;
  empresaId: string;
  contaId?: string;
  dataReferencia?: string;
  importId?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export type ChatActionKind =
  // Legado compatível: roteado para run_daily_reconciliation no backend.
  | 'matching'
  // Legado compatível: roteado para run_daily_reconciliation no backend.
  | 'trigger_ai'
  | 'refresh_summary'
  | 'run_daily_reconciliation'
  | 'apply_reconciliation_plan'
  | 'daily_close'
  | 'daily_reopen';

export interface ChatPendingActionState {
  step: 'preview' | 'text_confirmation';
  action: ChatActionKind;
  expires_at?: string;
}

export interface ChatAiProcessingStatus {
  state: BankAiExecutionRunStatus | 'polling' | 'agent_processing';
  attempts?: number;
  elapsed_ms?: number;
  outcome?: 'completed' | 'timeout' | 'no_pending' | 'failed';
  message?: string;
  correlation_id?: string;
  execution_run_id?: string;
  last_updated_at?: string;
  counts?: {
    sugestoes_total?: number;
    match_existing_count?: number;
    create_new_count?: number;
    ignore_count?: number;
    needs_review_count?: number;
  };
}

export interface ChatLastExecutionSummary {
  action: ChatActionKind;
  executed_at?: string;
  status: 'ok' | 'warning' | 'error' | 'processing';
  summary?: string;
  correlation_id?: string;
  execution_status_snapshot_at?: string;
  stale_reason?: string;
  ai_processing_status?: ChatAiProcessingStatus | null;
  affected_counts?: Record<string, number> | null;
}

export interface ChatSuggestedNextAction {
  action:
    | 'apply_reconciliation_plan'
    | 'run_daily_reconciliation'
    | 'trigger_ai'
    | 'refresh_summary'
    | 'resolve_pending_issues'
    | 'update_plan_status'
    | 'import_ofx'
    | 'question';
  label: string;
  reason?: string;
}

export type ChatReviewDecision =
  | 'approve_ignore'
  | 'approve_match'
  | 'keep_pending'
  | 'open_manual_review'
  | 'phase2_blocked';

export type ChatReviewAnswerDecision = Exclude<ChatReviewDecision, 'phase2_blocked'>;

export interface ChatReviewQuickAction {
  decision: ChatReviewDecision;
  label: string;
  requires_justification?: boolean;
  requires_item_financeiro_id?: boolean;
}

export interface ChatReviewQueueItem {
  case_id: string;
  suggestion_id?: string | null;
  extrato_transacao_id: string;
  action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
  question: string;
  rationale?: string | null;
  confidence?: number | null;
  confidence_band?: ChatPlanConfidenceBand;
  descricao?: string;
  data_movimento?: string;
  valor_centavos?: number | null;
  suggested_item_financeiro_id?: string | null;
}

export interface ChatReviewBatchOffer {
  strategy: 'strict_date_value';
  apply_safe_matches: boolean;
  apply_auto_divergence: boolean;
  safe_match_count: number;
  auto_divergence_count: number;
  exceptions_count: number;
  total_candidate_count: number;
  cta_label?: string;
  summary?: string | null;
  global_justification_suggestion?: string | null;
}

export interface ChatReviewGuidance {
  queue_total: number;
  queue_total_active?: number;
  queue_remaining: number;
  queue_phase?: 'pre_batch' | 'guided_1x1' | 'completed';
  display_mode?: 'guided_active' | 'guided_completed' | 'compact_status';
  safe_match_count?: number;
  auto_divergence_count?: number;
  exceptions_count?: number;
  batch_offer?: ChatReviewBatchOffer | null;
  final_summary?: {
    total: number;
    resolved: number;
    unresolved: number;
    manual_review_count?: number;
  } | null;
  can_undo_last?: boolean;
  last_decision?: {
    decision: 'approve_match' | 'approve_ignore';
    applied_at: string;
    reversible: boolean;
  } | null;
  current_position?: number | null;
  current_case?: ChatReviewQueueItem | null;
  next_actions?: ChatReviewQuickAction[];
  create_new_summary?: {
    total: number;
    valor_total_centavos: number;
    top_items: Array<{
      suggestion_id?: string | null;
      descricao: string;
      valor_centavos: number;
      confidence?: number | null;
    }>;
  } | null;
}

export interface ChatReviewAnswerInteraction {
  kind: 'review_answer';
  case_id: string;
  decision: ChatReviewAnswerDecision;
  justification?: string | null;
  item_financeiro_id?: string | null;
}

export interface ChatReviewBatchConfirmInteraction {
  kind: 'review_batch_confirm';
  strategy: 'strict_date_value';
  apply_safe_matches: boolean;
  apply_auto_divergence: boolean;
  global_justification?: string | null;
}

export interface ChatReviewNextInteraction {
  kind: 'review_next';
}

export interface ChatReviewUndoLastInteraction {
  kind: 'review_undo_last';
  justification?: string | null;
}

export type ChatMessageInteraction =
  | ChatReviewAnswerInteraction
  | ChatReviewBatchConfirmInteraction
  | ChatReviewNextInteraction
  | ChatReviewUndoLastInteraction;

export interface ConciliationHistoryImportEntry {
  id: string;
  conta_bancaria_id: string;
  parse_status: string;
  file_format?: string | null;
  original_filename?: string | null;
  periodo_inicio?: string | null;
  periodo_fim?: string | null;
  created_at: string;
  duplicate_suspect?: boolean;
}

export interface ConciliationHistoryReconciliationEntry {
  id: string;
  extrato_transacao_id: string;
  status: 'suggested' | 'confirmed' | 'rejected';
  method: 'manual' | 'deterministic' | 'rule' | 'ai';
  explanation?: string | null;
  item_financeiro_id?: string | null;
  lancamento_caixa_id?: string | null;
  confirmed_at?: string | null;
  created_at?: string | null;
}

export interface ConciliationHistoryDecisionEntry {
  id: string;
  session_id: string;
  case_id?: string | null;
  suggestion_id?: string | null;
  extrato_transacao_id: string;
  decision: 'approve_match' | 'approve_ignore' | 'keep_pending' | 'open_manual_review';
  justification?: string | null;
  conciliacao_id?: string | null;
  item_financeiro_id?: string | null;
  reversible: boolean;
  reversed_at?: string | null;
  created_at: string;
}

export interface ConciliationHistoryResponse {
  imports: ConciliationHistoryImportEntry[];
  conciliacoes: ConciliationHistoryReconciliationEntry[];
  guided_decisions: ConciliationHistoryDecisionEntry[];
  next_cursor?: string | null;
}

export type ConciliationWorkspaceRowState =
  | 'conciliado'
  | 'pendente'
  | 'divergente'
  | 'em_revisao'
  | 'ignorado';

export type ConciliationWorkspaceRowAction =
  | 'conciliar'
  | 'ignorar'
  | 'buscar'
  | 'adicionar'
  | 'editar'
  | 'desfazer';

export interface ConciliationCandidateSearchResult {
  item_financeiro_id: string;
  lancamento_caixa_id?: string | null;
  origem_tipo?: ConciliacaoItemOrigem | null;
  data: string;
  tipo: 'entrada' | 'saida';
  valor_centavos: number;
  descricao: string;
  documento?: string | null;
  score: number;
  exact_amount_match: boolean;
  exact_date_match: boolean;
  exact_direction_match: boolean;
  strict_value_date_direction_match: boolean;
}

export interface ConciliationWorkspaceRow {
  extrato_transacao_id: string;
  extrato_import_id: string;
  line_number: number;
  data_movimento: string;
  descricao: string;
  documento_ref?: string | null;
  valor_centavos: number;
  tipo: BankTransactionType;
  state: ConciliationWorkspaceRowState;
  group_key: string;
  group_label: string;
  actions_allowed: ConciliationWorkspaceRowAction[];
  candidate_count: number;
  safe_auto_match: boolean;
  conciliation?: {
    id: string;
    status: BankReconciliationStatus;
    method: 'manual' | 'deterministic' | 'rule' | 'ai';
    explanation?: string | null;
    item_financeiro_id?: string | null;
    lancamento_caixa_id?: string | null;
    confirmed_at?: string | null;
    created_at?: string | null;
  } | null;
  ai_suggestion?: {
    id: string;
    action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
    status: 'suggested' | 'approved' | 'rejected' | 'applied';
    confidence?: number | null;
    explanation?: string | null;
    item_financeiro_id?: string | null;
    lancamento_caixa_id?: string | null;
  } | null;
  suggested_candidate?: ConciliationCandidateSearchResult | null;
}

export interface ConciliationWorkspaceGroup {
  id: string;
  label: string;
  state: ConciliationWorkspaceRowState;
  total: number;
  row_ids: string[];
}

export interface ConciliationWorkspaceResponse {
  summary: {
    conta_bancaria_id: string;
    conta_label: string | null;
    import_id: string;
    presentation_mode: 'pre_conciliation' | 'post_conciliation';
    import_parse_status: string | null;
    import_file_format?: string | null;
    original_filename?: string | null;
    periodo_inicio?: string | null;
    periodo_fim?: string | null;
    saldo_final_centavos?: number | null;
    duplicate_suspect?: boolean;
    ai_status?: string | null;
    manual_creation_allowed: boolean;
    total_rows?: number;
  };
  counters: {
    pendente: number;
    em_revisao: number;
    conciliado: number;
    divergente: number;
    ignorado: number;
    safe_match: number;
    sem_vinculo: number;
  };
  groups: ConciliationWorkspaceGroup[];
  rows: ConciliationWorkspaceRow[];
  default_row_id?: string | null;
}

export interface ChatActionPreviewPayload {
  action: ChatActionKind;
  requires_confirmation: boolean;
  title?: string;
  idempotency_key: string;
  plan_id?: string | null;
  context: {
    conta_bancaria_id: string;
    data_referencia: string;
    import_id?: string | null;
  };
}

export type ChatPlanSelectionMode = 'all' | 'include_only' | 'exclude_some';

export interface BankReconciliationChatSessionRow {
  id: string;
  empresa_id: string;
  user_id: string;
  conta_bancaria_id: string | null;
  data_referencia: string | null;
  session_key: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  archived_at?: string | null;
  archived_by?: string | null;
  archived_reason?: string | null;
}

export interface ChatSessionListItem {
  id: string;
  contaId?: string;
  contaLabel?: string;
  dataReferencia?: string;
  importId?: string | null;
  title?: string | null;
  updatedAt?: string;
  archivedAt?: string | null;
}

export interface ChatHistoryGroup {
  date: string;
  items: ChatSessionListItem[];
}

export interface BankReconciliationChatStoredMessage {
  id: string;
  session_id: string;
  empresa_id: string;
  role: 'user' | 'assistant';
  content: string;
  rich_content: RichMessageContent | null;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ChatWebhookCallbackPayload {
  assistant_message?: string;
  session_id?: string;
  empresa_id?: string;
  conta_bancaria_id?: string;
  data_referencia?: string;
  import_id?: string | null;
  extrato_import_id?: string | null;
  role?: 'assistant' | 'user' | string;
  content?: string;
  rich_content?: RichMessageContent | null;
  metadata?: Record<string, unknown> | string;
  suggested_intent?: ChatAgentSuggestedIntent | string | null;
  suggested_parameters?: Record<string, unknown> | null;
  action_preview?: ChatActionPreviewPayload | Record<string, unknown> | null;
  execution_summary?: ChatActionExecutionSummary | Record<string, unknown> | null;
  last_execution_summary?: ChatLastExecutionSummary | Record<string, unknown> | null;
  ai_processing_status?: ChatAiProcessingStatus | Record<string, unknown> | null;
  reconciliation_plan?: ChatReconciliationPlan | Record<string, unknown> | null;
  clarifying_questions?: ChatClarifyingQuestion[] | null;
  pending_cases?: ChatPendingCase[] | null;
  suggested_next_actions?: ChatSuggestedNextAction[] | null;
  review_guidance?: ChatReviewGuidance | Record<string, unknown> | null;
  correlation_id?: string | null;
}

export type ChatAgentToolAction =
  | 'fetch_state'
  | 'prepare_run_daily'
  | 'prepare_apply_plan'
  | 'refresh_plan';

export type ChatAgentSuggestedIntent =
  | ChatActionKind
  | 'resolve_pending_issues'
  | 'update_plan_status'
  | 'execution_status_query'
  | 'execution_details_query'
  | 'question';

export interface ChatAgentToolRequest {
  empresa_id: string;
  conta_bancaria_id: string;
  data_referencia: string;
  import_id?: string | null;
  session_id?: string | null;
  user_id?: string | null;
  message?: string | null;
}

export interface ChatAgentToolResponse {
  ok: boolean;
  data: {
    action: ChatAgentToolAction;
    context_snapshot: BankReconciliationChatMessageResponse['data']['context_snapshot'];
    reconciliation_plan?: ChatReconciliationPlan | null;
    clarifying_questions?: ChatClarifyingQuestion[] | null;
    pending_cases?: ChatPendingCase[] | null;
    ai_processing_status?: ChatAiProcessingStatus | null;
    last_execution_summary?: ChatLastExecutionSummary | null;
    suggested_next_actions?: ChatSuggestedNextAction[] | null;
    suggested_intent?: ChatAgentSuggestedIntent | null;
    action_preview?: ChatActionPreviewPayload | null;
    guidance?: string | null;
  };
}

export interface BankReconciliationChatMessageRequest {
  message?: string;
  conta_bancaria_id: string;
  data_referencia: string;
  import_id?: string | null;
  session_id?: string | null;
  active_extrato_transacao_id?: string | null;
  attachments?: ChatAttachmentInput[];
  interaction?: ChatMessageInteraction | null;
  client_build_id?: string | null;
  client_upload_failure_context?: Record<string, unknown> | null;
}

export interface BankReconciliationChatMessageResponse {
  ok: boolean;
  runtime_build_id?: string | null;
  data: {
    session: BankReconciliationChatSessionRow;
    user_message: BankReconciliationChatStoredMessage;
    assistant_message: BankReconciliationChatStoredMessage;
    action_preview?: ChatActionPreviewPayload;
    context_snapshot: {
      empresa_id: string;
      conta_bancaria_id: string;
      conta_label: string | null;
      data_referencia: string;
      import_id: string | null;
      import_source?: string | null;
      import_file_format?: string | null;
      import_periodo_inicio?: string | null;
      import_periodo_fim?: string | null;
      ofx_required?: boolean;
      ofx_required_reason?: string | null;
      import_parse_status: string | null;
      import_error_message: string | null;
      status_counts: {
        pendente: number;
        sugerido: number;
        conciliado: number;
        divergente: number;
      };
      pendencias_criticas: number;
      pending_examples: Array<{
        extrato_transacao_id: string;
        descricao: string;
        valor_centavos: number;
        data_movimento: string;
      }>;
      daily_summary: Record<string, unknown> | null;
    };
    import_result?: ChatImportResult | null;
    reconciliation_plan?: ChatReconciliationPlan | null;
    clarifying_questions?: ChatClarifyingQuestion[] | null;
    pending_cases?: ChatPendingCase[] | null;
    pending_action_state?: ChatPendingActionState | null;
    ai_processing_status?: ChatAiProcessingStatus | null;
    ai_polling?: {
      attempts: number;
      elapsed_ms: number;
      outcome: 'completed' | 'timeout' | 'no_pending' | 'failed';
    } | null;
    correlation_id?: string | null;
    last_execution_summary?: ChatLastExecutionSummary | null;
    suggested_next_actions?: ChatSuggestedNextAction[] | null;
    review_guidance?: ChatReviewGuidance | null;
    ui_show_operational_cards?: boolean;
    ui_show_plan_card?: boolean;
    ui_show_guided_card?: boolean;
  };
}

export interface BankReconciliationChatActionConfirmRequest {
  action: ChatActionKind;
  conta_bancaria_id: string;
  data_referencia: string;
  import_id?: string | null;
  session_id?: string | null;
  plan_id?: string | null;
  idempotency_key?: string;
  selection_mode?: ChatPlanSelectionMode;
  include_suggestion_ids?: string[];
  exclude_suggestion_ids?: string[];
}

export interface BankReconciliationChatActionConfirmResponse {
  ok: boolean;
  runtime_build_id?: string | null;
  data: {
    execution: {
      ok: boolean;
      action: ChatActionKind;
      idempotency_key: string;
      executed_at: string;
      result: Record<string, unknown>;
      assistant_message: string;
      rich_content?: RichMessageContent;
      reused?: boolean;
    };
    action_preview?: ChatActionPreviewPayload;
    execution_summary?: ChatActionExecutionSummary;
    affected_counts?: Record<string, number>;
    applied_suggestion_ids?: string[];
    skipped_suggestion_ids?: string[];
    failed_items?: Array<{ suggestion_id?: string; action?: string; message: string }>;
    reconciliation_plan?: ChatReconciliationPlan | null;
    clarifying_questions?: ChatClarifyingQuestion[] | null;
    pending_cases?: ChatPendingCase[] | null;
    ai_processing_status?: ChatAiProcessingStatus | null;
    correlation_id?: string | null;
    review_guidance?: ChatReviewGuidance | null;
    ui_show_operational_cards?: boolean;
    ui_show_plan_card?: boolean;
    ui_show_guided_card?: boolean;
    ai_polling?: {
      attempts: number;
      elapsed_ms: number;
      outcome: 'completed' | 'timeout' | 'no_pending' | 'failed';
    } | null;
    session: BankReconciliationChatSessionRow;
    user_message: BankReconciliationChatStoredMessage;
    assistant_message: BankReconciliationChatStoredMessage;
  };
}

export interface ChatAttachmentInput {
  file_storage_bucket: string;
  file_storage_key: string;
  original_filename: string;
  source: 'bradesco' | 'itau' | 'ofx_generic';
  file_format: 'csv' | 'ofx';
}

export interface ChatImportResult {
  imported_count: number;
  parsed_count: number;
  failed_count: number;
  duplicate_count: number;
  selected_import_id: string | null;
  items: Array<{
    import_id: string | null;
    original_filename: string | null;
    parse_status: string | null;
    duplicate: boolean;
    message?: string | null;
    parse_errors?: string[];
  }>;
}

export interface ChatPlanItem {
  id: string;
  suggestion_id?: string | null;
  extrato_transacao_id: string;
  action: 'match_existing' | 'create_new' | 'ignore' | 'needs_review';
  confidence?: number | null;
  item_financeiro_id?: string | null;
  lancamento_caixa_id?: string | null;
  explanation?: string | null;
  extrato_data_movimento?: string;
  extrato_valor_centavos?: number;
  extrato_tipo?: BankTransactionType;
  extrato_descricao_raw?: string;
  extrato_documento_ref?: string | null;
  warnings?: string[];
  proposed_lancamento?: Record<string, unknown> | null;
}

export type ChatPlanConfidenceBand = 'high' | 'medium' | 'low';

export interface ChatPendingCase {
  id: string;
  suggestion_id?: string | null;
  extrato_transacao_id: string;
  action: ChatPlanItem['action'];
  reason: string;
  confidence?: number | null;
  confidence_band?: ChatPlanConfidenceBand;
  descricao?: string | null;
  data_movimento?: string | null;
  valor_centavos?: number | null;
}

export interface ChatClarifyingQuestion {
  id: string;
  suggestion_id?: string | null;
  extrato_transacao_id?: string | null;
  question: string;
  rationale?: string | null;
  confidence_band?: ChatPlanConfidenceBand;
  suggested_actions?: string[];
}

export interface ChatReconciliationPlan {
  plan_id: string;
  empresa_id: string;
  conta_bancaria_id: string;
  data_referencia: string;
  import_id?: string | null;
  generated_at: string;
  totals: {
    total: number;
    match_existing: number;
    create_new: number;
    ignore: number;
    needs_review: number;
  };
  items: ChatPlanItem[];
}

export interface ChatActionExecutionSummary {
  title: string;
  message: string;
  affected_counts?: Record<string, number>;
  balance_mutation_blocked?: boolean;
  blocked_create_new_count?: number;
}

export type LancamentoConciliationBadgeStatus = 'nao_conciliado' | 'parcial' | 'conciliado';

export interface LancamentoConciliationProvenance {
  ai_suggested_and_human_approved: boolean;
}
