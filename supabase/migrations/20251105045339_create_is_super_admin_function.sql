-- Criar função para verificar se usuário é super admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
DECLARE
  v_is_super_admin BOOLEAN;
BEGIN
  -- Buscar is_super_admin do perfil do usuário autenticado
  SELECT is_super_admin INTO v_is_super_admin
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
  
  -- Retornar FALSE se não encontrou ou se é NULL
  RETURN COALESCE(v_is_super_admin, FALSE);
END;
$$;

-- Comentário na função para documentação
COMMENT ON FUNCTION public.is_super_admin() IS 'Retorna TRUE se o usuário autenticado é super administrador';;
