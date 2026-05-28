-- ============================================
-- Chat de Conciliação - Fila de Revisão Guiada
-- 1 pergunta por vez, auditável e retomável
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_chat_review_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.bank_reconciliation_chat_sessions(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  data_referencia DATE NOT NULL,
  suggestion_id UUID NOT NULL REFERENCES public.bank_ai_suggestions(id) ON DELETE CASCADE,
  extrato_transacao_id UUID NOT NULL REFERENCES public.extrato_transacoes(id) ON DELETE CASCADE,
  source_action TEXT NOT NULL CHECK (source_action IN ('match_existing', 'ignore', 'needs_review', 'create_new')),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'asked', 'resolved', 'deferred', 'blocked')),
  decision TEXT NULL CHECK (decision IN ('approve_ignore', 'approve_match', 'keep_pending', 'open_manual_review', 'phase2_blocked')),
  justification TEXT NULL,
  resolved_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ NULL,
  asked_count INTEGER NOT NULL DEFAULT 0,
  last_asked_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bank_reconciliation_chat_review_items UNIQUE (empresa_id, session_id, suggestion_id)
);

CREATE INDEX IF NOT EXISTS idx_br_chat_review_items_empresa_session_status_asked
  ON public.bank_reconciliation_chat_review_items (empresa_id, session_id, review_status, last_asked_at DESC);

CREATE INDEX IF NOT EXISTS idx_br_chat_review_items_empresa_conta_data
  ON public.bank_reconciliation_chat_review_items (empresa_id, conta_bancaria_id, data_referencia, review_status);

DROP TRIGGER IF EXISTS update_bank_reconciliation_chat_review_items_updated_at ON public.bank_reconciliation_chat_review_items;
CREATE TRIGGER update_bank_reconciliation_chat_review_items_updated_at
  BEFORE UPDATE ON public.bank_reconciliation_chat_review_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.bank_reconciliation_chat_review_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng bank_reconciliation_chat_review_items" ON public.bank_reconciliation_chat_review_items;
CREATE POLICY "Users mng bank_reconciliation_chat_review_items"
  ON public.bank_reconciliation_chat_review_items
  FOR ALL
  USING (
    empresa_id = public.get_user_empresa_id()
    AND EXISTS (
      SELECT 1
      FROM public.bank_reconciliation_chat_sessions s
      WHERE s.id = bank_reconciliation_chat_review_items.session_id
        AND s.empresa_id = bank_reconciliation_chat_review_items.empresa_id
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
      WHERE s.id = bank_reconciliation_chat_review_items.session_id
        AND s.empresa_id = bank_reconciliation_chat_review_items.empresa_id
        AND (
          s.user_id = auth.uid()
          OR public.is_admin_or_financeiro(auth.uid())
        )
    )
  );

COMMENT ON TABLE public.bank_reconciliation_chat_review_items IS
  'Fila persistente de revisão guiada do chat de conciliação (1 pergunta por vez).';

COMMENT ON COLUMN public.bank_reconciliation_chat_review_items.decision IS
  'Decisão humana aplicada no item de revisão guiada.';

COMMENT ON COLUMN public.bank_reconciliation_chat_review_items.metadata IS
  'Snapshot operacional do caso (confiança, valor, descrição, sugestões rápidas, etc.).';
