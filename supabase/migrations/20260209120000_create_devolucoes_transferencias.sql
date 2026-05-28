-- ============================================
-- MIGRATION: Fase 2 - Modelo de devoluções com valor_transferido
-- ============================================
-- Cria tabela devolucoes_transferencias para persistir vínculo devolução x movimentação
-- Tabela de idempotência (request_id)
-- Função de cálculo de restante/status
-- RLS explícito em devolucoes_transferencias
-- ============================================

-- 1. TABELA devolucoes_transferencias
CREATE TABLE IF NOT EXISTS public.devolucoes_transferencias (
  id SERIAL PRIMARY KEY,
  devolucao_id INTEGER NOT NULL REFERENCES public.devolucoes_estoque(id) ON DELETE CASCADE,
  movimentacao_id BIGINT NOT NULL REFERENCES public.movimentacoes_estoque(id) ON DELETE CASCADE,
  valor_transferido NUMERIC(15,2) NOT NULL CHECK (valor_transferido > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_devolucao_movimentacao UNIQUE(devolucao_id, movimentacao_id)
);
CREATE INDEX IF NOT EXISTS idx_devolucoes_transferencias_devolucao ON public.devolucoes_transferencias(devolucao_id);
CREATE INDEX IF NOT EXISTS idx_devolucoes_transferencias_movimentacao ON public.devolucoes_transferencias(movimentacao_id);
COMMENT ON TABLE public.devolucoes_transferencias IS 'Vínculo devolução x movimentação para rastrear valor transferido por devolução';
COMMENT ON COLUMN public.devolucoes_transferencias.valor_transferido IS 'Valor transferido desta devolução nesta movimentação';
-- 2. TABELA de idempotência (request_id obrigatório)
CREATE TABLE IF NOT EXISTS public.devolucoes_transferencias_requests (
  request_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resultado JSONB NOT NULL
);
COMMENT ON TABLE public.devolucoes_transferencias_requests IS 'Idempotência: em conflito de request_id, retornar resultado já persistido';
-- 3. RLS em devolucoes_transferencias (isolamento por empresa via devolucoes_estoque)
ALTER TABLE public.devolucoes_transferencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT devolucoes_transferencias por empresa"
  ON public.devolucoes_transferencias
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.devolucoes_estoque de
      WHERE de.id = devolucoes_transferencias.devolucao_id
        AND de.empresa_id = public.get_user_empresa_id()
    )
  );
CREATE POLICY "INSERT devolucoes_transferencias por empresa"
  ON public.devolucoes_transferencias
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.devolucoes_estoque de
      WHERE de.id = devolucoes_transferencias.devolucao_id
        AND de.empresa_id = public.get_user_empresa_id()
    )
  );
-- 4. RLS em devolucoes_transferencias_requests (apenas authenticated; RPC SECURITY DEFINER gerencia)
ALTER TABLE public.devolucoes_transferencias_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "SELECT requests por usuario autenticado"
  ON public.devolucoes_transferencias_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "INSERT requests por usuario autenticado"
  ON public.devolucoes_transferencias_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
-- 5. Função: calcular valor_restante e status de uma devolução
CREATE OR REPLACE FUNCTION public.get_devolucao_restante_e_status(p_devolucao_id INTEGER)
RETURNS TABLE(valor_restante NUMERIC, status_devolucao VARCHAR) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valor_devolucao NUMERIC;
  v_valor_transferido NUMERIC := 0;
  v_status VARCHAR;
BEGIN
  SELECT valor_devolucao INTO v_valor_devolucao
  FROM devolucoes_estoque
  WHERE id = p_devolucao_id;

  IF v_valor_devolucao IS NULL THEN
    RAISE EXCEPTION 'DEVOLUCAO_NAO_ENCONTRADA: Devolução #% não encontrada', p_devolucao_id;
  END IF;

  SELECT COALESCE(SUM(valor_transferido), 0) INTO v_valor_transferido
  FROM devolucoes_transferencias
  WHERE devolucao_id = p_devolucao_id;

  v_status := CASE
    WHEN v_valor_transferido >= v_valor_devolucao THEN 'transferida'
    WHEN v_valor_transferido > 0 THEN 'parcialmente_transferida'
    ELSE 'pendente'
  END;

  valor_restante := GREATEST(0, v_valor_devolucao - v_valor_transferido);
  status_devolucao := v_status;
  RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_devolucao_restante_e_status(INTEGER) TO authenticated;
COMMENT ON FUNCTION public.get_devolucao_restante_e_status IS 'Retorna valor_restante e status derivado de SUM(valor_transferido)';
-- 6. Função: atualizar status em devolucoes_estoque a partir do acumulado
CREATE OR REPLACE FUNCTION public.atualizar_status_devolucao(p_devolucao_id INTEGER)
RETURNS VARCHAR
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status VARCHAR;
BEGIN
  SELECT status_devolucao INTO v_status
  FROM public.get_devolucao_restante_e_status(p_devolucao_id)
  LIMIT 1;

  UPDATE devolucoes_estoque
  SET status = v_status, updated_at = NOW()
  WHERE id = p_devolucao_id;

  RETURN v_status;
END;
$$;
GRANT EXECUTE ON FUNCTION public.atualizar_status_devolucao(INTEGER) TO authenticated;
