-- ============================================
-- FASE 2.6: origem explícita de devolução + RPC de transferíveis com classificação determinística
-- ============================================

-- 1) Coluna persistida para origem de devolução
ALTER TABLE public.devolucoes_estoque
  ADD COLUMN IF NOT EXISTS tipo_origem_devolucao VARCHAR(20);

ALTER TABLE public.devolucoes_estoque
  ALTER COLUMN tipo_origem_devolucao SET DEFAULT 'NAO_CLASSIFICADO';

-- 2) Backfill determinístico
-- 2.1) Devoluções vinculadas a operação: usar tipo do estoque da operação
UPDATE public.devolucoes_estoque de
SET tipo_origem_devolucao = e.tipo
FROM public.operacoes_estoque oe
JOIN public.estoques e ON e.id = oe.estoque_id
WHERE de.operacao_estoque_id = oe.id
  AND e.tipo IN ('SPPRO', 'SOI')
  AND (
    de.tipo_origem_devolucao IS NULL
    OR de.tipo_origem_devolucao = 'NAO_CLASSIFICADO'
  );

-- 2.2) Devoluções diretas: padrão estrito por histórico do lançamento de caixa
UPDATE public.devolucoes_estoque de
SET tipo_origem_devolucao = 'SPPRO'
FROM public.lancamentos_caixa lc
WHERE lc.id = de.lancamento_caixa_id
  AND de.operacao_estoque_id IS NULL
  AND (
    de.tipo_origem_devolucao IS NULL
    OR de.tipo_origem_devolucao = 'NAO_CLASSIFICADO'
  )
  AND lc.historico ILIKE 'Devolução Estoque SPPRO%';

UPDATE public.devolucoes_estoque de
SET tipo_origem_devolucao = 'SOI'
FROM public.lancamentos_caixa lc
WHERE lc.id = de.lancamento_caixa_id
  AND de.operacao_estoque_id IS NULL
  AND (
    de.tipo_origem_devolucao IS NULL
    OR de.tipo_origem_devolucao = 'NAO_CLASSIFICADO'
  )
  AND lc.historico ILIKE 'Devolução Estoque SOI%';

-- 2.3) Restante legado sem origem determinística
UPDATE public.devolucoes_estoque
SET tipo_origem_devolucao = 'NAO_CLASSIFICADO'
WHERE tipo_origem_devolucao IS NULL;

ALTER TABLE public.devolucoes_estoque
  DROP CONSTRAINT IF EXISTS chk_devolucoes_tipo_origem_devolucao;

ALTER TABLE public.devolucoes_estoque
  ADD CONSTRAINT chk_devolucoes_tipo_origem_devolucao
  CHECK (tipo_origem_devolucao IN ('SPPRO', 'SOI', 'NAO_CLASSIFICADO'));

ALTER TABLE public.devolucoes_estoque
  ALTER COLUMN tipo_origem_devolucao SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_devolucoes_empresa_tipo_origem
  ON public.devolucoes_estoque (empresa_id, tipo_origem_devolucao);

COMMENT ON COLUMN public.devolucoes_estoque.tipo_origem_devolucao IS
'Origem explícita da devolução para breakdown no dashboard e transferências: SPPRO, SOI ou NAO_CLASSIFICADO';

-- 3) RPC determinístico de transferíveis com origem explícita
DROP FUNCTION IF EXISTS public.listar_devolucoes_transferiveis(JSONB);

CREATE FUNCTION public.listar_devolucoes_transferiveis(payload JSONB DEFAULT '{}'::JSONB)
RETURNS TABLE(
  devolucao_id INTEGER,
  data_devolucao DATE,
  valor_devolucao NUMERIC,
  valor_transferido_calculado NUMERIC,
  valor_restante NUMERIC,
  status_calculado VARCHAR,
  operacao_estoque_id BIGINT,
  operacao_entrada_devolucoes_id BIGINT,
  tipo_origem_devolucao VARCHAR,
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
    de.id::INTEGER AS devolucao_id,
    de.data_devolucao::DATE,
    COALESCE(de.valor_devolucao, 0)::NUMERIC AS valor_devolucao,
    (COALESCE(de.valor_devolucao, 0)::NUMERIC - COALESCE(dt.valor_restante, 0)::NUMERIC) AS valor_transferido_calculado,
    COALESCE(dt.valor_restante, 0)::NUMERIC AS valor_restante,
    COALESCE(dt.status_devolucao, 'pendente')::VARCHAR AS status_calculado,
    de.operacao_estoque_id::BIGINT,
    de.operacao_entrada_devolucoes_id::BIGINT,
    COALESCE(de.tipo_origem_devolucao, 'NAO_CLASSIFICADO')::VARCHAR AS tipo_origem_devolucao,
    de.historico::TEXT,
    e.tipo::VARCHAR AS tipo_estoque,
    e.descricao::TEXT AS estoque_descricao,
    f.razao_social::TEXT AS fornecedor_nome,
    f.nome_fantasia::TEXT AS fornecedor_nome_fantasia
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
'Lista devoluções transferíveis com valor_restante determinístico e origem explícita (SPPRO/SOI/NAO_CLASSIFICADO)';
