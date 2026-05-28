-- ============================================
-- FUNÇÃO PARA RECALCULAR TODOS OS SALDOS DE ESTOQUES DE UMA EMPRESA
-- Recalcula o saldo_atual de todos os estoques da empresa
-- baseado em todas as operações
-- ============================================

CREATE OR REPLACE FUNCTION recalcular_todos_saldos_estoques_empresa(empresa_id_param UUID)
RETURNS TABLE(
  estoque_id BIGINT,
  estoque_descricao TEXT,
  tipo_estoque VARCHAR,
  saldo_anterior NUMERIC,
  saldo_novo NUMERIC
) AS $$
DECLARE
  estoque_record RECORD;
  resultado RECORD;
BEGIN
  -- Loop através de todos os estoques da empresa
  FOR estoque_record IN 
    SELECT id, descricao, tipo, saldo_atual
    FROM public.estoques
    WHERE empresa_id = empresa_id_param
      AND ativo = true
  LOOP
    -- Recalcular saldo do estoque usando a função específica
    SELECT * INTO resultado
    FROM recalcular_saldo_estoque(estoque_record.id);
    
    -- Retornar resultado
    estoque_id := resultado.estoque_id;
    estoque_descricao := estoque_record.descricao;
    tipo_estoque := estoque_record.tipo;
    saldo_anterior := resultado.saldo_anterior;
    saldo_novo := resultado.saldo_novo;
    
    RETURN NEXT;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Conceder permissões
GRANT EXECUTE ON FUNCTION recalcular_todos_saldos_estoques_empresa(UUID) TO authenticated;

-- Comentário para documentação
COMMENT ON FUNCTION recalcular_todos_saldos_estoques_empresa(UUID) IS 
'Recalcula o saldo_atual de todos os estoques de uma empresa baseado em todas as operações. Retorna uma tabela com os saldos anteriores e novos de cada estoque.';
