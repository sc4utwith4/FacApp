export type ImportParseStatus =
  | 'received'
  | 'processing'
  | 'parsed'
  | 'parse_partial'
  | 'failed'
  | 'duplicate';

export type DisecuritProgram = 'SPPRO' | 'SOI';

export type DisecuritDetectedBy = 'keyword' | 'user_stock' | 'fallback';
export type DisecuritExtractionSourceMethod = 'regex' | 'ocr' | 'heuristic' | 'manual';

export interface DisecuritExtractionCandidate {
  value: number | null;
  raw_value: string | null;
  source_method: DisecuritExtractionSourceMethod;
  confidence: number | null;
  match_type?: string | null;
}

export interface DisecuritExtractionDiagnostic {
  field_name: string;
  resolved_value: number | null;
  source_method: DisecuritExtractionSourceMethod;
  confidence: number | null;
  conflict_flag: boolean;
  critical: boolean;
  reason: string | null;
  compared_value: number | null;
  tolerance: number | null;
  difference: number | null;
  candidates?: DisecuritExtractionCandidate[];
}

export interface DisecuritSoiFormulaField {
  value: number | null;
  raw_value: string | null;
  source_method: DisecuritExtractionSourceMethod;
  confidence: number | null;
  match_type?: string | null;
  candidates?: DisecuritExtractionCandidate[];
  reason?: string | null;
}

export interface DisecuritSoiFormulaSnapshot {
  valor_original: DisecuritSoiFormulaField;
  valor_desagio: DisecuritSoiFormulaField;
  valor_desagio_antecipacao: DisecuritSoiFormulaField;
  despesas: DisecuritSoiFormulaField;
  regresso: DisecuritSoiFormulaField;
  amortiza_debitos: DisecuritSoiFormulaField;
  amortiza_creditos: DisecuritSoiFormulaField;
  creditos_gerados: DisecuritSoiFormulaField;
  liquido_liberado: DisecuritSoiFormulaField;
  field_candidates?: Record<string, DisecuritExtractionCandidate[]>;
  selection_reason?: Record<string, string>;
}

export interface DisecuritSpproFormulaSnapshot {
  quantidade_titulos: DisecuritSoiFormulaField;
  valor_face: DisecuritSoiFormulaField;
  valor_compra: DisecuritSoiFormulaField;
  ad_valorem: DisecuritSoiFormulaField;
  iss: DisecuritSoiFormulaField;
  despesas: DisecuritSoiFormulaField;
  iof: DisecuritSoiFormulaField;
  iof_adicional: DisecuritSoiFormulaField;
  recompra: DisecuritSoiFormulaField;
  liquido_operacao: DisecuritSoiFormulaField;
}

export interface OperationImportDocument {
  id?: string;
  sacado_nome?: string | null;
  sacado_cnpj?: string | null;
  documento?: string | null;
  vencimento?: string | null;
  flt?: number | null;
  prz_flt?: number | null;
  valor?: number | null;
  desagio?: number | null;
  liquido?: number | null;
  prz?: number | null;
  carteira?: string | number | null;
  tipo_doc?: string | null;
}

export interface DisecuritParsedDocument {
  debtor_name?: string | null;
  debtor_doc?: string | null;
  document?: string | null;
  due_date?: string | null;
  value?: number | null;
  discount?: number | null;
  net?: number | null;
  doc_type?: string | null;
}

export interface DisecuritParseResult {
  source: 'disecurit';
  program: DisecuritProgram;
  detected_by: DisecuritDetectedBy;
  confidence: number;
  document: {
    operation_number?: string | null;
    bordero_number?: string | null;
    date?: string | null;
    payment_date?: string | null;
  };
  parties?: {
    seller_name?: string | null;
    buyer_name?: string | null;
    client_name?: string | null;
    client_doc?: string | null;
  };
  values: {
    face_value?: number | null;
    purchase_value?: number | null;
    ad_valorem?: number | null;
    iss?: number | null;
    iof?: number | null;
    iof_additional?: number | null;
    expenses?: number | null;
    recompra?: number | null;
    amort_debits?: number | null;
    amort_credits?: number | null;
    discount_value?: number | null;
    net_value?: number | null;
  };
  documents?: DisecuritParsedDocument[];
  raw: {
    text_hash: string;
    text_excerpt: string;
  };
  debug?: {
    regex_matches?: Record<string, any>;
    warnings?: string[];
    missing_critical?: string[];
    extraction_diagnostics?: DisecuritExtractionDiagnostic[];
    has_critical_conflict?: boolean;
    soi_formula?: DisecuritSoiFormulaSnapshot;
    soi_formula_v2?: DisecuritSoiFormulaSnapshot;
    sppro_formula?: DisecuritSpproFormulaSnapshot;
  };
}

