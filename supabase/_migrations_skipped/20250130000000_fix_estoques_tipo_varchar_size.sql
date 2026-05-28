-- Corrigir tamanho do campo tipo na tabela estoques
-- O valor 'DEVOLUCOES' tem 11 caracteres, mas o campo está definido como VARCHAR(10)

-- 1. Aumentar o tamanho do campo tipo
ALTER TABLE public.estoques 
  ALTER COLUMN tipo TYPE VARCHAR(20);

-- 2. Garantir que o CHECK constraint inclui DEVOLUCOES
DO $$
BEGIN
  -- Remover constraint existente se houver
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage 
    WHERE table_name = 'estoques' 
    AND constraint_name = 'estoques_tipo_check'
  ) THEN
    ALTER TABLE public.estoques 
    DROP CONSTRAINT estoques_tipo_check;
  END IF;
  
  -- Adicionar constraint atualizada
  ALTER TABLE public.estoques
  ADD CONSTRAINT estoques_tipo_check 
  CHECK (tipo IN ('SPPRO', 'SOI', 'DEVOLUCOES'));
END $$;

-- 3. Comentário para documentação
COMMENT ON COLUMN public.estoques.tipo IS 'Tipo de estoque: SPPRO, SOI ou DEVOLUCOES';

