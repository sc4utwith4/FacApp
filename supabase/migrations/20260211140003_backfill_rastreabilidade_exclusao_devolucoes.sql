-- ============================================
-- FASE 2.4: Backfill best-effort de rastreabilidade para exclusão
-- ============================================
-- Regra: preencher apenas quando houver candidato único e determinístico.
-- Casos ambíguos permanecem NULL e serão bloqueados pelo RPC com LEGADO_AMBIGUO.
-- ============================================

DO $$
DECLARE
  dev_rec RECORD;
  mov_rec RECORD;
  v_candidate_count INT;
  v_candidate_id BIGINT;
  v_lanc_candidate UUID;
BEGIN
  -- 1) Backfill devolucoes_estoque.operacao_entrada_devolucoes_id
  FOR dev_rec IN
    SELECT
      de.id,
      de.empresa_id,
      de.operacao_estoque_id,
      de.data_devolucao,
      COALESCE(de.valor_devolucao, 0)::NUMERIC AS valor_devolucao
    FROM public.devolucoes_estoque de
    WHERE de.operacao_entrada_devolucoes_id IS NULL
    ORDER BY de.id
  LOOP
    WITH candidatos AS (
      SELECT oe.id
      FROM public.operacoes_estoque oe
      JOIN public.estoques e ON e.id = oe.estoque_id
      WHERE oe.empresa_id = dev_rec.empresa_id
        AND oe.tipo_operacao = 'entrada'
        AND e.tipo = 'DEVOLUCOES'
        AND oe.data = dev_rec.data_devolucao
        AND abs(COALESCE(oe.liquido_operacao, 0)::NUMERIC - dev_rec.valor_devolucao) <= 0.01
        AND (
          (dev_rec.operacao_estoque_id IS NOT NULL AND oe.historico ILIKE ('%' || dev_rec.operacao_estoque_id::TEXT || '%'))
          OR (dev_rec.operacao_estoque_id IS NULL AND oe.historico ILIKE '%devolução direta%')
          OR oe.historico ILIKE '%entrada por devolução%'
        )
    )
    SELECT COUNT(*), MIN(id)
    INTO v_candidate_count, v_candidate_id
    FROM candidatos;

    IF v_candidate_count = 1 THEN
      UPDATE public.devolucoes_estoque
      SET operacao_entrada_devolucoes_id = v_candidate_id,
          updated_at = NOW()
      WHERE id = dev_rec.id
        AND operacao_entrada_devolucoes_id IS NULL;
    END IF;
  END LOOP;

  -- 2) Backfill movimentacoes_estoque.operacao_destino_id via requests (fonte mais confiável)
  UPDATE public.movimentacoes_estoque me
  SET operacao_destino_id = (req.resultado->>'operacao_entrada_id')::BIGINT
  FROM public.devolucoes_transferencias_requests req
  WHERE me.id = (req.resultado->>'movimentacao_id')::BIGINT
    AND me.tipo = 'devolucao_para_estoque'
    AND me.operacao_destino_id IS NULL
    AND (req.resultado ? 'operacao_entrada_id')
    AND NULLIF(req.resultado->>'operacao_entrada_id', '') IS NOT NULL;

  -- 3) Backfill operacao_destino_id por candidato único (fallback)
  FOR mov_rec IN
    SELECT
      me.id,
      me.operacao_estoque_id,
      me.estoque_destino_id,
      COALESCE(me.valor, 0)::NUMERIC AS valor,
      me.data,
      me.historico,
      oe.empresa_id
    FROM public.movimentacoes_estoque me
    JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
    WHERE me.tipo = 'devolucao_para_estoque'
      AND me.operacao_destino_id IS NULL
      AND me.estoque_destino_id IS NOT NULL
  LOOP
    WITH candidatos AS (
      SELECT od.id
      FROM public.operacoes_estoque od
      WHERE od.empresa_id = mov_rec.empresa_id
        AND od.estoque_id = mov_rec.estoque_destino_id
        AND od.tipo_operacao = 'entrada'
        AND od.data = mov_rec.data
        AND abs(COALESCE(od.liquido_operacao, 0)::NUMERIC - mov_rec.valor) <= 0.01
        AND (
          (mov_rec.historico IS NOT NULL AND od.historico = mov_rec.historico)
          OR od.historico ILIKE '%transferência de devoluções%'
          OR od.historico ILIKE '%transferencia de devolucoes%'
        )
    )
    SELECT COUNT(*), MIN(id)
    INTO v_candidate_count, v_candidate_id
    FROM candidatos;

    IF v_candidate_count = 1 THEN
      UPDATE public.movimentacoes_estoque
      SET operacao_destino_id = v_candidate_id,
          updated_at = NOW()
      WHERE id = mov_rec.id
        AND operacao_destino_id IS NULL;
    END IF;
  END LOOP;

  -- 4) Backfill lancamento_destino_id por candidato único
  FOR mov_rec IN
    SELECT
      me.id,
      me.conta_bancaria_id,
      COALESCE(me.valor, 0)::NUMERIC AS valor,
      me.data,
      me.historico,
      oe.empresa_id
    FROM public.movimentacoes_estoque me
    JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
    WHERE me.tipo = 'devolucao_para_conta'
      AND me.lancamento_destino_id IS NULL
      AND me.conta_bancaria_id IS NOT NULL
  LOOP
    WITH candidatos AS (
      SELECT lc.id
      FROM public.lancamentos_caixa lc
      WHERE lc.empresa_id = mov_rec.empresa_id
        AND lc.conta_bancaria_id = mov_rec.conta_bancaria_id
        AND lc.tipo = 'entrada'
        AND lc.data = mov_rec.data
        AND abs(COALESCE(lc.valor, 0)::NUMERIC - mov_rec.valor) <= 0.01
        AND (
          (mov_rec.historico IS NOT NULL AND lc.historico = mov_rec.historico)
          OR lc.historico ILIKE '%transferência devoluções%'
          OR lc.historico ILIKE '%transferencia devolucoes%'
          OR lc.historico ILIKE '%transferência de devoluções%'
        )
    )
    SELECT COUNT(*), MIN(id::TEXT)::UUID
    INTO v_candidate_count, v_lanc_candidate
    FROM candidatos;

    IF v_candidate_count = 1 THEN
      UPDATE public.movimentacoes_estoque
      SET lancamento_destino_id = v_lanc_candidate,
          updated_at = NOW()
      WHERE id = mov_rec.id
        AND lancamento_destino_id IS NULL;
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Skipped backfill rastreabilidade: %', SQLERRM;
END
$$;
