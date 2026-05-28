-- Histórico dedicado de extração/correção numérica para DISECURIT (SOI/SPPRO)
CREATE TABLE IF NOT EXISTS public.operation_import_extraction_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  import_file_id UUID NOT NULL REFERENCES public.operation_import_files(id) ON DELETE CASCADE,
  line_index INTEGER NULL,
  field_name TEXT NOT NULL,
  raw_value TEXT NULL,
  normalized_value NUMERIC(18,2) NULL,
  source_method TEXT NOT NULL DEFAULT 'heuristic'
    CHECK (source_method IN ('regex', 'ocr', 'heuristic', 'manual')),
  confidence NUMERIC(6,4) NULL,
  conflict_flag BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'accepted'
    CHECK (status IN ('accepted', 'flagged', 'corrected')),
  actor_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_import_extraction_history_empresa
  ON public.operation_import_extraction_history (empresa_id);

CREATE INDEX IF NOT EXISTS idx_operation_import_extraction_history_import
  ON public.operation_import_extraction_history (import_file_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operation_import_extraction_history_field
  ON public.operation_import_extraction_history (empresa_id, field_name, created_at DESC);

ALTER TABLE public.operation_import_extraction_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own empresa extraction history" ON public.operation_import_extraction_history;
CREATE POLICY "Users can manage own empresa extraction history"
  ON public.operation_import_extraction_history
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

COMMENT ON TABLE public.operation_import_extraction_history IS
'Histórico por item/campo da extração DISECURIT (parse/reprocess/preview/correções manuais).';

CREATE OR REPLACE FUNCTION public.prune_operation_import_extraction_history(
  p_retention_months INTEGER DEFAULT 24
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted INTEGER := 0;
BEGIN
  DELETE FROM public.operation_import_extraction_history
  WHERE created_at < (NOW() - make_interval(months => GREATEST(p_retention_months, 1)));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.prune_operation_import_extraction_history(INTEGER) IS
'Limpa histórico de extração/correção além da janela de retenção (default: 24 meses).';
