-- ============================================
-- TRIGGERS PARA ATUALIZAÇÃO AUTOMÁTICA DE SALDOS
-- Triggers que atualizam saldo_atual automaticamente quando
-- lançamentos são criados, editados ou excluídos
-- ============================================

-- Função para atualizar saldo ao inserir lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_inserir_lancamento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.conta_bancaria_id IS NOT NULL THEN
    UPDATE contas_bancarias
    SET saldo_atual = COALESCE(saldo_atual, saldo_inicial, 0) + 
        CASE WHEN NEW.tipo = 'entrada' THEN NEW.valor ELSE -NEW.valor END
    WHERE id = NEW.conta_bancaria_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para atualizar saldo ao atualizar lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_atualizar_lancamento()
RETURNS TRIGGER AS $$
DECLARE
  valor_antigo NUMERIC;
  valor_novo NUMERIC;
BEGIN
  -- Se a conta bancária mudou ou foi removida, reverter o valor antigo
  IF OLD.conta_bancaria_id IS NOT NULL AND 
     (OLD.conta_bancaria_id != NEW.conta_bancaria_id OR NEW.conta_bancaria_id IS NULL) THEN
    UPDATE contas_bancarias
    SET saldo_atual = COALESCE(saldo_atual, saldo_inicial, 0) - 
        CASE WHEN OLD.tipo = 'entrada' THEN OLD.valor ELSE -OLD.valor END
    WHERE id = OLD.conta_bancaria_id;
  END IF;
  
  -- Se a conta bancária mudou ou foi adicionada, aplicar o valor novo
  IF NEW.conta_bancaria_id IS NOT NULL AND 
     (OLD.conta_bancaria_id != NEW.conta_bancaria_id OR OLD.conta_bancaria_id IS NULL) THEN
    UPDATE contas_bancarias
    SET saldo_atual = COALESCE(saldo_atual, saldo_inicial, 0) + 
        CASE WHEN NEW.tipo = 'entrada' THEN NEW.valor ELSE -NEW.valor END
    WHERE id = NEW.conta_bancaria_id;
  -- Se a conta bancária não mudou, calcular apenas a diferença
  ELSIF OLD.conta_bancaria_id = NEW.conta_bancaria_id AND NEW.conta_bancaria_id IS NOT NULL THEN
    valor_antigo := CASE WHEN OLD.tipo = 'entrada' THEN OLD.valor ELSE -OLD.valor END;
    valor_novo := CASE WHEN NEW.tipo = 'entrada' THEN NEW.valor ELSE -NEW.valor END;
    
    UPDATE contas_bancarias
    SET saldo_atual = COALESCE(saldo_atual, saldo_inicial, 0) + (valor_novo - valor_antigo)
    WHERE id = NEW.conta_bancaria_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Função para atualizar saldo ao deletar lançamento
CREATE OR REPLACE FUNCTION atualizar_saldo_ao_deletar_lancamento()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.conta_bancaria_id IS NOT NULL THEN
    UPDATE contas_bancarias
    SET saldo_atual = COALESCE(saldo_atual, saldo_inicial, 0) - 
        CASE WHEN OLD.tipo = 'entrada' THEN OLD.valor ELSE -OLD.valor END
    WHERE id = OLD.conta_bancaria_id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar triggers
DROP TRIGGER IF EXISTS trigger_atualizar_saldo_insert ON lancamentos_caixa;
CREATE TRIGGER trigger_atualizar_saldo_insert
  AFTER INSERT ON lancamentos_caixa
  FOR EACH ROW
  EXECUTE FUNCTION atualizar_saldo_ao_inserir_lancamento();

DROP TRIGGER IF EXISTS trigger_atualizar_saldo_update ON lancamentos_caixa;
CREATE TRIGGER trigger_atualizar_saldo_update
  AFTER UPDATE ON lancamentos_caixa
  FOR EACH ROW
  EXECUTE FUNCTION atualizar_saldo_ao_atualizar_lancamento();

DROP TRIGGER IF EXISTS trigger_atualizar_saldo_delete ON lancamentos_caixa;
CREATE TRIGGER trigger_atualizar_saldo_delete
  AFTER DELETE ON lancamentos_caixa
  FOR EACH ROW
  EXECUTE FUNCTION atualizar_saldo_ao_deletar_lancamento();

-- Comentários para documentação
COMMENT ON FUNCTION atualizar_saldo_ao_inserir_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um novo lançamento é inserido. Soma entradas e subtrai saídas.';

COMMENT ON FUNCTION atualizar_saldo_ao_atualizar_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um lançamento é atualizado. Recalcula a diferença entre valores antigo e novo.';

COMMENT ON FUNCTION atualizar_saldo_ao_deletar_lancamento() IS 
'Atualiza automaticamente o saldo_atual da conta bancária quando um lançamento é deletado. Reverte o valor do lançamento removido.';

