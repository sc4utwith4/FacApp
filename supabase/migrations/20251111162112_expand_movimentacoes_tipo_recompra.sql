-- ============================================
-- EXPANDIR TIPOS DE MOVIMENTAÇÕES PARA INCLUIR RECOMPRA
-- Permite registrar recompras como movimentação vinculada à operação de estoque
-- ============================================

-- Remover constraint atual e recriar com novo conjunto de tipos permitidos
ALTER TABLE public.movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS movimentacoes_estoque_tipo_check;

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
      'retido_estoque',
      'recompra'
    ));

COMMENT ON CONSTRAINT movimentacoes_estoque_tipo_check ON public.movimentacoes_estoque IS
  'Tipos de movimentação permitidos, incluindo registro de recompra vinculada à operação de estoque.';
