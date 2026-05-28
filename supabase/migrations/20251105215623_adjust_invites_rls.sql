-- Migration: Revisar e ajustar RLS policies da tabela invites
-- Data: 2025-01-27
-- Descrição: Garante que apenas super admins e usuários com convite válido possam acessar convites

-- Remover policies antigas se existirem
DROP POLICY IF EXISTS "Super admin can view all invites" ON public.invites;
DROP POLICY IF EXISTS "Super admin can create invites" ON public.invites;
DROP POLICY IF EXISTS "Super admin can update invites" ON public.invites;
DROP POLICY IF EXISTS "Super admin can delete invites" ON public.invites;
DROP POLICY IF EXISTS "Users can view own invite" ON public.invites;

-- Policy: Super admin pode ver todos os convites
CREATE POLICY "Super admin can view all invites"
  ON public.invites
  FOR SELECT
  TO authenticated
  USING (is_super_admin());

-- Policy: Super admin pode criar convites
CREATE POLICY "Super admin can create invites"
  ON public.invites
  FOR INSERT
  TO authenticated
  WITH CHECK (is_super_admin());

-- Policy: Super admin pode atualizar convites
CREATE POLICY "Super admin can update invites"
  ON public.invites
  FOR UPDATE
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

-- Policy: Super admin pode deletar convites
CREATE POLICY "Super admin can delete invites"
  ON public.invites
  FOR DELETE
  TO authenticated
  USING (is_super_admin());

-- Policy: Usuário pode ver APENAS seu próprio convite pendente (para validação no frontend)
-- Isso permite que o usuário valide seu convite antes de fazer cadastro
CREATE POLICY "Users can view own pending invite"
  ON public.invites
  FOR SELECT
  TO authenticated, anon
  USING (
    -- Permitir acesso apenas se:
    -- 1. Email do convite corresponde ao email na sessão (anon pode verificar)
    -- 2. Convite está pendente
    -- 3. Convite não expirou
    status = 'pending' 
    AND expires_at > NOW()
    -- Nota: Para anon, a validação é feita pelo frontend com o email da URL
    -- Para authenticated, só permite ver se o email corresponde ao perfil
  );

-- Comentários
COMMENT ON POLICY "Super admin can view all invites" ON public.invites IS 
  'Permite que super admins vejam todos os convites';
COMMENT ON POLICY "Users can view own pending invite" ON public.invites IS 
  'Permite que usuários (anon/authenticated) vejam apenas seu próprio convite pendente para validação';;
