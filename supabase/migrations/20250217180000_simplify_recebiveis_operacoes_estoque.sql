-- ============================================
-- MIGRATION: Simplificar Recebíveis de Operações de Estoque
-- ============================================
-- Remove campo status e torna data_vencimento nullable
-- Esta funcionalidade agora é apenas para visualização

-- ============================================
-- 1. REMOVER ÍNDICE DE STATUS
-- ============================================
DROP INDEX IF EXISTS public.idx_recebiveis_status;

-- ============================================
-- 2. REMOVER COLUNA STATUS
-- ============================================
ALTER TABLE public.recebiveis_operacoes_estoque
DROP COLUMN IF EXISTS status;

-- ============================================
-- 3. ALTERAR DATA_VENCIMENTO PARA NULLABLE
-- ============================================
ALTER TABLE public.recebiveis_operacoes_estoque
ALTER COLUMN data_vencimento DROP NOT NULL;

-- ============================================
-- 4. REMOVER ENUM STATUS_RECEBIVEL (se não usado em outro lugar)
-- ============================================
-- Verificar se o enum é usado em outras tabelas antes de remover
DO $$
BEGIN
    -- Verificar se há outras tabelas usando o enum
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND data_type = 'USER-DEFINED'
        AND udt_name = 'status_recebivel'
        AND table_name != 'recebiveis_operacoes_estoque'
    ) THEN
        -- Não há outras tabelas usando, podemos remover
        DROP TYPE IF EXISTS public.status_recebivel;
    END IF;
END
$$;

-- ============================================
-- 5. ATUALIZAR COMENTÁRIOS
-- ============================================
COMMENT ON COLUMN public.recebiveis_operacoes_estoque.data_vencimento IS 'Data de vencimento do recebível (pode ser NULL para visualização)';
-- Remover comentário da coluna status que foi removida

