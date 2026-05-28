-- ============================================
-- FUNÇÃO PARA RECALCULAR SALDO DE CONTA
-- Recalcula o saldo_atual baseado em saldo_inicial + todos os lançamentos
-- Útil para corrigir saldos desatualizados ou sincronizar dados
-- ============================================

CREATE OR REPLACE FUNCTION recalcular_saldo_conta(conta_id_param UUID)
RETURNS NUMERIC AS $$
DECLARE
  saldo_calculado NUMERIC;
  saldo_inicial_val NUMERIC;
  saldo_final NUMERIC;
BEGIN
  -- Buscar saldo inicial
  SELECT COALESCE(saldo_inicial, 0) INTO saldo_inicial_val
  FROM contas_bancarias
  WHERE id = conta_id_param;
  
  IF saldo_inicial_val IS NULL THEN
    RAISE EXCEPTION 'Conta bancária não encontrada: %', conta_id_param;
  END IF;
  
  -- Calcular saldo baseado em todos os lançamentos
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
  ), 0) INTO saldo_calculado
  FROM lancamentos_caixa
  WHERE conta_bancaria_id = conta_id_param;
  
  -- Calcular saldo final
  saldo_final := saldo_inicial_val + saldo_calculado;
  
  -- Atualizar saldo_atual
  UPDATE contas_bancarias
  SET saldo_atual = saldo_final
  WHERE id = conta_id_param;
  
  RETURN saldo_final;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para recalcular todos os saldos de uma empresa
CREATE OR REPLACE FUNCTION recalcular_todos_saldos_empresa(empresa_id_param UUID)
RETURNS TABLE(conta_id UUID, saldo_anterior NUMERIC, saldo_novo NUMERIC) AS $$
DECLARE
  conta_record RECORD;
BEGIN
  -- Loop através de todas as contas da empresa
  FOR conta_record IN 
    SELECT id, saldo_atual
    FROM contas_bancarias
    WHERE empresa_id = empresa_id_param
  LOOP
    -- Recalcular saldo da conta
    PERFORM recalcular_saldo_conta(conta_record.id);
    
    -- Buscar saldo atualizado
    SELECT saldo_atual INTO saldo_novo
    FROM contas_bancarias
    WHERE id = conta_record.id;
    
    -- Retornar resultado
    conta_id := conta_record.id;
    saldo_anterior := COALESCE(conta_record.saldo_atual, 0);
    saldo_novo := COALESCE(saldo_novo, 0);
    
    RETURN NEXT;
  END LOOP;
  
  RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Conceder permissões
GRANT EXECUTE ON FUNCTION recalcular_saldo_conta(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION recalcular_saldo_conta(UUID) TO anon;
GRANT EXECUTE ON FUNCTION recalcular_todos_saldos_empresa(UUID) TO authenticated;

-- Comentários para documentação
COMMENT ON FUNCTION recalcular_saldo_conta(UUID) IS 
'Recalcula o saldo_atual de uma conta bancária específica baseado no saldo_inicial mais todos os lançamentos de caixa. Útil para corrigir saldos desatualizados.';

COMMENT ON FUNCTION recalcular_todos_saldos_empresa(UUID) IS 
'Recalcula o saldo_atual de todas as contas bancárias de uma empresa. Retorna uma tabela com os saldos anteriores e novos de cada conta.';

