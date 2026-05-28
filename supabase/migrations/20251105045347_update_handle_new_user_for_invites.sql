-- Atualizar função handle_new_user() para suportar convites
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
SECURITY DEFINER
SET search_path = ''
LANGUAGE plpgsql
AS $$
DECLARE
  v_invite RECORD;
  v_empresa_id UUID;
  v_perfil VARCHAR(50);
  v_is_super_admin BOOLEAN;
BEGIN
  -- Verificar se existe um convite pendente para este email
  SELECT empresa_id, perfil INTO v_invite
  FROM public.invites
  WHERE email = NEW.email
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  -- Se encontrou convite, usar dados do convite
  IF v_invite IS NOT NULL THEN
    v_empresa_id := v_invite.empresa_id;
    v_perfil := v_invite.perfil;
    
    -- Marcar convite como aceito
    UPDATE public.invites
    SET status = 'accepted', updated_at = NOW()
    WHERE email = NEW.email
      AND status = 'pending'
      AND expires_at > NOW();
  ELSE
    -- Se não encontrou convite, usar valores padrão
    v_empresa_id := '00000000-0000-0000-0000-000000000001'::uuid;
    v_perfil := 'Operacional';
  END IF;

  -- Verificar se é super admin (apenas se não houver convite ou se for o primeiro usuário)
  -- Por padrão, o primeiro usuário criado será super admin
  v_is_super_admin := FALSE;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE is_super_admin = TRUE) THEN
    v_is_super_admin := TRUE;
  END IF;

  -- Criar perfil do usuário
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
  
  RETURN NEW;
END;
$$;

-- Comentário atualizado
COMMENT ON FUNCTION public.handle_new_user() IS 'Cria perfil automaticamente quando usuário é criado, usando dados do convite se existir';;
