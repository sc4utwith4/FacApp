-- ============================================
-- PERMITIR operacao_estoque_id NULL EM devolucoes_estoque
-- Permite devoluções diretas de estoque sem operação específica
-- ============================================

-- 1. Tornar operacao_estoque_id nullable
ALTER TABLE public.devolucoes_estoque
  ALTER COLUMN operacao_estoque_id DROP NOT NULL;

-- 2. Atualizar função de validação para permitir NULL
CREATE OR REPLACE FUNCTION public.validate_devolucao_valor()
RETURNS TRIGGER AS $$
DECLARE
  total_devolvido NUMERIC(15,2);
  face_titulos NUMERIC(15,2);
BEGIN
  -- Se operacao_estoque_id for NULL, não validar contra Face dos Títulos
  -- (devolução direta de estoque)
  IF NEW.operacao_estoque_id IS NULL THEN
    -- Apenas validar que o valor é positivo (já validado pelo CHECK constraint)
    RETURN NEW;
  END IF;

  -- Validação original para devoluções de operação específica
  -- Calcular total já devolvido (excluindo a devolução atual se for update)
  SELECT COALESCE(SUM(valor_devolucao), 0) INTO total_devolvido
  FROM public.devolucoes_estoque
  WHERE operacao_estoque_id = NEW.operacao_estoque_id
    AND id != COALESCE(NEW.id, 0);

  -- Buscar Face dos Títulos da operação
  SELECT face_titulos INTO face_titulos
  FROM public.operacoes_estoque
  WHERE id = NEW.operacao_estoque_id;

  -- Validar que o total não excede a Face dos Títulos
  IF (total_devolvido + NEW.valor_devolucao) > face_titulos THEN
    RAISE EXCEPTION 'Total de devoluções (R$ %) excede a Face dos Títulos (R$ %)', 
      (total_devolvido + NEW.valor_devolucao), face_titulos;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Atualizar comentários
COMMENT ON COLUMN public.devolucoes_estoque.operacao_estoque_id IS 'ID da operação de estoque relacionada (NULL para devoluções diretas de estoque)';



