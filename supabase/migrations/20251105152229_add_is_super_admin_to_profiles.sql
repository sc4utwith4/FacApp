-- Adicionar coluna is_super_admin à tabela profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Adicionar índice para consultas mais rápidas
CREATE INDEX IF NOT EXISTS idx_profiles_is_super_admin ON public.profiles (is_super_admin);

-- Adicionar comentário para documentação
COMMENT ON COLUMN public.profiles.is_super_admin IS 'Indica se o usuário é super administrador do sistema';

-- Atualizar o usuário existente para ser super admin (se for o primeiro usuário)
UPDATE public.profiles
SET is_super_admin = TRUE
WHERE id = 'c65d28bc-5f4a-48a2-9d60-775c15a78436';;
