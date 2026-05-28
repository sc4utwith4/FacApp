import { z } from 'zod';

// Tipos de estoque
export type TipoEstoque = 'SPPRO' | 'SOI' | 'DEVOLUCOES';
export type TipoOperacaoEstoque = 'entrada' | 'saida';
export type TipoMovimentacaoEstoque = 
  | 'acrescimos' 
  | 'receita_juros' 
  | 'entre_contas' 
  | 'lancar_receitas' 
  | 'devolucao_cheque'
  | 'conta_para_estoque'
  | 'estoque_para_conta'
  | 'estoque_para_estoque'
  | 'conta_para_conta'
  | 'distribuicao_conta'
  | 'retido_estoque'
  | 'recompra'
  | 'devolucao_para_conta'
  | 'devolucao_para_estoque';

export type TipoTransferencia =
  | 'conta_para_estoque'
  | 'estoque_para_conta'
  | 'estoque_para_estoque'
  | 'conta_para_conta';

export interface DistribuicaoConta {
  conta_bancaria_id: string;
  valor: number;
}

export interface TransferenciaEstoque {
  tipo: TipoTransferencia;
  origem_id: string | number; // UUID para conta, number para estoque
  destino_id: string | number;
  valor: number;
  data: string;
  historico?: string;
}

// Schema base para Estoque
export const estoqueSchema = z.object({
  id: z.number(),
  empresa_id: z.string().uuid(),
  tipo: z.enum(['SPPRO', 'SOI', 'DEVOLUCOES']),
  descricao: z.string().nullable(),
  saldo_inicial: z.number().default(0),
  saldo_atual: z.number().default(0),
  fornecedor_id: z.number().nullable(),
  ativo: z.boolean().default(true),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.string().nullable(),
});

export type Estoque = z.infer<typeof estoqueSchema>;

// Schema para criar Estoque
export const createEstoqueSchema = z.object({
  empresa_id: z.string().uuid('Empresa é obrigatória'),
  tipo: z.enum(['SPPRO', 'SOI', 'DEVOLUCOES'], { required_error: 'Tipo de estoque é obrigatório' }),
  descricao: z.string().max(200, 'Descrição muito longa').optional(),
  saldo_atual: z.number().min(0, 'Saldo não pode ser negativo').default(0),
  fornecedor_id: z.number().nullable().optional(),
  ativo: z.boolean().default(true),
});

export type CreateEstoque = z.infer<typeof createEstoqueSchema>;

// Schema para atualizar Estoque
export const updateEstoqueSchema = z.object({
  id: z.number().min(1, 'ID é obrigatório'),
  descricao: z.string().max(200, 'Descrição muito longa').optional(),
  saldo_atual: z.number().min(0, 'Saldo não pode ser negativo').optional(),
  fornecedor_id: z.number().nullable().optional(),
  ativo: z.boolean().optional(),
});

export type UpdateEstoque = z.infer<typeof updateEstoqueSchema>;

// Schema base para Operação de Estoque (SPPRO)
export const operacaoEstoqueSPPROSchema = z.object({
  id: z.number().optional(),
  empresa_id: z.string().uuid(),
  estoque_id: z.number().min(1, 'Estoque é obrigatório'),
  tipo_operacao: z.enum(['entrada', 'saida']),
  data: z.string().min(1, 'Data é obrigatória'),
  fornecedor_id: z.string().uuid().nullable().optional(),
  conta_bancaria_id: z.string().uuid().min(1, 'Conta bancária é obrigatória para entradas'),
  
  // Campos comuns
  face_titulos: z.number().min(0, 'Face dos títulos deve ser positivo'),
  valor_compra: z.number().min(0, 'Valor de compra deve ser positivo'),
  despesas: z.number().min(0, 'Despesas devem ser positivas').default(0),
  recompra: z.number().min(0, 'Recompra deve ser positiva').default(0),
  liquido_operacao: z.number().min(0, 'Líquido deve ser positivo').default(0),
  
  // Campos específicos SPPRO
  ad_valorem: z.number().min(0, 'Ad-Valorem deve ser positivo').default(0),
  iss: z.number().min(0, 'ISS deve ser positivo').default(0),
  iof: z.number().min(0, 'IOF deve ser positivo').default(0),
  amortizacao_debitos: z.number().min(0, 'Amortização de débitos deve ser positiva').default(0),
  amortizacao_creditos: z.number().min(0, 'Amortização de créditos deve ser positiva').default(0),
  
  historico: z.string().optional(),
  documento: z.string().max(60, 'Documento muito longo').optional(),
  observacoes: z.string().optional(),
}).refine(
  (data) => {
    if (data.tipo_operacao === 'entrada') {
      return data.conta_bancaria_id !== undefined && data.conta_bancaria_id.length > 0;
    }
    return true;
  },
  {
    message: 'Conta bancária é obrigatória para operações de entrada',
    path: ['conta_bancaria_id'],
  }
);

