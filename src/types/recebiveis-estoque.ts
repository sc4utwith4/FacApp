import { z } from 'zod';

// Schema para Recebível de Operação de Estoque
export const recebivelOperacaoEstoqueSchema = z.object({
  id: z.number(),
  operacao_estoque_id: z.number(),
  empresa_id: z.string().uuid(),
  valor: z.number().positive(),
  data_vencimento: z.string().nullable().optional(), // formato YYYY-MM-DD, opcional
  descricao: z.string().nullable().optional(),
  tipo_estoque: z.enum(['SPPRO', 'SOI']),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export type RecebivelOperacaoEstoque = z.infer<typeof recebivelOperacaoEstoqueSchema>;

// Schema para criar Recebível
export const createRecebivelOperacaoEstoqueSchema = z.object({
  operacao_estoque_id: z.number().positive(),
  empresa_id: z.string().uuid(),
  valor: z.number().positive(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD').nullable().optional(),
  descricao: z.string().optional(),
  tipo_estoque: z.enum(['SPPRO', 'SOI']),
});

export type CreateRecebivelOperacaoEstoque = z.infer<typeof createRecebivelOperacaoEstoqueSchema>;

// Schema para atualizar Recebível
export const updateRecebivelOperacaoEstoqueSchema = z.object({
  id: z.number().positive(),
  valor: z.number().positive().optional(),
  data_vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  descricao: z.string().optional(),
});

export type UpdateRecebivelOperacaoEstoque = z.infer<typeof updateRecebivelOperacaoEstoqueSchema>;

