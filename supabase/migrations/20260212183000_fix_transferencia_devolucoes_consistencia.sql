-- ============================================
-- FASE 2.7: Consistência de devoluções (transferência + criação + diagnóstico/reparo)
-- ============================================
-- Objetivos:
-- 1) Expor limite operacional de transferência no RPC listar_devolucoes_transferiveis
-- 2) Fornecer diagnóstico estruturado de consistência de devoluções
-- 3) Disponibilizar reparo determinístico (dry_run/apply) sem heurística destrutiva
-- 4) Criar RPC transacional/idempotente para criação de devolução (evita fluxo client-side parcial)
-- 5) Corrigir funções verificar/recalcular saldos (ambiguidade + regra DEVOLUCOES por liquido/movimentações)
-- ============================================

-- ------------------------------------------------------------
-- 1) Idempotência da criação de devolução
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devolucoes_criacao_requests (
  request_id UUID PRIMARY KEY,
  resultado JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.devolucoes_criacao_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT devolucoes_criacao_requests por usuario autenticado" ON public.devolucoes_criacao_requests;
CREATE POLICY "SELECT devolucoes_criacao_requests por usuario autenticado"
  ON public.devolucoes_criacao_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "INSERT devolucoes_criacao_requests por usuario autenticado" ON public.devolucoes_criacao_requests;
CREATE POLICY "INSERT devolucoes_criacao_requests por usuario autenticado"
  ON public.devolucoes_criacao_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.devolucoes_criacao_requests IS
'Idempotência para RPC criar_devolucao_estoque: mesma request_id retorna resultado persistido';

-- ------------------------------------------------------------
-- 2) RPC: listar_devolucoes_transferiveis com limite operacional
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.listar_devolucoes_transferiveis(JSONB);