export type OperacaoEstoqueSPPRO = z.infer<typeof operacaoEstoqueSPPROSchema>;

// Schema base para Operação de Estoque (SOI)
export const operacaoEstoqueSOISchema = z.object({
  id: z.number().optional(),
  empresa_id: z.string().uuid(),
  estoque_id: z.number().min(1, 'Estoque é obrigatório'),
  tipo_operacao: z.enum(['entrada', 'saida']),
  data: z.string().min(1, 'Data é obrigatória'),
  fornecedor_id: z.string().uuid().nullable().optional(),
  conta_bancaria_id: z.string().uuid().min(1, 'Conta bancária é obrigatória para entradas'),
  
  // Campos comuns
  face_titulos: z.number().min(0, 'Face dos títulos deve ser positivo'),
  valor_compra: z.number().min(0, 'Valor de compra deve ser positivo'),
  despesas: z.number().min(0, 'Despesas devem ser positivas').default(0),
  recompra: z.number().min(0, 'Recompra deve ser positiva').default(0),
  liquido_operacao: z.number().min(0, 'Líquido deve ser positivo').default(0),
  
  // Campos específicos SOI
  amortizacao_debitos: z.number().min(0, 'Amortização de débitos deve ser positiva').default(0),
  amortizacao_creditos: z.number().min(0, 'Amortização de créditos deve ser positiva').default(0),
  
  historico: z.string().optional(),
  documento: z.string().max(60, 'Documento muito longo').optional(),
  observacoes: z.string().optional(),
}).refine(
  (data) => {
    if (data.tipo_operacao === 'entrada') {
      return data.conta_bancaria_id !== undefined && data.conta_bancaria_id.length > 0;
    }
    return true;
  },
  {
    message: 'Conta bancária é obrigatória para operações de entrada',
    path: ['conta_bancaria_id'],
  }
);

export type OperacaoEstoqueSOI = z.infer<typeof operacaoEstoqueSOISchema>;

// Tipo unificado para operação de estoque
export type OperacaoEstoque = OperacaoEstoqueSPPRO | OperacaoEstoqueSOI;

// Tipo para operação de estoque com relações (retornado do banco)
export interface OperacaoEstoqueComRelacoes {
  id: number;
  empresa_id: string;
  estoque_id: number;
  tipo_operacao: 'entrada' | 'saida';
  data: string;
  fornecedor_id: string | null; // UUID
  conta_bancaria_id: string | null; // UUID
  face_titulos: number;
  valor_compra: number;
  despesas: number;
  recompra: number;
  liquido_operacao: number;
  ad_valorem: number | null;
  iss: number | null;
  iof: number | null;
  amortizacao_debitos: number | null;
  amortizacao_creditos: number | null;
  historico: string | null;
  documento: string | null;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  estoques?: {
    id: number;
    tipo: string;
    descricao: string | null;
    saldo_atual: number;
  } | null;
  fornecedores?: {
    id: number;
    nome: string;
    nome_fantasia: string | null;
  } | null;
  contas_bancarias?: {
    id: string; // UUID
    descricao: string;
  } | null;
}

