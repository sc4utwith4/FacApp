-- ============================================
-- EXPANDIR TIPOS DE MOVIMENTAÇÕES DE ESTOQUE
-- Adiciona novos tipos para distribuição e transferências
-- ============================================

-- 1. Remover constraint antiga
ALTER TABLE public.movimentacoes_estoque 
DROP CONSTRAINT IF EXISTS movimentacoes_estoque_tipo_check;

-- 2. Adicionar constraint com novos tipos
ALTER TABLE public.movimentacoes_estoque
ADD CONSTRAINT movimentacoes_estoque_tipo_check 
CHECK (tipo IN (
  'acrescimos',
  'receita_juros',
  'entre_contas',
  'lancar_receitas',
  'devolucao_cheque',
  'conta_para_estoque',
  'estoque_para_conta',
  'estoque_para_estoque',
  'distribuicao_conta',
  'retido_estoque'
));

-- 3. Tornar operacao_estoque_id nullable (transferências não têm operação associada)
ALTER TABLE public.movimentacoes_estoque
ALTER COLUMN operacao_estoque_id DROP NOT NULL;

-- 4. Adicionar coluna conta_origem_id (opcional, para transferências futuras)
ALTER TABLE public.movimentacoes_estoque
ADD COLUMN IF NOT EXISTS conta_origem_id UUID REFERENCES public.contas_bancarias(id) ON DELETE SET NULL;

-- 5. Criar índice para conta_origem_id
CREATE INDEX IF NOT EXISTS idx_movimentacoes_conta_origem 
ON public.movimentacoes_estoque(conta_origem_id) 
WHERE conta_origem_id IS NOT NULL;

-- 6. Comentários para documentação
COMMENT ON COLUMN public.movimentacoes_estoque.tipo IS 
'Tipo de movimentação: distribuicao_conta (rateio do líquido), retido_estoque (diferença não distribuída), conta_para_estoque, estoque_para_conta, estoque_para_estoque (transferências)';

COMMENT ON COLUMN public.movimentacoes_estoque.conta_origem_id IS 
'Conta bancária de origem (usado em transferências conta -> estoque)';

