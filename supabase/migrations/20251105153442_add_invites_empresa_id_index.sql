-- ============================================
-- MIGRATION: Adicionar Índice em invites.empresa_id
-- ============================================
-- Adiciona índice para melhorar performance de queries que filtram por empresa_id
-- na tabela invites.

-- Verificar se índice já existe antes de criar
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'invites'
      AND indexname = 'idx_invites_empresa_id'
  ) THEN
    -- Criar índice
    CREATE INDEX idx_invites_empresa_id ON public.invites (empresa_id);
    
    RAISE NOTICE 'Índice idx_invites_empresa_id criado com sucesso';
  ELSE
    RAISE NOTICE 'Índice idx_invites_empresa_id já existe';
  END IF;
END $$;

-- Comentário no índice
COMMENT ON INDEX public.idx_invites_empresa_id IS 'Índice para melhorar performance de queries que filtram convites por empresa_id';

