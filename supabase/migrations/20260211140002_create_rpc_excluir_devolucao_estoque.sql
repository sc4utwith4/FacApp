-- ============================================
-- FASE 2.3: RPC transacional para exclusão determinística de devolução
-- ============================================
-- Regras:
-- - Sem heurística por data/histórico
-- - Idempotência por request_id
-- - Bloqueia legado ambíguo com code=LEGADO_AMBIGUO
-- ============================================

-- 1) Tabela de idempotência para exclusão
CREATE TABLE IF NOT EXISTS public.devolucoes_exclusao_requests (
  request_id UUID PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resultado JSONB NOT NULL
);

COMMENT ON TABLE public.devolucoes_exclusao_requests IS
'Idempotência para RPC excluir_devolucao_estoque: em conflito de request_id retorna resultado persistido';

ALTER TABLE public.devolucoes_exclusao_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "SELECT requests exclusao por usuario autenticado"
  ON public.devolucoes_exclusao_requests;

CREATE POLICY "SELECT requests exclusao por usuario autenticado"
  ON public.devolucoes_exclusao_requests
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "INSERT requests exclusao por usuario autenticado"
  ON public.devolucoes_exclusao_requests;

CREATE POLICY "INSERT requests exclusao por usuario autenticado"
  ON public.devolucoes_exclusao_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- 2) RPC de exclusão
CREATE OR REPLACE FUNCTION public.excluir_devolucao_estoque(payload JSONB)
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
  v_devolucao_id INTEGER;

  v_devolucao RECORD;
  v_operacao_entrada RECORD;
  v_estoque_entrada RECORD;

  v_dt RECORD;
  v_mov RECORD;
  v_op_saida RECORD;
  v_op_destino RECORD;
  v_lanc_destino RECORD;

  v_count_refs BIGINT;
  v_related_movs BIGINT;

  v_total_transferencias_revertidas NUMERIC := 0;
  v_valor_entrada_devolucoes NUMERIC := 0;
  v_novo_valor_mov NUMERIC;
  v_novo_valor_op_saida NUMERIC;
  v_novo_valor_op_destino NUMERIC;

  v_resultado JSONB;
