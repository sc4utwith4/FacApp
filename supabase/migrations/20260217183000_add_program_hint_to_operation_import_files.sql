-- DISECURIT: persistir hint explícito de programa (SPPRO/SOI) para fallback de UI/prefill.

ALTER TABLE public.operation_import_files
ADD COLUMN IF NOT EXISTS program_hint TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'operation_import_files_program_hint_check'
      AND conrelid = 'public.operation_import_files'::regclass
  ) THEN
    ALTER TABLE public.operation_import_files
    ADD CONSTRAINT operation_import_files_program_hint_check
    CHECK (program_hint IN ('SPPRO', 'SOI'));
  END IF;
END
$$;

UPDATE public.operation_import_files
SET program_hint = UPPER(parsed_payload->>'program')
WHERE program_hint IS NULL
  AND UPPER(parsed_payload->>'program') IN ('SPPRO', 'SOI');

CREATE INDEX IF NOT EXISTS idx_operation_import_files_queue_program
  ON public.operation_import_files (empresa_id, source, program_hint, parse_status, linked_operacao_id, created_at DESC);

COMMENT ON COLUMN public.operation_import_files.program_hint
  IS 'Hint explícito do programa DISECURIT escolhido no upload/reprocesso (SPPRO/SOI).';
