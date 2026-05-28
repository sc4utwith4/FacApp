-- ============================================
-- MIGRATION: Corrigir is_super_admin() para PostgREST
-- ============================================
-- Recria a função sem SET search_path na definição inicial
-- e garante que o PostgREST reconheça a função no cache

-- Recriar função sem SET search_path na definição
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
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

-- Configurar search_path após CREATE OR REPLACE
ALTER FUNCTION public.is_super_admin() SET search_path = 'auth', 'public';

-- Garantir permissões
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin() FROM PUBLIC;

-- Comentário na função
COMMENT ON FUNCTION public.is_super_admin() IS 'Verifica se o usuário autenticado é super admin. Retorna FALSE se não houver sessão ou se o perfil não existir.';

-- Forçar reload do schema do PostgREST
NOTIFY pgrst, 'reload schema';
;