// Schema para criar Operação de Estoque
export const createOperacaoEstoqueSchema = z.discriminatedUnion('tipo_estoque', [
  z.object({
    tipo_estoque: z.literal('SPPRO'),
    empresa_id: z.string().uuid(),
    estoque_id: z.number().min(1),
    tipo_operacao: z.enum(['entrada', 'saida']),
    data: z.string().min(1),
    fornecedor_id: z.string().uuid().nullable().optional(),
    conta_bancaria_id: z.string().uuid().nullable().optional(),
    face_titulos: z.number().min(0),
    valor_compra: z.number().min(0),
    despesas: z.number().min(0).default(0),
    recompra: z.number().min(0).default(0),
    ad_valorem: z.number().min(0).default(0),
    iss: z.number().min(0).default(0),
    iof: z.number().min(0).default(0),
    historico: z.string().optional(),
    documento: z.string().optional(),
    observacoes: z.string().optional(),
  }),
  z.object({
    tipo_estoque: z.literal('SOI'),
    empresa_id: z.string().uuid(),
    estoque_id: z.number().min(1),
    tipo_operacao: z.enum(['entrada', 'saida']),
    data: z.string().min(1),
    fornecedor_id: z.string().uuid().nullable().optional(),
    conta_bancaria_id: z.string().uuid().nullable().optional(),
    face_titulos: z.number().min(0),
    valor_compra: z.number().min(0),
    despesas: z.number().min(0).default(0),
    recompra: z.number().min(0).default(0),
    amortizacao_debitos: z.number().min(0).default(0),
    amortizacao_creditos: z.number().min(0).default(0),
    historico: z.string().optional(),
    documento: z.string().optional(),
    observacoes: z.string().optional(),
  }),
  z.object({
    tipo_estoque: z.literal('DEVOLUCOES'),
    empresa_id: z.string().uuid(),
    estoque_id: z.number().min(1),
    tipo_operacao: z.enum(['entrada', 'saida']),
    data: z.string().min(1),
    fornecedor_id: z.string().uuid().nullable().optional(),
    conta_bancaria_id: z.string().uuid().nullable().optional(),
    face_titulos: z.number().min(0).default(0),
    valor_compra: z.number().min(0).default(0),
    despesas: z.number().min(0).default(0),
    recompra: z.number().min(0).default(0),
    liquido_operacao: z.number().min(0),
    historico: z.string().optional(),
    documento: z.string().optional(),
    observacoes: z.string().optional(),
  }),
]);

export type CreateOperacaoEstoque = z.infer<typeof createOperacaoEstoqueSchema>;

// Schema para Movimentação de Estoque
export const movimentacaoEstoqueSchema = z.object({
  id: z.number(),
  operacao_estoque_id: z.number().min(1, 'Operação de estoque é obrigatória'),
  tipo: z.enum(['acrescimos', 'receita_juros', 'entre_contas', 'lancar_receitas', 'devolucao_cheque', 'conta_para_estoque', 'estoque_para_conta', 'estoque_para_estoque', 'conta_para_conta', 'distribuicao_conta', 'retido_estoque', 'recompra']),
  valor: z.number().min(0, 'Valor deve ser positivo'),
  conta_bancaria_id: z.string().uuid().nullable().optional(),
  conta_bancaria_destino_id: z.string().uuid().nullable().optional(),
  lancamento_destino_id: z.string().uuid().nullable().optional(),
  estoque_origem_id: z.number().nullable().optional(),
  estoque_destino_id: z.number().nullable().optional(),
  operacao_destino_id: z.number().nullable().optional(),
  historico: z.string().optional(),
  data: z.string().min(1, 'Data é obrigatória'),
  created_at: z.string(),
  updated_at: z.string(),
});

export type MovimentacaoEstoque = z.infer<typeof movimentacaoEstoqueSchema>;

// Schema para criar Movimentação de Estoque
export const createMovimentacaoEstoqueSchema = z.object({
  operacao_estoque_id: z.number().min(1, 'Operação de estoque é obrigatória'),
  tipo: z.enum(['acrescimos', 'receita_juros', 'entre_contas', 'lancar_receitas', 'devolucao_cheque', 'conta_para_estoque', 'estoque_para_conta', 'estoque_para_estoque', 'conta_para_conta', 'distribuicao_conta', 'retido_estoque', 'recompra', 'devolucao_para_conta', 'devolucao_para_estoque']),
  valor: z.number().min(0, 'Valor deve ser positivo'),
  conta_bancaria_id: z.string().uuid().nullable().optional(),
  conta_bancaria_destino_id: z.string().uuid().nullable().optional(),
  lancamento_destino_id: z.string().uuid().nullable().optional(),
  estoque_origem_id: z.number().nullable().optional(),
  estoque_destino_id: z.number().nullable().optional(),
  operacao_destino_id: z.number().nullable().optional(),
  historico: z.string().optional(),
  data: z.string().min(1, 'Data é obrigatória'),
}).refine(
  (data) => {
    if (data.tipo === 'entre_contas') {
      return data.estoque_origem_id !== undefined && data.estoque_destino_id !== undefined;
    }
    return true;
  },
  {
    message: 'Estoque origem e destino são obrigatórios para transferências entre contas',
    path: ['estoque_origem_id'],
  }
);

