-- ============================================
-- ADICIONAR COLUNA saldo_atual EM contas_bancarias
-- Adiciona a coluna saldo_atual se não existir
-- ============================================

-- Adicionar coluna saldo_atual se não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'contas_bancarias' 
    AND column_name = 'saldo_atual'
  ) THEN
    ALTER TABLE contas_bancarias 
    ADD COLUMN saldo_atual DECIMAL(15,2);
    
    -- Inicializar saldo_atual com saldo_inicial para contas existentes
    UPDATE contas_bancarias 
    SET saldo_atual = COALESCE(saldo_inicial, 0)
    WHERE saldo_atual IS NULL;
  END IF;
END $$;

-- Comentário para documentação
COMMENT ON COLUMN contas_bancarias.saldo_atual IS 
'Saldo atual da conta bancária, calculado automaticamente a partir do saldo_inicial mais todas as movimentações (lançamentos de caixa). Atualizado automaticamente por triggers.';

