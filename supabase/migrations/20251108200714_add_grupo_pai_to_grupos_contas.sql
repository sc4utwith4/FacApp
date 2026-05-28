-- ============================================
-- Adicionar suporte a hierarquia de subgrupos
-- em grupos_contas
-- ============================================

-- Adicionar coluna grupo_pai_id para relacionamento hierárquico
ALTER TABLE public.grupos_contas
ADD COLUMN IF NOT EXISTS grupo_pai_id UUID REFERENCES public.grupos_contas(id) ON DELETE CASCADE;

-- Criar índice para melhor performance em consultas hierárquicas
CREATE INDEX IF NOT EXISTS idx_grupos_contas_grupo_pai_id 
ON public.grupos_contas(grupo_pai_id);

-- Constraint para evitar auto-referência (um grupo não pode ser pai de si mesmo)
ALTER TABLE public.grupos_contas
ADD CONSTRAINT check_grupo_pai_different 
CHECK (id IS DISTINCT FROM grupo_pai_id);

-- Comentário na coluna para documentação
COMMENT ON COLUMN public.grupos_contas.grupo_pai_id IS 'Referência ao grupo pai. NULL para grupos de primeiro nível.';

