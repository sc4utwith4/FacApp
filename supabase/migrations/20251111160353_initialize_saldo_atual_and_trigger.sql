-- ============================================
-- INICIALIZAR saldo_atual E TRIGGER PARA CRIAÇÃO DE CONTAS
-- Garante que saldo_atual seja sempre inicializado ao criar conta
-- ============================================

-- Função para inicializar saldo_atual ao criar conta
CREATE OR REPLACE FUNCTION inicializar_saldo_atual_conta()
RETURNS TRIGGER AS $$
BEGIN
  -- Se saldo_atual não foi definido, inicializar com saldo_inicial
  IF NEW.saldo_atual IS NULL THEN
    NEW.saldo_atual := COALESCE(NEW.saldo_inicial, 0);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Criar trigger para inicializar saldo_atual ao criar conta
DROP TRIGGER IF EXISTS trigger_inicializar_saldo_atual ON contas_bancarias;
CREATE TRIGGER trigger_inicializar_saldo_atual
  BEFORE INSERT ON contas_bancarias
  FOR EACH ROW
  EXECUTE FUNCTION inicializar_saldo_atual_conta();

-- Inicializar saldo_atual para contas existentes que não têm esse valor
UPDATE contas_bancarias
SET saldo_atual = COALESCE(saldo_inicial, 0)
WHERE saldo_atual IS NULL;

-- Comentário para documentação
COMMENT ON FUNCTION inicializar_saldo_atual_conta() IS 
'Garante que saldo_atual seja sempre inicializado com saldo_inicial quando uma nova conta bancária é criada.';

