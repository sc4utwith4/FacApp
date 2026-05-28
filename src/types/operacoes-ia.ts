export type OperationIaProgram = 'SPPRO' | 'SOI';

export type OperationIaSourceType = 'disecurit_pdf';
export type OperationIaExtractionSourceMethod = 'regex' | 'ocr' | 'heuristic' | 'manual';
export type OperationIaRawSnapshotSourceMethod = OperationIaExtractionSourceMethod | 'payload';

export type OperationIaItemStatus =
  | 'pending'
  | 'review'
  | 'ready'
  | 'ignored'
  | 'error'
  | 'created'
  | 'failed';

export type OperationIaFornecedorMatchMethod = 'cnpj' | 'name_fuzzy' | 'manual' | 'none';

export interface OperationIaSoiFormula {
  valor_original: number | null;
  valor_desagio: number | null;
  valor_desagio_antecipacao: number | null;
  despesas: number | null;
  regresso: number | null;
  amortiza_debitos: number | null;
  amortiza_creditos: number | null;
  creditos_gerados: number | null;
  liquido_liberado: number | null;
}

export interface OperationIaSpproFormula {
  quantidade_titulos: number | null;
  valor_face: number | null;
  valor_compra: number | null;
  ad_valorem: number | null;
  iss: number | null;
  despesas: number | null;
  iof: number | null;
  iof_adicional: number | null;
  recompra: number | null;
  liquido_operacao: number | null;
}

export interface OperationIaExtractionCandidate {
  value: number | null;
  raw_value: string | null;
  source_method: OperationIaExtractionSourceMethod;
  confidence: number | null;
}

export interface OperationIaExtractionDiagnostic {
  field_name: string;
  resolved_value: number | null;
  source_method: OperationIaExtractionSourceMethod;
  confidence: number | null;
  conflict_flag: boolean;
  critical: boolean;
  reason: string | null;
  compared_value: number | null;
  tolerance: number | null;
  difference: number | null;
  candidates?: OperationIaExtractionCandidate[];
}

export interface OperationIaRawSnapshotField {
  key: string;
  label: string;
  raw_value: string | null;
  normalized_value: number | string | null;
  source_method: OperationIaRawSnapshotSourceMethod;
  confidence: number | null;
  conflict_flag: boolean;
  reason: string | null;
}

