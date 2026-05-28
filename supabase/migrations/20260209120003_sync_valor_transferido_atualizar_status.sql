-- ============================================
-- Sincronizar valor_transferido em devolucoes_estoque ao atualizar status
-- Garante que o frontend calcule valor_restante = valor_devolucao - valor_transferido corretamente
-- ============================================

-- Garantir que valor_transferido existe em devolucoes_estoque (pode vir de 20260209000000)
ALTER TABLE public.devolucoes_estoque
  ADD COLUMN IF NOT EXISTS valor_transferido NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (valor_transferido >= 0);
ALTER TABLE public.devolucoes_estoque
  DROP CONSTRAINT IF EXISTS chk_devolucoes_valor_transferido_lte_valor;
ALTER TABLE public.devolucoes_estoque
  ADD CONSTRAINT chk_devolucoes_valor_transferido_lte_valor
  CHECK (valor_transferido <= valor_devolucao);
CREATE OR REPLACE FUNCTION public.atualizar_status_devolucao(p_devolucao_id INTEGER)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status VARCHAR;
  v_valor_transferido NUMERIC;
BEGIN
  SELECT status_devolucao INTO v_status
  FROM public.get_devolucao_restante_e_status(p_devolucao_id)
  LIMIT 1;

  SELECT COALESCE(SUM(valor_transferido), 0) INTO v_valor_transferido
  FROM devolucoes_transferencias
  WHERE devolucao_id = p_devolucao_id;

  UPDATE devolucoes_estoque
  SET status = v_status, updated_at = NOW(),
      valor_transferido = LEAST(v_valor_transferido, valor_devolucao)
  WHERE id = p_devolucao_id;

  RETURN v_status;
END;
$$;
