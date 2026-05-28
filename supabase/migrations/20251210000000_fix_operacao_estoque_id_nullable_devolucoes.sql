-- ============================================
-- CORRIGIR operacao_estoque_id NULL EM devolucoes_estoque
-- Garantir que devoluções diretas de estoque podem ter operacao_estoque_id NULL
-- ============================================

-- 1. Verificar e remover constraint NOT NULL se ainda existir
DO $$
BEGIN
  -- Verificar se a coluna ainda tem NOT NULL
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'devolucoes_estoque' 
      AND column_name = 'operacao_estoque_id'
      AND is_nullable = 'NO'
  ) THEN
    -- Remover NOT NULL
    ALTER TABLE public.devolucoes_estoque
      ALTER COLUMN operacao_estoque_id DROP NOT NULL;
    
    RAISE NOTICE 'Constraint NOT NULL removida de operacao_estoque_id';
  ELSE
    RAISE NOTICE 'Coluna operacao_estoque_id já permite NULL';
  END IF;
END $$;

-- 2. Verificar se a foreign key permite NULL (já deve permitir por padrão, mas vamos garantir)
-- Foreign keys no PostgreSQL permitem NULL por padrão, então não precisamos fazer nada
-- Mas vamos verificar se existe e está correta
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_name = 'devolucoes_estoque'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'operacao_estoque_id'
  ) THEN
    -- Se não existe foreign key, criar uma que permita NULL
    ALTER TABLE public.devolucoes_estoque
      ADD CONSTRAINT devolucoes_estoque_operacao_estoque_id_fkey
      FOREIGN KEY (operacao_estoque_id)
      REFERENCES public.operacoes_estoque(id)
      ON DELETE CASCADE;
    
    RAISE NOTICE 'Foreign key criada para operacao_estoque_id';
  ELSE
    RAISE NOTICE 'Foreign key já existe e permite NULL';
  END IF;
END $$;

-- 3. Atualizar função de validação para permitir NULL (se ainda não estiver atualizada)
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

-- 4. Atualizar comentários
COMMENT ON COLUMN public.devolucoes_estoque.operacao_estoque_id IS 'ID da operação de estoque relacionada (NULL para devoluções diretas de estoque)';
