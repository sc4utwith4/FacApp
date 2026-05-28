-- ============================================
-- ADICIONAR CAMPOS PARA SUPORTE A ATUALIZAÇÕES MANUAIS DE SALDO
-- Permite que o trigger respeite atualizações manuais do saldo
-- ============================================

-- 1. Adicionar campos na tabela contas_bancarias
ALTER TABLE contas_bancarias
ADD COLUMN IF NOT EXISTS data_corte_saldo DATE,
ADD COLUMN IF NOT EXISTS saldo_base_ajustado NUMERIC(15,2);

-- Comentários
COMMENT ON COLUMN contas_bancarias.data_corte_saldo IS 
'Data a partir da qual o saldo foi ajustado manualmente. Se NULL, o saldo é calculado desde o saldo_inicial. Se NOT NULL, o saldo é calculado a partir desta data usando saldo_base_ajustado como base.';

COMMENT ON COLUMN contas_bancarias.saldo_base_ajustado IS 
'Saldo na data de corte (data_corte_saldo). Usado como base para cálculo quando há atualização manual do saldo.';

-- 2. Modificar função para atualizar saldo ao inserir lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_inserir_lancamento()
RETURNS TRIGGER AS $$
DECLARE
  saldo_inicial_val NUMERIC;
  saldo_base_ajustado_val NUMERIC;
  data_corte_val DATE;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
BEGIN
  IF NEW.conta_bancaria_id IS NOT NULL THEN
    -- Buscar dados da conta
    SELECT 
      COALESCE(saldo_inicial, 0),
      saldo_base_ajustado,
      data_corte_saldo
    INTO 
      saldo_inicial_val,
      saldo_base_ajustado_val,
      data_corte_val
    FROM contas_bancarias
    WHERE id = NEW.conta_bancaria_id;
    
    -- Verificar se há atualização manual (data_corte_saldo definida)
    IF data_corte_val IS NOT NULL AND saldo_base_ajustado_val IS NOT NULL THEN
      -- Calcular apenas lançamentos APÓS a data de corte
      SELECT COALESCE(SUM(
        CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
      ), 0) INTO saldo_calculado
      FROM lancamentos_caixa
      WHERE conta_bancaria_id = NEW.conta_bancaria_id
        AND data >= data_corte_val;
      
      -- Saldo final = saldo_base_ajustado + lançamentos após data de corte
      saldo_final := saldo_base_ajustado_val + saldo_calculado;
    ELSE
      -- Lógica original: calcular desde saldo_inicial com todos os lançamentos
      SELECT COALESCE(SUM(
        CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
      ), 0) INTO saldo_calculado
      FROM lancamentos_caixa
      WHERE conta_bancaria_id = NEW.conta_bancaria_id;
      
      -- Saldo final = saldo_inicial + todos os lançamentos
      saldo_final := saldo_inicial_val + saldo_calculado;
    END IF;
    
    -- Atualizar saldo_atual
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final
    WHERE id = NEW.conta_bancaria_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Modificar função para atualizar saldo ao atualizar lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_atualizar_lancamento()
RETURNS TRIGGER AS $$
DECLARE
  saldo_inicial_val NUMERIC;
  saldo_base_ajustado_val NUMERIC;
  data_corte_val DATE;
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
    SELECT 
      COALESCE(saldo_inicial, 0),
      saldo_base_ajustado,
      data_corte_saldo
    INTO 
      saldo_inicial_val,
      saldo_base_ajustado_val,
      data_corte_val
    FROM contas_bancarias
    WHERE id = OLD.conta_bancaria_id;
    
    IF data_corte_val IS NOT NULL AND saldo_base_ajustado_val IS NOT NULL THEN
      SELECT COALESCE(SUM(
        CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
      ), 0) INTO saldo_calculado
      FROM lancamentos_caixa
      WHERE conta_bancaria_id = OLD.conta_bancaria_id
        AND data >= data_corte_val;
      saldo_final := saldo_base_ajustado_val + saldo_calculado;
    ELSE
      SELECT COALESCE(SUM(
        CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
      ), 0) INTO saldo_calculado
      FROM lancamentos_caixa
      WHERE conta_bancaria_id = OLD.conta_bancaria_id;
      saldo_final := saldo_inicial_val + saldo_calculado;
    END IF;
    
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final
    WHERE id = OLD.conta_bancaria_id;
  END IF;
  
  -- Recalcular conta atual (nova ou atualizada)
  SELECT 
    COALESCE(saldo_inicial, 0),
    saldo_base_ajustado,
    data_corte_saldo
  INTO 
    saldo_inicial_val,
    saldo_base_ajustado_val,
    data_corte_val
  FROM contas_bancarias
  WHERE id = conta_id_para_atualizar;
  
  IF data_corte_val IS NOT NULL AND saldo_base_ajustado_val IS NOT NULL THEN
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = conta_id_para_atualizar
      AND data >= data_corte_val;
    saldo_final := saldo_base_ajustado_val + saldo_calculado;
  ELSE
    SELECT COALESCE(SUM(
      CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
    ), 0) INTO saldo_calculado
    FROM lancamentos_caixa
    WHERE conta_bancaria_id = conta_id_para_atualizar;
    saldo_final := saldo_inicial_val + saldo_calculado;
  END IF;
  
  UPDATE contas_bancarias
  SET saldo_atual = saldo_final
  WHERE id = conta_id_para_atualizar;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Modificar função para atualizar saldo ao deletar lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_deletar_lancamento()
