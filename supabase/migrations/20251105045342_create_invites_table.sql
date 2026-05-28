-- Criar tabela de convites para rastrear convites enviados
CREATE TABLE IF NOT EXISTS public.invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  perfil VARCHAR(50) NOT NULL DEFAULT 'Operacional',
  invited_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token VARCHAR(255) UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled')),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Criar índices para melhorar performance
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.invites(email);
CREATE INDEX IF NOT EXISTS idx_invites_token ON public.invites(token) WHERE token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invites_status ON public.invites(status);
CREATE INDEX IF NOT EXISTS idx_invites_invited_by ON public.invites(invited_by);
CREATE INDEX IF NOT EXISTS idx_invites_expires_at ON public.invites(expires_at);

-- Criar trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_invites_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_invites_updated_at
  BEFORE UPDATE ON public.invites
  FOR EACH ROW
  EXECUTE FUNCTION public.update_invites_updated_at();

-- Habilitar RLS
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Política RLS: Super admin pode ver todos os convites
CREATE POLICY "Super admin can view all invites"
  ON public.invites
  FOR SELECT
  USING (public.is_super_admin());

-- Política RLS: Super admin pode criar convites
CREATE POLICY "Super admin can create invites"
  ON public.invites
  FOR INSERT
  WITH CHECK (public.is_super_admin());

-- Política RLS: Super admin pode atualizar convites
CREATE POLICY "Super admin can update invites"
  ON public.invites
  FOR UPDATE
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Política RLS: Super admin pode deletar convites
CREATE POLICY "Super admin can delete invites"
  ON public.invites
  FOR DELETE
  USING (public.is_super_admin());

-- Comentários para documentação
COMMENT ON TABLE public.invites IS 'Tabela para rastrear convites de usuários enviados por super admin';
COMMENT ON COLUMN public.invites.token IS 'Token único do convite (gerado pelo Supabase)';
COMMENT ON COLUMN public.invites.status IS 'Status do convite: pending, accepted, expired, cancelled';
COMMENT ON COLUMN public.invites.expires_at IS 'Data de expiração do convite (padrão: 7 dias)';;
