-- ============================================================
-- Ack de avisos operacionais do import (ex.: suspeita de duplicidade)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bank_reconciliation_import_notice_ack (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  extrato_import_id UUID NOT NULL REFERENCES public.extratos_import(id) ON DELETE CASCADE,
  notice_type TEXT NOT NULL CHECK (notice_type IN ('duplicate_suspect')),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bank_reconciliation_import_notice_ack UNIQUE (
    empresa_id,
    user_id,
    extrato_import_id,
    notice_type
  )
);

CREATE INDEX IF NOT EXISTS idx_br_import_notice_ack_empresa_user_created
  ON public.bank_reconciliation_import_notice_ack (empresa_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_br_import_notice_ack_empresa_import_type
  ON public.bank_reconciliation_import_notice_ack (empresa_id, extrato_import_id, notice_type);

DROP TRIGGER IF EXISTS update_bank_reconciliation_import_notice_ack_updated_at
  ON public.bank_reconciliation_import_notice_ack;
CREATE TRIGGER update_bank_reconciliation_import_notice_ack_updated_at
  BEFORE UPDATE ON public.bank_reconciliation_import_notice_ack
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.bank_reconciliation_import_notice_ack ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng bank_reconciliation_import_notice_ack"
  ON public.bank_reconciliation_import_notice_ack;
CREATE POLICY "Users mng bank_reconciliation_import_notice_ack"
  ON public.bank_reconciliation_import_notice_ack
  FOR ALL
  USING (
    empresa_id = public.get_user_empresa_id()
    AND user_id = auth.uid()
  )
  WITH CHECK (
    empresa_id = public.get_user_empresa_id()
    AND user_id = auth.uid()
  );

COMMENT ON TABLE public.bank_reconciliation_import_notice_ack IS
  'Confirmações de avisos operacionais por usuário/import no fluxo de conciliação bancária.';
