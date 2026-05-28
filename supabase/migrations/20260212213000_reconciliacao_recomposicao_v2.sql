-- ============================================
-- FASE 2.9: Reconciliação v2 + recomposição automática de saldo DEVOLUCOES
-- ============================================
-- Objetivos:
-- 1) Inferência de tipo mais robusta para legado (destino + conta mapeada + histórico estrito)
-- 2) Recomposição automática e rastreável do saldo residual do DEVOLUCOES
-- 3) Consulta leve de status por request_id para UX em background
-- ============================================

-- ------------------------------------------------------------
-- 1) Mapa determinístico de conta bancária -> tipo de devolução
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contas_bancarias_tipo_devolucao (
  id BIGSERIAL PRIMARY KEY,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  tipo_origem_devolucao VARCHAR(20) NOT NULL CHECK (tipo_origem_devolucao IN ('SPPRO', 'SOI')),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_cbtde_empresa
  ON public.contas_bancarias_tipo_devolucao(empresa_id);

CREATE INDEX IF NOT EXISTS idx_cbtde_conta
  ON public.contas_bancarias_tipo_devolucao(conta_bancaria_id);

CREATE INDEX IF NOT EXISTS idx_cbtde_tipo
  ON public.contas_bancarias_tipo_devolucao(tipo_origem_devolucao);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cbtde_conta_ativa
  ON public.contas_bancarias_tipo_devolucao(empresa_id, conta_bancaria_id)
  WHERE ativo = true;

ALTER TABLE public.contas_bancarias_tipo_devolucao ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT contas_bancarias_tipo_devolucao por empresa" ON public.contas_bancarias_tipo_devolucao;
CREATE POLICY "SELECT contas_bancarias_tipo_devolucao por empresa"
  ON public.contas_bancarias_tipo_devolucao
  FOR SELECT
  TO authenticated
  USING (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "INSERT contas_bancarias_tipo_devolucao por empresa" ON public.contas_bancarias_tipo_devolucao;
CREATE POLICY "INSERT contas_bancarias_tipo_devolucao por empresa"
  ON public.contas_bancarias_tipo_devolucao
  FOR INSERT
  TO authenticated
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "UPDATE contas_bancarias_tipo_devolucao por empresa" ON public.contas_bancarias_tipo_devolucao;
CREATE POLICY "UPDATE contas_bancarias_tipo_devolucao por empresa"
  ON public.contas_bancarias_tipo_devolucao
  FOR UPDATE
  TO authenticated
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP POLICY IF EXISTS "DELETE contas_bancarias_tipo_devolucao por empresa" ON public.contas_bancarias_tipo_devolucao;
CREATE POLICY "DELETE contas_bancarias_tipo_devolucao por empresa"
  ON public.contas_bancarias_tipo_devolucao
  FOR DELETE
  TO authenticated
  USING (empresa_id = public.get_user_empresa_id());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.contas_bancarias_tipo_devolucao
  TO authenticated;

GRANT USAGE, SELECT
  ON SEQUENCE public.contas_bancarias_tipo_devolucao_id_seq
  TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'update_contas_bancarias_tipo_devolucao_updated_at'
  ) THEN
    CREATE TRIGGER update_contas_bancarias_tipo_devolucao_updated_at
      BEFORE UPDATE ON public.contas_bancarias_tipo_devolucao
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;

COMMENT ON TABLE public.contas_bancarias_tipo_devolucao IS
'Mapa determinístico de conta bancária para tipo de devolução (SPPRO/SOI) usado na reconciliação legada.';

-- Backfill estrito inicial: apenas conta com token exclusivo SPPRO ou SOI na descrição.
INSERT INTO public.contas_bancarias_tipo_devolucao (
  empresa_id,
  conta_bancaria_id,
  tipo_origem_devolucao,
  ativo,
  created_by
)
SELECT
  cb.empresa_id,
  cb.id,
  CASE
    WHEN UPPER(COALESCE(cb.descricao, '')) ~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
         AND UPPER(COALESCE(cb.descricao, '')) !~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
      THEN 'SPPRO'
    WHEN UPPER(COALESCE(cb.descricao, '')) ~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
         AND UPPER(COALESCE(cb.descricao, '')) !~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
      THEN 'SOI'
    ELSE NULL
  END,
  true,
  NULL
FROM public.contas_bancarias cb
WHERE cb.empresa_id IS NOT NULL
  AND (
    UPPER(COALESCE(cb.descricao, '')) ~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
    OR UPPER(COALESCE(cb.descricao, '')) ~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.contas_bancarias_tipo_devolucao m
    WHERE m.empresa_id = cb.empresa_id
      AND m.conta_bancaria_id = cb.id
      AND m.ativo = true
  )
  AND (
    CASE
      WHEN UPPER(COALESCE(cb.descricao, '')) ~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
           AND UPPER(COALESCE(cb.descricao, '')) !~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
        THEN 'SPPRO'
      WHEN UPPER(COALESCE(cb.descricao, '')) ~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
           AND UPPER(COALESCE(cb.descricao, '')) !~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
        THEN 'SOI'
      ELSE NULL
    END
  ) IS NOT NULL;

-- Ajuste de schema de auditoria para permitir evento de recomposição sem movimentação específica.
ALTER TABLE public.devolucoes_reconciliacao_auditoria
  ALTER COLUMN movimentacao_id DROP NOT NULL;

-- ------------------------------------------------------------
-- 2) Diagnóstico com novas dimensões de inferência/recomposição
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
  gap_tipo_indeterminado NUMERIC,
  gap_tipo_inferido_por_destino NUMERIC,
  gap_tipo_inferido_por_conta_mapeada NUMERIC,
  gap_residual_recomponivel NUMERIC
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
      UPPER(COALESCE(me.historico, '') || ' ' || COALESCE(oe.historico, '')) AS historico_norm,
      est_dest.tipo::TEXT AS tipo_destino_operacao,
      ctd.tipo_origem_devolucao::TEXT AS tipo_mapeado_conta
    FROM public.movimentacoes_estoque me
    JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
    LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
    LEFT JOIN public.devolucoes_estoque de ON de.id = dt.devolucao_id
    LEFT JOIN public.operacoes_estoque oe_dest ON oe_dest.id = me.operacao_destino_id
    LEFT JOIN public.estoques est_dest ON est_dest.id = oe_dest.estoque_id
    LEFT JOIN public.contas_bancarias_tipo_devolucao ctd
      ON ctd.empresa_id = oe.empresa_id
     AND ctd.conta_bancaria_id = me.conta_bancaria_id
     AND ctd.ativo = true
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    GROUP BY
      me.id,
      me.data,
      me.valor,
      me.historico,
      oe.historico,
      est_dest.tipo,
      ctd.tipo_origem_devolucao
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
        WHEN mb.tipo_destino_operacao IN ('SPPRO', 'SOI') THEN mb.tipo_destino_operacao
        WHEN mb.tipo_mapeado_conta IN ('SPPRO', 'SOI') THEN mb.tipo_mapeado_conta
        WHEN mb.historico_norm ~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
             AND mb.historico_norm !~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
          THEN 'SPPRO'
        WHEN mb.historico_norm ~ '(^|[^A-Z0-9])SOI([^A-Z0-9]|$)'
             AND mb.historico_norm !~ '(^|[^A-Z0-9])SPPRO([^A-Z0-9]|$)'
          THEN 'SOI'
        ELSE NULL
      END AS tipo_inferido,
      CASE
        WHEN mb.linked_type_count = 1 THEN 'LINK_EXISTENTE'
        WHEN mb.tipo_destino_operacao IN ('SPPRO', 'SOI') THEN 'DESTINO'
        WHEN mb.tipo_mapeado_conta IN ('SPPRO', 'SOI') THEN 'CONTA_MAPEADA'
        WHEN mb.historico_norm ~ '(^|[^A-Z0-9])(SPPRO|SOI)([^A-Z0-9]|$)' THEN 'HISTORICO_ESTRITO'
        ELSE 'INDETERMINADO'
      END AS fonte_inferencia
    FROM mov_base mb
  ),
  saldo AS (
    SELECT
      COALESCE((SELECT total FROM entradas_ledger), 0::NUMERIC)
      -
      COALESCE((SELECT total FROM saidas_ledger), 0::NUMERIC) AS saldo_operacional
  ),
  restante_total AS (
    SELECT COALESCE(SUM(r.valor_restante), 0::NUMERIC) AS total_restante
    FROM restante r
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
    COALESCE((SELECT saldo_operacional FROM saldo), 0::NUMERIC) AS saldo_operacional_calculado,
    COALESCE((SELECT total_restante FROM restante_total), 0::NUMERIC) AS total_restante_deterministico,
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
    COALESCE((SELECT SUM(mg.gap) FROM mov_gaps mg WHERE mg.gap > 0.01 AND mg.tipo_inferido IS NULL), 0::NUMERIC) AS gap_tipo_indeterminado,
    COALESCE((SELECT SUM(mg.gap) FROM mov_gaps mg WHERE mg.gap > 0.01 AND mg.fonte_inferencia = 'DESTINO'), 0::NUMERIC) AS gap_tipo_inferido_por_destino,
    COALESCE((SELECT SUM(mg.gap) FROM mov_gaps mg WHERE mg.gap > 0.01 AND mg.fonte_inferencia = 'CONTA_MAPEADA'), 0::NUMERIC) AS gap_tipo_inferido_por_conta_mapeada,
    GREATEST(
      0::NUMERIC,
      COALESCE((SELECT total_restante FROM restante_total), 0::NUMERIC)
      -
      COALESCE((SELECT saldo_operacional FROM saldo), 0::NUMERIC)
    ) AS gap_residual_recomponivel;
END;
$$;

GRANT EXECUTE ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) TO service_role;

