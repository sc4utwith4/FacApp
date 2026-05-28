-- Migration: Adicionar campos de auditoria na tabela invites
-- Data: 2025-01-27
-- Descrição: Adiciona campos used_at e used_by para rastrear quando e quem usou o convite

-- Adicionar colunas de auditoria
ALTER TABLE public.invites
  ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS used_by UUID REFERENCES auth.users(id);

-- Criar índice para busca rápida por token (se não existir)
CREATE INDEX IF NOT EXISTS idx_invites_token ON public.invites(token) WHERE token IS NOT NULL;

-- Criar índice para busca por status e email (otimização)
CREATE INDEX IF NOT EXISTS idx_invites_status_email ON public.invites(status, email) WHERE status = 'pending';

-- Comentários nas colunas
COMMENT ON COLUMN public.invites.used_at IS 'Data e hora em que o convite foi utilizado';
COMMENT ON COLUMN public.invites.used_by IS 'ID do usuário que utilizou o convite (FK para auth.users)';;
