-- ============================================
-- CRIAÇÃO DE SUPER ADMINS
-- Função para promover usuários existentes a super admin
-- ============================================

-- Criar empresa padrão se não existir
DO $$
DECLARE
    v_empresa_id UUID;
BEGIN
    SELECT id INTO v_empresa_id FROM public.empresas LIMIT 1;
    
    IF v_empresa_id IS NULL THEN
        v_empresa_id := '00000000-0000-0000-0000-000000000001';
        INSERT INTO public.empresas (id, nome, razao_social, status)
        VALUES (v_empresa_id, 'Empresa Padrão', 'Empresa Padrão', true)
        ON CONFLICT (id) DO NOTHING;
    END IF;
END $$;

-- Função para promover usuário existente a super admin
CREATE OR REPLACE FUNCTION public.promote_to_super_admin(
    p_email TEXT,
    p_nome TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
    v_user_id UUID;
    v_empresa_id UUID;
    v_user_nome TEXT;
BEGIN
    -- Buscar usuário por email
    SELECT id INTO v_user_id 
    FROM auth.users 
    WHERE email = p_email;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Usuário com email % não encontrado. Crie o usuário primeiro via interface ou API.', p_email;
    END IF;
    
    -- Obter empresa padrão
    SELECT id INTO v_empresa_id FROM public.empresas LIMIT 1;
    
    IF v_empresa_id IS NULL THEN
        RAISE EXCEPTION 'Empresa padrão não encontrada';
    END IF;
    
    -- Determinar nome
    IF p_nome IS NULL THEN
        v_user_nome := split_part(p_email, '@', 1);
    ELSE
        v_user_nome := p_nome;
    END IF;
    
    -- Criar ou atualizar perfil como super admin
    INSERT INTO public.profiles (
        id,
        empresa_id,
        email,
        nome,
        perfil,
        is_super_admin
    )
    VALUES (
        v_user_id,
        v_empresa_id,
        p_email,
        v_user_nome,
        'Admin',
        TRUE
    )
    ON CONFLICT (id) DO UPDATE
    SET 
        is_super_admin = TRUE,
        perfil = 'Admin',
        nome = COALESCE(p_nome, profiles.nome),
        updated_at = NOW();
    
    RETURN v_user_id;
END;
$$;

-- Comentário na função
COMMENT ON FUNCTION public.promote_to_super_admin(TEXT, TEXT) IS 
    'Promove um usuário existente (criado via auth) a super administrador. Use após criar o usuário via interface ou API.';