CREATE FUNCTION public.listar_devolucoes_transferiveis(payload JSONB DEFAULT '{}'::JSONB)
RETURNS TABLE(
  devolucao_id INTEGER,
  data_devolucao DATE,
  valor_devolucao NUMERIC,
  valor_transferido_calculado NUMERIC,
  valor_restante NUMERIC,
  valor_transferivel_agora NUMERIC,
  saldo_devolucoes_atual NUMERIC,
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
  v_estoque_devolucoes_id BIGINT;
  v_saldo_devolucoes NUMERIC := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NAO_AUTENTICADO: Usuário não autenticado';
  END IF;

  v_empresa_id := public.get_user_empresa_id();

  SELECT e.id, COALESCE(e.saldo_atual, 0)::NUMERIC
  INTO v_estoque_devolucoes_id, v_saldo_devolucoes
  FROM public.estoques e
  WHERE e.empresa_id = v_empresa_id
    AND e.tipo = 'DEVOLUCOES'
    AND e.ativo = true
  ORDER BY e.id
  LIMIT 1;

  IF v_estoque_devolucoes_id IS NULL THEN
    v_saldo_devolucoes := 0;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT
      de.id::INTEGER AS devolucao_id,
      de.data_devolucao::DATE AS data_devolucao,
      COALESCE(de.valor_devolucao, 0)::NUMERIC AS valor_devolucao,
      (COALESCE(de.valor_devolucao, 0)::NUMERIC - COALESCE(dt.valor_restante, 0)::NUMERIC) AS valor_transferido_calculado,
      COALESCE(dt.valor_restante, 0)::NUMERIC AS valor_restante,
      COALESCE(dt.status_devolucao, 'pendente')::VARCHAR AS status_calculado,
      de.operacao_estoque_id::BIGINT AS operacao_estoque_id,
      de.operacao_entrada_devolucoes_id::BIGINT AS operacao_entrada_devolucoes_id,
      COALESCE(de.tipo_origem_devolucao, 'NAO_CLASSIFICADO')::VARCHAR AS tipo_origem_devolucao,
      de.historico::TEXT AS historico,
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
  ),
  running AS (
    SELECT
      b.*,
      COALESCE(
        SUM(b.valor_restante) OVER (
          ORDER BY b.data_devolucao DESC, b.devolucao_id DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ),
        0
      )::NUMERIC AS acumulado_antes
    FROM base b
  )
  SELECT
    r.devolucao_id,
    r.data_devolucao,
    r.valor_devolucao,
    r.valor_transferido_calculado,
    r.valor_restante,
    GREATEST(
      0::NUMERIC,
      LEAST(r.valor_restante, (v_saldo_devolucoes - r.acumulado_antes))
    )::NUMERIC AS valor_transferivel_agora,
    v_saldo_devolucoes::NUMERIC AS saldo_devolucoes_atual,
    r.status_calculado,
    r.operacao_estoque_id,
    r.operacao_entrada_devolucoes_id,
    r.tipo_origem_devolucao,
    r.historico,
    r.tipo_estoque,
    r.estoque_descricao,
    r.fornecedor_nome,
    r.fornecedor_nome_fantasia
  FROM running r
  ORDER BY r.data_devolucao DESC, r.devolucao_id DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.listar_devolucoes_transferiveis(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.listar_devolucoes_transferiveis(JSONB) TO service_role;
COMMENT ON FUNCTION public.listar_devolucoes_transferiveis(JSONB) IS
'Lista devoluções com valor_restante determinístico e valor_transferivel_agora limitado pelo saldo atual do estoque DEVOLUCOES (ordem LIFO)';

-- ------------------------------------------------------------
-- 3) RPC: diagnóstico de consistência de devoluções
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(payload JSONB DEFAULT '{}'::JSONB)
RETURNS TABLE(
  saldo_estoque_atual NUMERIC,
  saldo_operacional_calculado NUMERIC,
  total_restante_deterministico NUMERIC,
  gap_movimentacoes_sem_vinculo NUMERIC,
  devolucoes_sem_operacao_entrada INTEGER,
  movimentacoes_com_gap INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_empresa_id UUID;
  v_estoque_devolucoes_id BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    v_empresa_id := NULLIF(payload->>'empresa_id', '')::UUID;
    IF v_empresa_id IS NULL THEN
      RAISE EXCEPTION 'NAO_AUTENTICADO: Usuário não autenticado e empresa_id não informado';
    END IF;
  ELSE
    v_empresa_id := public.get_user_empresa_id();
  END IF;

  SELECT e.id
  INTO v_estoque_devolucoes_id
  FROM public.estoques e
  WHERE e.empresa_id = v_empresa_id
    AND e.tipo = 'DEVOLUCOES'
    AND e.ativo = true
  ORDER BY e.id
  LIMIT 1;

  RETURN QUERY
  WITH devolucoes_base AS (
    SELECT
      de.id,
      COALESCE(de.valor_devolucao, 0)::NUMERIC AS valor_devolucao,
      de.operacao_entrada_devolucoes_id
    FROM public.devolucoes_estoque de
    WHERE de.empresa_id = v_empresa_id
  ),
  transferencias_por_devolucao AS (
    SELECT
      dt.devolucao_id,
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_transferido
    FROM public.devolucoes_transferencias dt
    GROUP BY dt.devolucao_id
  ),
  restante AS (
    SELECT
      db.id,
      GREATEST(0::NUMERIC, db.valor_devolucao - COALESCE(tp.valor_transferido, 0)::NUMERIC) AS valor_restante
    FROM devolucoes_base db
    LEFT JOIN transferencias_por_devolucao tp ON tp.devolucao_id = db.id
  ),
  entradas_ledger AS (
    SELECT
      COALESCE(SUM(oe.liquido_operacao), 0)::NUMERIC AS total
    FROM public.operacoes_estoque oe
    WHERE oe.empresa_id = v_empresa_id
      AND oe.estoque_id = v_estoque_devolucoes_id
      AND oe.tipo_operacao = 'entrada'
  ),
  saidas_ledger AS (
    SELECT
      COALESCE(SUM(me.valor), 0)::NUMERIC AS total
    FROM public.movimentacoes_estoque me
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
  ),
  gaps_mov AS (
    SELECT
      me.id,
      COALESCE(me.valor, 0)::NUMERIC AS valor_mov,
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_vinculado
    FROM public.movimentacoes_estoque me
    LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    GROUP BY me.id, me.valor
  )
  SELECT
    COALESCE(
      (
        SELECT COALESCE(e.saldo_atual, 0)::NUMERIC
        FROM public.estoques e
        WHERE e.id = v_estoque_devolucoes_id
      ),
      0::NUMERIC
    ) AS saldo_estoque_atual,
    COALESCE((SELECT total FROM entradas_ledger), 0::NUMERIC) - COALESCE((SELECT total FROM saidas_ledger), 0::NUMERIC) AS saldo_operacional_calculado,
    COALESCE((SELECT SUM(r.valor_restante) FROM restante r), 0::NUMERIC) AS total_restante_deterministico,
    COALESCE(
      (
        SELECT SUM(GREATEST(0::NUMERIC, gm.valor_mov - gm.valor_vinculado))
        FROM gaps_mov gm
      ),
      0::NUMERIC
    ) AS gap_movimentacoes_sem_vinculo,
    COALESCE(
      (
        SELECT COUNT(*)::INTEGER
        FROM devolucoes_base db
        WHERE db.operacao_entrada_devolucoes_id IS NULL
      ),
      0
    ) AS devolucoes_sem_operacao_entrada,
    COALESCE(
      (
        SELECT COUNT(*)::INTEGER
        FROM gaps_mov gm
        WHERE gm.valor_mov - gm.valor_vinculado > 0.01
      ),
      0
    ) AS movimentacoes_com_gap;
END;
$$;

GRANT EXECUTE ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) TO service_role;
COMMENT ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) IS
'Diagnóstico de consistência de devoluções: saldo snapshot x saldo operacional x restante determinístico e gaps de vínculos';