export type CreateMovimentacaoEstoque = z.infer<typeof createMovimentacaoEstoqueSchema>;

// Schema para filtros de operações de estoque
export const filtrosOperacoesEstoqueSchema = z.object({
  estoque_id: z.number().optional(),
  tipo_estoque: z.enum(['SPPRO', 'SOI', 'DEVOLUCOES']).optional(),
  tipo_operacao: z.enum(['entrada', 'saida']).optional(),
  fornecedor_id: z.string().uuid().optional(),
  conta_bancaria_id: z.string().uuid().optional(),
  data_inicio: z.string().optional(),
  data_fim: z.string().optional(),
});

export type FiltrosOperacoesEstoque = z.infer<typeof filtrosOperacoesEstoqueSchema>;

// Funções auxiliares para cálculos

/**
 * Calcula o valor líquido da operação SPPRO
 * Líquido = Face - (Valor de Compra + Ad-Valorem + ISS + IOF + IOF Adicional + Despesas + Recompra + Amortização de Débitos) + Amortização de Créditos
 */
export function calcularLiquidoSPPRO(data: {
  face_titulos: number;
  valor_compra: number;
  ad_valorem: number;
  iss: number;
  iof: number;
  iof_adicional?: number;
  despesas: number;
  recompra: number;
  amortizacao_debitos?: number;
  amortizacao_creditos?: number;
}): number {
  const { face_titulos, valor_compra, ad_valorem, iss, iof, iof_adicional = 0, despesas, recompra, amortizacao_debitos = 0, amortizacao_creditos = 0 } = data;
  const custosTotais = valor_compra + ad_valorem + iss + iof + iof_adicional + despesas + recompra + amortizacao_debitos;
  const liquido = face_titulos - custosTotais + amortizacao_creditos;
  return Math.max(0, liquido); // Não permite negativo
}

/**
 * Calcula o valor líquido da operação SOI
 * Líquido = Face - (Valor de Compra + Despesas + Recompra + Amortização de débitos) + Amortização de créditos
 */
export function calcularLiquidoSOI(data: {
  face_titulos: number;
  valor_compra: number;
  despesas: number;
  recompra: number;
  amortizacao_debitos: number;
  amortizacao_creditos: number;
}): number {
  const {
    face_titulos,
    valor_compra,
    despesas,
    recompra,
    amortizacao_debitos,
    amortizacao_creditos,
  } = data;
  const custosTotais = valor_compra + despesas + recompra + amortizacao_debitos;
  const liquido = face_titulos - custosTotais + amortizacao_creditos;
  return Math.max(0, liquido); // Não permite negativo
}

// Constantes
export const TIPOS_ESTOQUE: { value: TipoEstoque; label: string }[] = [
  { value: 'SPPRO', label: 'SPPRO' },
  { value: 'SOI', label: 'SOI' },
  { value: 'DEVOLUCOES', label: 'Estoque Devoluções' },
];

export const TIPOS_OPERACAO_ESTOQUE: { value: TipoOperacaoEstoque; label: string }[] = [
  { value: 'entrada', label: 'Entrada' },
  { value: 'saida', label: 'Saída' },
];

export const TIPOS_MOVIMENTACAO_ESTOQUE: { value: TipoMovimentacaoEstoque; label: string }[] = [
  { value: 'acrescimos', label: 'Acréscimos' },
  { value: 'receita_juros', label: 'Receita de Juros' },
  { value: 'entre_contas', label: 'Entre Contas' },
  { value: 'lancar_receitas', label: 'Lançar Receitas' },
  { value: 'devolucao_cheque', label: 'Devolução de Cheque' },
  { value: 'conta_para_estoque', label: 'Transferência Conta → Estoque' },
  { value: 'estoque_para_conta', label: 'Transferência Estoque → Conta' },
  { value: 'estoque_para_estoque', label: 'Transferência Estoque → Estoque' },
  { value: 'distribuicao_conta', label: 'Distribuição entre Contas' },
  { value: 'retido_estoque', label: 'Retido no Estoque' },
  { value: 'recompra', label: 'Recompra' },
];

