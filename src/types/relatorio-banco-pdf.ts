// ============================================
// TIPOS - RELATÓRIOS BANCO PDF
// ============================================

export type StatusRelatorioBanco = "processando" | "extraido" | "validado" | "divergencia" | "erro";

export interface RelatorioBancoPDF {
  id: string;
  empresa_id: string;
  fechamento_id?: string | null;
  banco_id?: number | null;
  
  // Metadados do arquivo
  arquivo_nome: string;
  arquivo_url: string;
  arquivo_hash?: string | null;
  arquivo_tamanho?: number | null;
  data_upload: string;
  uploaded_by?: string | null;
  
  // Dados da Consulta
  agencia?: string | null;
  conta?: string | null;
  beneficiario_nome?: string | null;
  beneficiario_razao?: string | null;
  data_operacao?: string | null;
  hora_operacao?: string | null;
  
  // Posição de Carteira
  saldo_anterior_qtd?: number | null;
  saldo_anterior_valor?: number | null;
  saldo_entradas_qtd?: number | null;
  saldo_entradas_valor?: number | null;
  saldo_baixas_qtd?: number | null;
  saldo_baixas_valor?: number | null;
  saldo_atual_qtd?: number | null;
  saldo_atual_valor?: number | null;
  registrados_mes_qtd?: number | null;
  registrados_mes_valor?: number | null;
  registrados_mes_anterior_qtd?: number | null;
  registrados_mes_anterior_valor?: number | null;
  acumulados_pagos_mes_qtd?: number | null;
  acumulados_pagos_mes_valor?: number | null;
  acumulados_nao_pagos_mes_qtd?: number | null;
  acumulados_nao_pagos_mes_valor?: number | null;
  acumulados_pagos_compensacao_mes_qtd?: number | null;
  acumulados_pagos_compensacao_mes_valor?: number | null;
  pagos_mes_anterior_qtd?: number | null;
  pagos_mes_anterior_valor?: number | null;
  pagos_compensacao_mes_anterior_qtd?: number | null;
  pagos_compensacao_mes_anterior_valor?: number | null;
  titulos_instrucao_protesto_qtd?: number | null;
  titulos_instrucao_protesto_valor?: number | null;
  titulos_poder_cartorio_qtd?: number | null;
  titulos_poder_cartorio_valor?: number | null;
  
  // Índice Liquidez
  liquidez_diaria_percent?: number | null;
  liquidez_mensal_percent?: number | null;
  
  // Validação
  validado_contra_fechamento: boolean;
  divergencia_valor: number;
  divergencia_qtd: number;
  divergencias_detalhadas: Record<string, unknown>;
  validado_em?: string | null;
  validado_por?: string | null;
  
  // Histórico
  versao: number;
  versao_anterior_id?: string | null;
  
  // Status
  status: StatusRelatorioBanco;
  observacoes?: string | null;
  
  created_at: string;
  updated_at: string;
}

export interface DadosConsulta {
  agencia: string;
  conta: string;
  beneficiario_nome: string;
  beneficiario_razao: string;
  data_operacao: string;
  hora_operacao: string;
}

export interface PosicaoCarteira {
  saldo_anterior: { qtd: number; valor: number };
  saldo_entradas: { qtd: number; valor: number };
  saldo_baixas: { qtd: number; valor: number };
  saldo_atual: { qtd: number; valor: number };
  registrados_mes: { qtd: number; valor: number };
  registrados_mes_anterior: { qtd: number; valor: number };
  acumulados_pagos_mes: { qtd: number; valor: number };
  acumulados_nao_pagos_mes: { qtd: number; valor: number };
  acumulados_pagos_compensacao_mes: { qtd: number; valor: number };
  pagos_mes_anterior: { qtd: number; valor: number };
  pagos_compensacao_mes_anterior: { qtd: number; valor: number };
  titulos_instrucao_protesto: { qtd: number; valor: number };
  titulos_poder_cartorio: { qtd: number; valor: number };
}

export interface IndiceLiquidez {
  diaria_percent: number;
  mensal_percent: number;
}

export interface PDFBradescoParsed {
  dados_consulta: DadosConsulta;
  posicao_carteira: PosicaoCarteira;
  indice_liquidez: IndiceLiquidez;
  erros: string[];
  warnings: string[];
}

export interface ResultadoValidacao {
  validado: boolean;
  divergencia_valor: number;
  divergencia_qtd: number;
  divergencias_detalhadas: {
    campo: string;
    valor_pdf: number;
    valor_sistema: number;
    diferenca: number;
  }[];
}

// Tipo para inserção (sem campos gerados automaticamente)
export type RelatorioBancoPDFInsert = Omit<
  RelatorioBancoPDF,
  "id" | "created_at" | "updated_at"
>;

