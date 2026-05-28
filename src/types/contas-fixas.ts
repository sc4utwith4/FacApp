import { z } from 'zod';

// Schema para Conta Fixa
export const contaFixaSchema = z.object({
  id: z.number().optional(),
  descricao: z.string().min(1, 'Descrição é obrigatória').max(200, 'Descrição muito longa'),
  natureza: z.enum(['entrada', 'saida'], { required_error: 'Natureza é obrigatória' }),
  grupo_contas_id: z.string().uuid('Grupo de contas é obrigatório'),
  conta_bancaria_id: z.string().uuid('Conta bancária é obrigatória'),
  periodicidade: z.enum(['mensal', 'semanal', 'quinzenal', 'anual'], { 
    required_error: 'Periodicidade é obrigatória' 
  }),
  dia_ref: z.number().min(1).max(31, 'Dia deve estar entre 1 e 31'),
  weekday_ref: z.number().min(0).max(6).optional(), // 0=domingo, 6=sábado
  valor: z.number().min(0, 'Valor deve ser positivo'),
  ativo: z.boolean().default(true),
  proximo_evento: z.string().optional(), // será calculado automaticamente
  tolerancia_dias: z.number().min(0).default(0),
  observacoes: z.string().optional(),
});

export type ContaFixa = z.infer<typeof contaFixaSchema>;

// Schema para Lançamento Previsto
export const lancamentoPrevistoSchema = z.object({
  id: z.number().optional(),
  fixa_id: z.number().min(1, 'Conta fixa é obrigatória'),
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve estar no formato YYYY-MM'),
  vencimento: z.string().min(1, 'Data de vencimento é obrigatória'),
  tipo: z.enum(['entrada', 'saida'], { required_error: 'Tipo é obrigatório' }),
  valor: z.number().min(0, 'Valor deve ser positivo'),
  status: z.enum(['previsto', 'agendado', 'pago', 'atrasado']).default('previsto'),
  conta_bancaria_id: z.string().uuid('Conta bancária é obrigatória'),
  grupo_contas_id: z.string().uuid('Grupo de contas é obrigatório'),
  historico: z.string().optional(),
  pago_em: z.string().optional(),
  lancamento_caixa_id: z.number().optional(),
  observacoes: z.string().optional(),
});

export type LancamentoPrevisto = z.infer<typeof lancamentoPrevistoSchema>;

// Schema para criar Conta Fixa
export const createContaFixaSchema = contaFixaSchema.omit({ 
  id: true, 
  proximo_evento: true 
}).extend({
  proximo_evento: z.string().min(1, 'Próximo evento é obrigatório'),
});

export type CreateContaFixa = z.infer<typeof createContaFixaSchema>;

// Schema para atualizar Conta Fixa
export const updateContaFixaSchema = contaFixaSchema.partial().extend({
  id: z.number().min(1, 'ID é obrigatório'),
});

export type UpdateContaFixa = z.infer<typeof updateContaFixaSchema>;

// Schema para ações em Lançamentos Previstos
export const previstoActionSchema = z.object({
  id: z.number().min(1, 'ID é obrigatório'),
  action: z.enum(['marcar_pago', 'reagendar', 'cancelar']),
  data_pagamento: z.string().optional(),
  nova_data_vencimento: z.string().optional(),
  observacoes: z.string().optional(),
});

export type PrevistoAction = z.infer<typeof previstoActionSchema>;

// Schema para geração de previstos
export const gerarPrevistosSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/, 'Competência deve estar no formato YYYY-MM'),
  empresa_id: z.string().uuid('Empresa é obrigatória').optional(),
});

export type GerarPrevistos = z.infer<typeof gerarPrevistosSchema>;

// Schema para filtros de consulta
export const filtrosPrevistosSchema = z.object({
  competencia: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(['previsto', 'agendado', 'pago', 'atrasado']).optional(),
  tipo: z.enum(['entrada', 'saida']).optional(),
  conta_bancaria_id: z.string().uuid().optional(),
  grupo_contas_id: z.string().uuid().optional(),
  data_inicio: z.string().optional(),
  data_fim: z.string().optional(),
});

export type FiltrosPrevistos = z.infer<typeof filtrosPrevistosSchema>;

// Schema para projeção de caixa
export const projecaoCaixaSchema = z.object({
  data_inicio: z.string().min(1, 'Data de início é obrigatória'),
  data_fim: z.string().min(1, 'Data de fim é obrigatória'),
  conta_bancaria_id: z.string().uuid().optional(),
  incluir_previstos: z.boolean().default(true),
});

export type ProjecaoCaixa = z.infer<typeof projecaoCaixaSchema>;

// Tipos auxiliares
export type StatusPrevisto = 'previsto' | 'agendado' | 'pago' | 'atrasado';
export type Periodicidade = 'mensal' | 'semanal' | 'quinzenal' | 'anual';
export type Natureza = 'entrada' | 'saida';

// Constantes
export const PERIODICIDADES: { value: Periodicidade; label: string }[] = [
  { value: 'mensal', label: 'Mensal' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quinzenal', label: 'Quinzenal' },
  { value: 'anual', label: 'Anual' },
];

export const STATUS_PREVISTO: { value: StatusPrevisto; label: string; color: string }[] = [
  { value: 'previsto', label: 'Previsto', color: 'blue' },
  { value: 'agendado', label: 'Agendado', color: 'yellow' },
  { value: 'pago', label: 'Pago', color: 'green' },
  { value: 'atrasado', label: 'Atrasado', color: 'red' },
];

export const DIAS_SEMANA: { value: number; label: string }[] = [
  { value: 0, label: 'Domingo' },
  { value: 1, label: 'Segunda-feira' },
  { value: 2, label: 'Terça-feira' },
  { value: 3, label: 'Quarta-feira' },
  { value: 4, label: 'Quinta-feira' },
  { value: 5, label: 'Sexta-feira' },
  { value: 6, label: 'Sábado' },
];





