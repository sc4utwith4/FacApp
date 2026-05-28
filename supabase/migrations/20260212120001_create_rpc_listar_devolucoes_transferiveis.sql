-- ============================================
-- FASE 2.5: RPC determinístico para listar devoluções transferíveis
-- ============================================
-- Fonte de verdade: get_devolucao_restante_e_status(de.id)
-- Regra: listar apenas devoluções com valor_restante > 0.01
-- ============================================

CREATE OR REPLACE FUNCTION public.listar_devolucoes_transferiveis(payload JSONB DEFAULT '{}'::JSONB)
RETURNS TABLE(
  devolucao_id INTEGER,
  data_devolucao DATE,
  valor_devolucao NUMERIC,
  valor_transferido_calculado NUMERIC,
  valor_restante NUMERIC,
  status_calculado VARCHAR,
  operacao_estoque_id BIGINT,
  operacao_entrada_devolucoes_id BIGINT,
  historico TEXT,
  tipo_estoque VARCHAR,
  estoque_descricao TEXT,
  fornecedor_nome TEXT,
  fornecedor_nome_fantasia TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_empresa_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO: Usuário não autenticado';
  END IF;

  v_empresa_id := public.get_user_empresa_id();

  RETURN QUERY
  SELECT
    de.id AS devolucao_id,
    de.data_devolucao,
    COALESCE(de.valor_devolucao, 0)::NUMERIC AS valor_devolucao,
    (COALESCE(de.valor_devolucao, 0)::NUMERIC - COALESCE(dt.valor_restante, 0)::NUMERIC) AS valor_transferido_calculado,
    COALESCE(dt.valor_restante, 0)::NUMERIC AS valor_restante,
    COALESCE(dt.status_devolucao, 'pendente')::VARCHAR AS status_calculado,
    de.operacao_estoque_id::BIGINT,
    de.operacao_entrada_devolucoes_id::BIGINT,
    de.historico,
    e.tipo::VARCHAR AS tipo_estoque,
    e.descricao AS estoque_descricao,
    f.razao_social AS fornecedor_nome,
    f.nome_fantasia AS fornecedor_nome_fantasia
  FROM public.devolucoes_estoque de
  CROSS JOIN LATERAL public.get_devolucao_restante_e_status(de.id) dt
  LEFT JOIN public.operacoes_estoque oe ON oe.id = de.operacao_estoque_id
  LEFT JOIN public.estoques e ON e.id = oe.estoque_id
  LEFT JOIN public.fornecedores f ON f.id = oe.fornecedor_id
  WHERE de.empresa_id = v_empresa_id
    AND COALESCE(dt.valor_restante, 0) > 0.01
  ORDER BY de.data_devolucao DESC, de.id DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_devolucoes_transferiveis(JSONB) TO authenticated;
COMMENT ON FUNCTION public.listar_devolucoes_transferiveis(JSONB) IS
'Lista devoluções transferíveis com valor_restante derivado deterministicamente de devolucoes_transferencias (get_devolucao_restante_e_status)';