// Status de Devolução
export type StatusDevolucao = 'pendente' | 'transferida' | 'parcialmente_transferida';
export type TipoOrigemDevolucao = 'SPPRO' | 'SOI' | 'NAO_CLASSIFICADO';
export type MotivoDevolucaoOrfa =
  | 'SEM_LANCAMENTO'
  | 'LANCAMENTO_INEXISTENTE'
  | 'SEM_OPERACAO_ENTRADA'
  | 'TRANSFERENCIA_SEM_DESTINO_DETERMINISTICO'
  | 'ESTADO_INVALIDO';

export type TransferirDevolucoesRpcCode =
  | 'REQUEST_ID_INVALIDO'
  | 'NAO_AUTENTICADO'
  | 'DATA_INVALIDA'
  | 'DESTINO_INVALIDO'
  | 'PAYLOAD_INVALIDO'
  | 'DEVOLUCAO_DUPLICADA'
  | 'DEVOLUCAO_NAO_ENCONTRADA'
  | 'VALOR_INVALIDO'
  | 'SOBRETRANSFERENCIA'
  | 'ESTOQUE_NAO_ENCONTRADO'
  | 'SALDO_DEVOLUCOES_INSUFICIENTE';

export type CriarDevolucaoRpcCode =
  | 'REQUEST_ID_INVALIDO'
  | 'NAO_AUTENTICADO'
  | 'EMPRESA_NAO_ENCONTRADA'
  | 'DATA_INVALIDA'
  | 'VALOR_INVALIDO'
  | 'CONTA_SB_S0I2_NAO_ENCONTRADA'
  | 'CONTA_INVALIDA'
  | 'OPERACAO_NAO_ENCONTRADA'
  | 'LIMITE_FACE_EXCEDIDO'
  | 'TIPO_ESTOQUE_INVALIDO'
  | 'ESTOQUE_NAO_ENCONTRADO'
  | 'SALDO_ESTOQUE_ORIGEM_INSUFICIENTE';

// Interfaces para Devoluções de Estoque
export interface DevolucaoEstoque {
  id: number;
  operacao_estoque_id: number | null; // NULL para devoluções diretas de estoque
  operacao_entrada_devolucoes_id?: number | null; // Operação de entrada no estoque DEVOLUCOES (rastreabilidade de exclusão)
  tipo_origem_devolucao?: TipoOrigemDevolucao;
  data_devolucao: string;
  valor_devolucao: number;
  valor_transferido?: number; // Fase 2: valor já transferido (acumulado); restante = valor_devolucao - valor_transferido
  conta_bancaria_id: string;
  lancamento_caixa_id: string | null;
  historico?: string | null;
  observacoes?: string | null;
  status?: StatusDevolucao; // Status da devolução
  created_by: string;
  created_at: string;
  updated_at: string;
  empresa_id: string;
}

export interface DevolucaoEstoqueComRelacoes extends DevolucaoEstoque {
  operacoes_estoque?: {
    id: number;
    face_titulos: number;
    tipo_operacao: TipoOperacaoEstoque;
    data: string;
    historico?: string | null;
    fornecedor_id?: string | null;
    fornecedores?: {
      id: string;
      razao_social: string;
      nome_fantasia?: string | null;
    } | null;
    estoques?: {
      id: number;
      tipo: TipoEstoque;
      descricao?: string | null;
    } | null;
  } | null;
  contas_bancarias?: {
    id: string;
    descricao: string;
  } | null;
  lancamentos_caixa?: {
    id: string;
    valor: number;
    tipo: 'entrada' | 'saida';
    data: string;
  } | null;
}