COMMENT ON FUNCTION public.diagnosticar_consistencia_devolucoes_estoque(JSONB) IS
'Diagnóstico expandido de consistência de devoluções com inferência por destino/conta mapeada e gap residual recomponível.';

-- ------------------------------------------------------------
-- 3) Reparo v2: inferência robusta + recomposição automática
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
  v_recompor_saldo_residual BOOLEAN;
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
  v_gap_residual_antes_recomposicao NUMERIC := 0;
  v_valor_recomposicao_aplicada NUMERIC := 0;
  v_operacao_ajuste_id BIGINT := NULL;
  v_status_execucao TEXT := 'DONE';
BEGIN
  v_mode := LOWER(COALESCE(payload->>'mode', 'dry_run'));
  IF v_mode NOT IN ('dry_run', 'apply') THEN
    RETURN jsonb_build_object(
      'error', 'Modo inválido. Use dry_run ou apply',
      'code', 'MODO_INVALIDO',
      'status_execucao', 'ERROR'
    );
  END IF;
  v_apply := (v_mode = 'apply');

  v_request_id := NULLIF(payload->>'request_id', '')::UUID;
  IF v_apply AND v_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'request_id obrigatório para apply',
      'code', 'REQUEST_ID_INVALIDO',
      'status_execucao', 'ERROR'
    );
  END IF;

  v_reconciliar_vinculos := COALESCE((payload->>'reconciliar_vinculos')::BOOLEAN, true);
  v_recompor_saldo_residual := COALESCE((payload->>'recompor_saldo_residual')::BOOLEAN, true);
  v_estrategia := UPPER(COALESCE(payload->>'estrategia', 'LIFO_TIPO_DATA_STRITO'));

  IF v_estrategia <> 'LIFO_TIPO_DATA_STRITO' THEN
    RETURN jsonb_build_object(
      'error', 'Estratégia inválida. Use LIFO_TIPO_DATA_STRITO',
      'code', 'ESTRATEGIA_INVALIDA',
      'status_execucao', 'ERROR'
    );
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    v_empresa_id := NULLIF(payload->>'empresa_id', '')::UUID;
    IF v_empresa_id IS NULL THEN
      RETURN jsonb_build_object(
        'error', 'Usuário não autenticado e empresa_id não informado',
        'code', 'NAO_AUTENTICADO',
        'status_execucao', 'ERROR'
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
  LIMIT 1;

  IF v_estoque_devolucoes_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'Estoque DEVOLUCOES não encontrado',
      'code', 'ESTOQUE_NAO_ENCONTRADO',
      'status_execucao', 'ERROR'
    );
  END IF;

  IF v_apply THEN
    PERFORM 1
    FROM public.estoques e
    WHERE e.id = v_estoque_devolucoes_id
    FOR UPDATE;
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
      COALESCE(SUM(dt.valor_transferido), 0)::NUMERIC AS valor_vinculado
    FROM public.movimentacoes_estoque me
    LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
    WHERE me.estoque_origem_id = v_estoque_devolucoes_id
      AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
    GROUP BY me.id, me.data, me.valor
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
          UPPER(COALESCE(me.historico, '') || ' ' || COALESCE(oe.historico, '')) AS historico_norm,
          est_dest.tipo::TEXT AS tipo_destino_operacao,
          ctd.tipo_origem_devolucao::TEXT AS tipo_mapeado_conta
        FROM public.movimentacoes_estoque me
        JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
        LEFT JOIN public.devolucoes_transferencias dt ON dt.movimentacao_id = me.id
        LEFT JOIN public.devolucoes_estoque de ON de.id = dt.devolucao_id
        LEFT JOIN public.operacoes_estoque oe_dest ON oe_dest.id = me.operacao_destino_id
        LEFT JOIN public.estoques est_dest ON est_dest.id = oe_dest.estoque_id
        LEFT JOIN public.contas_bancarias_tipo_devolucao ctd
          ON ctd.empresa_id = oe.empresa_id
         AND ctd.conta_bancaria_id = me.conta_bancaria_id
         AND ctd.ativo = true
        WHERE me.estoque_origem_id = v_estoque_devolucoes_id
          AND me.tipo IN ('devolucao_para_conta', 'devolucao_para_estoque')
        GROUP BY
          me.id,
          me.data,
          me.valor,
          me.historico,
          oe.historico,
          est_dest.tipo,
          ctd.tipo_origem_devolucao
      ),
      mov_gaps AS (
        SELECT
          mb.movimentacao_id,
          mb.data_mov,
          GREATEST(0::NUMERIC, mb.valor_mov - mb.valor_vinculado) AS gap,
          CASE
            WHEN mb.linked_type_count = 1 THEN mb.linked_type_single
            WHEN mb.tipo_destino_operacao IN ('SPPRO', 'SOI') THEN mb.tipo_destino_operacao
            WHEN mb.tipo_mapeado_conta IN ('SPPRO', 'SOI') THEN mb.tipo_mapeado_conta
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

  v_gap_residual_antes_recomposicao := GREATEST(0::NUMERIC, v_total_restante - v_saldo_operacional);

  IF v_apply AND v_recompor_saldo_residual AND v_gap_residual_antes_recomposicao > 0.01 THEN
    INSERT INTO public.operacoes_estoque (
      empresa_id,
      estoque_id,
      tipo_operacao,
      data,
      face_titulos,
      valor_compra,
      despesas,
      recompra,
      liquido_operacao,
      historico,
      observacoes,
      created_by
    )
    VALUES (
      v_empresa_id,
      v_estoque_devolucoes_id,
      'entrada',
      CURRENT_DATE,
      0,
      0,
      0,
      0,
      v_gap_residual_antes_recomposicao,
      'Ajuste de recomposição DEVOLUCOES (reconciliação automática)',
      'Recomposição automática de saldo residual após reconciliação determinística. request_id=' || COALESCE(v_request_id::TEXT, 'N/A'),
      v_user_id
    )
    RETURNING id INTO v_operacao_ajuste_id;

    v_valor_recomposicao_aplicada := v_gap_residual_antes_recomposicao;

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
      NULL,
      NULL,
      v_valor_recomposicao_aplicada,
      NULL,
      NULL,
      v_estrategia,
      'AJUSTE_RECOMPOSICAO_SALDO',
      v_user_id
    );

    -- Recalcular saldo operacional após operação de ajuste.
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
  END IF;

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

  v_resultado := jsonb_build_object(
    'status_execucao', v_status_execucao,
    'mode', v_mode,
    'request_id', v_request_id,
    'empresa_id', v_empresa_id,
    'estrategia', v_estrategia,
    'reconciliar_vinculos', v_reconciliar_vinculos,
    'recompor_saldo_residual', v_recompor_saldo_residual,
    'estoque_devolucoes_id', v_estoque_devolucoes_id,
    'saldo_antes', v_saldo_antes,
    'saldo_operacional_calculado', v_saldo_operacional,
    'saldo_final', v_saldo_aplicado,
    'saldo_final_pos_recomposicao', v_saldo_aplicado,
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
    'gap_residual_antes_recomposicao', v_gap_residual_antes_recomposicao,
    'valor_recomposicao_aplicada', v_valor_recomposicao_aplicada,
    'operacao_ajuste_id', v_operacao_ajuste_id,
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
'Reparo v2: reconciliação determinística + inferência por destino/conta mapeada + recomposição automática rastreável de saldo residual.';

-- ------------------------------------------------------------
-- 4) Consulta leve de status de reconciliação por request_id
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consultar_reconciliacao_devolucoes_estoque(payload JSONB DEFAULT '{}'::JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_empresa_id UUID;
  v_request_id UUID;
  v_resultado JSONB;
BEGIN
  v_request_id := NULLIF(payload->>'request_id', '')::UUID;
  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object(
      'error', 'request_id obrigatório',
      'code', 'REQUEST_ID_INVALIDO',
      'status_execucao', 'ERROR'
    );
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    v_empresa_id := NULLIF(payload->>'empresa_id', '')::UUID;
    IF v_empresa_id IS NULL THEN
      RETURN jsonb_build_object(
        'error', 'Usuário não autenticado e empresa_id não informado',
        'code', 'NAO_AUTENTICADO',
        'status_execucao', 'ERROR'
      );
    END IF;
  ELSE
    v_empresa_id := public.get_user_empresa_id();
  END IF;

  SELECT r.resultado
  INTO v_resultado
  FROM public.devolucoes_reconciliacao_requests r
  WHERE r.request_id = v_request_id
    AND r.empresa_id = v_empresa_id
  LIMIT 1;

  IF v_resultado IS NULL THEN
    RETURN jsonb_build_object(
      'request_id', v_request_id,
      'empresa_id', v_empresa_id,
      'status_execucao', 'RUNNING_BACKGROUND'
    );
  END IF;

  IF NOT (v_resultado ? 'status_execucao') THEN
    v_resultado := v_resultado || jsonb_build_object('status_execucao', 'DONE');
  END IF;

  RETURN v_resultado;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consultar_reconciliacao_devolucoes_estoque(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_reconciliacao_devolucoes_estoque(JSONB) TO service_role;

COMMENT ON FUNCTION public.consultar_reconciliacao_devolucoes_estoque(JSONB) IS
'Consulta leve por request_id para acompanhar status da reconciliação em background sem reexecutar lógica pesada.';
