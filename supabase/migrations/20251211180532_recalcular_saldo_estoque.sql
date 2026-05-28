-- ============================================
-- FUNÇÃO PARA RECALCULAR SALDO DE ESTOQUE
-- Recalcula o saldo_atual de um estoque específico
-- baseado em todas as operações (entradas, transferências, recompras, devoluções)
-- ============================================

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
  -- Buscar estoque
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
  
  -- 1. Calcular total de entradas (face_titulos de operações de entrada)
  SELECT COALESCE(SUM(face_titulos), 0) INTO total_entradas_val
  FROM public.operacoes_estoque
  WHERE estoque_id = estoque_id_param
    AND tipo_operacao = 'entrada';
  
  -- 2. Transferências que AUMENTAM saldo (entrada no estoque)
  SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_entrada_val
  FROM public.movimentacoes_estoque
  WHERE (
    (tipo = 'conta_para_estoque' AND estoque_destino_id = estoque_id_param)
    OR (tipo = 'estoque_para_estoque' AND estoque_destino_id = estoque_id_param)
  );
  
  -- 3. Transferências que DIMINUEM saldo (saída do estoque)
  SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_saida_val
  FROM public.movimentacoes_estoque
  WHERE (
    (tipo = 'estoque_para_conta' AND estoque_origem_id = estoque_id_param)
    OR (tipo = 'estoque_para_estoque' AND estoque_origem_id = estoque_id_param)
  );
  
  -- 4. Recompras (subtraem do saldo, apenas para operações de entrada)
  SELECT COALESCE(SUM(r.valor_recompra), 0) INTO total_recompras_val
  FROM public.recompras_estoque r
  INNER JOIN public.operacoes_estoque o ON o.id = r.operacao_estoque_id
  WHERE o.estoque_id = estoque_id_param
    AND o.tipo_operacao = 'entrada';
  
  -- 5. Devoluções (reduzem saldo do estoque original)
  SELECT COALESCE(SUM(d.valor_devolucao), 0) INTO total_devolucoes_val
  FROM public.devolucoes_estoque d
  INNER JOIN public.operacoes_estoque o ON o.id = d.operacao_estoque_id
  WHERE o.estoque_id = estoque_id_param
    AND o.tipo_operacao = 'entrada';
  
  -- Calcular saldo esperado
  saldo_esperado_val := saldo_inicial_val 
    + total_entradas_val
    + total_transferencias_entrada_val
    - total_transferencias_saida_val
    - total_recompras_val
    - total_devolucoes_val;
  
  -- Atualizar saldo_atual
  UPDATE public.estoques
  SET saldo_atual = saldo_esperado_val,
      updated_at = NOW()
  WHERE id = estoque_id_param;
  
  -- Retornar resultado
  estoque_id := estoque_id_param;
  saldo_anterior := saldo_atual_val;
  saldo_novo := saldo_esperado_val;
  
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Conceder permissões
GRANT EXECUTE ON FUNCTION recalcular_saldo_estoque(BIGINT) TO authenticated;

-- Comentário para documentação
COMMENT ON FUNCTION recalcular_saldo_estoque(BIGINT) IS 
'Recalcula o saldo_atual de um estoque específico baseado em todas as operações (entradas com face_titulos, transferências, recompras, devoluções). Retorna o saldo anterior e o novo saldo calculado.';