export interface DevolucaoTransferivel {
  devolucao_id: number;
  data_devolucao: string;
  valor_devolucao: number;
  valor_transferido_calculado: number;
  valor_restante: number;
  valor_transferivel_agora: number;
  saldo_devolucoes_atual: number | null;
  status_calculado: StatusDevolucao;
  origem_dados?: 'rpc_deterministico' | 'fallback_legacy';
  operacao_estoque_id: number | null;
  operacao_entrada_devolucoes_id: number | null;
  tipo_origem_devolucao: TipoOrigemDevolucao;
  historico: string | null;
  tipo_estoque: 'SPPRO' | 'SOI' | 'DEVOLUCOES' | null;
  estoque_descricao: string | null;
  fornecedor_nome: string | null;
  fornecedor_nome_fantasia: string | null;
}

export interface DevolucaoOrfaDiagnostico {
  devolucao_id: number;
  motivo: MotivoDevolucaoOrfa;
  pode_limpar: boolean;
  lancamento_caixa_id: string | null;
  operacao_entrada_devolucoes_id: number | null;
}

export interface LimpezaDevolucoesOrfasResultado {
  total_orfas: number;
  total_limpaveis: number;
  limpas: number;
  falhas: number;
  bloqueadas: Array<{
    devolucao_id: number;
    motivo: MotivoDevolucaoOrfa | string;
  }>;
  erros: Array<{
    devolucao_id: number;
    code: string;
    erro: string;
  }>;
}

export interface DiagnosticoConsistenciaDevolucoesEstoque {
  saldo_estoque_atual: number;
  saldo_operacional_calculado: number;
  total_restante_deterministico: number;
  gap_movimentacoes_sem_vinculo: number;
  devolucoes_sem_operacao_entrada: number;
  movimentacoes_com_gap: number;
  gap_por_tipo_sppro: number;
  gap_por_tipo_soi: number;
  gap_tipo_indeterminado: number;
  gap_tipo_inferido_por_destino: number;
  gap_tipo_inferido_por_conta_mapeada: number;
  gap_residual_recomponivel: number;
}

export type EstrategiaReconciliacaoDevolucoes = 'LIFO_TIPO_DATA_STRITO';

export type MotivoBloqueioReconciliacao =
  | 'TIPO_INDETERMINADO'
  | 'SEM_CANDIDATO_SUFICIENTE'
  | 'AJUSTE_RECOMPOSICAO_SALDO'
  | string;

export interface BloqueioReconciliacaoDevolucao {
  movimentacao_id: number | null;
  motivo: MotivoBloqueioReconciliacao;
  gap: number;
  tipo_origem_movimentacao?: TipoOrigemDevolucao | null;
}

export interface RepararInconsistenciasDevolucoesPayload {
  mode?: 'dry_run' | 'apply';
  request_id?: string;
  reconciliar_vinculos?: boolean;
  recompor_saldo_residual?: boolean;
  estrategia?: EstrategiaReconciliacaoDevolucoes;
  empresa_id?: string;
  silent?: boolean;
}

export type StatusExecucaoReconciliacao = 'DONE' | 'RUNNING_BACKGROUND' | 'ERROR' | string;

export interface RepararInconsistenciasDevolucoesResultado {
  status_execucao: StatusExecucaoReconciliacao;
  mode: 'dry_run' | 'apply';
  request_id?: string | null;
  empresa_id: string;
  estrategia?: EstrategiaReconciliacaoDevolucoes | string;
  reconciliar_vinculos?: boolean;
  recompor_saldo_residual?: boolean;
  estoque_devolucoes_id: number;
  saldo_antes: number;
  saldo_operacional_calculado: number;
  saldo_final: number;
  saldo_final_pos_recomposicao: number;
  devolucoes_sem_operacao_entrada_antes: number;
  devolucoes_backfill_candidatas: number;
  devolucoes_backfill_aplicadas: number;
  devolucoes_sem_operacao_entrada_depois: number;
  total_restante_deterministico: number;
  gap_movimentacoes_sem_vinculo: number;
  movimentacoes_com_gap: number;
  vinculos_criados: number;
  movimentacoes_reconciliadas: number;
  movimentacoes_bloqueadas: number;
  gap_movimentacoes_sem_vinculo_antes: number;
  gap_movimentacoes_sem_vinculo_depois: number;
  gap_remanescente_bloqueado: number;
  gap_residual_antes_recomposicao: number;
  valor_recomposicao_aplicada: number;
  operacao_ajuste_id: number | null;
  bloqueios: BloqueioReconciliacaoDevolucao[];
}

