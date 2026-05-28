-- ============================================
-- FASE 2.8: Reconciliação estrita de devoluções (LIFO por tipo/data)
-- ============================================
-- Objetivo:
-- - Reconciliar vínculos faltantes de transferências antigas sem heurística destrutiva.
-- - Manter guarda operacional do estoque DEVOLUCOES.
-- - Registrar trilha de auditoria detalhada.
-- ============================================

-- ------------------------------------------------------------
-- 1) Idempotência e auditoria de reconciliação
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.devolucoes_reconciliacao_requests (
  request_id UUID PRIMARY KEY,
  empresa_id UUID NOT NULL,
  resultado JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.devolucoes_reconciliacao_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT devolucoes_reconciliacao_requests por empresa" ON public.devolucoes_reconciliacao_requests;
CREATE POLICY "SELECT devolucoes_reconciliacao_requests por empresa"
  ON public.devolucoes_reconciliacao_requests
  FOR SELECT
  TO authenticated
  USING (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "INSERT devolucoes_reconciliacao_requests por empresa" ON public.devolucoes_reconciliacao_requests;
CREATE POLICY "INSERT devolucoes_reconciliacao_requests por empresa"
  ON public.devolucoes_reconciliacao_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (empresa_id = public.get_user_empresa_id());

COMMENT ON TABLE public.devolucoes_reconciliacao_requests IS
'Idempotência da reconciliação de devoluções por request_id.';

CREATE TABLE IF NOT EXISTS public.devolucoes_reconciliacao_auditoria (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL,
  empresa_id UUID NOT NULL,
  movimentacao_id BIGINT NOT NULL,
  devolucao_id INTEGER NULL REFERENCES public.devolucoes_estoque(id) ON DELETE SET NULL,
  valor_vinculado NUMERIC(15,2) NOT NULL DEFAULT 0,
  tipo_origem_movimentacao TEXT NULL,
  tipo_origem_devolucao TEXT NULL,
  regra TEXT NOT NULL,
  motivo_bloqueio TEXT NULL,
  created_by UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dev_reconc_auditoria_request ON public.devolucoes_reconciliacao_auditoria(request_id);
CREATE INDEX IF NOT EXISTS idx_dev_reconc_auditoria_empresa ON public.devolucoes_reconciliacao_auditoria(empresa_id);
CREATE INDEX IF NOT EXISTS idx_dev_reconc_auditoria_mov ON public.devolucoes_reconciliacao_auditoria(movimentacao_id);

ALTER TABLE public.devolucoes_reconciliacao_auditoria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT devolucoes_reconciliacao_auditoria por empresa" ON public.devolucoes_reconciliacao_auditoria;
CREATE POLICY "SELECT devolucoes_reconciliacao_auditoria por empresa"
  ON public.devolucoes_reconciliacao_auditoria
  FOR SELECT
  TO authenticated
  USING (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "INSERT devolucoes_reconciliacao_auditoria por empresa" ON public.devolucoes_reconciliacao_auditoria;
CREATE POLICY "INSERT devolucoes_reconciliacao_auditoria por empresa"
  ON public.devolucoes_reconciliacao_auditoria
  FOR INSERT
  TO authenticated
  WITH CHECK (empresa_id = public.get_user_empresa_id());

COMMENT ON TABLE public.devolucoes_reconciliacao_auditoria IS
'Trilha detalhada da reconciliação de vínculos de devoluções.';

-- ------------------------------------------------------------
-- 2) Diagnóstico expandido (com gap por tipo)
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS public.diagnosticar_consistencia_devolucoes_estoque(JSONB);

CREATE OR REPLACE FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(payload JSONB DEFAULT '{}'::JSONB)
RETURNS TABLE(
  saldo_estoque_atual NUMERIC,
  saldo_operacional_calculado NUMERIC,
  total_restante_deterministico NUMERIC,
  gap_movimentacoes_sem_vinculo NUMERIC,
  devolucoes_sem_operacao_entrada INTEGER,
  movimentacoes_com_gap INTEGER,
  gap_por_tipo_sppro NUMERIC,
  gap_por_tipo_soi NUMERIC,
  gap_tipo_indeterminado NUMERIC
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
  mov_base AS (
    SELECT
      me.id AS movimentacao_id,
      me.data AS data_mov,
      COALESCE(me.valor, 0)::NUMERIC AS valor_mov,
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_vinculado,
      COUNT(DISTINCT CASE
        WHEN de.tipo_origem_devolucao IN ('SPPRO', 'SOI') THEN de.tipo_origem_devolucao
        ELSE NULL
      END) AS linked_type_count,
      MIN(CASE
        WHEN de.tipo_origem_devolucao IN ('SPPRO', 'SOI') THEN de.tipo_origem_devolucao
        ELSE NULL
      END) AS linked_type_single,
      UPPER(COALESCE(me.historico, '') || ' ' || COALESCE(oe.historico, '')) AS historico_norm
    FROM public.movimentacoes_estoque me
    JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
    LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
    LEFT JOIN public.devolucoes_estoque de ON de.id = dt.devolucao_id
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    GROUP BY me.id, me.data, me.valor, me.historico, oe.historico
  ),
  mov_gaps AS (
    SELECT
      mb.movimentacao_id,
      mb.data_mov,
      mb.valor_mov,
      mb.valor_vinculado,
      GREATEST(0::NUMERIC, mb.valor_mov - mb.valor_vinculado) AS gap,
      CASE
        WHEN mb.linked_type_count = 1 THEN mb.linked_type_single
        WHEN mb.historico_norm ~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
             AND mb.historico_norm !~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
          THEN 'SPPRO'
        WHEN mb.historico_norm ~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
             AND mb.historico_norm !~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
          THEN 'SOI'
        ELSE NULL
      END AS tipo_inferido
    FROM mov_base mb
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
    COALESCE((SELECT SUM(mg.gap) FROM mov_gaps mg WHERE mg.gap > 0.01), 0::NUMERIC) AS gap_movimentacoes_sem_vinculo,
    COALESCE(
      (
        SELECT COUNT(*)::INTEGER
        FROM devolucoes_base db
        WHERE db.operacao_entrada_devolucoes_id IS NULL
      ),
      0
    ) AS devolucoes_sem_operacao_entrada,
    COALESCE((SELECT COUNT(*)::INTEGER FROM mov_gaps mg WHERE mg.gap > 0.01), 0) AS movimentacoes_com_gap,
    COALESCE((SELECT SUM(mg.gap) FROM mov_gaps mg WHERE mg.gap > 0.01 AND mg.tipo_inferido = 'SPPRO'), 0::NUMERIC) AS gap_por_tipo_sppro,
    COALESCE((SELECT SUM(mg.gap) FROM mov_gaps mg WHERE mg.gap > 0.01 AND mg.tipo_inferido = 'SOI'), 0::NUMERIC) AS gap_por_tipo_soi,
    COALESCE((SELECT SUM(mg.gap) FROM mov_gaps mg WHERE mg.gap > 0.01 AND mg.tipo_inferido IS NULL), 0::NUMERIC) AS gap_tipo_indeterminado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) TO service_role;
COMMENT ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) IS
'Diagnóstico expandido de consistência de devoluções com gap por tipo inferido (SPPRO/SOI/indeterminado).';

-- ------------------------------------------------------------
-- 3) Reparo expandido: reconciliação estrita + auditoria
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
  v_request_id UUID;
  v_existing JSONB;
  v_reconciliar_vinculos BOOLEAN;
  v_estrategia TEXT;
  v_estoque_devolucoes_id BIGINT;
  v_saldo_antes NUMERIC := 0;
  v_saldo_operacional NUMERIC := 0;
  v_saldo_aplicado NUMERIC := 0;
  v_sem_operacao_entrada_antes INTEGER := 0;
  v_sem_operacao_entrada_depois INTEGER := 0;
  v_backfill_candidates INTEGER := 0;
  v_backfill_aplicados INTEGER := 0;
  v_total_restante NUMERIC := 0;
  v_gap_antes NUMERIC := 0;
  v_gap_depois NUMERIC := 0;
  v_mov_gap_depois INTEGER := 0;
  v_vinculos_criados INTEGER := 0;
  v_movimentacoes_reconciliadas INTEGER := 0;
  v_movimentacoes_bloqueadas INTEGER := 0;
  v_gap_mov_restante NUMERIC := 0;
  v_valor_a_vincular NUMERIC := 0;
  v_vinculos_mov INTEGER := 0;
  v_bloqueios JSONB := '[]'::JSONB;
  v_resultado JSONB;
  v_devolucoes_tocadas INTEGER[] := '{}';
  v_devolucao_id INTEGER;
  v_mov_rec RECORD;
  v_dev_rec RECORD;
BEGIN
  v_mode := LOWER(COALESCE(payload->>'mode', 'dry_run'));
  IF v_mode NOT IN ('dry_run', 'apply') THEN
    RETURN jsonb_build_object(
      'error', 'Modo inválido. Use dry_run ou apply',
      'code', 'MODO_INVALIDO'
    );
  END IF;
  v_apply := (v_mode = 'apply');

  v_request_id := NULLIF(payload->>'request_id', '')::UUID;
  IF v_apply AND v_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'request_id obrigatório para apply',
      'code', 'REQUEST_ID_INVALIDO'
    );
  END IF;

  v_reconciliar_vinculos := COALESCE((payload->>'reconciliar_vinculos')::BOOLEAN, true);
  v_estrategia := UPPER(COALESCE(payload->>'estrategia', 'LIFO_TIPO_DATA_STRITO'));

  IF v_estrategia <> 'LIFO_TIPO_DATA_STRITO' THEN
    RETURN jsonb_build_object(
      'error', 'Estratégia inválida. Use LIFO_TIPO_DATA_STRITO',
      'code', 'ESTRATEGIA_INVALIDA'
    );
  END IF;

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

  IF v_request_id IS NOT NULL THEN
    SELECT r.resultado
    INTO v_existing
    FROM public.devolucoes_reconciliacao_requests r
    WHERE r.request_id = v_request_id;

    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT e.id, COALESCE(e.saldo_atual, 0)::NUMERIC
  INTO v_estoque_devolucoes_id, v_saldo_antes
  FROM public.estoques e
  WHERE e.empresa_id = v_empresa_id
    AND e.tipo = 'DEVOLUCOES'
    AND e.ativo = true
  ORDER BY e.id
  LIMIT 1
  FOR UPDATE;

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

  WITH mov_base AS (
    SELECT
      me.id AS movimentacao_id,
      me.data AS data_mov,
      COALESCE(me.valor, 0)::NUMERIC AS valor_mov,
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_vinculado,
      COUNT(DISTINCT CASE
        WHEN de.tipo_origem_devolucao IN ('SPPRO', 'SOI') THEN de.tipo_origem_devolucao
        ELSE NULL
      END) AS linked_type_count,
      MIN(CASE
        WHEN de.tipo_origem_devolucao IN ('SPPRO', 'SOI') THEN de.tipo_origem_devolucao
        ELSE NULL
      END) AS linked_type_single,
      UPPER(COALESCE(me.historico, '') || ' ' || COALESCE(oe.historico, '')) AS historico_norm
    FROM public.movimentacoes_estoque me
    JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
    LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
    LEFT JOIN public.devolucoes_estoque de ON de.id = dt.devolucao_id
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    GROUP BY me.id, me.data, me.valor, me.historico, oe.historico
  ),
  mov_gaps AS (
    SELECT
      mb.movimentacao_id,
      GREATEST(0::NUMERIC, mb.valor_mov - mb.valor_vinculado) AS gap
    FROM mov_base mb
  )
  SELECT COALESCE(SUM(mg.gap), 0)::NUMERIC
  INTO v_gap_antes
  FROM mov_gaps mg
  WHERE mg.gap > 0.01;

  IF v_apply AND v_reconciliar_vinculos THEN
    FOR v_mov_rec IN
      WITH mov_base AS (
        SELECT
          me.id AS movimentacao_id,
          me.data AS data_mov,
          COALESCE(me.valor, 0)::NUMERIC AS valor_mov,
          COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_vinculado,
          COUNT(DISTINCT CASE
            WHEN de.tipo_origem_devolucao IN ('SPPRO', 'SOI') THEN de.tipo_origem_devolucao
            ELSE NULL
          END) AS linked_type_count,
          MIN(CASE
            WHEN de.tipo_origem_devolucao IN ('SPPRO', 'SOI') THEN de.tipo_origem_devolucao
            ELSE NULL
          END) AS linked_type_single,
          UPPER(COALESCE(me.historico, '') || ' ' || COALESCE(oe.historico, '')) AS historico_norm
        FROM public.movimentacoes_estoque me
        JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
        LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
        LEFT JOIN public.devolucoes_estoque de ON de.id = dt.devolucao_id
        WHERE me.estoque_origem_id = v_estoque_devolucoes_id
          AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
        GROUP BY me.id, me.data, me.valor, me.historico, oe.historico
      ),
      mov_gaps AS (
        SELECT
          mb.movimentacao_id,
          mb.data_mov,
          GREATEST(0::NUMERIC, mb.valor_mov - mb.valor_vinculado) AS gap,
          CASE
            WHEN mb.linked_type_count = 1 THEN mb.linked_type_single
            WHEN mb.historico_norm ~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
                 AND mb.historico_norm !~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
              THEN 'SPPRO'
            WHEN mb.historico_norm ~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
                 AND mb.historico_norm !~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
              THEN 'SOI'
            ELSE NULL
          END AS tipo_inferido
        FROM mov_base mb
      )
      SELECT
        mg.movimentacao_id,
        mg.data_mov,
        mg.gap,
        mg.tipo_inferido
      FROM mov_gaps mg
      WHERE mg.gap > 0.01
      ORDER BY mg.data_mov ASC NULLS FIRST, mg.movimentacao_id ASC
    LOOP
      v_gap_mov_restante := COALESCE(v_mov_rec.gap, 0);
      v_vinculos_mov := 0;

      IF v_mov_rec.tipo_inferido IS NULL THEN
        v_movimentacoes_bloqueadas := v_movimentacoes_bloqueadas + 1;
        v_bloqueios := v_bloqueios || jsonb_build_array(
          jsonb_build_object(
            'movimentacao_id', v_mov_rec.movimentacao_id,
            'motivo', 'TIPO_INDETERMINADO',
            'gap', v_gap_mov_restante,
            'tipo_origem_movimentacao', NULL
          )
        );

        INSERT INTO public.devolucoes_reconciliacao_auditoria (
          request_id,
          empresa_id,
          movimentacao_id,
          devolucao_id,
          valor_vinculado,
          tipo_origem_movimentacao,
          tipo_origem_devolucao,
          regra,
          motivo_bloqueio,
          created_by
        )
        VALUES (
          v_request_id,
          v_empresa_id,
          v_mov_rec.movimentacao_id,
          NULL,
          0,
          NULL,
          NULL,
          v_estrategia,
          'TIPO_INDETERMINADO',
          v_user_id
        );

        CONTINUE;
      END IF;

      FOR v_dev_rec IN
        SELECT
          de.id AS devolucao_id,
          de.data_devolucao,
          GREATEST(
            0::NUMERIC,
            COALESCE(de.valor_devolucao, 0)::NUMERIC -
            COALESCE(
              (
                SELECT SUM(dt2.valor_transferido)
                FROM public.devolucoes_transferencias dt2
                WHERE dt2.devolucao_id = de.id
              ),
              0
            )::NUMERIC
          ) AS valor_restante
        FROM public.devolucoes_estoque de
        WHERE de.empresa_id = v_empresa_id
          AND de.tipo_origem_devolucao = v_mov_rec.tipo_inferido
          AND de.data_devolucao <= COALESCE(v_mov_rec.data_mov, de.data_devolucao)
          AND NOT EXISTS (
            SELECT 1
            FROM public.devolucoes_transferencias dt3
            WHERE dt3.movimentacao_id = v_mov_rec.movimentacao_id
              AND dt3.devolucao_id = de.id
          )
        ORDER BY de.data_devolucao DESC, de.id DESC
      LOOP
        EXIT WHEN v_gap_mov_restante <= 0.01;

        IF COALESCE(v_dev_rec.valor_restante, 0) <= 0.01 THEN
          CONTINUE;
        END IF;

        v_valor_a_vincular := LEAST(v_gap_mov_restante, v_dev_rec.valor_restante);
        EXIT WHEN v_valor_a_vincular <= 0.01;

        INSERT INTO public.devolucoes_transferencias (
          devolucao_id,
          movimentacao_id,
          valor_transferido
        )
        VALUES (
          v_dev_rec.devolucao_id,
          v_mov_rec.movimentacao_id,
          v_valor_a_vincular
        );

        INSERT INTO public.devolucoes_reconciliacao_auditoria (
          request_id,
          empresa_id,
          movimentacao_id,
          devolucao_id,
          valor_vinculado,
          tipo_origem_movimentacao,
          tipo_origem_devolucao,
          regra,
          motivo_bloqueio,
          created_by
        )
        VALUES (
          v_request_id,
          v_empresa_id,
          v_mov_rec.movimentacao_id,
          v_dev_rec.devolucao_id,
          v_valor_a_vincular,
          v_mov_rec.tipo_inferido,
          v_mov_rec.tipo_inferido,
          v_estrategia,
          NULL,
          v_user_id
        );

        v_vinculos_criados := v_vinculos_criados + 1;
        v_vinculos_mov := v_vinculos_mov + 1;
        v_gap_mov_restante := v_gap_mov_restante - v_valor_a_vincular;

        IF NOT (v_dev_rec.devolucao_id = ANY(v_devolucoes_tocadas)) THEN
          v_devolucoes_tocadas := array_append(v_devolucoes_tocadas, v_dev_rec.devolucao_id);
        END IF;
      END LOOP;

      IF v_vinculos_mov > 0 THEN
        v_movimentacoes_reconciliadas := v_movimentacoes_reconciliadas + 1;
      END IF;

      IF v_gap_mov_restante > 0.01 THEN
        v_movimentacoes_bloqueadas := v_movimentacoes_bloqueadas + 1;
        v_bloqueios := v_bloqueios || jsonb_build_array(
          jsonb_build_object(
            'movimentacao_id', v_mov_rec.movimentacao_id,
            'motivo', 'SEM_CANDIDATO_SUFICIENTE',
            'gap', v_gap_mov_restante,
            'tipo_origem_movimentacao', v_mov_rec.tipo_inferido
          )
        );

        INSERT INTO public.devolucoes_reconciliacao_auditoria (
          request_id,
          empresa_id,
          movimentacao_id,
          devolucao_id,
          valor_vinculado,
          tipo_origem_movimentacao,
          tipo_origem_devolucao,
          regra,
          motivo_bloqueio,
          created_by
        )
        VALUES (
          v_request_id,
          v_empresa_id,
          v_mov_rec.movimentacao_id,
          NULL,
          0,
          v_mov_rec.tipo_inferido,
          NULL,
          v_estrategia,
          'SEM_CANDIDATO_SUFICIENTE',
          v_user_id
        );
      END IF;
    END LOOP;

    IF COALESCE(array_length(v_devolucoes_tocadas, 1), 0) > 0 THEN
      FOREACH v_devolucao_id IN ARRAY v_devolucoes_tocadas LOOP
        PERFORM public.atualizar_status_devolucao(v_devolucao_id);
      END LOOP;
    END IF;
  END IF;

  -- Backfill estrito do vínculo de entrada DEVOLUCOES (mantido)
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

  WITH mov_base AS (
    SELECT
      me.id AS movimentacao_id,
      COALESCE(me.valor, 0)::NUMERIC AS valor_mov,
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_vinculado
    FROM public.movimentacoes_estoque me
    LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    GROUP BY me.id, me.valor
  ),
  mov_gaps AS (
    SELECT
      mb.movimentacao_id,
      GREATEST(0::NUMERIC, mb.valor_mov - mb.valor_vinculado) AS gap
    FROM mov_base mb
  )
  SELECT
    COALESCE(SUM(mg.gap), 0)::NUMERIC,
    COALESCE(COUNT(*) FILTER (WHERE mg.gap > 0.01), 0)::INTEGER
  INTO v_gap_depois, v_mov_gap_depois
  FROM mov_gaps mg;

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

  v_resultado := jsonb_build_object(
    'mode', v_mode,
    'request_id', v_request_id,
    'empresa_id', v_empresa_id,
    'estrategia', v_estrategia,
    'reconciliar_vinculos', v_reconciliar_vinculos,
    'estoque_devolucoes_id', v_estoque_devolucoes_id,
    'saldo_antes', v_saldo_antes,
    'saldo_operacional_calculado', v_saldo_operacional,
    'saldo_final', v_saldo_aplicado,
    'devolucoes_sem_operacao_entrada_antes', v_sem_operacao_entrada_antes,
    'devolucoes_backfill_candidatas', v_backfill_candidates,
    'devolucoes_backfill_aplicadas', v_backfill_aplicados,
    'devolucoes_sem_operacao_entrada_depois', v_sem_operacao_entrada_depois,
    'total_restante_deterministico', v_total_restante,
    'gap_movimentacoes_sem_vinculo', v_gap_depois,
    'movimentacoes_com_gap', v_mov_gap_depois,
    'vinculos_criados', v_vinculos_criados,
    'movimentacoes_reconciliadas', v_movimentacoes_reconciliadas,
    'movimentacoes_bloqueadas', v_movimentacoes_bloqueadas,
    'gap_movimentacoes_sem_vinculo_antes', v_gap_antes,
    'gap_movimentacoes_sem_vinculo_depois', v_gap_depois,
    'gap_remanescente_bloqueado', v_gap_depois,
    'bloqueios', v_bloqueios
  );

  IF v_request_id IS NOT NULL THEN
    INSERT INTO public.devolucoes_reconciliacao_requests (request_id, empresa_id, resultado)
    VALUES (v_request_id, v_empresa_id, v_resultado)
    ON CONFLICT (request_id) DO NOTHING;
  END IF;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reparar_inconsistencias_devolucoes_estoque(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reparar_inconsistencias_devolucoes_estoque(JSONB) TO service_role;
COMMENT ON FUNCTION public.reparar_inconsistencias_devolucoes_estoque(JSONB) IS
'Reparo determinístico estrito: reconcilia vínculos faltantes LIFO por tipo/data, sem cruzar tipo, com auditoria e idempotência por request_id.';