RETURNS TRIGGER AS $$
DECLARE
  saldo_inicial_val NUMERIC;
  saldo_base_ajustado_val NUMERIC;
  data_corte_val DATE;
  saldo_calculado NUMERIC;
  saldo_final NUMERIC;
BEGIN
  IF OLD.conta_bancaria_id IS NOT NULL THEN
    -- Buscar dados da conta
    SELECT 
      COALESCE(saldo_inicial, 0),
      saldo_base_ajustado,
      data_corte_saldo
    INTO 
      saldo_inicial_val,
      saldo_base_ajustado_val,
      data_corte_val
    FROM contas_bancarias
    WHERE id = OLD.conta_bancaria_id;
    
    -- Verificar se há atualização manual
    IF data_corte_val IS NOT NULL AND saldo_base_ajustado_val IS NOT NULL THEN
      -- Calcular apenas lançamentos APÓS a data de corte (o deletado já não está mais na tabela)
      SELECT COALESCE(SUM(
        CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
      ), 0) INTO saldo_calculado
      FROM lancamentos_caixa
      WHERE conta_bancaria_id = OLD.conta_bancaria_id
        AND data >= data_corte_val;
      
      saldo_final := saldo_base_ajustado_val + saldo_calculado;
    ELSE
      -- Lógica original: calcular desde saldo_inicial com todos os lançamentos restantes
      SELECT COALESCE(SUM(
        CASE WHEN tipo = 'entrada' THEN valor ELSE -valor END
      ), 0) INTO saldo_calculado
      FROM lancamentos_caixa
      WHERE conta_bancaria_id = OLD.conta_bancaria_id;
      
      saldo_final := saldo_inicial_val + saldo_calculado;
    END IF;
    
    -- Atualizar saldo_atual
    UPDATE contas_bancarias
    SET saldo_atual = saldo_final
    WHERE id = OLD.conta_bancaria_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Criar função RPC para atualizar saldo manualmente
CREATE OR REPLACE FUNCTION atualizar_saldo_manual(
  p_conta_id UUID,
  p_novo_saldo NUMERIC,
  p_data_corte DATE DEFAULT CURRENT_DATE
)
RETURNS JSON AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Atualizar saldo e definir data de corte
  UPDATE contas_bancarias
  SET 
    saldo_atual = p_novo_saldo,
    saldo_base_ajustado = p_novo_saldo,
    data_corte_saldo = p_data_corte,
    updated_at = NOW()
  WHERE id = p_conta_id;
  
  IF NOT FOUND THEN
    RETURN json_build_object(
      'success', false,
      'message', 'Conta bancária não encontrada'
    );
  END IF;
  
  RETURN json_build_object(
    'success', true,
    'message', 'Saldo atualizado manualmente com sucesso',
    'conta_id', p_conta_id,
    'novo_saldo', p_novo_saldo,
    'data_corte', p_data_corte
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION atualizar_saldo_manual IS 
'Atualiza o saldo de uma conta bancária manualmente, definindo data_corte_saldo e saldo_base_ajustado. A partir desta data, o trigger calculará apenas lançamentos posteriores.';

-- 6. Atualizar comentários das funções
COMMENT ON FUNCTION atualizar_saldo_ao_inserir_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um novo lançamento é inserido. Se data_corte_saldo estiver definida, calcula apenas lançamentos após essa data usando saldo_base_ajustado como base. Caso contrário, calcula desde saldo_inicial com todos os lançamentos.';

COMMENT ON FUNCTION atualizar_saldo_ao_atualizar_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um lançamento é atualizado. Se data_corte_saldo estiver definida, calcula apenas lançamentos após essa data usando saldo_base_ajustado como base. Caso contrário, calcula desde saldo_inicial com todos os lançamentos.';

COMMENT ON FUNCTION atualizar_saldo_ao_deletar_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um lançamento é deletado. Se data_corte_saldo estiver definida, calcula apenas lançamentos após essa data usando saldo_base_ajustado como base. Caso contrário, calcula desde saldo_inicial com todos os lançamentos.';

-- 7. Criar índice para melhorar performance na busca de lançamentos por data
CREATE INDEX IF NOT EXISTS idx_lancamentos_caixa_conta_data 
ON lancamentos_caixa(conta_bancaria_id, data)
WHERE conta_bancaria_id IS NOT NULL;

COMMENT ON INDEX idx_lancamentos_caixa_conta_data IS 
'Índice para melhorar performance ao calcular saldo com data_corte_saldo, permitindo busca eficiente de lançamentos por conta e data.';

