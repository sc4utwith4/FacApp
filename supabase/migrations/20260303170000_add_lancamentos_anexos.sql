-- ============================================
-- Anexos de Lançamentos Financeiros
-- ============================================

CREATE TABLE IF NOT EXISTS public.lancamentos_anexos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  lancamento_caixa_id UUID NOT NULL REFERENCES public.lancamentos_caixa(id) ON DELETE CASCADE,
  storage_bucket TEXT NOT NULL DEFAULT 'lancamentos-comprovantes',
  storage_key TEXT NOT NULL,
  nome_arquivo TEXT NOT NULL,
  mime_type TEXT,
  tamanho_bytes BIGINT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, lancamento_caixa_id, storage_key)
);

CREATE INDEX IF NOT EXISTS idx_lancamentos_anexos_empresa
  ON public.lancamentos_anexos (empresa_id);

CREATE INDEX IF NOT EXISTS idx_lancamentos_anexos_lancamento
  ON public.lancamentos_anexos (lancamento_caixa_id, created_at DESC);

ALTER TABLE public.lancamentos_anexos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own empresa lancamentos_anexos" ON public.lancamentos_anexos;
CREATE POLICY "Users can manage own empresa lancamentos_anexos"
  ON public.lancamentos_anexos
  FOR ALL
  USING (empresa_id = public.get_user_empresa_id())
  WITH CHECK (empresa_id = public.get_user_empresa_id());

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lancamentos-comprovantes',
  'lancamentos-comprovantes',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can read lancamentos comprovantes files" ON storage.objects;
CREATE POLICY "Users can read lancamentos comprovantes files"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'lancamentos-comprovantes'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can upload lancamentos comprovantes files" ON storage.objects;
CREATE POLICY "Users can upload lancamentos comprovantes files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'lancamentos-comprovantes'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can update lancamentos comprovantes files" ON storage.objects;
CREATE POLICY "Users can update lancamentos comprovantes files"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'lancamentos-comprovantes'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  )
  WITH CHECK (
    bucket_id = 'lancamentos-comprovantes'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can delete lancamentos comprovantes files" ON storage.objects;
CREATE POLICY "Users can delete lancamentos comprovantes files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'lancamentos-comprovantes'
    AND (storage.foldername(name))[1] = public.get_user_empresa_id()::text
  );

COMMENT ON TABLE public.lancamentos_anexos IS 'Metadados de comprovantes anexados a lançamentos de caixa';
COMMENT ON COLUMN public.lancamentos_anexos.storage_key IS 'Path completo do arquivo no bucket lancamentos-comprovantes';
