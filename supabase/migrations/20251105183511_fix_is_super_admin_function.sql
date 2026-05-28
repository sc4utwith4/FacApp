-- ============================================
-- MIGRATION: Corrigir Função is_super_admin()
-- ============================================
-- Garante que a função is_super_admin() tem todas as configurações corretas:
-- - SECURITY DEFINER
-- - SET search_path após CREATE OR REPLACE
-- - Permissões corretas para authenticated e anon

-- Recriar função com todas as configurações
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id UUID;
  v_is_super_admin BOOLEAN;
BEGIN
  -- Obter ID do usuário autenticado
  v_user_id := auth.uid();
  
  -- Se não houver usuário autenticado, retornar FALSE
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  
  -- Buscar is_super_admin do perfil do usuário autenticado
  SELECT is_super_admin INTO v_is_super_admin
  FROM public.profiles
  WHERE id = v_user_id
  LIMIT 1;
  
  -- Retornar FALSE se não encontrou ou se é NULL
  RETURN COALESCE(v_is_super_admin, FALSE);
END;
$$;

-- IMPORTANTE: Após CREATE OR REPLACE, garantir configurações explícitas
-- Isso é necessário porque recriações podem resetar essas flags
ALTER FUNCTION public.is_super_admin() SET search_path = 'auth', 'public';

-- Ajustar permissões
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon;

-- Revogar permissões de outros roles (se necessário)
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;

-- Comentário na função
COMMENT ON FUNCTION public.is_super_admin() IS 'Verifica se o usuário autenticado é super admin. Retorna FALSE se não houver sessão ou se o perfil não existir.';;
