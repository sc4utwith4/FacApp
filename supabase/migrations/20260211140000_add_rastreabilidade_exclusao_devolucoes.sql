-- ============================================
-- FASE 2.1: Rastreabilidade determinística para exclusão de devoluções
-- ============================================
-- Adiciona referências explícitas para eliminar rollback por heurística
-- - devolucoes_estoque.operacao_entrada_devolucoes_id
-- - movimentacoes_estoque.operacao_destino_id
-- - movimentacoes_estoque.lancamento_destino_id
-- ============================================

-- 1) Devolução -> operação de entrada no estoque DEVOLUCOES
ALTER TABLE public.devolucoes_estoque
  ADD COLUMN IF NOT EXISTS operacao_entrada_devolucoes_id BIGINT NULL;

ALTER TABLE public.devolucoes_estoque
  DROP CONSTRAINT IF EXISTS fk_devolucoes_operacao_entrada_devolucoes;

ALTER TABLE public.devolucoes_estoque
  ADD CONSTRAINT fk_devolucoes_operacao_entrada_devolucoes
  FOREIGN KEY (operacao_entrada_devolucoes_id)
  REFERENCES public.operacoes_estoque(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_devolucoes_operacao_entrada_devolucoes
  ON public.devolucoes_estoque(operacao_entrada_devolucoes_id)
  WHERE operacao_entrada_devolucoes_id IS NOT NULL;

COMMENT ON COLUMN public.devolucoes_estoque.operacao_entrada_devolucoes_id IS
'Operação de entrada criada no estoque DEVOLUCOES para esta devolução (rastreabilidade determinística para exclusão)';

-- 2) Movimentação de transferência de devolução -> operação destino (quando destino = estoque)
ALTER TABLE public.movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS operacao_destino_id BIGINT NULL;

ALTER TABLE public.movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS fk_movimentacoes_operacao_destino;

ALTER TABLE public.movimentacoes_estoque
  ADD CONSTRAINT fk_movimentacoes_operacao_destino
  FOREIGN KEY (operacao_destino_id)
  REFERENCES public.operacoes_estoque(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movimentacoes_operacao_destino
  ON public.movimentacoes_estoque(operacao_destino_id)
  WHERE operacao_destino_id IS NOT NULL;

COMMENT ON COLUMN public.movimentacoes_estoque.operacao_destino_id IS
'Operação de entrada no estoque destino para movimentações de tipo devolucao_para_estoque';

-- 3) Movimentação de transferência de devolução -> lançamento destino (quando destino = conta)
ALTER TABLE public.movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS lancamento_destino_id UUID NULL;

ALTER TABLE public.movimentacoes_estoque
  DROP CONSTRAINT IF EXISTS fk_movimentacoes_lancamento_destino;

ALTER TABLE public.movimentacoes_estoque
  ADD CONSTRAINT fk_movimentacoes_lancamento_destino
  FOREIGN KEY (lancamento_destino_id)
  REFERENCES public.lancamentos_caixa(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_movimentacoes_lancamento_destino
  ON public.movimentacoes_estoque(lancamento_destino_id)
  WHERE lancamento_destino_id IS NOT NULL;

COMMENT ON COLUMN public.movimentacoes_estoque.lancamento_destino_id IS
'Lançamento de entrada na conta destino para movimentações de tipo devolucao_para_conta';
