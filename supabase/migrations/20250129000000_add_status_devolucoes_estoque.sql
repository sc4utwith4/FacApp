-- ============================================
-- MIGRATION: Adicionar campo status em devoluções_estoque
-- ============================================
-- Adiciona campo status para rastrear se devolução foi transferida
-- e novos tipos de movimentação para transferências de devoluções

-- ============================================
-- 1. ADICIONAR CAMPO STATUS
-- ============================================
ALTER TABLE public.devolucoes_estoque 
ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente' 
CHECK (status IN ('pendente', 'transferida', 'parcialmente_transferida'));

-- Comentário
COMMENT ON COLUMN public.devolucoes_estoque.status IS 'Status da devolução: pendente, transferida ou parcialmente_transferida';

-- ============================================
-- 2. ATUALIZAR TIPOS DE MOVIMENTAÇÃO
-- ============================================
-- Adicionar novos tipos de movimentação para transferências de devoluções
-- Nota: A tabela movimentacoes_estoque já aceita VARCHAR(20), então não precisa alterar o tipo
-- Mas precisamos atualizar o CHECK constraint se existir

-- Verificar se existe constraint e atualizar
DO $$
BEGIN
  -- Remover constraint antiga se existir
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'movimentacoes_estoque' 
    AND constraint_name LIKE '%tipo%check%'
  ) THEN
    ALTER TABLE public.movimentacoes_estoque 
    DROP CONSTRAINT IF EXISTS movimentacoes_estoque_tipo_check;
  END IF;
  
  -- Adicionar nova constraint com os novos tipos
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
    'conta_para_conta',
    'distribuicao_conta',
    'retido_estoque',
    'recompra',
    'devolucao_para_conta',
    'devolucao_para_estoque'
  ));
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint já existe, não fazer nada
    NULL;
END $$;

-- ============================================
-- 3. ÍNDICES PARA PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_devolucoes_status ON public.devolucoes_estoque(status);
CREATE INDEX IF NOT EXISTS idx_devolucoes_status_empresa ON public.devolucoes_estoque(empresa_id, status);

-- ============================================
-- 4. ATUALIZAR DEVOLUÇÕES EXISTENTES
-- ============================================
-- Todas as devoluções existentes devem ter status 'pendente'
UPDATE public.devolucoes_estoque 
SET status = 'pendente' 
WHERE status IS NULL;