export interface ConsultarReconciliacaoDevolucoesPayload {
  request_id: string;
  empresa_id?: string;
}

export type ConsultarReconciliacaoDevolucoesResultado =
  | RepararInconsistenciasDevolucoesResultado
  | {
      status_execucao: 'RUNNING_BACKGROUND' | 'ERROR' | string;
      request_id?: string | null;
      empresa_id?: string;
      code?: string;
      error?: string;
    };

export interface CreateDevolucaoEstoque {
  operacao_estoque_id?: number | null; // Opcional para devoluções diretas de estoque
  tipo_estoque?: 'SPPRO' | 'SOI'; // Necessário quando operacao_estoque_id é NULL
  data_devolucao: string;
  valor_devolucao: number;
  conta_bancaria_id: string; // Sempre SB-S0I2
  historico?: string;
  observacoes?: string;
}

export interface DevolucoesTotais {
  total: number;
  sppro: number;
  soi: number;
  naoClassificado: number;
}

// Interface para transferir devoluções
export interface TransferirDevolucoesInput {
  devolucoes_selecionadas: Array<{
    devolucao_id: number;
    valor_transferir: number; // Pode ser parcial
  }>;
  data_transferencia: string;
  tipo_estoque?: 'SPPRO' | 'SOI'; // Se transferindo separadamente
  destino_tipo: 'conta' | 'estoque';
  destino_id: string; // UUID para conta, number (string) para estoque
  historico?: string;
  observacoes?: string;
}

// Tipos para Recompra de Estoque
export type StatusRecompra = 'pendente' | 'paga';
export type OrigemRecompra = 'estoque' | 'conta';

export interface RecompraEstoque {
  id: number;
  operacao_estoque_id: number; // Sempre vinculada a uma operação
  data_recompra: string;
  valor_recompra: number;
  status: StatusRecompra;
  origem_tipo: OrigemRecompra;
  origem_id: string; // INTEGER para estoque, UUID para conta (armazenado como string)
  destino_tipo: OrigemRecompra | null;
  destino_id: string | null;
  lancamento_saida_id: string | null;
  lancamento_entrada_id: string | null;
  historico?: string | null;
  observacoes?: string | null;
  data_pagamento: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  empresa_id: string;
}

export interface RecompraEstoqueComRelacoes extends RecompraEstoque {
  operacoes_estoque?: {
    id: number;
    face_titulos: number;
    tipo_operacao: TipoOperacaoEstoque;
    data: string;
    historico?: string | null;
    fornecedor_id?: string | null;
    fornecedores?: {
      id: string;
      razao_social: string;
      nome_fantasia?: string | null;
    } | null;
    estoques?: {
      id: number;
      tipo: TipoEstoque;
      descricao?: string | null;
    } | null;
  } | null;
  estoques_origem?: {
    id: number;
    tipo: TipoEstoque;
    descricao?: string | null;
  } | null;
  contas_origem?: {
    id: string;
    descricao: string;
  } | null;
  estoques_destino?: {
    id: number;
    tipo: TipoEstoque;
    descricao?: string | null;
  } | null;
  contas_destino?: {
    id: string;
    descricao: string;
  } | null;
  lancamentos_saida?: {
    id: string;
    valor: number;
    tipo: 'entrada' | 'saida';
    data: string;
    historico?: string | null;
  } | null;
  lancamentos_entrada?: {
    id: string;
    valor: number;
    tipo: 'entrada' | 'saida';
    data: string;
    historico?: string | null;
  } | null;
}

export interface CreateRecompraEstoque {
  operacao_estoque_id: number;
  data_recompra: string;
  valor_recompra: number;
  origem_tipo: OrigemRecompra;
  origem_id: string | number; // INTEGER para estoque, UUID para conta
  historico?: string;
  observacoes?: string;
}

export interface PagarRecompraEstoque {
  recompra_id: number;
  data_pagamento: string;
  destino_tipo: OrigemRecompra;
  destino_id: string | number; // INTEGER para estoque, UUID para conta
  historico?: string;
  observacoes?: string;
}
