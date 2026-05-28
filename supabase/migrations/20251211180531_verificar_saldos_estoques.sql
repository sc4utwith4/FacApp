-- ============================================
-- FUNÇÃO PARA VERIFICAR SALDOS DE ESTOQUES
-- Analisa todas as operações que afetam o saldo de cada estoque
-- Calcula o saldo esperado e compara com o saldo atual
-- Identifica discrepâncias
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
  -- Loop através de todos os estoques da empresa
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
    
    -- 1. Calcular total de entradas (face_titulos de operações de entrada)
    SELECT COALESCE(SUM(face_titulos), 0) INTO total_entradas_val
    FROM public.operacoes_estoque
    WHERE estoque_id = estoque_record.id
      AND tipo_operacao = 'entrada';
    
    -- 2. Operações de SAÍDA não alteram saldo (conforme regra atual)
    -- Mas vamos contar para informação
    SELECT COALESCE(SUM(face_titulos), 0) INTO total_saidas_val
    FROM public.operacoes_estoque
    WHERE estoque_id = estoque_record.id
      AND tipo_operacao = 'saida';
    
    -- 3. Transferências que AUMENTAM saldo (entrada no estoque)
    -- conta_para_estoque: quando estoque_destino_id = estoque.id
    -- estoque_para_estoque: quando estoque_destino_id = estoque.id
    SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_entrada_val
    FROM public.movimentacoes_estoque
    WHERE (
      (tipo = 'conta_para_estoque' AND estoque_destino_id = estoque_record.id)
      OR (tipo = 'estoque_para_estoque' AND estoque_destino_id = estoque_record.id)
    );
    
    -- 4. Transferências que DIMINUEM saldo (saída do estoque)
    -- estoque_para_conta: quando estoque_origem_id = estoque.id
    -- estoque_para_estoque: quando estoque_origem_id = estoque.id
    SELECT COALESCE(SUM(valor), 0) INTO total_transferencias_saida_val
    FROM public.movimentacoes_estoque
    WHERE (
      (tipo = 'estoque_para_conta' AND estoque_origem_id = estoque_record.id)
      OR (tipo = 'estoque_para_estoque' AND estoque_origem_id = estoque_record.id)
    );
    
    -- 5. Recompras (subtraem do saldo, apenas para operações de entrada)
    SELECT COALESCE(SUM(r.valor_recompra), 0) INTO total_recompras_val
    FROM public.recompras_estoque r
    INNER JOIN public.operacoes_estoque o ON o.id = r.operacao_estoque_id
    WHERE o.estoque_id = estoque_record.id
      AND o.tipo_operacao = 'entrada';
    
    -- 6. Devoluções (reduzem saldo do estoque original)
    SELECT COALESCE(SUM(d.valor_devolucao), 0) INTO total_devolucoes_val
    FROM public.devolucoes_estoque d
    INNER JOIN public.operacoes_estoque o ON o.id = d.operacao_estoque_id
    WHERE o.estoque_id = estoque_record.id
      AND o.tipo_operacao = 'entrada';
    
    -- Calcular saldo esperado
    saldo_esperado_val := saldo_inicial_val 
      + total_entradas_val
      + total_transferencias_entrada_val
      - total_transferencias_saida_val
      - total_recompras_val
      - total_devolucoes_val;
    
    -- Retornar resultado
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

-- Conceder permissões
GRANT EXECUTE ON FUNCTION verificar_saldos_estoques(UUID) TO authenticated;

-- Comentário para documentação
COMMENT ON FUNCTION verificar_saldos_estoques(UUID) IS 
'Verifica os saldos de todos os estoques de uma empresa, calculando o saldo esperado baseado em todas as operações (entradas, transferências, recompras, devoluções) e comparando com o saldo atual. Retorna uma tabela com as discrepâncias encontradas.';
