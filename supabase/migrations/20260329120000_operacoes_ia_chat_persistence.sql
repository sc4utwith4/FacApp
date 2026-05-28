-- ============================================
-- Operacoes IA — persistencia de conversas do copiloto (paridade com bank_reconciliation_chat_*)
-- ============================================

CREATE TABLE IF NOT EXISTS public.operacoes_ia_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_key TEXT NOT NULL,
  reference_date DATE,
  program_hint TEXT,
  operation_hint TEXT,
  cnpj_hint TEXT,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NULL,
  archived_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  archived_reason TEXT NULL,
  CONSTRAINT uq_operacoes_ia_chat_sessions UNIQUE (empresa_id, user_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_operacoes_ia_chat_sessions_empresa_user_last
  ON public.operacoes_ia_chat_sessions (empresa_id, user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_operacoes_ia_chat_sessions_empresa_user_archived_last
  ON public.operacoes_ia_chat_sessions (empresa_id, user_id, archived_at, last_message_at DESC);

DROP TRIGGER IF EXISTS update_operacoes_ia_chat_sessions_updated_at ON public.operacoes_ia_chat_sessions;
CREATE TRIGGER update_operacoes_ia_chat_sessions_updated_at
  BEFORE UPDATE ON public.operacoes_ia_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.operacoes_ia_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.operacoes_ia_chat_sessions(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operacoes_ia_chat_messages_session_created
  ON public.operacoes_ia_chat_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_operacoes_ia_chat_messages_empresa_created
  ON public.operacoes_ia_chat_messages (empresa_id, created_at DESC);

ALTER TABLE public.operacoes_ia_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operacoes_ia_chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng operacoes_ia_chat_sessions" ON public.operacoes_ia_chat_sessions;
CREATE POLICY "Users mng operacoes_ia_chat_sessions"
  ON public.operacoes_ia_chat_sessions
  FOR ALL
  USING (
    empresa_id = public.get_user_empresa_id()
  AND (
      user_id = auth.uid()
      OR public.is_admin_or_financeiro(auth.uid())
    )
  )
  WITH CHECK (
    empresa_id = public.get_user_empresa_id()
  AND (
      user_id = auth.uid()
      OR public.is_admin_or_financeiro(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users mng operacoes_ia_chat_messages" ON public.operacoes_ia_chat_messages;
CREATE POLICY "Users mng operacoes_ia_chat_messages"
  ON public.operacoes_ia_chat_messages
  FOR ALL
  USING (
    empresa_id = public.get_user_empresa_id()
    AND EXISTS (
      SELECT 1
      FROM public.operacoes_ia_chat_sessions s
      WHERE s.id = operacoes_ia_chat_messages.session_id
        AND s.empresa_id = operacoes_ia_chat_messages.empresa_id
        AND (
          s.user_id = auth.uid()
          OR public.is_admin_or_financeiro(auth.uid())
        )
    )
  )
  WITH CHECK (
    empresa_id = public.get_user_empresa_id()
    AND EXISTS (
      SELECT 1
      FROM public.operacoes_ia_chat_sessions s
      WHERE s.id = operacoes_ia_chat_messages.session_id
        AND s.empresa_id = operacoes_ia_chat_messages.empresa_id
        AND (
          s.user_id = auth.uid()
          OR public.is_admin_or_financeiro(auth.uid())
        )
    )
  );

COMMENT ON TABLE public.operacoes_ia_chat_sessions IS 'Sessoes de chat do copiloto Operacoes IA (mensagens em operacoes_ia_chat_messages).';
COMMENT ON COLUMN public.operacoes_ia_chat_sessions.archived_at IS 'Soft delete no historico; mensagens preservadas.';
