// ============================================
// TIPOS - MÓDULO CONTROLE DE COBRANÇA BANCÁRIA
// ============================================

export type StatusTitulo =
  | "ABERTO"
  | "LIQUIDADO"
  | "BAIXADO"
  | "DEVOLVIDO"
  | "PROTESTO_INSTRUIDO"
  | "EM_CARTORIO"
  | "ACORDO_DESCONTO"
  | "DIVERGENCIA";

export type TipoEvento =
  | "REGISTRO"
  | "ENTRADA"
  | "LIQUIDACAO"
  | "BAIXA"
  | "DEVOLUCAO"
  | "PROTESTO"
  | "CARTORIO"
  | "DESCONTO_CONCEDIDO"
  | "TARIFA"
  | "AJUSTE_MANUAL";

export type TipoImportacao = "PDF" | "PLANILHA" | "CNAB";

export type StatusImportacao = "processando" | "concluido" | "erro";

export interface CarteiraCobranca {
  id: string;
  empresa_id: string;
  banco_id?: number | null;
  agencia?: string | null;
  conta?: string | null;
  convenio?: string | null;
  carteira?: string | null;
  beneficiario_razao_social: string;
  beneficiario_cnpj?: string | null;
  regras_juros_multa: Record<string, unknown>;
  parametros_cobranca: Record<string, unknown>;
  status: boolean;
  created_at: string;
  updated_at: string;
}

export interface TituloCobranca {
  id: string;
  empresa_id: string;
  carteira_id?: string | null;
  operacao_id?: string | null;
  identificador_interno?: string | null;
  nosso_numero?: string | null;
  seu_numero?: string | null;
  sacado_nome?: string | null;
  sacado_documento?: string | null;
  sacado_contato: Record<string, unknown>;
  valor_nominal: number;
  vencimento: string;
  data_emissao?: string | null;
  status_atual: StatusTitulo;
  tags: string[];
  cliente_codigo?: string | null;
  registrado_banco: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventoCobranca {
  id: string;
  titulo_id: string;
  carteira_id?: string | null;
  tipo_evento: TipoEvento;
  data_evento: string;
  data_referencia?: string | null;
  codigo_banco?: string | null;
  descricao_banco?: string | null;
  valor_principal: number;
  juros: number;
  multa: number;
  desconto: number;
  abatimento: number;
  tarifa: number;
  valor_liquido: number;
  origem: Record<string, unknown>;
  conciliado: boolean;
  confianca_conciliacao: number;
  observacoes?: string | null;
  created_at: string;
}

export interface FechamentoDiario {
  id: string;
  empresa_id: string;
  data_fechamento: string;
  saldo_anterior_qtd: number;
  saldo_anterior_valor: number;
  entradas_qtd: number;
  entradas_valor: number;
  baixas_qtd: number;
  baixas_valor: number;
  saldo_atual_qtd: number;
  saldo_atual_valor: number;
  indicadores: Record<string, unknown>;
  confirmado_por?: string | null;
  confirmado_em?: string | null;
  exportado_pdf_url?: string | null;
  exportado_excel_url?: string | null;
  validado_contra_banco: boolean;
  divergencia_valor: number;
  created_at: string;
  updated_at: string;
}

export interface FilaOcorrencia {
  id: string;
  empresa_id: string;
  titulo_id?: string | null;
  data_ocorrencia: string;
  identificador?: string | null;
  acao?: string | null;
  status_motivo?: string | null;
  valor?: number | null;
  observacoes?: string | null;
  tags: string[];
  referencia_cruzada: Record<string, unknown>;
  valor_ref?: number | null;
  resolvido: boolean;
  resolvido_por?: string | null;
  resolvido_em?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportacaoCobranca {
  id: string;
  empresa_id: string;
  tipo_importacao: TipoImportacao;
  arquivo_nome: string;
  arquivo_url?: string | null;
  arquivo_hash?: string | null;
  total_registros: number;
  registros_processados: number;
  registros_erro: number;
  status: StatusImportacao;
  erros: unknown[];
  created_at: string;
  updated_at: string;
}

// Tipos para inserção (sem campos gerados automaticamente)
export type CarteiraCobrancaInsert = Omit<
  CarteiraCobranca,
  "id" | "created_at" | "updated_at"
>;

export type TituloCobrancaInsert = Omit<
  TituloCobranca,
  "id" | "created_at" | "updated_at"
>;

export type EventoCobrancaInsert = Omit<EventoCobranca, "id" | "created_at">;

export type FechamentoDiarioInsert = Omit<
  FechamentoDiario,
  "id" | "created_at" | "updated_at"
>;

export type FilaOcorrenciaInsert = Omit<
  FilaOcorrencia,
  "id" | "created_at" | "updated_at"
>;

export type ImportacaoCobrancaInsert = Omit<
  ImportacaoCobranca,
  "id" | "created_at" | "updated_at"
>;

// Tipos auxiliares
export interface DashboardDia {
  saldo_anterior: {
    qtd: number;
    valor: number;
  };
  entradas: {
    qtd: number;
    valor: number;
  };
  baixas: {
    qtd: number;
    valor: number;
  };
  saldo_atual: {
    qtd: number;
    valor: number;
  };
  divergencia_banco?: number;
}

export interface OrigemEvento {
  arquivo?: string;
  linha?: number;
  protocolo?: string;
  usuario?: string;
  tipo_importacao?: TipoImportacao;
}

export interface IndicadoresFechamento {
  liquidez?: number;
  titulos_cartorio?: number;
  valor_cartorio?: number;
  titulos_protesto?: number;
  valor_protesto?: number;
  [key: string]: unknown;
}

