-- Migration: Corrigir trigger handle_new_user para evitar erro de foreign key
-- Data: 2025-01-27
-- Descrição: Separa validação (BEFORE) e criação de perfil (AFTER) para evitar erro de FK

-- Função para VALIDAR convite (BEFORE INSERT)
CREATE OR REPLACE FUNCTION public.handle_new_user_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_invite RECORD;
  v_is_first_user BOOLEAN;
BEGIN
  -- Verificar se é o primeiro usuário (não há perfis no sistema)
  v_is_first_user := NOT EXISTS (SELECT 1 FROM public.profiles);
  
  IF v_is_first_user THEN
    -- Se é o primeiro usuário, permitir criação sem convite
    RETURN NEW;
  ELSE
    -- Se não é o primeiro usuário, verificar se existe um convite pendente válido
    SELECT 
      id,
      empresa_id, 
      perfil,
      token
    INTO v_invite
    FROM public.invites
    WHERE email = NEW.email
      AND status = 'pending'
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    -- Se NÃO encontrou convite válido, ABORTAR criação de usuário
    IF v_invite IS NULL THEN
      RAISE EXCEPTION 'Cadastro apenas via convite. Entre em contato com o administrador para receber um convite.'
        USING ERRCODE = 'P0001';
    END IF;

    -- Se encontrou convite válido, permitir criação
    RETURN NEW;
  END IF;
END;
$$;

-- Função para CRIAR PERFIL (AFTER INSERT)
CREATE OR REPLACE FUNCTION public.handle_new_user_create_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_invite RECORD;
  v_empresa_id UUID;
  v_perfil VARCHAR(50);
  v_is_super_admin BOOLEAN;
  v_invite_id UUID;
  v_is_first_user BOOLEAN;
BEGIN
  -- Verificar se é o primeiro usuário (não há perfis no sistema)
  v_is_first_user := NOT EXISTS (SELECT 1 FROM public.profiles WHERE id != NEW.id);
  
  IF v_is_first_user THEN
    -- Se é o primeiro usuário, criar como super admin
    v_empresa_id := '00000000-0000-0000-0000-000000000001';
    v_perfil := 'Admin';
    v_is_super_admin := TRUE;
    v_invite_id := NULL;
  ELSE
    -- Se não é o primeiro usuário, buscar convite válido
    SELECT 
      id,
      empresa_id, 
      perfil,
      token
    INTO v_invite
    FROM public.invites
    WHERE email = NEW.email
      AND status = 'pending'
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1;

    -- Se encontrou convite válido, usar dados do convite
    IF v_invite IS NOT NULL THEN
      v_empresa_id := v_invite.empresa_id;
      v_perfil := v_invite.perfil;
      v_invite_id := v_invite.id;
      
      -- Verificar se é super admin (apenas se não houver nenhum super admin)
      v_is_super_admin := FALSE;
      IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_super_admin = TRUE) THEN
        v_is_super_admin := TRUE;
      END IF;
    ELSE
      -- Fallback (não deveria chegar aqui se validação funcionou)
      v_empresa_id := '00000000-0000-0000-0000-000000000001';
      v_perfil := 'Operacional';
      v_is_super_admin := FALSE;
      v_invite_id := NULL;
    END IF;
  END IF;

  -- Criar perfil do usuário (agora o usuário já existe em auth.users)
  INSERT INTO public.profiles (id, empresa_id, email, nome, perfil, is_super_admin)
  VALUES (
    NEW.id,
    v_empresa_id,
    COALESCE(NEW.email, ''),
    COALESCE(
      NEW.raw_user_meta_data->>'nome',
      split_part(COALESCE(NEW.email, ''), '@', 1),
      'Usuário'
    ),
    v_perfil,
    v_is_super_admin
  )
  ON CONFLICT (id) DO NOTHING;

  -- Se foi via convite, atualizar convite como aceito NA MESMA TRANSAÇÃO
  IF v_invite_id IS NOT NULL THEN
    UPDATE public.invites
    SET 
      status = 'accepted',
      used_at = NOW(),
      used_by = NEW.id,
      updated_at = NOW()
    WHERE id = v_invite_id
      AND status = 'pending'; -- Garantir que ainda está pendente
    
    -- Se não atualizou nenhuma linha, significa que o convite já foi usado
    IF NOT FOUND THEN
      -- Não abortar aqui, apenas logar (usuário já foi criado)
      RAISE WARNING 'Convite já foi utilizado ou não está mais disponível.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Remover trigger antigo
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Criar trigger para VALIDAR (BEFORE INSERT)
CREATE TRIGGER on_auth_user_created_validate
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_validate();

-- Criar trigger para CRIAR PERFIL (AFTER INSERT)
CREATE TRIGGER on_auth_user_created_create_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_create_profile();

-- Comentários
COMMENT ON FUNCTION public.handle_new_user_validate() IS 
  'Função que valida convite antes de criar usuário. Aborta INSERT se não houver convite válido (exceto primeiro usuário).';

COMMENT ON FUNCTION public.handle_new_user_create_profile() IS 
  'Função que cria perfil automaticamente após criar usuário. Usa dados do convite ou configura como super admin (primeiro usuário).';
;