BEGIN
  -- 1. Idempotência
  v_request_id := (payload->>'request_id')::UUID;
  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('error', 'request_id obrigatório', 'code', 'REQUEST_ID_INVALIDO');
  END IF;

  SELECT resultado INTO v_existing
  FROM public.devolucoes_exclusao_requests
  WHERE request_id = v_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- 2. Autenticação e empresa
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não autenticado', 'code', 'NAO_AUTENTICADO');
  END IF;

  v_empresa_id := public.get_user_empresa_id();

  v_devolucao_id := (payload->>'devolucao_id')::INTEGER;
  IF v_devolucao_id IS NULL OR v_devolucao_id <= 0 THEN
    RETURN jsonb_build_object('error', 'devolucao_id obrigatório e válido', 'code', 'DEVOLUCAO_NAO_ENCONTRADA');
  END IF;

  -- 3. Lock da devolução
  SELECT
    de.id,
    de.empresa_id,
    de.valor_devolucao,
    de.valor_transferido,
    COALESCE(de.status, 'pendente') AS status,
    de.lancamento_caixa_id,
    de.operacao_entrada_devolucoes_id
  INTO v_devolucao
  FROM public.devolucoes_estoque de
  WHERE de.id = v_devolucao_id
    AND de.empresa_id = v_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Devolução não encontrada', 'code', 'DEVOLUCAO_NAO_ENCONTRADA');
  END IF;

  IF v_devolucao.status NOT IN ('pendente', 'parcialmente_transferida', 'transferida') THEN
    RETURN jsonb_build_object('error', 'Estado da devolução inválido para exclusão', 'code', 'ESTADO_INVALIDO');
  END IF;

  -- 4. Referência determinística da operação de entrada no estoque DEVOLUCOES
  IF v_devolucao.operacao_entrada_devolucoes_id IS NULL THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: devolução sem operacao_entrada_devolucoes_id';
  END IF;

  SELECT
    oe.id,
    oe.empresa_id,
    oe.estoque_id,
    oe.tipo_operacao,
    COALESCE(oe.liquido_operacao, 0)::NUMERIC AS liquido_operacao
  INTO v_operacao_entrada
  FROM public.operacoes_estoque oe
  WHERE oe.id = v_devolucao.operacao_entrada_devolucoes_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: operacao_entrada_devolucoes_id não encontrada';
  END IF;

  IF v_operacao_entrada.empresa_id <> v_empresa_id THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de entrada da devolução pertence a outra empresa';
  END IF;

  IF v_operacao_entrada.tipo_operacao <> 'entrada' THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de entrada da devolução com tipo inválido';
  END IF;

  SELECT id, tipo
  INTO v_estoque_entrada
  FROM public.estoques
  WHERE id = v_operacao_entrada.estoque_id
  FOR UPDATE;

  IF NOT FOUND OR v_estoque_entrada.tipo <> 'DEVOLUCOES' THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: operação vinculada não está no estoque DEVOLUCOES';
  END IF;

  SELECT COUNT(*) INTO v_count_refs
  FROM public.devolucoes_estoque
  WHERE operacao_entrada_devolucoes_id = v_operacao_entrada.id
    AND id <> v_devolucao.id;

  IF v_count_refs > 0 THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de entrada compartilhada por múltiplas devoluções';
  END IF;

  IF abs(v_operacao_entrada.liquido_operacao - COALESCE(v_devolucao.valor_devolucao, 0)::NUMERIC) > 0.01 THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: valor da operação de entrada diverge do valor da devolução';
  END IF;

  -- 5. Reverter vínculos de transferência desta devolução
  FOR v_dt IN
    SELECT
      dt.id,
      dt.movimentacao_id,
      COALESCE(dt.valor_transferido, 0)::NUMERIC AS valor_transferido
    FROM public.devolucoes_transferencias dt
    WHERE dt.devolucao_id = v_devolucao.id
    ORDER BY dt.id
    FOR UPDATE
  LOOP
    IF v_dt.valor_transferido <= 0 THEN
      RAISE EXCEPTION 'ESTADO_INVALIDO: valor_transferido inválido no vínculo';
    END IF;

    SELECT
      me.id,
      me.tipo,
      me.operacao_estoque_id,
      COALESCE(me.valor, 0)::NUMERIC AS valor,
      me.conta_bancaria_id,
      me.estoque_destino_id,
      me.operacao_destino_id,
      me.lancamento_destino_id
    INTO v_mov
    FROM public.movimentacoes_estoque me
    JOIN public.operacoes_estoque oe ON oe.id = me.operacao_estoque_id
    WHERE me.id = v_dt.movimentacao_id
      AND oe.empresa_id = v_empresa_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LEGADO_AMBIGUO: movimentação do vínculo não encontrada';
    END IF;

    IF v_mov.tipo NOT IN ('devolucao_para_conta', 'devolucao_para_estoque') THEN
      RAISE EXCEPTION 'ESTADO_INVALIDO: tipo de movimentação incompatível com devolução';
    END IF;

    SELECT
      oe.id,
      oe.estoque_id,
      oe.tipo_operacao,
      COALESCE(oe.liquido_operacao, 0)::NUMERIC AS liquido_operacao
    INTO v_op_saida
    FROM public.operacoes_estoque oe
    WHERE oe.id = v_mov.operacao_estoque_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de saída da transferência não encontrada';
    END IF;

    IF v_op_saida.tipo_operacao <> 'saida' OR v_op_saida.estoque_id <> v_estoque_entrada.id THEN
      RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de saída incompatível com estoque DEVOLUCOES';
    END IF;

    -- 5.1 Reverter destino
    IF v_mov.tipo = 'devolucao_para_conta' THEN
      IF v_mov.conta_bancaria_id IS NULL OR v_mov.lancamento_destino_id IS NULL THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: devolucao_para_conta sem referências determinísticas';
      END IF;

      PERFORM public.increment('contas_bancarias', 'id', v_mov.conta_bancaria_id::UUID, 'saldo_atual', -v_dt.valor_transferido);

      SELECT
        lc.id,
        lc.empresa_id,
        lc.conta_bancaria_id,
        lc.tipo,
        COALESCE(lc.valor, 0)::NUMERIC AS valor
      INTO v_lanc_destino
      FROM public.lancamentos_caixa lc
      WHERE lc.id = v_mov.lancamento_destino_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: lançamento destino da transferência não encontrado';
      END IF;

      IF v_lanc_destino.empresa_id <> v_empresa_id
         OR v_lanc_destino.conta_bancaria_id <> v_mov.conta_bancaria_id
         OR v_lanc_destino.tipo <> 'entrada' THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: lançamento destino incompatível com a movimentação';
      END IF;

      IF v_lanc_destino.valor + 0.01 < v_dt.valor_transferido THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: lançamento destino com valor inferior ao vínculo';
      END IF;

      IF abs(v_lanc_destino.valor - v_dt.valor_transferido) <= 0.01 THEN
        DELETE FROM public.lancamentos_caixa WHERE id = v_lanc_destino.id;
      ELSE
        UPDATE public.lancamentos_caixa
        SET valor = v_lanc_destino.valor - v_dt.valor_transferido
        WHERE id = v_lanc_destino.id;
      END IF;
    ELSE
      IF v_mov.estoque_destino_id IS NULL OR v_mov.operacao_destino_id IS NULL THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: devolucao_para_estoque sem referências determinísticas';
      END IF;

      PERFORM public.increment('estoques', 'id', v_mov.estoque_destino_id::BIGINT, 'saldo_atual', -v_dt.valor_transferido);

      SELECT
        oe.id,
        oe.empresa_id,
        oe.estoque_id,
        oe.tipo_operacao,
        COALESCE(oe.liquido_operacao, 0)::NUMERIC AS liquido_operacao
      INTO v_op_destino
      FROM public.operacoes_estoque oe
      WHERE oe.id = v_mov.operacao_destino_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: operação destino da transferência não encontrada';
      END IF;

      IF v_op_destino.empresa_id <> v_empresa_id
         OR v_op_destino.estoque_id <> v_mov.estoque_destino_id
         OR v_op_destino.tipo_operacao <> 'entrada' THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: operação destino incompatível com a movimentação';
      END IF;

      IF v_op_destino.liquido_operacao + 0.01 < v_dt.valor_transferido THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: operação destino com valor inferior ao vínculo';
      END IF;

      v_novo_valor_op_destino := v_op_destino.liquido_operacao - v_dt.valor_transferido;

      IF v_novo_valor_op_destino <= 0.01 THEN
        DELETE FROM public.operacoes_estoque WHERE id = v_op_destino.id;
      ELSE
        UPDATE public.operacoes_estoque
        SET liquido_operacao = v_novo_valor_op_destino,
            updated_at = NOW()
        WHERE id = v_op_destino.id;
      END IF;
    END IF;

    -- 5.2 Reverter saldo do estoque DEVOLUCOES referente ao vínculo
    PERFORM public.increment('estoques', 'id', v_estoque_entrada.id::BIGINT, 'saldo_atual', v_dt.valor_transferido);

    -- 5.3 Ajustar movimentação e operação de saída (podem ser compartilhadas por outras devoluções)
    IF v_mov.valor + 0.01 < v_dt.valor_transferido THEN
      RAISE EXCEPTION 'LEGADO_AMBIGUO: movimentação com valor inferior ao vínculo';
    END IF;

    v_novo_valor_mov := v_mov.valor - v_dt.valor_transferido;

    IF v_novo_valor_mov <= 0.01 THEN
      DELETE FROM public.movimentacoes_estoque WHERE id = v_mov.id;
    ELSE
      UPDATE public.movimentacoes_estoque
      SET valor = v_novo_valor_mov,
          updated_at = NOW()
      WHERE id = v_mov.id;
    END IF;

    IF v_op_saida.liquido_operacao + 0.01 < v_dt.valor_transferido THEN
      RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de saída com valor inferior ao vínculo';
    END IF;

    v_novo_valor_op_saida := v_op_saida.liquido_operacao - v_dt.valor_transferido;

    IF v_novo_valor_op_saida <= 0.01 THEN
      SELECT COUNT(*) INTO v_related_movs
      FROM public.movimentacoes_estoque
      WHERE operacao_estoque_id = v_op_saida.id;

      IF v_related_movs > 0 THEN
        RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de saída zerada ainda possui movimentações relacionadas';
      END IF;

      DELETE FROM public.operacoes_estoque WHERE id = v_op_saida.id;
    ELSE
      UPDATE public.operacoes_estoque
      SET liquido_operacao = v_novo_valor_op_saida,
          updated_at = NOW()
      WHERE id = v_op_saida.id;
    END IF;

    DELETE FROM public.devolucoes_transferencias
    WHERE id = v_dt.id;

    v_total_transferencias_revertidas := v_total_transferencias_revertidas + v_dt.valor_transferido;
  END LOOP;

  -- 6. Remover contribuição base da devolução no estoque DEVOLUCOES
  v_valor_entrada_devolucoes := COALESCE(v_operacao_entrada.liquido_operacao, 0)::NUMERIC;

  IF v_valor_entrada_devolucoes <= 0 THEN
    RAISE EXCEPTION 'LEGADO_AMBIGUO: operação de entrada da devolução com valor inválido';
  END IF;

  PERFORM public.increment('estoques', 'id', v_estoque_entrada.id::BIGINT, 'saldo_atual', -v_valor_entrada_devolucoes);

  DELETE FROM public.operacoes_estoque
  WHERE id = v_operacao_entrada.id;

  -- 7. Excluir devolução
  DELETE FROM public.devolucoes_estoque
  WHERE id = v_devolucao.id
    AND empresa_id = v_empresa_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ESTADO_INVALIDO: devolução não foi removida';
  END IF;

  -- 8. Excluir lançamento de saída da devolução (se existir)
  IF v_devolucao.lancamento_caixa_id IS NOT NULL THEN
    DELETE FROM public.lancamentos_caixa
    WHERE id = v_devolucao.lancamento_caixa_id
      AND empresa_id = v_empresa_id;
  END IF;

  v_resultado := jsonb_build_object(
    'devolucao_id', v_devolucao.id,
    'operacao_entrada_devolucoes_id', v_operacao_entrada.id,
    'valor_devolucao', v_devolucao.valor_devolucao,
    'total_transferencias_revertidas', v_total_transferencias_revertidas,
    'status', 'excluida'
  );

  INSERT INTO public.devolucoes_exclusao_requests (request_id, resultado)
  VALUES (v_request_id, v_resultado);

  RETURN v_resultado;

EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM LIKE 'LEGADO_AMBIGUO:%' THEN
      RETURN jsonb_build_object(
        'error', trim(regexp_replace(SQLERRM, '^LEGADO_AMBIGUO:\\s*', '')),
        'code', 'LEGADO_AMBIGUO'
      );
    ELSIF SQLERRM LIKE 'ESTADO_INVALIDO:%' THEN
      RETURN jsonb_build_object(
        'error', trim(regexp_replace(SQLERRM, '^ESTADO_INVALIDO:\\s*', '')),
        'code', 'ESTADO_INVALIDO'
      );
    ELSE
      RETURN jsonb_build_object(
        'error', SQLERRM,
        'code', 'ESTADO_INVALIDO'
      );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.excluir_devolucao_estoque(JSONB) TO authenticated;

COMMENT ON FUNCTION public.excluir_devolucao_estoque IS
'RPC transacional e idempotente para exclusão de devolução com rollback determinístico via devolucoes_transferencias; bloqueia casos legados ambíguos';
