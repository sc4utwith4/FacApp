-- ============================================
-- CORREÇÃO: Garantir cálculo correto de saldos
-- saldo_atual = saldo_inicial + entradas - saídas
-- ============================================

-- Primeiro, vamos recalcular todos os saldos existentes usando a fórmula correta
-- Isso garante que todos os saldos estejam corretos antes de atualizar os triggers

DO $$
DECLARE
  conta_record RECORD;
  saldo_inicial_val NUMERIC;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
BEGIN
  -- Loop através de todas as contas bancárias
  FOR conta_record IN 
    SELECT id, saldo_inicial, empresa_id
    FROM contas_bancarias
  LOOP
    -- Buscar saldo inicial
    saldo_inicial_val := COALESCE(conta_record.saldo_inicial, 0);
    
    -- Calcular saldo baseado em todos os lançamentos
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = conta_record.id;
    
    -- Calcular saldo final: saldo_inicial + entradas - saídas
    saldo_final := saldo_inicial_val + saldo_calculado;
    
    -- Atualizar saldo_atual
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final
    WHERE id = conta_record.id;
  END LOOP;
END $$;

-- Agora vamos atualizar os triggers para garantir que sempre recalculem corretamente
-- Função para atualizar saldo ao inserir lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_inserir_lancamento()
RETURNS TRIGGER AS $$
DECLARE
  saldo_inicial_val NUMERIC;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
BEGIN
  IF NEW.conta_bancaria_id IS NOT NULL THEN
    -- Buscar saldo inicial
    SELECT COALESCE(saldo_inicial, 0) INTO saldo_inicial_val
    FROM contas_bancarias
    WHERE id = NEW.conta_bancaria_id;
    
    -- Calcular saldo baseado em TODOS os lançamentos (incluindo o novo)
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = NEW.conta_bancaria_id;
    
    -- Calcular saldo final: saldo_inicial + entradas - saídas
    saldo_final := saldo_inicial_val + saldo_calculado;
    
    -- Atualizar saldo_atual
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final
    WHERE id = NEW.conta_bancaria_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para atualizar saldo ao atualizar lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_atualizar_lancamento()
RETURNS TRIGGER AS $$
DECLARE
  saldo_inicial_val NUMERIC;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
  conta_id_para_atualizar UUID;
BEGIN
  -- Determinar qual conta atualizar
  IF NEW.conta_bancaria_id IS NOT NULL THEN
    conta_id_para_atualizar := NEW.conta_bancaria_id;
  ELSIF OLD.conta_bancaria_id IS NOT NULL THEN
    conta_id_para_atualizar := OLD.conta_bancaria_id;
  ELSE
    RETURN NEW;
  END IF;
  
  -- Se a conta mudou, atualizar ambas as contas
  IF OLD.conta_bancaria_id IS NOT NULL AND 
     NEW.conta_bancaria_id IS NOT NULL AND
     OLD.conta_bancaria_id != NEW.conta_bancaria_id THEN
    -- Recalcular conta antiga
    SELECT COALESCE(saldo_inicial, 0) INTO saldo_inicial_val
    FROM contas_bancarias
    WHERE id = OLD.conta_bancaria_id;
    
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = OLD.conta_bancaria_id;
    
    saldo_final := saldo_inicial_val + saldo_calculado;
    
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final
    WHERE id = OLD.conta_bancaria_id;
  END IF;
  
  -- Recalcular conta atual (nova ou atualizada)
  SELECT COALESCE(saldo_inicial, 0) INTO saldo_inicial_val
  FROM contas_bancarias
  WHERE id = conta_id_para_atualizar;
  
  SELECT COALESCE(SUM(
    CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
  ), 0) INTO saldo_calculado
  FROM lancamentos_caixa
  WHERE conta_bancaria_id = conta_id_para_atualizar;
  
  saldo_final := saldo_inicial_val + saldo_calculado;
  
  UPDATE contas_bancarias
  SET saldo_atual = saldo_final
  WHERE id = conta_id_para_atualizar;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para atualizar saldo ao deletar lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_deletar_lancamento()
RETURNS TRIGGER AS $$
DECLARE
  saldo_inicial_val NUMERIC;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
BEGIN
  IF OLD.conta_bancaria_id IS NOT NULL THEN
    -- Buscar saldo inicial
    SELECT COALESCE(saldo_inicial, 0) INTO saldo_inicial_val
    FROM contas_bancarias
    WHERE id = OLD.conta_bancaria_id;
    
    -- Calcular saldo baseado em TODOS os lançamentos restantes (o deletado já não está mais na tabela)
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = OLD.conta_bancaria_id;
    
    -- Calcular saldo final: saldo_inicial + entradas - saídas
    saldo_final := saldo_inicial_val + saldo_calculado;
    
    -- Atualizar saldo_atual
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final
    WHERE id = OLD.conta_bancaria_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comentários atualizados
COMMENT ON FUNCTION atualizar_saldo_ao_inserir_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um novo lançamento é inserido. Recalcula sempre: saldo_atual = saldo_inicial + entradas - saídas';

COMMENT ON FUNCTION atualizar_saldo_ao_atualizar_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um lançamento é atualizado. Recalcula sempre: saldo_atual = saldo_inicial + entradas - saídas';

COMMENT ON FUNCTION atualizar_saldo_ao_deletar_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um lançamento é deletado. Recalcula sempre: saldo_atual = saldo_inicial + entradas - saídas';

