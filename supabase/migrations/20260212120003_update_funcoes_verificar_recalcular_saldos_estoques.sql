-- ============================================
-- FASE 2.5: Atualizar funções de diagnóstico/recalculo de saldos de estoque
-- ============================================
-- Inclui movimentações de devoluções:
-- - devolucao_para_conta
-- - devolucao_para_estoque
-- evitando diagnóstico incorreto em cenários pós-Fase 2
-- ============================================

CREATE OR REPLACE FUNCTION verificar_saldos_estoques(empresa_id_param UUID)
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
      COALESCE(e.saldo_inicial, 0) as saldo_inicial,
      COALESCE(e.saldo_atual, 0) as saldo_atual
    FROM public.estoques e
    WHERE e.empresa_id = empresa_id_param
      AND e.ativo = true
  LOOP
    saldo_inicial_val := estoque_record.saldo_inicial;
    saldo_atual_val := estoque_record.saldo_atual;

    SELECT COALESCE(SUM(face_titulos), 0) INTO total_entradas_val
    FROM public.operacoes_estoque
    WHERE estoque_id = estoque_record.id
      AND tipo_operacao = 'entrada';

    SELECT COALESCE(SUM(face_titulos), 0) INTO total_saidas_val
    FROM public.operacoes_estoque
    WHERE estoque_id = estoque_record.id
      AND tipo_operacao = 'saida';

    -- Entradas por transferência/movimentação
    SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_entrada_val
    FROM public.movimentacoes_estoque
    WHERE (
      (tipo = 'conta_para_estoque' AND estoque_destino_id = estoque_record.id)
      OR (tipo = 'estoque_para_estoque' AND estoque_destino_id = estoque_record.id)
      OR (tipo = 'devolucao_para_estoque' AND estoque_destino_id = estoque_record.id)
    );

    -- Saídas por transferência/movimentação
    SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_saida_val
    FROM public.movimentacoes_estoque
    WHERE (
      (tipo = 'estoque_para_conta' AND estoque_origem_id = estoque_record.id)
      OR (tipo = 'estoque_para_estoque' AND estoque_origem_id = estoque_record.id)
      OR (tipo = 'devolucao_para_conta' AND estoque_origem_id = estoque_record.id)
      OR (tipo = 'devolucao_para_estoque' AND estoque_origem_id = estoque_record.id)
    );

    SELECT COALESCE(SUM(r.valor_recompra), 0) INTO total_recompras_val
    FROM public.recompras_estoque r
    INNER JOIN public.operacoes_estoque o ON o.id = r.operacao_estoque_id
    WHERE o.estoque_id = estoque_record.id
      AND o.tipo_operacao = 'entrada';

    SELECT COALESCE(SUM(d.valor_devolucao), 0) INTO total_devolucoes_val
    FROM public.devolucoes_estoque d
    INNER JOIN public.operacoes_estoque o ON o.id = d.operacao_estoque_id
    WHERE o.estoque_id = estoque_record.id
      AND o.tipo_operacao = 'entrada';

    saldo_esperado_val := saldo_inicial_val
      + total_entradas_val
      + total_transferencias_entrada_val
      - total_transferencias_saida_val
      - total_recompras_val
      - total_devolucoes_val;

    estoque_id := estoque_record.id;
    estoque_descricao := estoque_record.descricao;
    tipo_estoque := estoque_record.tipo;
    saldo_inicial := saldo_inicial_val;
    saldo_atual := saldo_atual_val;
    saldo_esperado := saldo_esperado_val;
    diferenca := saldo_atual_val - saldo_esperado_val;
    total_entradas := total_entradas_val;
    total_saidas := total_saidas_val;
    total_transferencias_entrada := total_transferencias_entrada_val;
    total_transferencias_saida := total_transferencias_saida_val;
    total_recompras := total_recompras_val;
    total_devolucoes := total_devolucoes_val;

    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION verificar_saldos_estoques(UUID) TO authenticated;

COMMENT ON FUNCTION verificar_saldos_estoques(UUID) IS
'Verifica saldos de estoques considerando entradas, transferências gerais e transferências de devoluções (devolucao_para_conta/devolucao_para_estoque), recompras e devoluções.';

CREATE OR REPLACE FUNCTION recalcular_saldo_estoque(estoque_id_param BIGINT)
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
  total_transferencias_entrada_val NUMERIC;
  total_transferencias_saida_val NUMERIC;
  total_recompras_val NUMERIC;
  total_devolucoes_val NUMERIC;
BEGIN
  SELECT
    id,
    COALESCE(saldo_inicial, 0) as saldo_inicial,
    COALESCE(saldo_atual, 0) as saldo_atual
  INTO estoque_record
  FROM public.estoques
  WHERE id = estoque_id_param;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estoque não encontrado: %', estoque_id_param;
  END IF;

  saldo_inicial_val := estoque_record.saldo_inicial;
  saldo_atual_val := estoque_record.saldo_atual;

  SELECT COALESCE(SUM(face_titulos), 0) INTO total_entradas_val
  FROM public.operacoes_estoque
  WHERE estoque_id = estoque_id_param
    AND tipo_operacao = 'entrada';

  SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_entrada_val
  FROM public.movimentacoes_estoque
  WHERE (
    (tipo = 'conta_para_estoque' AND estoque_destino_id = estoque_id_param)
    OR (tipo = 'estoque_para_estoque' AND estoque_destino_id = estoque_id_param)
    OR (tipo = 'devolucao_para_estoque' AND estoque_destino_id = estoque_id_param)
  );

  SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_saida_val
  FROM public.movimentacoes_estoque
  WHERE (
    (tipo = 'estoque_para_conta' AND estoque_origem_id = estoque_id_param)
    OR (tipo = 'estoque_para_estoque' AND estoque_origem_id = estoque_id_param)
    OR (tipo = 'devolucao_para_conta' AND estoque_origem_id = estoque_id_param)
    OR (tipo = 'devolucao_para_estoque' AND estoque_origem_id = estoque_id_param)
  );

  SELECT COALESCE(SUM(r.valor_recompra), 0) INTO total_recompras_val
  FROM public.recompras_estoque r
  INNER JOIN public.operacoes_estoque o ON o.id = r.operacao_estoque_id
  WHERE o.estoque_id = estoque_id_param
    AND o.tipo_operacao = 'entrada';

  SELECT COALESCE(SUM(d.valor_devolucao), 0) INTO total_devolucoes_val
  FROM public.devolucoes_estoque d
  INNER JOIN public.operacoes_estoque o ON o.id = d.operacao_estoque_id
  WHERE o.estoque_id = estoque_id_param
    AND o.tipo_operacao = 'entrada';

  saldo_esperado_val := saldo_inicial_val
    + total_entradas_val
    + total_transferencias_entrada_val
    - total_transferencias_saida_val
    - total_recompras_val
    - total_devolucoes_val;

  UPDATE public.estoques
  SET saldo_atual = saldo_esperado_val,
      updated_at = NOW()
  WHERE id = estoque_id_param;

  estoque_id := estoque_id_param;
  saldo_anterior := saldo_atual_val;
  saldo_novo := saldo_esperado_val;

  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION recalcular_saldo_estoque(BIGINT) TO authenticated;

COMMENT ON FUNCTION recalcular_saldo_estoque(BIGINT) IS
'Recalcula saldo_atual de um estoque considerando entradas, transferências gerais e transferências de devoluções (devolucao_para_conta/devolucao_para_estoque), recompras e devoluções.';
