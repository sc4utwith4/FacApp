-- ============================================
-- FASE 2.5: Guardas de saldo para transferência de devoluções
-- ============================================
-- Objetivo:
-- - Bloquear transferência quando saldo_atual do estoque DEVOLUCOES for insuficiente
-- - Retornar erro de negócio padronizado (SALDO_DEVOLUCOES_INSUFICIENTE)
-- - Evitar vazamento de erro de constraint estoques_saldo_atual_check para o frontend
-- ============================================

CREATE OR REPLACE FUNCTION public.transferir_devolucoes_estoque(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id UUID;
  v_empresa_id UUID;
  v_user_id UUID;
  v_data_transferencia DATE;
  v_historico TEXT;
  v_observacoes TEXT;
  v_destino_tipo TEXT;
  v_destino_id TEXT;
  v_devolucoes_json JSONB;
  v_devolucao_rec RECORD;
  v_devolucao_ids INTEGER[] := '{}';
  v_valor_total NUMERIC := 0;
  v_estoque_devolucoes_id BIGINT;
  v_estoque_devolucoes_saldo NUMERIC := 0;
  v_operacao_saida_id BIGINT;
  v_movimentacao_id BIGINT;
  v_operacao_entrada_id BIGINT := NULL;
  v_lancamento_destino_id UUID := NULL;
  v_devolucoes_atualizadas JSONB := '[]';
  v_valor_restante NUMERIC;
  v_status_novo VARCHAR;
  v_existing JSONB;
  v_destino_empresa_id UUID;
BEGIN
  -- 1. Idempotência: verificar request_id
  v_request_id := (payload->>'request_id')::UUID;
  IF v_request_id IS NULL THEN
    RETURN jsonb_build_object('error', 'request_id obrigatório', 'code', 'REQUEST_ID_INVALIDO');
  END IF;

  SELECT resultado INTO v_existing
  FROM devolucoes_transferencias_requests
  WHERE request_id = v_request_id;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  -- 2. Usuário e empresa
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Usuário não autenticado', 'code', 'NAO_AUTENTICADO');
  END IF;

  v_empresa_id := get_user_empresa_id();

  -- 3. Parse payload
  v_data_transferencia := (payload->>'data_transferencia')::DATE;
  v_historico := payload->>'historico';
  v_observacoes := payload->>'observacoes';
  v_destino_tipo := payload->>'destino_tipo';
  v_destino_id := payload->>'destino_id';
  v_devolucoes_json := payload->'devolucoes_selecionadas';

  IF v_data_transferencia IS NULL THEN
    RETURN jsonb_build_object('error', 'data_transferencia obrigatória', 'code', 'DATA_INVALIDA');
  END IF;

  IF v_destino_tipo IS NULL OR v_destino_tipo NOT IN ('conta', 'estoque') THEN
    RETURN jsonb_build_object('error', 'destino_tipo inválido', 'code', 'DESTINO_INVALIDO');
  END IF;

  IF v_destino_id IS NULL OR v_destino_id = '' THEN
    RETURN jsonb_build_object('error', 'destino_id obrigatório', 'code', 'DESTINO_INVALIDO');
  END IF;

  IF v_devolucoes_json IS NULL OR jsonb_array_length(v_devolucoes_json) = 0 THEN
    RETURN jsonb_build_object('error', 'devolucoes_selecionadas vazio', 'code', 'PAYLOAD_INVALIDO');
  END IF;

  -- 4. Validar destino pertence à empresa
  IF v_destino_tipo = 'conta' THEN
    SELECT empresa_id INTO v_destino_empresa_id
    FROM contas_bancarias WHERE id = v_destino_id::UUID LIMIT 1;
  ELSE
    SELECT e.empresa_id INTO v_destino_empresa_id
    FROM estoques e WHERE e.id = (v_destino_id::TEXT)::BIGINT LIMIT 1;
  END IF;

  IF v_destino_empresa_id IS NULL OR v_destino_empresa_id != v_empresa_id THEN
    RETURN jsonb_build_object('error', 'Destino não encontrado ou não pertence à empresa', 'code', 'DESTINO_INVALIDO');
  END IF;

  -- 5. Rejeitar devolucao_id duplicado
  SELECT array_agg((elem->>'devolucao_id')::INTEGER) INTO v_devolucao_ids
  FROM jsonb_array_elements(v_devolucoes_json) AS elem;

  IF (SELECT count(*)::INT FROM unnest(v_devolucao_ids) AS x) !=
     (SELECT count(DISTINCT x)::INT FROM unnest(v_devolucao_ids) AS x) THEN
    RETURN jsonb_build_object('error', 'devolucao_id duplicado em devolucoes_selecionadas', 'code', 'DEVOLUCAO_DUPLICADA');
  END IF;

  -- 6. Buscar estoque DEVOLUCOES
  SELECT id INTO v_estoque_devolucoes_id
  FROM estoques
  WHERE empresa_id = v_empresa_id AND tipo = 'DEVOLUCOES' AND ativo = true
  LIMIT 1;

  IF v_estoque_devolucoes_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Estoque DEVOLUCOES não encontrado', 'code', 'ESTOQUE_NAO_ENCONTRADO');
  END IF;

  -- 7. Travar devoluções com FOR UPDATE em ordem estável
  PERFORM 1
  FROM devolucoes_estoque
  WHERE id = ANY(v_devolucao_ids) AND empresa_id = v_empresa_id
  ORDER BY id
  FOR UPDATE;

  -- 8. Validar valor_restante para cada devolução
  FOR v_devolucao_rec IN
    SELECT
      (elem->>'devolucao_id')::INTEGER AS devolucao_id,
      (elem->>'valor_transferir')::NUMERIC AS valor_transferir
    FROM jsonb_array_elements(v_devolucoes_json) AS elem
  LOOP
    IF v_devolucao_rec.valor_transferir <= 0 THEN
      RETURN jsonb_build_object('error', 'valor_transferir deve ser > 0 para devolução #' || v_devolucao_rec.devolucao_id, 'code', 'VALOR_INVALIDO');
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM devolucoes_estoque
      WHERE id = v_devolucao_rec.devolucao_id AND empresa_id = v_empresa_id
    ) THEN
      RETURN jsonb_build_object('error', 'Devolução #' || v_devolucao_rec.devolucao_id || ' não encontrada ou não pertence à empresa', 'code', 'DEVOLUCAO_NAO_ENCONTRADA');
    END IF;

    SELECT dt.valor_restante INTO v_valor_restante
    FROM get_devolucao_restante_e_status(v_devolucao_rec.devolucao_id) dt;

    IF v_valor_restante IS NULL OR v_devolucao_rec.valor_transferir > v_valor_restante THEN
      RETURN jsonb_build_object('error', 'Valor a transferir excede o restante para devolução #' || v_devolucao_rec.devolucao_id, 'code', 'SOBRETRANSFERENCIA');
    END IF;

    v_valor_total := v_valor_total + v_devolucao_rec.valor_transferir;
  END LOOP;

  -- 8.1 Guardar saldo do estoque DEVOLUCOES sob lock antes da mutação
  SELECT COALESCE(e.saldo_atual, 0)::NUMERIC
  INTO v_estoque_devolucoes_saldo
  FROM estoques e
  WHERE e.id = v_estoque_devolucoes_id
  FOR UPDATE;

  IF v_estoque_devolucoes_saldo + 0.01 < v_valor_total THEN
    RETURN jsonb_build_object(
      'error', 'Saldo insuficiente no estoque DEVOLUCOES para transferir as devoluções selecionadas',
      'code', 'SALDO_DEVOLUCOES_INSUFICIENTE',
      'saldo_atual', v_estoque_devolucoes_saldo,
      'valor_solicitado', v_valor_total
    );
  END IF;

  -- 9. Criar operação SAÍDA no estoque DEVOLUCOES
  INSERT INTO operacoes_estoque (
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
    created_by
  )
  VALUES (
    v_empresa_id,
    v_estoque_devolucoes_id,
    'saida',
    v_data_transferencia,
    0, 0, 0, 0,
    v_valor_total,
    COALESCE(v_historico, 'Transferência de devoluções'),
    v_user_id
  )
  RETURNING id INTO v_operacao_saida_id;

  -- 10. Decrementar saldo do estoque DEVOLUCOES
  PERFORM public.increment('estoques', 'id', v_estoque_devolucoes_id::BIGINT, 'saldo_atual', -v_valor_total);

  -- 11. Criar movimentação (rastreabilidade de destino preenchida na etapa 13)
  INSERT INTO movimentacoes_estoque (
    operacao_estoque_id,
    tipo,
    valor,
    data,
    historico,
    estoque_origem_id,
    conta_bancaria_id,
    estoque_destino_id,
    operacao_destino_id,
    lancamento_destino_id
  )
  SELECT
    v_operacao_saida_id,
    CASE v_destino_tipo WHEN 'conta' THEN 'devolucao_para_conta' ELSE 'devolucao_para_estoque' END,
    v_valor_total,
    v_data_transferencia,
    COALESCE(v_historico, 'Transferência de devoluções'),
    v_estoque_devolucoes_id,
    CASE WHEN v_destino_tipo = 'conta' THEN v_destino_id::UUID ELSE NULL END,
    CASE WHEN v_destino_tipo = 'estoque' THEN (v_destino_id::TEXT)::BIGINT ELSE NULL END,
    NULL,
    NULL
  RETURNING id INTO v_movimentacao_id;

  -- 12. Inserir vínculos em devolucoes_transferencias e atualizar status
  FOR v_devolucao_rec IN
    SELECT
      (elem->>'devolucao_id')::INTEGER AS devolucao_id,
      (elem->>'valor_transferir')::NUMERIC AS valor_transferir
    FROM jsonb_array_elements(v_devolucoes_json) AS elem
  LOOP
    INSERT INTO devolucoes_transferencias (devolucao_id, movimentacao_id, valor_transferido)
    VALUES (v_devolucao_rec.devolucao_id, v_movimentacao_id, v_devolucao_rec.valor_transferir);

    v_status_novo := atualizar_status_devolucao(v_devolucao_rec.devolucao_id);
    v_devolucoes_atualizadas := v_devolucoes_atualizadas || jsonb_build_array(
      jsonb_build_object('devolucao_id', v_devolucao_rec.devolucao_id, 'status', v_status_novo)
    );
  END LOOP;

  -- 13. Processar destino e persistir referência determinística
  IF v_destino_tipo = 'conta' THEN
    PERFORM public.increment('contas_bancarias', 'id', v_destino_id::UUID, 'saldo_atual', v_valor_total);

    INSERT INTO lancamentos_caixa (
      empresa_id,
      conta_bancaria_id,
      data,
      historico,
      tipo,
      valor,
      observacoes
    )
    VALUES (
      v_empresa_id,
      v_destino_id::UUID,
      v_data_transferencia,
      COALESCE(v_historico, 'Transferência Devoluções - Transferência de devoluções do estoque DEVOLUCOES'),
      'entrada',
      v_valor_total,
      COALESCE(v_observacoes, 'Transferência de devoluções')
    )
    RETURNING id INTO v_lancamento_destino_id;

    UPDATE movimentacoes_estoque
    SET lancamento_destino_id = v_lancamento_destino_id
    WHERE id = v_movimentacao_id;
  ELSE
    PERFORM public.increment('estoques', 'id', (v_destino_id::TEXT)::BIGINT, 'saldo_atual', v_valor_total);

    INSERT INTO operacoes_estoque (
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
      (v_destino_id::TEXT)::BIGINT,
      'entrada',
      v_data_transferencia,
      0, 0, 0, 0,
      v_valor_total,
      COALESCE(v_historico, 'Transferência de devoluções do estoque DEVOLUCOES'),
      v_observacoes,
      v_user_id
    )
    RETURNING id INTO v_operacao_entrada_id;

    UPDATE movimentacoes_estoque
    SET operacao_destino_id = v_operacao_entrada_id
    WHERE id = v_movimentacao_id;
  END IF;

  -- 14. Persistir resultado para idempotência
  INSERT INTO devolucoes_transferencias_requests (request_id, resultado)
  VALUES (
    v_request_id,
    jsonb_build_object(
      'operacao_saida_id', v_operacao_saida_id,
      'movimentacao_id', v_movimentacao_id,
      'operacao_entrada_id', v_operacao_entrada_id,
      'lancamento_destino_id', v_lancamento_destino_id,
      'devolucoes_atualizadas', v_devolucoes_atualizadas
    )
  );

  RETURN jsonb_build_object(
    'operacao_saida_id', v_operacao_saida_id,
    'movimentacao_id', v_movimentacao_id,
    'operacao_entrada_id', v_operacao_entrada_id,
    'lancamento_destino_id', v_lancamento_destino_id,
    'devolucoes_atualizadas', v_devolucoes_atualizadas
  );
EXCEPTION
  WHEN check_violation THEN
    IF SQLERRM ILIKE '%estoques_saldo_atual_check%' THEN
      RETURN jsonb_build_object(
        'error', 'Saldo insuficiente no estoque DEVOLUCOES para transferir as devoluções selecionadas',
        'code', 'SALDO_DEVOLUCOES_INSUFICIENTE',
        'saldo_atual', v_estoque_devolucoes_saldo,
        'valor_solicitado', v_valor_total
      );
    END IF;
    RAISE;
  WHEN OTHERS THEN
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.transferir_devolucoes_estoque(JSONB) TO authenticated;
COMMENT ON FUNCTION public.transferir_devolucoes_estoque IS
'RPC transacional: transferência de devoluções com idempotência (request_id), rastreabilidade determinística de destino e guarda explícita de saldo (code=SALDO_DEVOLUCOES_INSUFICIENTE)';
