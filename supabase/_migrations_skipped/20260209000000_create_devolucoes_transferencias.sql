-- ============================================
-- Fase 2: Persistência determinística de valor transferido por devolução
-- Tabela devolucoes_transferencias + coluna valor_transferido + status derivado
-- ============================================

-- 1. Tabela de vínculo: cada linha = parte de uma transferência atribuída a uma devolução
CREATE TABLE IF NOT EXISTS public.devolucoes_transferencias (
  id SERIAL PRIMARY KEY,
  devolucao_id INTEGER NOT NULL REFERENCES public.devolucoes_estoque(id) ON DELETE CASCADE,
  movimentacao_id BIGINT NOT NULL REFERENCES public.movimentacoes_estoque(id) ON DELETE CASCADE,
  valor_transferido NUMERIC(15,2) NOT NULL CHECK (valor_transferido > 0),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devolucoes_transferencias_devolucao ON public.devolucoes_transferencias(devolucao_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_transferencias_movimentacao ON public.devolucoes_transferencias(movimentacao_id);

COMMENT ON TABLE public.devolucoes_transferencias IS 'Vínculo devolução x movimentação: quanto de cada devolução foi transferido em cada movimentação';

-- 2. Coluna valor_transferido em devolucoes_estoque (acumulado, para leitura e status)
ALTER TABLE public.devolucoes_estoque
  ADD COLUMN IF NOT EXISTS valor_transferido NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (valor_transferido >= 0);

-- Constraint: valor_transferido não pode superar valor_devolucao
ALTER TABLE public.devolucoes_estoque
  DROP CONSTRAINT IF EXISTS chk_devolucoes_valor_transferido_lte_valor;
ALTER TABLE public.devolucoes_estoque
  ADD CONSTRAINT chk_devolucoes_valor_transferido_lte_valor
  CHECK (valor_transferido <= valor_devolucao);

COMMENT ON COLUMN public.devolucoes_estoque.valor_transferido IS 'Valor já transferido (acumulado). Status derivado: pendente | parcialmente_transferida | transferida';

-- 3. Trigger: ao atualizar valor_transferido, definir status de forma determinística
CREATE OR REPLACE FUNCTION public.set_status_devolucao_from_valor_transferido()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.valor_transferido >= NEW.valor_devolucao THEN
    NEW.status := 'transferida';
  ELSIF NEW.valor_transferido > 0 THEN
    NEW.status := 'parcialmente_transferida';
  ELSE
    NEW.status := 'pendente';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_status_devolucao_valor_transferido ON public.devolucoes_estoque;
CREATE TRIGGER trigger_set_status_devolucao_valor_transferido
  BEFORE INSERT OR UPDATE OF valor_transferido ON public.devolucoes_estoque
  FOR EACH ROW
  EXECUTE FUNCTION public.set_status_devolucao_from_valor_transferido();

-- 4. Backfill: devoluções já marcadas como transferida → valor_transferido = valor_devolucao
UPDATE public.devolucoes_estoque
SET valor_transferido = valor_devolucao
WHERE status = 'transferida' AND COALESCE(valor_transferido, 0) = 0;

-- Parcialmente transferidas: aproximação (metade) para manter status; sem histórico exato
UPDATE public.devolucoes_estoque
SET valor_transferido = valor_devolucao * 0.5
WHERE status = 'parcialmente_transferida' AND COALESCE(valor_transferido, 0) = 0;

-- 5. RLS para devolucoes_transferencias (herdar da empresa via devolucao)
ALTER TABLE public.devolucoes_transferencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ver transferências de devoluções da própria empresa"
  ON public.devolucoes_transferencias
  FOR SELECT
  USING (
    devolucao_id IN (
      SELECT id FROM public.devolucoes_estoque
      WHERE empresa_id IN (SELECT empresa_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Inserir transferências em devoluções da própria empresa"
  ON public.devolucoes_transferencias
  FOR INSERT
  WITH CHECK (
    devolucao_id IN (
      SELECT id FROM public.devolucoes_estoque
      WHERE empresa_id IN (SELECT empresa_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Atualizar transferências de devoluções da própria empresa"
  ON public.devolucoes_transferencias
  FOR UPDATE
  USING (
    devolucao_id IN (
      SELECT id FROM public.devolucoes_estoque
      WHERE empresa_id IN (SELECT empresa_id FROM public.profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Deletar transferências de devoluções da própria empresa"
  ON public.devolucoes_transferencias
  FOR DELETE
  USING (
    devolucao_id IN (
      SELECT id FROM public.devolucoes_estoque
      WHERE empresa_id IN (SELECT empresa_id FROM public.profiles WHERE id = auth.uid())
    )
  );