export interface ParsedPayloadDisecurit {
  // Canônico
  source?: string;
  program?: DisecuritProgram;
  detected_by?: DisecuritDetectedBy;
  confidence?: number;
  document?: {
    operation_number?: string | null;
    bordero_number?: string | null;
    date?: string | null;
    payment_date?: string | null;
  };
  parties?: {
    seller_name?: string | null;
    buyer_name?: string | null;
    client_name?: string | null;
    client_doc?: string | null;
  };
  values?: {
    face_value?: number | null;
    purchase_value?: number | null;
    ad_valorem?: number | null;
    iss?: number | null;
    iof?: number | null;
    iof_additional?: number | null;
    expenses?: number | null;
    recompra?: number | null;
    amort_debits?: number | null;
    amort_credits?: number | null;
    discount_value?: number | null;
    net_value?: number | null;
  };
  raw?: {
    text_hash?: string;
    text_excerpt?: string;
  };
  debug?: {
    regex_matches?: Record<string, any>;
    warnings?: string[];
    missing_critical?: string[];
    extraction_diagnostics?: DisecuritExtractionDiagnostic[];
    has_critical_conflict?: boolean;
    soi_formula?: DisecuritSoiFormulaSnapshot;
    soi_formula_v2?: DisecuritSoiFormulaSnapshot;
    sppro_formula?: DisecuritSpproFormulaSnapshot;
  };

  // Legado
  operation_number?: string;
  status?: string;
  dt_pagamento?: string;
  client?: {
    name?: string;
    cnpj?: string;
  };
  totals?: {
    valor?: number;
    desagio?: number;
    liquido?: number;
  };
  fees?: {
    prazo_medio?: number;
    fator_periodo?: number;
    taxa_efetiva?: number;
    fator_nominal?: number;
    fator_ajustado?: number;
    comissao_percent?: number;
  };
  documents?: Array<OperationImportDocument | DisecuritParsedDocument>;

  [key: string]: unknown;
}

export interface OperationImportFile {
  id: string;
  empresa_id: string;
  source: string;
  program_hint?: DisecuritProgram | null;
  payload_ready?: boolean;
  file_storage_bucket: string;
  file_storage_key: string;
  original_filename: string | null;
  file_sha256: string | null;
  operation_number: string | null;
  parse_status: ImportParseStatus;
  parsed_payload: ParsedPayloadDisecurit | null;
  raw_text: string | null;
  error_message: string | null;
  parse_attempts: number;
  linked_operacao_id: number | null;
  linked_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DisecuritImportWebhookResponse {
  ok?: boolean;
  import_file_id?: string;
  status?: ImportParseStatus | string;
  reason?: string | null;
  existing_import_file_id?: string | null;
  existing_linked_operacao_id?: number | null;
  workflow_version?: string | null;
}

export interface OperationImportDocumentRow {
  id?: string;
  empresa_id: string;
  operacao_estoque_id: number;
  import_file_id: string;
  line_index: number;
  sacado_nome: string | null;
  sacado_cnpj: string | null;
  documento: string | null;
  vencimento: string | null;
  flt: number | null;
  prz_flt: number | null;
  valor: number | null;
  desagio: number | null;
  liquido: number | null;
  prz: number | null;
  carteira: string | null;
  tipo_doc: string | null;
}

export interface OperationImportHints {
  operation_number?: string;
  client_cnpj?: string;
  program_hint?: DisecuritProgram;
  /** Data de referência do lote (YYYY-MM-DD), repassada ao n8n em `hints` para contexto temporal. */
  reference_date?: string;
}

export interface UiDefaultsSPPRO {
  data?: string;
  documento?: string;
  quantidadeTitulos?: number | null;
  faceDosTitulos?: number | null;
  valorDeCompra?: number | null;
  adValorem?: number | null;
  iss?: number | null;
  iof?: number | null;
  iofAdicional?: number | null;
  despesas?: number | null;
  recompra?: number | null;
  valorLiquidoOperacao?: number | null;
  amortizacaoDebitos?: number | null;
  amortizacaoCreditos?: number | null;
}

export interface UiDefaultsSOI {
  data?: string;
  documento?: string;
  faceDosTitulos?: number | null;
  valorDeCompra?: number | null;
  despesas?: number | null;
  amortizacaoDebitos?: number | null;
  amortizacaoCreditos?: number | null;
  historico?: string;
}
