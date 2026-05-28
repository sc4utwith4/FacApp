-- ============================================
-- ADICIONAR CAMPO saldo_inicial NA TABELA estoques
-- Implementar mesma lógica das contas bancárias
-- ============================================

-- 1. Adicionar coluna saldo_inicial
ALTER TABLE public.estoques
ADD COLUMN IF NOT EXISTS saldo_inicial NUMERIC(15,2) DEFAULT 0;

-- 2. Calcular e distribuir valores iniciais
-- Valores iniciais desejados:
-- SPPRO: 9.933.726,12
-- SOI: 7.164.022,87
DO $$
DECLARE
  valor_inicial_sppro NUMERIC := 9933726.12;
  valor_inicial_soi NUMERIC := 7164022.87;
  total_sppro NUMERIC;
  total_soi NUMERIC;
  qtd_sppro INTEGER;
  qtd_soi INTEGER;
  offset_sppro NUMERIC;
  offset_soi NUMERIC;
  estoque_record RECORD;
BEGIN
  -- Calcular totais e quantidades para SPPRO
  SELECT COALESCE(SUM(saldo_atual), 0), COUNT(*)
  INTO total_sppro, qtd_sppro
  FROM estoques
  WHERE tipo = 'SPPRO' AND ativo = true;
  
  -- Calcular totais e quantidades para SOI
  SELECT COALESCE(SUM(saldo_atual), 0), COUNT(*)
  INTO total_soi, qtd_soi
  FROM estoques
  WHERE tipo = 'SOI' AND ativo = true;
  
  -- Distribuir valor inicial proporcionalmente entre os estoques do mesmo tipo
  -- Cada estoque recebe: saldo_inicial = (valor_inicial_total / quantidade_estoques) - saldo_atual_atual
  -- Isso garante que: saldo_inicial + saldo_atual = valor_inicial_total / quantidade_estoques
  -- E a soma de todos os estoques do mesmo tipo = valor_inicial_total
  
  -- Atualizar estoques SPPRO
  FOR estoque_record IN 
    SELECT id, saldo_atual 
    FROM estoques 
    WHERE tipo = 'SPPRO' AND ativo = true
  LOOP
    UPDATE estoques
    SET saldo_inicial = CASE 
      WHEN qtd_sppro > 0 THEN (valor_inicial_sppro / qtd_sppro) - COALESCE(estoque_record.saldo_atual, 0)
      ELSE 0
    END
    WHERE id = estoque_record.id;
  END LOOP;
  
  -- Atualizar estoques SOI
  FOR estoque_record IN 
    SELECT id, saldo_atual 
    FROM estoques 
    WHERE tipo = 'SOI' AND ativo = true
  LOOP
    UPDATE estoques
    SET saldo_inicial = CASE 
      WHEN qtd_soi > 0 THEN (valor_inicial_soi / qtd_soi) - COALESCE(estoque_record.saldo_atual, 0)
      ELSE 0
    END
    WHERE id = estoque_record.id;
  END LOOP;
END $$;

-- 3. Adicionar comentário para documentação
COMMENT ON COLUMN public.estoques.saldo_inicial IS 
'Saldo inicial do estoque (valor base). O saldo exibido será saldo_inicial + saldo_atual, permitindo que operações alterem o saldo_atual dinamicamente. Funciona igual às contas bancárias.';

