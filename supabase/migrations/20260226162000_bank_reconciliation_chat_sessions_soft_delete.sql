-- ============================================
-- Chat Sessions Soft Delete (Conciliacao Bancaria)
-- Permite excluir sessao do historico sem apagar mensagens/auditoria
-- ============================================

ALTER TABLE public.bank_reconciliation_chat_sessions
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS archived_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_reason TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_br_chat_sessions_empresa_user_archived_last_message
  ON public.bank_reconciliation_chat_sessions (empresa_id, user_id, archived_at, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_br_chat_sessions_empresa_conta_data_archived
  ON public.bank_reconciliation_chat_sessions (empresa_id, conta_bancaria_id, data_referencia, archived_at, last_message_at DESC);

COMMENT ON COLUMN public.bank_reconciliation_chat_sessions.archived_at IS
  'Soft delete da sessao no historico. Mensagens sao preservadas para auditoria.';
COMMENT ON COLUMN public.bank_reconciliation_chat_sessions.archived_by IS
  'Usuario que arquivou/removeu a sessao do historico.';
COMMENT ON COLUMN public.bank_reconciliation_chat_sessions.archived_reason IS
  'Motivo opcional do arquivamento (ex.: user_delete).';