-- ------------------------------------------------------------
-- 4) RPC: reparo determinístico (dry_run/apply)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reparar_inconsistencias_devolucoes_estoque(payload JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_empresa_id UUID;
  v_mode TEXT;
  v_apply BOOLEAN;
  v_estoque_devolucoes_id BIGINT;
  v_saldo_antes NUMERIC := 0;
  v_saldo_operacional NUMERIC := 0;
  v_saldo_aplicado NUMERIC := 0;
  v_sem_operacao_entrada_antes INTEGER := 0;
  v_sem_operacao_entrada_depois INTEGER := 0;
  v_backfill_candidates INTEGER := 0;
  v_backfill_aplicados INTEGER := 0;
  v_total_restante NUMERIC := 0;
  v_gap_sem_vinculo NUMERIC := 0;
  v_mov_gap INTEGER := 0;
BEGIN
  v_mode := LOWER(COALESCE(payload->>'mode', 'dry_run'));
  IF v_mode NOT IN ('dry_run', 'apply') THEN
    RETURN jsonb_build_object(
      'error', 'Modo inválido. Use dry_run ou apply',
      'code', 'MODO_INVALIDO'
    );
  END IF;
  v_apply := (v_mode = 'apply');

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    v_empresa_id := NULLIF(payload->>'empresa_id', '')::UUID;
    IF v_empresa_id IS NULL THEN
      RETURN jsonb_build_object(
        'error', 'Usuário não autenticado e empresa_id não informado',
        'code', 'NAO_AUTENTICADO'
      );
    END IF;
  ELSE
    v_empresa_id := public.get_user_empresa_id();
  END IF;

  SELECT e.id, COALESCE(e.saldo_atual, 0)::NUMERIC
  INTO v_estoque_devolucoes_id, v_saldo_antes
  FROM public.estoques e
  WHERE e.empresa_id = v_empresa_id
    AND e.tipo = 'DEVOLUCOES'
    AND e.ativo = true
  ORDER BY e.id
  LIMIT 1;

  IF v_estoque_devolucoes_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Estoque DEVOLUCOES não encontrado',
      'code', 'ESTOQUE_NAO_ENCONTRADO'
    );
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_sem_operacao_entrada_antes
  FROM public.devolucoes_estoque de
  WHERE de.empresa_id = v_empresa_id
    AND de.operacao_entrada_devolucoes_id IS NULL;

  WITH candidatos AS (
    SELECT
      de.id AS devolucao_id,
      oe.id AS operacao_entrada_id
    FROM public.devolucoes_estoque de
    JOIN public.operacoes_estoque oe
      ON oe.empresa_id = de.empresa_id
     AND oe.estoque_id = v_estoque_devolucoes_id
     AND oe.tipo_operacao = 'entrada'
     AND oe.data = de.data_devolucao
     AND ABS(COALESCE(oe.liquido_operacao, 0)::NUMERIC - COALESCE(de.valor_devolucao, 0)::NUMERIC) <= 0.01
     AND (de.created_by IS NULL OR oe.created_by = de.created_by)
     AND COALESCE(oe.historico, '') ILIKE 'Entrada por devolução%'
    WHERE de.empresa_id = v_empresa_id
      AND de.operacao_entrada_devolucoes_id IS NULL
  ),
  unicos_por_devolucao AS (
    SELECT
      c.devolucao_id,
      MIN(c.operacao_entrada_id) AS operacao_entrada_id
    FROM candidatos c
    GROUP BY c.devolucao_id
    HAVING COUNT(*) = 1
  ),
  sem_uso_previo AS (
    SELECT
      u.devolucao_id,
      u.operacao_entrada_id
    FROM unicos_por_devolucao u
    LEFT JOIN public.devolucoes_estoque ja
      ON ja.operacao_entrada_devolucoes_id = u.operacao_entrada_id
    WHERE ja.id IS NULL
  ),
  deterministico AS (
    SELECT
      s.devolucao_id,
      s.operacao_entrada_id
    FROM (
      SELECT
        sup.*,
        ROW_NUMBER() OVER (PARTITION BY sup.operacao_entrada_id ORDER BY sup.devolucao_id) AS rn
      FROM sem_uso_previo sup
    ) s
    WHERE s.rn = 1
  )
  SELECT COUNT(*)::INTEGER
  INTO v_backfill_candidates
  FROM deterministico;

  IF v_apply THEN
    WITH candidatos AS (
      SELECT
        de.id AS devolucao_id,
        oe.id AS operacao_entrada_id
      FROM public.devolucoes_estoque de
      JOIN public.operacoes_estoque oe
        ON oe.empresa_id = de.empresa_id
       AND oe.estoque_id = v_estoque_devolucoes_id
       AND oe.tipo_operacao = 'entrada'
       AND oe.data = de.data_devolucao
       AND ABS(COALESCE(oe.liquido_operacao, 0)::NUMERIC - COALESCE(de.valor_devolucao, 0)::NUMERIC) <= 0.01
       AND (de.created_by IS NULL OR oe.created_by = de.created_by)
       AND COALESCE(oe.historico, '') ILIKE 'Entrada por devolução%'
      WHERE de.empresa_id = v_empresa_id
        AND de.operacao_entrada_devolucoes_id IS NULL
    ),
    unicos_por_devolucao AS (
      SELECT
        c.devolucao_id,
        MIN(c.operacao_entrada_id) AS operacao_entrada_id
      FROM candidatos c
      GROUP BY c.devolucao_id
      HAVING COUNT(*) = 1
    ),
    sem_uso_previo AS (
      SELECT
        u.devolucao_id,
        u.operacao_entrada_id
      FROM unicos_por_devolucao u
      LEFT JOIN public.devolucoes_estoque ja
        ON ja.operacao_entrada_devolucoes_id = u.operacao_entrada_id
      WHERE ja.id IS NULL
    ),
    deterministico AS (
      SELECT
        s.devolucao_id,
        s.operacao_entrada_id
      FROM (
        SELECT
          sup.*,
          ROW_NUMBER() OVER (PARTITION BY sup.operacao_entrada_id ORDER BY sup.devolucao_id) AS rn
        FROM sem_uso_previo sup
      ) s
      WHERE s.rn = 1
    ),
    upd AS (
      UPDATE public.devolucoes_estoque de
      SET
        operacao_entrada_devolucoes_id = d.operacao_entrada_id,
        updated_at = NOW()
      FROM deterministico d
      WHERE de.id = d.devolucao_id
        AND de.empresa_id = v_empresa_id
        AND de.operacao_entrada_devolucoes_id IS NULL
      RETURNING de.id
    )
    SELECT COUNT(*)::INTEGER
    INTO v_backfill_aplicados
    FROM upd;
  END IF;

  -- saldo operacional por ledger DEVOLUCOES
  SELECT
    COALESCE(
      (
        SELECT SUM(oe.liquido_operacao)
        FROM public.operacoes_estoque oe
        WHERE oe.empresa_id = v_empresa_id
          AND oe.estoque_id = v_estoque_devolucoes_id
          AND oe.tipo_operacao = 'entrada'
      ),
      0
    )::NUMERIC
    -
    COALESCE(
      (
        SELECT SUM(me.valor)
        FROM public.movimentacoes_estoque me
        WHERE me.estoque_origem_id = v_estoque_devolucoes_id
          AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
      ),
      0
    )::NUMERIC
  INTO v_saldo_operacional;

  IF v_apply THEN
    UPDATE public.estoques e
    SET
      saldo_atual = GREATEST(0::NUMERIC, v_saldo_operacional),
      updated_at = NOW()
    WHERE e.id = v_estoque_devolucoes_id;
  END IF;

  SELECT COALESCE(e.saldo_atual, 0)::NUMERIC
  INTO v_saldo_aplicado
  FROM public.estoques e
  WHERE e.id = v_estoque_devolucoes_id;

  SELECT COUNT(*)::INTEGER
  INTO v_sem_operacao_entrada_depois
  FROM public.devolucoes_estoque de
  WHERE de.empresa_id = v_empresa_id
    AND de.operacao_entrada_devolucoes_id IS NULL;

  WITH mov AS (
    SELECT
      me.id,
      COALESCE(me.valor, 0)::NUMERIC AS valor_mov,
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_vinculado
    FROM public.movimentacoes_estoque me
    LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    GROUP BY me.id, me.valor
  )
  SELECT
    COALESCE(SUM(GREATEST(0::NUMERIC, mov.valor_mov - mov.valor_vinculado)), 0)::NUMERIC,
    COALESCE(COUNT(*) FILTER (WHERE mov.valor_mov - mov.valor_vinculado > 0.01), 0)::INTEGER
  INTO v_gap_sem_vinculo, v_mov_gap
  FROM mov;

  WITH dev AS (
    SELECT
      de.id,
      COALESCE(de.valor_devolucao, 0)::NUMERIC AS valor_devolucao
    FROM public.devolucoes_estoque de
    WHERE de.empresa_id = v_empresa_id
  ),
  transf AS (
    SELECT
      dt.devolucao_id,
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_transferido
    FROM public.devolucoes_transferencias dt
    GROUP BY dt.devolucao_id
  )
  SELECT COALESCE(SUM(GREATEST(0::NUMERIC, dev.valor_devolucao - COALESCE(transf.valor_transferido, 0))), 0)::NUMERIC
  INTO v_total_restante
  FROM dev
  LEFT JOIN transf ON transf.devolucao_id = dev.id;

  RETURN jsonb_build_object(
    'mode', v_mode,
    'empresa_id', v_empresa_id,
    'estoque_devolucoes_id', v_estoque_devolucoes_id,
    'saldo_antes', v_saldo_antes,
    'saldo_operacional_calculado', v_saldo_operacional,
    'saldo_final', v_saldo_aplicado,
    'devolucoes_sem_operacao_entrada_antes', v_sem_operacao_entrada_antes,
    'devolucoes_backfill_candidatas', v_backfill_candidates,
    'devolucoes_backfill_aplicadas', v_backfill_aplicados,
    'devolucoes_sem_operacao_entrada_depois', v_sem_operacao_entrada_depois,
    'total_restante_deterministico', v_total_restante,
    'gap_movimentacoes_sem_vinculo', v_gap_sem_vinculo,
    'movimentacoes_com_gap', v_mov_gap
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reparar_inconsistencias_devolucoes_estoque(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reparar_inconsistencias_devolucoes_estoque(JSONB) TO service_role;
COMMENT ON FUNCTION public.reparar_inconsistencias_devolucoes_estoque(JSONB) IS
'Reparo determinístico de devoluções: backfill estrito de operacao_entrada_devolucoes_id e recomposição do saldo snapshot DEVOLUCOES (dry_run/apply)';

-- ------------------------------------------------------------
-- 5) RPC: criação transacional/idempotente de devolução
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.criar_devolucao_estoque(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_existing JSONB;
  v_user_id UUID;
  v_empresa_id UUID;
  v_data_devolucao DATE;
  v_valor_devolucao NUMERIC;
  v_operacao_estoque_id BIGINT;
  v_tipo_estoque TEXT;
  v_conta_payload UUID;
  v_historico TEXT;
  v_observacoes TEXT;
  v_conta_sb_id UUID;
  v_estoque_devolucoes_id BIGINT;
  v_fornecedor_id UUID;
  v_tipo_origem VARCHAR(20) := 'NAO_CLASSIFICADO';
  v_face_titulos NUMERIC := 0;
  v_total_devolvido NUMERIC := 0;
  v_saldo_disponivel NUMERIC := 0;
  v_qtd_estoques_tipo INTEGER := 0;
  v_historico_lancamento TEXT;
  v_historico_operacao_entrada TEXT;
  v_observacao_lancamento TEXT;
  v_lancamento_id UUID;
  v_devolucao_id INTEGER;
  v_operacao_entrada_id BIGINT;
BEGIN
  v_request_id := NULLIF(payload->>'request_id', '')::UUID;
  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('error', 'request_id obrigatório', 'code', 'REQUEST_ID_INVALIDO');
  END IF;

  SELECT r.resultado INTO v_existing
  FROM public.devolucoes_criacao_requests r
  WHERE r.request_id = v_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não autenticado', 'code', 'NAO_AUTENTICADO');
  END IF;

  v_empresa_id := public.get_user_empresa_id();
  IF v_empresa_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Empresa não encontrada para o usuário', 'code', 'EMPRESA_NAO_ENCONTRADA');
  END IF;

  v_data_devolucao := NULLIF(payload->>'data_devolucao', '')::DATE;
  IF v_data_devolucao IS NULL THEN
    RETURN jsonb_build_object('error', 'data_devolucao obrigatória', 'code', 'DATA_INVALIDA');
  END IF;

  v_valor_devolucao := COALESCE(NULLIF(payload->>'valor_devolucao', '')::NUMERIC, 0);
  IF v_valor_devolucao <= 0 THEN
    RETURN jsonb_build_object('error', 'valor_devolucao deve ser maior que zero', 'code', 'VALOR_INVALIDO');
  END IF;

  v_operacao_estoque_id := NULLIF(payload->>'operacao_estoque_id', '')::BIGINT;
  v_tipo_estoque := UPPER(COALESCE(NULLIF(payload->>'tipo_estoque', ''), ''));
  v_conta_payload := NULLIF(payload->>'conta_bancaria_id', '')::UUID;
  v_historico := NULLIF(payload->>'historico', '');
  v_observacoes := NULLIF(payload->>'observacoes', '');

  SELECT cb.id
  INTO v_conta_sb_id
  FROM public.contas_bancarias cb
  WHERE cb.empresa_id = v_empresa_id
    AND cb.descricao ILIKE '%SB-S0I2%'
  ORDER BY cb.id
  LIMIT 1;

  IF v_conta_sb_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Conta SB-S0I2 não encontrada',
      'code', 'CONTA_SB_S0I2_NAO_ENCONTRADA'
    );
  END IF;

  IF v_conta_payload IS NOT NULL AND v_conta_payload <> v_conta_sb_id THEN
    RETURN jsonb_build_object(
      'error', 'A devolução deve ser registrada na conta SB-S0I2',
      'code', 'CONTA_INVALIDA'
    );
  END IF;

  SELECT e.id
  INTO v_estoque_devolucoes_id
  FROM public.estoques e
  WHERE e.empresa_id = v_empresa_id
    AND e.tipo = 'DEVOLUCOES'
    AND e.ativo = true
  ORDER BY e.id
  LIMIT 1
  FOR UPDATE;

  IF v_estoque_devolucoes_id IS NULL THEN
    INSERT INTO public.estoques (
      empresa_id,
      tipo,
      descricao,
      saldo_inicial,
      saldo_atual,
      ativo,
      created_by
    )
    VALUES (
      v_empresa_id,
      'DEVOLUCOES',
      'Estoque de Devoluções',
      0,
      0,
      true,
      v_user_id
    )
    RETURNING id INTO v_estoque_devolucoes_id;
  END IF;

  IF v_operacao_estoque_id IS NOT NULL AND v_operacao_estoque_id > 0 THEN
    SELECT
      oe.face_titulos,
      oe.fornecedor_id,
      CASE WHEN e.tipo IN ('SPPRO', 'SOI') THEN e.tipo ELSE 'NAO_CLASSIFICADO' END
    INTO
      v_face_titulos,
      v_fornecedor_id,
      v_tipo_origem
    FROM public.operacoes_estoque oe
    JOIN public.estoques e ON e.id = oe.estoque_id
    WHERE oe.id = v_operacao_estoque_id
      AND oe.empresa_id = v_empresa_id
      AND oe.tipo_operacao = 'entrada'
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'error', 'Operação de estoque não encontrada',
        'code', 'OPERACAO_NAO_ENCONTRADA'
      );
    END IF;

    PERFORM 1
    FROM public.devolucoes_estoque de
    WHERE de.empresa_id = v_empresa_id
      AND de.operacao_estoque_id = v_operacao_estoque_id
    FOR UPDATE;

    SELECT COALESCE(SUM(de.valor_devolucao), 0)::NUMERIC
    INTO v_total_devolvido
    FROM public.devolucoes_estoque de
    WHERE de.empresa_id = v_empresa_id
      AND de.operacao_estoque_id = v_operacao_estoque_id;

    IF (v_total_devolvido + v_valor_devolucao) > (COALESCE(v_face_titulos, 0) + 0.01) THEN
      RETURN jsonb_build_object(
        'error', 'Total de devoluções excede a Face dos Títulos da operação',
        'code', 'LIMITE_FACE_EXCEDIDO',
        'face_titulos', COALESCE(v_face_titulos, 0),
        'total_devolvido', COALESCE(v_total_devolvido, 0),
        'valor_solicitado', v_valor_devolucao
      );
    END IF;

    v_historico_lancamento := CASE
      WHEN v_historico IS NOT NULL THEN FORMAT('Devolução Operação #%s - %s', v_operacao_estoque_id, v_historico)
      ELSE FORMAT('Devolução Operação #%s', v_operacao_estoque_id)
    END;
    v_historico_operacao_entrada := FORMAT('Entrada por devolução da operação #%s', v_operacao_estoque_id);
    v_observacao_lancamento := FORMAT('Devolução da operação de estoque #%s', v_operacao_estoque_id);
  ELSE
    IF v_tipo_estoque NOT IN ('SPPRO', 'SOI') THEN
      RETURN jsonb_build_object(
        'error', 'tipo_estoque (SPPRO ou SOI) é obrigatório para devolução direta',
        'code', 'TIPO_ESTOQUE_INVALIDO'
      );
    END IF;

    SELECT
      COUNT(*)::INTEGER,
      COALESCE(SUM(COALESCE(e.saldo_inicial, 0) + COALESCE(e.saldo_atual, 0)), 0)::NUMERIC
    INTO v_qtd_estoques_tipo, v_saldo_disponivel
    FROM public.estoques e
    WHERE e.empresa_id = v_empresa_id
      AND e.tipo = v_tipo_estoque
      AND e.ativo = true;

    IF v_qtd_estoques_tipo = 0 THEN
      RETURN jsonb_build_object(
        'error', FORMAT('Nenhum estoque %s encontrado', v_tipo_estoque),
        'code', 'ESTOQUE_NAO_ENCONTRADO'
      );
    END IF;

    IF v_valor_devolucao > (v_saldo_disponivel + 0.01) THEN
      RETURN jsonb_build_object(
        'error', FORMAT(
          'Valor da devolução excede o saldo disponível do estoque %s',
          v_tipo_estoque
        ),
        'code', 'SALDO_ESTOQUE_ORIGEM_INSUFICIENTE',
        'saldo_disponivel', v_saldo_disponivel,
        'valor_solicitado', v_valor_devolucao
      );
    END IF;

    v_tipo_origem := v_tipo_estoque;
    v_historico_lancamento := CASE
      WHEN v_historico IS NOT NULL THEN FORMAT('Devolução Estoque %s - %s', v_tipo_estoque, v_historico)
      ELSE FORMAT('Devolução Estoque %s', v_tipo_estoque)
    END;
    v_historico_operacao_entrada := FORMAT('Entrada por devolução direta de estoque %s', v_tipo_estoque);
    v_observacao_lancamento := FORMAT('Devolução direta do estoque %s', v_tipo_estoque);
    v_fornecedor_id := NULL;
    v_operacao_estoque_id := NULL;
  END IF;

  INSERT INTO public.lancamentos_caixa (
    empresa_id,
    conta_bancaria_id,
    grupo_contas_id,
    data,
    historico,
    tipo,
    valor,
    documento,
    observacoes
  )
  VALUES (
    v_empresa_id,
    v_conta_sb_id,
    NULL,
    v_data_devolucao,
    v_historico_lancamento,
    'saida',
    v_valor_devolucao,
    NULL,
    v_observacao_lancamento
  )
  RETURNING id INTO v_lancamento_id;

  INSERT INTO public.devolucoes_estoque (
    operacao_estoque_id,
    tipo_origem_devolucao,
    data_devolucao,
    valor_devolucao,
    conta_bancaria_id,
    lancamento_caixa_id,
    historico,
    observacoes,
    created_by,
    empresa_id
  )
  VALUES (
    v_operacao_estoque_id,
    v_tipo_origem,
    v_data_devolucao,
    v_valor_devolucao,
    v_conta_sb_id,
    v_lancamento_id,
    v_historico,
    v_observacoes,
    v_user_id,
    v_empresa_id
  )
  RETURNING id INTO v_devolucao_id;

  INSERT INTO public.operacoes_estoque (
    empresa_id,
    estoque_id,
    tipo_operacao,
    data,
    fornecedor_id,
    conta_bancaria_id,
    face_titulos,
    valor_compra,
    despesas,
    recompra,
    liquido_operacao,
    historico,
    documento,
    observacoes,
    created_by
  )
  VALUES (
    v_empresa_id,
    v_estoque_devolucoes_id,
    'entrada',
    v_data_devolucao,
    v_fornecedor_id,
    NULL,
    0,
    0,
    0,
    0,
    v_valor_devolucao,
    v_historico_operacao_entrada,
    NULL,
    FORMAT('Devolução registrada em %s', NOW()::TEXT),
    v_user_id
  )
  RETURNING id INTO v_operacao_entrada_id;

  UPDATE public.estoques e
  SET saldo_atual = COALESCE(e.saldo_atual, 0)::NUMERIC + v_valor_devolucao
  WHERE e.id = v_estoque_devolucoes_id;

  UPDATE public.devolucoes_estoque de
  SET
    operacao_entrada_devolucoes_id = v_operacao_entrada_id,
    updated_at = NOW()
  WHERE de.id = v_devolucao_id
    AND de.empresa_id = v_empresa_id;

  v_existing := jsonb_build_object(
    'devolucao_id', v_devolucao_id,
    'lancamento_caixa_id', v_lancamento_id,
    'operacao_entrada_devolucoes_id', v_operacao_entrada_id,
    'conta_bancaria_id', v_conta_sb_id,
    'estoque_devolucoes_id', v_estoque_devolucoes_id,
    'tipo_origem_devolucao', v_tipo_origem
  );

  INSERT INTO public.devolucoes_criacao_requests (request_id, resultado)
  VALUES (v_request_id, v_existing);

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.criar_devolucao_estoque(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.criar_devolucao_estoque(JSONB) TO service_role;
COMMENT ON FUNCTION public.criar_devolucao_estoque(JSONB) IS
'RPC transacional/idempotente para criação de devolução: cria lançamento, devolução, operação de entrada DEVOLUCOES e vínculo operacao_entrada_devolucoes_id';

-- ------------------------------------------------------------
-- 6) Correção: funções de verificar/recalcular saldos de estoque
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_saldos_estoques(empresa_id_param UUID)
RETURNS TABLE(
  estoque_id BIGINT,
  estoque_descricao TEXT,
  tipo_estoque VARCHAR,
  saldo_inicial NUMERIC,
  saldo_atual NUMERIC,
  saldo_esperado NUMERIC,
  diferenca NUMERIC,
  total_entradas NUMERIC,
  total_saidas NUMERIC,
  total_transferencias_entrada NUMERIC,
  total_transferencias_saida NUMERIC,
  total_recompras NUMERIC,
  total_devolucoes NUMERIC
) AS $$
DECLARE
  estoque_record RECORD;
  saldo_inicial_val NUMERIC;
  saldo_atual_val NUMERIC;
  saldo_esperado_val NUMERIC;
  total_entradas_val NUMERIC;
  total_saidas_val NUMERIC;
  total_transferencias_entrada_val NUMERIC;
  total_transferencias_saida_val NUMERIC;
  total_recompras_val NUMERIC;
  total_devolucoes_val NUMERIC;
