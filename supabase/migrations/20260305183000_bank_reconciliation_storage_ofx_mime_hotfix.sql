-- Hotfix: harmoniza MIME types do bucket de extratos para upload OFX entre navegadores.
-- Preserva bucket privado e limite de tamanho já configurado.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'extratos-bancarios',
  'extratos-bancarios',
  false,
  52428800,
  ARRAY[
    'application/x-ofx',
    'application/ofx',
    'application/xml',
    'text/xml',
    'text/plain',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = COALESCE(storage.buckets.file_size_limit, EXCLUDED.file_size_limit),
  allowed_mime_types = EXCLUDED.allowed_mime_types;