export interface OperationIaHistoryTimelineEvent {
  id: string;
  import_file_id: string;
  line_index: number | null;
  field_name: string;
  raw_value: string | null;
  normalized_value: number | null;
  source_method: OperationIaExtractionSourceMethod;
  confidence: number | null;
  conflict_flag: boolean;
  status: 'accepted' | 'flagged' | 'corrected';
  actor_user_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OperationIaContaBancariaOption {
  id: string;
  descricao: string;
}

export interface OperationIaDraftItem {
  id: string;
  import_file_id: string;
  source_type: OperationIaSourceType;
  parse_status: string;
  original_filename: string | null;
  operation_number: string | null;
  file_sha256: string | null;
  duplicate_origin_import_file_id?: string | null;
  duplicate_hydration_status?: 'hydrated' | 'missing' | null;
  duplicate_hydration_resolution_method?:
    | 'self_payload'
    | 'audit'
    | 'hash'
    | 'operation_number'
    | 'auto_reparse'
    | 'none'
    | null;
  linked_operacao_id: number | null;
  program: OperationIaProgram | null;
  soi_formula?: OperationIaSoiFormula | null;
  sppro_formula?: OperationIaSpproFormula | null;
  estoque_id: number | null;
  fornecedor_id: string | null;
  fornecedor_match_method: OperationIaFornecedorMatchMethod;
  fornecedor_match_confidence: number | null;
  conta_bancaria_id: string | null;
  data_operacao: string | null;
  documento: string | null;
  historico: string | null;
  face_titulos: number | null;
  valor_compra: number | null;
  despesas: number | null;
  recompra: number | null;
  ad_valorem: number | null;
  iss: number | null;
  iof: number | null;
  iof_adicional: number | null;
  amortizacao_debitos: number | null;
  amortizacao_creditos: number | null;
  raw_pdf_snapshot: OperationIaRawSnapshotField[];
  extraction_diagnostics: OperationIaExtractionDiagnostic[];
  has_critical_conflict: boolean;
  history_timeline: OperationIaHistoryTimelineEvent[];
  status: OperationIaItemStatus;
  issues: string[];
}

export interface OperationIaBatchPreviewSummary {
  total: number;
  ready: number;
  review: number;
  error: number;
  linked: number;
  auto_supplier_suggested: number;
}

export interface OperationIaBatchPreviewMeta {
  duplicate_test_mode_enabled: boolean;
  conflict_override_duplicate_test_enabled?: boolean;
}

export interface OperationIaBatchPreviewResponse {
  ok: true;
  batch_id: string;
  generated_at: string;
  meta?: OperationIaBatchPreviewMeta;
  contas_bancarias: OperationIaContaBancariaOption[];
  default_conta_bancaria_id: string | null;
  summary: OperationIaBatchPreviewSummary;
  items: OperationIaDraftItem[];
}

export interface OperationIaBatchPreviewRequest {
  import_file_ids: string[];
  /** Data de referência do lote (YYYY-MM-DD): fallback de `data_operacao` quando o parse não trouxer data. */
  reference_date?: string | null;
}

export type OperationIaConfirmDecision = 'confirm' | 'ignore';

export interface OperationIaConfirmItemPayload {
  program: OperationIaProgram | null;
  soi_formula?: OperationIaSoiFormula | null;
  sppro_formula?: OperationIaSpproFormula | null;
  estoque_id: number | null;
  fornecedor_id: string | null;
  fornecedor_match_method?: OperationIaFornecedorMatchMethod;
  conta_bancaria_id: string | null;
  data_operacao: string | null;
  documento: string | null;
  historico: string | null;
  face_titulos: number | null;
  valor_compra: number | null;
  despesas: number | null;
  recompra: number | null;
  ad_valorem: number | null;
  iss: number | null;
  iof: number | null;
  iof_adicional: number | null;
  amortizacao_debitos: number | null;
  amortizacao_creditos: number | null;
}

export interface OperationIaBatchConfirmItem {
  item_id: string;
  import_file_id: string;
  decision: OperationIaConfirmDecision;
  ignore_reason?: string | null;
  force_create?: boolean;
  force_create_reason?: string | null;
  payload: OperationIaConfirmItemPayload;
}

export interface OperationIaBatchConfirmRequest {
  items: OperationIaBatchConfirmItem[];
}

export type OperationIaBatchConfirmResultStatus = 'created' | 'ignored' | 'failed';

export interface OperationIaBatchConfirmResultItem {
  item_id: string;
  import_file_id: string;
  status: OperationIaBatchConfirmResultStatus;
  operation_id?: number | null;
  duplicate_detected?: boolean;
  message?: string;
}

export interface OperationIaBatchConfirmSummary {
  total: number;
  created: number;
  ignored: number;
  failed: number;
  pending_review: number;
  value_total_created: number;
  auto_supplier_rate: number;
  processing_time_ms: number;
}

export interface OperationIaBatchConfirmResponse {
  ok: true;
  summary: OperationIaBatchConfirmSummary;
  results: OperationIaBatchConfirmResultItem[];
}

export type OperationIaHistorySeverity = 'success' | 'info' | 'warning' | 'error';

export type OperationIaHistoryCategory = 'imports' | 'created' | 'errors' | 'corrections' | 'other';

export type OperationIaHistoryOrigin =
  | 'operation_import_files'
  | 'integration_audit_log'
  | 'operation_import_extraction_history';

export interface OperationIaHistoryEvent {
  id: string;
  timestamp: string;
  tipo_evento: string;
  programa: OperationIaProgram | null;
  operacao: string | null;
  documento: string | null;
  import_file_id: string | null;
  status: OperationIaHistorySeverity;
  categoria: OperationIaHistoryCategory;
  mensagem: string | null;
  usuario: string | null;
  metadata: Record<string, unknown>;
  origin: OperationIaHistoryOrigin;
}

export interface OperationIaHistorySummary {
  total: number;
  errors: number;
  created: number;
  corrections: number;
  imports: number;
}

export interface OperationIaHistoryData {
  timezone: string;
  date_ref: string;
  range_start_utc: string;
  range_end_utc: string;
  fetched_at: string;
  summary: OperationIaHistorySummary;
  events: OperationIaHistoryEvent[];
}

export interface OperationIaHistoryResponse {
  ok: true;
  data: OperationIaHistoryData;
}

/** Linha de `operacoes_ia_chat_sessions` (lista / GET mensagens). */
export interface OperacoesIaChatSessionRow {
  id: string;
  empresa_id: string;
  user_id: string;
  session_key: string;
  reference_date: string | null;
  program_hint: string | null;
  operation_hint: string | null;
  cnpj_hint: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  archived_at: string | null;
  archived_by: string | null;
  archived_reason: string | null;
}

/** Linha de `operacoes_ia_chat_messages`. */
export interface OperacoesIaChatMessageRow {
  id: string;
  session_id: string;
  empresa_id: string;
  role: 'user' | 'assistant';
  content: string;
  context: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface OperacoesIaChatSessionsApiResponse {
  ok: true;
  data: OperacoesIaChatSessionRow[];
  runtime_build_id?: string | null;
}

export interface OperacoesIaChatMessagesApiResponse {
  ok: true;
  data: {
    session: OperacoesIaChatSessionRow;
    messages: OperacoesIaChatMessageRow[];
  };
  runtime_build_id?: string | null;
}
