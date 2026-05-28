-- ============================================================
-- Log operacional de decisões da revisão guiada (chat)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_chat_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.bank_reconciliation_chat_sessions(id) ON DELETE CASCADE,
  case_id UUID NULL REFERENCES public.bank_reconciliation_chat_review_items(id) ON DELETE SET NULL,
  suggestion_id UUID NULL REFERENCES public.bank_ai_suggestions(id) ON DELETE SET NULL,
  extrato_transacao_id UUID NOT NULL REFERENCES public.extrato_transacoes(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('approve_match', 'approve_ignore', 'keep_pending', 'open_manual_review')),
  justification TEXT NULL,
  conciliacao_id UUID NULL,
  item_financeiro_id UUID NULL REFERENCES public.conciliacao_itens_financeiros(id) ON DELETE SET NULL,
  reversible BOOLEAN NOT NULL DEFAULT TRUE,
  reversed_at TIMESTAMPTZ NULL,
  reversed_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_br_chat_review_actions_empresa_session_created
  ON public.bank_reconciliation_chat_review_actions (empresa_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_br_chat_review_actions_empresa_extrato_created
  ON public.bank_reconciliation_chat_review_actions (empresa_id, extrato_transacao_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_br_chat_review_actions_empresa_reversible
  ON public.bank_reconciliation_chat_review_actions (empresa_id, session_id, reversible, reversed_at, created_at DESC);

DROP TRIGGER IF EXISTS update_bank_reconciliation_chat_review_actions_updated_at
  ON public.bank_reconciliation_chat_review_actions;
CREATE TRIGGER update_bank_reconciliation_chat_review_actions_updated_at
  BEFORE UPDATE ON public.bank_reconciliation_chat_review_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.bank_reconciliation_chat_review_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng bank_reconciliation_chat_review_actions"
  ON public.bank_reconciliation_chat_review_actions;
CREATE POLICY "Users mng bank_reconciliation_chat_review_actions"
  ON public.bank_reconciliation_chat_review_actions
  FOR ALL
  USING (
    empresa_id = public.get_user_empresa_id()
    AND EXISTS (
      SELECT 1
      FROM public.bank_reconciliation_chat_sessions s
      WHERE s.id = bank_reconciliation_chat_review_actions.session_id
        AND s.empresa_id = bank_reconciliation_chat_review_actions.empresa_id
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
      WHERE s.id = bank_reconciliation_chat_review_actions.session_id
        AND s.empresa_id = bank_reconciliation_chat_review_actions.empresa_id
        AND (
          s.user_id = auth.uid()
          OR public.is_admin_or_financeiro(auth.uid())
        )
    )
  );

COMMENT ON TABLE public.bank_reconciliation_chat_review_actions IS
  'Log transacional das decisões da revisão guiada (incluindo reversões) no chat de conciliação.';
