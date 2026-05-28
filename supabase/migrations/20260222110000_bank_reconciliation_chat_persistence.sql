-- ============================================
-- Bank Reconciliation Chat Persistence
-- Sessões/mensagens auditáveis + idempotência de ações
-- ============================================

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conta_bancaria_id UUID REFERENCES public.contas_bancarias(id) ON DELETE SET NULL,
  data_referencia DATE,
  session_key TEXT NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bank_reconciliation_chat_sessions UNIQUE (empresa_id, user_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_chat_sessions_empresa_user_last
  ON public.bank_reconciliation_chat_sessions (empresa_id, user_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_chat_sessions_empresa_conta_data
  ON public.bank_reconciliation_chat_sessions (empresa_id, conta_bancaria_id, data_referencia, last_message_at DESC);

DROP TRIGGER IF EXISTS update_bank_reconciliation_chat_sessions_updated_at ON public.bank_reconciliation_chat_sessions;
CREATE TRIGGER update_bank_reconciliation_chat_sessions_updated_at
  BEFORE UPDATE ON public.bank_reconciliation_chat_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.bank_reconciliation_chat_sessions(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  rich_content JSONB,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_chat_messages_session_created
  ON public.bank_reconciliation_chat_messages (session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_chat_messages_empresa_created
  ON public.bank_reconciliation_chat_messages (empresa_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_chat_action_idempotency (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bank_reconciliation_chat_action_idempotency UNIQUE (empresa_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliation_chat_action_idempotency_empresa_created
  ON public.bank_reconciliation_chat_action_idempotency (empresa_id, created_at DESC);

ALTER TABLE public.bank_reconciliation_chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_chat_action_idempotency ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng bank_reconciliation_chat_sessions" ON public.bank_reconciliation_chat_sessions;
CREATE POLICY "Users mng bank_reconciliation_chat_sessions"
  ON public.bank_reconciliation_chat_sessions
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

DROP POLICY IF EXISTS "Users mng bank_reconciliation_chat_messages" ON public.bank_reconciliation_chat_messages;
CREATE POLICY "Users mng bank_reconciliation_chat_messages"
  ON public.bank_reconciliation_chat_messages
  FOR ALL
  USING (
    empresa_id = public.get_user_empresa_id()
    AND EXISTS (
      SELECT 1
      FROM public.bank_reconciliation_chat_sessions s
      WHERE s.id = bank_reconciliation_chat_messages.session_id
        AND s.empresa_id = bank_reconciliation_chat_messages.empresa_id
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
      FROM public.bank_reconciliation_chat_sessions s
      WHERE s.id = bank_reconciliation_chat_messages.session_id
        AND s.empresa_id = bank_reconciliation_chat_messages.empresa_id
        AND (
          s.user_id = auth.uid()
          OR public.is_admin_or_financeiro(auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Users mng bank_reconciliation_chat_action_idempotency" ON public.bank_reconciliation_chat_action_idempotency;
CREATE POLICY "Users mng bank_reconciliation_chat_action_idempotency"
  ON public.bank_reconciliation_chat_action_idempotency
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

COMMENT ON TABLE public.bank_reconciliation_chat_sessions IS
  'Sessões do chat operacional da conciliação bancária por usuário/conta/data.';

COMMENT ON TABLE public.bank_reconciliation_chat_messages IS
  'Mensagens auditáveis do chat operacional da conciliação bancária.';

COMMENT ON TABLE public.bank_reconciliation_chat_action_idempotency IS
  'Idempotência para ações confirmadas no chat operacional (matching/IA/resumo).';