BEGIN
  FOR estoque_record IN
    SELECT
      e.id,
      e.descricao,
      e.tipo,
      COALESCE(e.saldo_inicial, 0) AS saldo_inicial,
      COALESCE(e.saldo_atual, 0) AS saldo_atual
    FROM public.estoques e
    WHERE e.empresa_id = empresa_id_param
      AND e.ativo = true
  LOOP
    saldo_inicial_val := estoque_record.saldo_inicial;
    saldo_atual_val := estoque_record.saldo_atual;

    IF estoque_record.tipo = 'DEVOLUCOES' THEN
      -- DEVOLUCOES: base operacional por liquido de entradas e movimentações de saída.
      SELECT COALESCE(SUM(oe.liquido_operacao), 0)
      INTO total_entradas_val
      FROM public.operacoes_estoque oe
      WHERE oe.estoque_id = estoque_record.id
        AND oe.tipo_operacao = 'entrada';

      total_saidas_val := 0;
      total_transferencias_entrada_val := 0;

      SELECT COALESCE(SUM(me.valor), 0)
      INTO total_transferencias_saida_val
      FROM public.movimentacoes_estoque me
      WHERE me.estoque_origem_id = estoque_record.id
        AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque');

      total_recompras_val := 0;
      total_devolucoes_val := 0;
    ELSE
      SELECT COALESCE(SUM(oe.face_titulos), 0)
      INTO total_entradas_val
      FROM public.operacoes_estoque oe
      WHERE oe.estoque_id = estoque_record.id
        AND oe.tipo_operacao = 'entrada';

      SELECT COALESCE(SUM(oe.face_titulos), 0)
      INTO total_saidas_val
      FROM public.operacoes_estoque oe
      WHERE oe.estoque_id = estoque_record.id
        AND oe.tipo_operacao = 'saida';

      SELECT COALESCE(SUM(me.valor), 0)
      INTO total_transferencias_entrada_val
      FROM public.movimentacoes_estoque me
      WHERE (
        (me.tipo = 'conta_para_estoque' AND me.estoque_destino_id = estoque_record.id)
        OR (me.tipo = 'estoque_para_estoque' AND me.estoque_destino_id = estoque_record.id)
        OR (me.tipo = 'devolucao_para_estoque' AND me.estoque_destino_id = estoque_record.id)
      );

      SELECT COALESCE(SUM(me.valor), 0)
      INTO total_transferencias_saida_val
      FROM public.movimentacoes_estoque me
      WHERE (
        (me.tipo = 'estoque_para_conta' AND me.estoque_origem_id = estoque_record.id)
        OR (me.tipo = 'estoque_para_estoque' AND me.estoque_origem_id = estoque_record.id)
        OR (me.tipo = 'devolucao_para_conta' AND me.estoque_origem_id = estoque_record.id)
        OR (me.tipo = 'devolucao_para_estoque' AND me.estoque_origem_id = estoque_record.id)
      );

      SELECT COALESCE(SUM(r.valor_recompra), 0)
      INTO total_recompras_val
      FROM public.recompras_estoque r
      INNER JOIN public.operacoes_estoque oo ON oo.id = r.operacao_estoque_id
      WHERE oo.estoque_id = estoque_record.id
        AND oo.tipo_operacao = 'entrada';

      SELECT COALESCE(SUM(d.valor_devolucao), 0)
      INTO total_devolucoes_val
      FROM public.devolucoes_estoque d
      INNER JOIN public.operacoes_estoque od ON od.id = d.operacao_estoque_id
      WHERE od.estoque_id = estoque_record.id
        AND od.tipo_operacao = 'entrada';
    END IF;

    saldo_esperado_val := saldo_inicial_val
      + COALESCE(total_entradas_val, 0)
      - COALESCE(total_saidas_val, 0)
      + COALESCE(total_transferencias_entrada_val, 0)
      - COALESCE(total_transferencias_saida_val, 0)
      - COALESCE(total_recompras_val, 0)
      - COALESCE(total_devolucoes_val, 0);

    estoque_id := estoque_record.id;
    estoque_descricao := estoque_record.descricao;
    tipo_estoque := estoque_record.tipo;
    saldo_inicial := saldo_inicial_val;
    saldo_atual := saldo_atual_val;
    saldo_esperado := saldo_esperado_val;
    diferenca := saldo_atual_val - saldo_esperado_val;
    total_entradas := COALESCE(total_entradas_val, 0);
    total_saidas := COALESCE(total_saidas_val, 0);
    total_transferencias_entrada := COALESCE(total_transferencias_entrada_val, 0);
    total_transferencias_saida := COALESCE(total_transferencias_saida_val, 0);
    total_recompras := COALESCE(total_recompras_val, 0);
    total_devolucoes := COALESCE(total_devolucoes_val, 0);

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.verificar_saldos_estoques(UUID) TO authenticated;
COMMENT ON FUNCTION public.verificar_saldos_estoques(UUID) IS
'Verifica saldos de estoque por empresa. Para DEVOLUCOES usa base operacional (liquido de entrada e movimentações devolucao_* de saída).';

