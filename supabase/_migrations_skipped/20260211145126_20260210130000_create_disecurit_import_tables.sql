-- ============================================
-- DISECURIT PDF IMPORT - FASE 1 (SEMI-AUTOMATICA)
-- ============================================

-- 1) Tabela principal de arquivos importados
CREATE TABLE IF NOT EXISTS public.operation_import_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'disecurit',
  file_storage_bucket TEXT NOT NULL DEFAULT 'operacoes-disecurit-pdf',
  file_storage_key TEXT NOT NULL,
  original_filename TEXT,
  file_sha256 TEXT,
  operation_number TEXT,
  parse_status TEXT NOT NULL DEFAULT 'received' CHECK (
    parse_status IN ('received', 'processing', 'parsed', 'parse_partial', 'failed', 'duplicate')
  ),
  parsed_payload JSONB,
  raw_text TEXT,
  error_message TEXT,
  parse_attempts INTEGER NOT NULL DEFAULT 0 CHECK (parse_attempts >= 0),
  linked_operacao_id BIGINT,
  linked_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_import_files_empresa ON public.operation_import_files(empresa_id);
CREATE INDEX IF NOT EXISTS idx_operation_import_files_status ON public.operation_import_files(parse_status);
CREATE INDEX IF NOT EXISTS idx_operation_import_files_linked ON public.operation_import_files(linked_operacao_id);
CREATE INDEX IF NOT EXISTS idx_operation_import_files_operation_number ON public.operation_import_files(operation_number) WHERE operation_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_operation_import_files_created_at ON public.operation_import_files(created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_import_files_unique_hash
  ON public.operation_import_files(empresa_id, source, file_sha256)
  WHERE file_sha256 IS NOT NULL;

DROP TRIGGER IF EXISTS update_operation_import_files_updated_at ON public.operation_import_files;
CREATE TRIGGER update_operation_import_files_updated_at
  BEFORE UPDATE ON public.operation_import_files
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2) Tabela de auditoria de integrações
CREATE TABLE IF NOT EXISTS public.integration_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_file_id UUID REFERENCES public.operation_import_files(id) ON DELETE SET NULL,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'disecurit',
  event_type TEXT NOT NULL,
  status TEXT,
  message TEXT,
  details JSONB,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_log_empresa ON public.integration_audit_log(empresa_id);
CREATE INDEX IF NOT EXISTS idx_integration_audit_log_import_file ON public.integration_audit_log(import_file_id);
CREATE INDEX IF NOT EXISTS idx_integration_audit_log_event_type ON public.integration_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_integration_audit_log_created_at ON public.integration_audit_log(created_at DESC);

-- 3) Tabela de documentos/títulos persistidos após criação da operação
CREATE TABLE IF NOT EXISTS public.operation_import_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  operacao_estoque_id BIGINT NOT NULL REFERENCES public.operacoes_estoque(id) ON DELETE CASCADE,
  import_file_id UUID NOT NULL REFERENCES public.operation_import_files(id) ON DELETE RESTRICT,
  line_index INTEGER NOT NULL DEFAULT 0,
  sacado_nome TEXT,
  sacado_cnpj TEXT,
  documento TEXT,
  vencimento DATE,
  flt NUMERIC(15,2),
  prz_flt NUMERIC(15,2),
  valor NUMERIC(15,2),
  desagio NUMERIC(15,2),
  liquido NUMERIC(15,2),
  prz NUMERIC(15,2),
  carteira TEXT,
  tipo_doc TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operation_import_documents_empresa ON public.operation_import_documents(empresa_id);
CREATE INDEX IF NOT EXISTS idx_operation_import_documents_operacao ON public.operation_import_documents(operacao_estoque_id);
CREATE INDEX IF NOT EXISTS idx_operation_import_documents_import_file ON public.operation_import_documents(import_file_id);
CREATE INDEX IF NOT EXISTS idx_operation_import_documents_line ON public.operation_import_documents(line_index);

DROP TRIGGER IF EXISTS update_operation_import_documents_updated_at ON public.operation_import_documents;
CREATE TRIGGER update_operation_import_documents_updated_at
  BEFORE UPDATE ON public.operation_import_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 4) RLS
ALTER TABLE public.operation_import_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operation_import_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own empresa operation import files" ON public.operation_import_files;
CREATE POLICY "Users can manage own empresa operation import files"
  ON public.operation_import_files
  FOR ALL
  USING (empresa_id = get_user_empresa_id())
  WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can manage own empresa integration audit log" ON public.integration_audit_log;
CREATE POLICY "Users can manage own empresa integration audit log"
  ON public.integration_audit_log
  FOR ALL
  USING (empresa_id = get_user_empresa_id())
  WITH CHECK (empresa_id = get_user_empresa_id());

DROP POLICY IF EXISTS "Users can manage own empresa operation import documents" ON public.operation_import_documents;
CREATE POLICY "Users can manage own empresa operation import documents"
  ON public.operation_import_documents
  FOR ALL
  USING (empresa_id = get_user_empresa_id())
  WITH CHECK (empresa_id = get_user_empresa_id());

-- 5) Storage bucket + políticas
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'operacoes-disecurit-pdf',
  'operacoes-disecurit-pdf',
  false,
  20971520,
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can read disecurit pdf files" ON storage.objects;
CREATE POLICY "Users can read disecurit pdf files"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'operacoes-disecurit-pdf'
    AND (storage.foldername(name))[1] = get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can upload disecurit pdf files" ON storage.objects;
CREATE POLICY "Users can upload disecurit pdf files"
  ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'operacoes-disecurit-pdf'
    AND (storage.foldername(name))[1] = get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can update disecurit pdf files" ON storage.objects;
CREATE POLICY "Users can update disecurit pdf files"
  ON storage.objects
  FOR UPDATE
  USING (
    bucket_id = 'operacoes-disecurit-pdf'
    AND (storage.foldername(name))[1] = get_user_empresa_id()::text
  )
  WITH CHECK (
    bucket_id = 'operacoes-disecurit-pdf'
    AND (storage.foldername(name))[1] = get_user_empresa_id()::text
  );

DROP POLICY IF EXISTS "Users can delete disecurit pdf files" ON storage.objects;
CREATE POLICY "Users can delete disecurit pdf files"
  ON storage.objects
  FOR DELETE
  USING (
    bucket_id = 'operacoes-disecurit-pdf'
    AND (storage.foldername(name))[1] = get_user_empresa_id()::text
  );

-- 6) Comentários
COMMENT ON TABLE public.operation_import_files IS 'Arquivos PDF importados da integração DISECURIT/DifactWeb para prefill de operações';
COMMENT ON TABLE public.integration_audit_log IS 'Eventos e tentativas da integração DISECURIT';
COMMENT ON TABLE public.operation_import_documents IS 'Documentos/títulos editados e persistidos após criação da operação a partir de import';
COMMENT ON COLUMN public.operation_import_files.linked_operacao_id IS 'ID histórico da operação vinculada (sem FK forte intencional)';;
