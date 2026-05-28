-- Migration: Atualizar função handle_new_user para bloquear cadastro sem convite
-- Data: 2025-01-27
-- Descrição: Modifica trigger para RAISE EXCEPTION se não houver convite válido, abortando INSERT em auth.users

-- Remover trigger antigo se existir
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Recriar função handle_new_user com validação estrita
CREATE OR REPLACE FUNCTION public.handle_new_user()
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
BEGIN
  -- Verificar se existe um convite pendente válido para este email
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

  -- Se encontrou convite válido, usar dados do convite
  v_empresa_id := v_invite.empresa_id;
  v_perfil := v_invite.perfil;
  v_invite_id := v_invite.id;

  -- Verificar se é super admin (apenas se não houver nenhum super admin no sistema)
  v_is_super_admin := FALSE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_super_admin = TRUE) THEN
    v_is_super_admin := TRUE;
  END IF;

  -- Criar perfil do usuário com dados do convite
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

  -- Atualizar convite como aceito NA MESMA TRANSAÇÃO
  -- Usar PK do convite para evitar race conditions
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
    RAISE EXCEPTION 'Convite já foi utilizado ou não está mais disponível.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN NEW;
END;
$$;

-- Recriar trigger como BEFORE INSERT (aborta antes de criar usuário)
CREATE TRIGGER on_auth_user_created
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Comentários
COMMENT ON FUNCTION public.handle_new_user() IS 
  'Função que valida convite e cria perfil automaticamente. Aborta INSERT se não houver convite válido.';;
