-- Verificar se empresa padrão existe, criar se não existir (já existe, mas garantindo)
INSERT INTO public.empresas (id, nome)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Empresa Padrão'
)
ON CONFLICT (id) DO NOTHING;

-- Criar função para criar perfil automaticamente quando usuário é criado
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (id, empresa_id, email, nome, perfil)
  VALUES (
    NEW.id,
    '00000000-0000-0000-0000-000000000001'::uuid,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'nome',
      split_part(COALESCE(NEW.email, ''), '@', 1),
      'Usuário'
    ),
    'Admin'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Criar trigger para executar função quando novo usuário é criado
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Garantir permissões corretas
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated, anon, public;;