CREATE OR REPLACE FUNCTION public.recalcular_saldo_estoque(estoque_id_param BIGINT)
RETURNS TABLE(
  estoque_id BIGINT,
  saldo_anterior NUMERIC,
  saldo_novo NUMERIC
) AS $$
DECLARE
  estoque_record RECORD;
  saldo_inicial_val NUMERIC;
  saldo_atual_val NUMERIC;
  saldo_esperado_val NUMERIC;
  total_entradas_val NUMERIC;
  total_saidas_val NUMERIC;
  total_transferencias_entrada_val NUMERIC;
  total_transferencias_saida_val NUMERIC;
  total_recompras_val NUMERIC;
  total_devolucoes_val NUMERIC;
BEGIN
  SELECT
    e.id,
    e.tipo,
    COALESCE(e.saldo_inicial, 0) AS saldo_inicial,
    COALESCE(e.saldo_atual, 0) AS saldo_atual
  INTO estoque_record
  FROM public.estoques e
  WHERE e.id = estoque_id_param;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque não encontrado: %', estoque_id_param;
  END IF;

  saldo_inicial_val := estoque_record.saldo_inicial;
  saldo_atual_val := estoque_record.saldo_atual;

  IF estoque_record.tipo = 'DEVOLUCOES' THEN
    SELECT COALESCE(SUM(oe.liquido_operacao), 0)
    INTO total_entradas_val
    FROM public.operacoes_estoque oe
    WHERE oe.estoque_id = estoque_id_param
      AND oe.tipo_operacao = 'entrada';

    total_saidas_val := 0;
    total_transferencias_entrada_val := 0;

    SELECT COALESCE(SUM(me.valor), 0)
    INTO total_transferencias_saida_val
    FROM public.movimentacoes_estoque me
    WHERE me.estoque_origem_id = estoque_id_param
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque');

    total_recompras_val := 0;
    total_devolucoes_val := 0;
  ELSE
    SELECT COALESCE(SUM(oe.face_titulos), 0)
    INTO total_entradas_val
    FROM public.operacoes_estoque oe
    WHERE oe.estoque_id = estoque_id_param
      AND oe.tipo_operacao = 'entrada';

    SELECT COALESCE(SUM(oe.face_titulos), 0)
    INTO total_saidas_val
    FROM public.operacoes_estoque oe
    WHERE oe.estoque_id = estoque_id_param
      AND oe.tipo_operacao = 'saida';

      SELECT COALESCE(SUM(me.valor), 0)
      INTO total_transferencias_entrada_val
      FROM public.movimentacoes_estoque me
      WHERE (
        (me.tipo = 'conta_para_estoque' AND me.estoque_destino_id = estoque_id_param)
        OR (me.tipo = 'estoque_para_estoque' AND me.estoque_destino_id = estoque_id_param)
        OR (me.tipo = 'devolucao_para_estoque' AND me.estoque_destino_id = estoque_id_param)
      );

      SELECT COALESCE(SUM(me.valor), 0)
      INTO total_transferencias_saida_val
      FROM public.movimentacoes_estoque me
      WHERE (
        (me.tipo = 'estoque_para_conta' AND me.estoque_origem_id = estoque_id_param)
        OR (me.tipo = 'estoque_para_estoque' AND me.estoque_origem_id = estoque_id_param)
        OR (me.tipo = 'devolucao_para_conta' AND me.estoque_origem_id = estoque_id_param)
        OR (me.tipo = 'devolucao_para_estoque' AND me.estoque_origem_id = estoque_id_param)
      );

    SELECT COALESCE(SUM(r.valor_recompra), 0)
    INTO total_recompras_val
    FROM public.recompras_estoque r
    INNER JOIN public.operacoes_estoque oo ON oo.id = r.operacao_estoque_id
    WHERE oo.estoque_id = estoque_id_param
      AND oo.tipo_operacao = 'entrada';

    SELECT COALESCE(SUM(d.valor_devolucao), 0)
    INTO total_devolucoes_val
    FROM public.devolucoes_estoque d
    INNER JOIN public.operacoes_estoque od ON od.id = d.operacao_estoque_id
    WHERE od.estoque_id = estoque_id_param
      AND od.tipo_operacao = 'entrada';
  END IF;

  saldo_esperado_val := saldo_inicial_val
    + COALESCE(total_entradas_val, 0)
    - COALESCE(total_saidas_val, 0)
    + COALESCE(total_transferencias_entrada_val, 0)
    - COALESCE(total_transferencias_saida_val, 0)
    - COALESCE(total_recompras_val, 0)
    - COALESCE(total_devolucoes_val, 0);

  UPDATE public.estoques e
  SET
    saldo_atual = GREATEST(0::NUMERIC, saldo_esperado_val),
    updated_at = NOW()
  WHERE e.id = estoque_id_param;

  estoque_id := estoque_id_param;
  saldo_anterior := saldo_atual_val;
  saldo_novo := GREATEST(0::NUMERIC, saldo_esperado_val);
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.recalcular_saldo_estoque(BIGINT) TO authenticated;
COMMENT ON FUNCTION public.recalcular_saldo_estoque(BIGINT) IS
'Recalcula saldo de um estoque. Para DEVOLUCOES usa base operacional (liquido de entrada e movimentações devolucao_* de saída).';
