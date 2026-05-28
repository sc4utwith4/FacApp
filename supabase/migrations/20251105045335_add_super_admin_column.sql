-- Adicionar coluna is_super_admin na tabela profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN DEFAULT FALSE NOT NULL;

-- Criar índice para melhorar performance de consultas
CREATE INDEX IF NOT EXISTS idx_profiles_is_super_admin ON public.profiles(is_super_admin) WHERE is_super_admin = TRUE;

-- Comentário na coluna para documentação
COMMENT ON COLUMN public.profiles.is_super_admin IS 'Indica se o usuário é super administrador do sistema';;
