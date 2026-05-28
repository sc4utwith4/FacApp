-- Melhorar função get_user_empresa_id para retornar UUID padrão quando perfil não existe
CREATE OR REPLACE FUNCTION public.get_user_empresa_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  -- Buscar empresa_id do perfil do usuário autenticado
  SELECT empresa_id INTO v_empresa_id
  FROM public.profiles
  WHERE id = auth.uid()
  LIMIT 1;
  
  -- Se não encontrou, retornar UUID padrão (evita NULL e bloqueio de RLS)
  RETURN COALESCE(v_empresa_id, '00000000-0000-0000-0000-000000000001'::uuid);
END;
$$;;
