-- ============================================
-- Bank AI Execution Runs (Conciliacao Bancaria)
-- Correlacao de trigger/callback/polling do workflow n8n
-- ============================================

CREATE TABLE IF NOT EXISTS public.bank_ai_execution_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conta_bancaria_id UUID NOT NULL REFERENCES public.contas_bancarias(id) ON DELETE CASCADE,
  extrato_import_id UUID NOT NULL REFERENCES public.extratos_import(id) ON DELETE CASCADE,
  correlation_id TEXT NOT NULL,
  trigger_source TEXT NOT NULL DEFAULT 'bank_reconciliation',
  status TEXT NOT NULL CHECK (
    status IN ('triggered', 'processing', 'completed', 'no_pending', 'failed', 'timeout')
  ),
  sugestoes_total INTEGER NOT NULL DEFAULT 0,
  match_existing_count INTEGER NOT NULL DEFAULT 0,
  create_new_count INTEGER NOT NULL DEFAULT 0,
  ignore_count INTEGER NOT NULL DEFAULT 0,
  needs_review_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_ai_execution_runs_empresa_correlation
  ON public.bank_ai_execution_runs (empresa_id, correlation_id);

CREATE INDEX IF NOT EXISTS idx_bank_ai_execution_runs_empresa_conta_import_created
  ON public.bank_ai_execution_runs (empresa_id, conta_bancaria_id, extrato_import_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bank_ai_execution_runs_empresa_status_created
  ON public.bank_ai_execution_runs (empresa_id, status, created_at DESC);

ALTER TABLE public.bank_ai_execution_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users mng bank_ai_execution_runs" ON public.bank_ai_execution_runs;
CREATE POLICY "Users mng bank_ai_execution_runs"
  ON public.bank_ai_execution_runs
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

DROP TRIGGER IF EXISTS update_bank_ai_execution_runs_updated_at ON public.bank_ai_execution_runs;
CREATE TRIGGER update_bank_ai_execution_runs_updated_at
  BEFORE UPDATE ON public.bank_ai_execution_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.bank_ai_execution_runs IS
  'Execucoes correlacionadas do workflow n8n de conciliacao bancaria (trigger/callback/status/counts).';
