import { createHash } from 'crypto';
import importNoticeAckHandler from '../../api_legacy/bank-statement/import/notice/ack.js';
import {
  BankImportReprocessConflictError,
  processBankImport,
} from '../../src/server/bank-statement/_import-core.js';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  isBankReconciliationOfxOnlyEnabled,
  resolveInternalApiBaseUrlFromRequest,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../src/server/bank-statement/_shared.js';

type BankStatementSource = 'bradesco' | 'itau' | 'ofx_generic';
type BankStatementFormat = 'csv' | 'ofx';

interface ImportRequestBody {
  conta_bancaria_id?: string;
  source?: string;
  file_format?: string;
  file_storage_bucket?: string;
  file_storage_key?: string;
  original_filename?: string;
}

interface ReprocessRequestBody {
  import_id?: string;
}

const VALID_SOURCES = new Set<BankStatementSource>(['bradesco', 'itau', 'ofx_generic']);
const VALID_FORMATS = new Set<BankStatementFormat>(['csv', 'ofx']);
const DEFAULT_BUCKET = 'extratos-bancarios';

const isUniqueViolation = (error: unknown): boolean => {
  const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : null;
  return String(record?.code || '') === '23505';
};

const toHexSha256 = async (blob: Blob): Promise<string> => {
  const bytes = await blob.arrayBuffer();
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex');
};

const normalizeSource = (raw: unknown): BankStatementSource | null => {
  const value = String(raw || '').trim().toLowerCase();
  return VALID_SOURCES.has(value as BankStatementSource) ? (value as BankStatementSource) : null;
};

const normalizeFormat = (raw: unknown): BankStatementFormat | null => {
  const value = String(raw || '').trim().toLowerCase();
  return VALID_FORMATS.has(value as BankStatementFormat) ? (value as BankStatementFormat) : null;
};

const readAction = (req: VercelRequest): string => {
  const raw = req.query?.action;
  if (Array.isArray(raw)) return String(raw[0] || '').trim().toLowerCase();
  return String(raw || '').trim().toLowerCase();
};

const appendParseWarning = (
  parseResult: Awaited<ReturnType<typeof processBankImport>>,
  warning: string | null
): Awaited<ReturnType<typeof processBankImport>> => {
  if (!warning) return parseResult;
  const warnings = Array.isArray(parseResult.warnings) ? parseResult.warnings : [];
  if (warnings.includes(warning)) return parseResult;
  return {
    ...parseResult,
    warnings: [...warnings, warning],
  };
};

const triggerDeterministicAutoMatchAfterImport = async (args: {
  req: VercelRequest;
  adminClient: ReturnType<typeof getAdminClient>;
  accessToken: string;
  empresaId: string;
  userId: string;
  importId: string;
}): Promise<{ warning: string | null }> => {
  const path = '/api/bank-statement/match';
  let baseUrl: string;
  try {
    baseUrl = resolveInternalApiBaseUrlFromRequest(args.req, {
      missingHostMessage: 'Nao foi possivel resolver host para auto-match da importacao.',
    });
  } catch (error: unknown) {
    const warning = 'Importacao concluida, mas o auto-match deterministico nao foi executado.';
    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      extrato_import_id: args.importId,
      action: 'import_auto_match_warning',
      status: 'warning',
      message: warning,
      created_by: args.userId,
      details: {
        stage: 'resolve_base_url',
        reason: getErrorMessage(error, 'host_unresolved'),
      },
    });
    return { warning };
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        import_id: args.importId,
        auto_confirm: true,
      }),
    });
  } catch (error: unknown) {
    const warning = 'Importacao concluida, mas o auto-match deterministico nao foi executado.';
    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      extrato_import_id: args.importId,
      action: 'import_auto_match_warning',
      status: 'warning',
      message: warning,
      created_by: args.userId,
      details: {
        stage: 'network_fetch',
        method: 'POST',
        path,
        base_url: baseUrl,
        reason: getErrorMessage(error, 'fetch failed'),
      },
    });
    return { warning };
  }

  const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    const warning = 'Importacao concluida, mas o auto-match deterministico retornou erro operacional.';
    await safeInsertBankAuditLog(args.adminClient, {
      empresa_id: args.empresaId,
      extrato_import_id: args.importId,
      action: 'import_auto_match_warning',
      status: 'warning',
      message: warning,
      created_by: args.userId,
      details: {
        stage: 'http_response',
        method: 'POST',
        path,
        base_url: baseUrl,
        status: response.status,
        error_message: String(payload?.message || payload?.error || 'internal_error'),
      },
    });
    return { warning };
  }

  await safeInsertBankAuditLog(args.adminClient, {
    empresa_id: args.empresaId,
    extrato_import_id: args.importId,
    action: 'import_auto_match_completed',
    status: 'success',
    message: 'Auto-match deterministico executado apos importacao parsed.',
    created_by: args.userId,
    details: {
      stage: 'completed',
      method: 'POST',
      path,
      confirmed_count: Number(payload?.confirmed_count || 0),
      suggested_count: Number(payload?.suggested_count || 0),
      skipped_count: Number(payload?.skipped_count || 0),
    },
  });

  return { warning: null };
};

const handleReprocessRequest = async (
  req: VercelRequest,
  res: VercelResponse,
  auth: { empresaId: string; userId: string },
  adminClient: ReturnType<typeof getAdminClient>,
  accessToken: string
) => {
  let body: ReprocessRequestBody;
  try {
    body = (parseJsonBody(req) || {}) as ReprocessRequestBody;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const importId = String(body?.import_id || '').trim();

  if (!importId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'import_id obrigatorio.',
    });
  }

  const { data: importRow, error: importError } = await adminClient
    .from('extratos_import')
    .select('*')
    .eq('id', importId)
    .eq('empresa_id', auth.empresaId)
    .maybeSingle();

  if (importError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao buscar importacao: ${importError.message}`,
    });
  }

  if (!importRow) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Importacao nao encontrada para a empresa.',
    });
  }

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    extrato_import_id: importId,
    action: 'import_reprocess_requested',
    status: 'info',
    message: 'Reprocessamento solicitado.',
    created_by: auth.userId,
    details: {
      previous_parse_status: importRow.parse_status,
      conta_bancaria_id: importRow.conta_bancaria_id,
    },
  });

  let parseResult: Awaited<ReturnType<typeof processBankImport>>;
  try {
    parseResult = await processBankImport({
      adminClient,
      empresaId: auth.empresaId,
      importId,
      userId: auth.userId,
      forceReprocess: true,
    });
  } catch (error: unknown) {
    if (error instanceof BankImportReprocessConflictError) {
      return res.status(409).json({
        error: 'Conflict',
        code: error.code,
        message: error.message,
      });
    }

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_import_id: importId,
      action: 'import_reprocess_exception',
      status: 'error',
      message: getErrorMessage(error, 'Falha ao reprocessar importacao.'),
      created_by: auth.userId,
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: getErrorMessage(error, 'Falha ao reprocessar importacao.'),
    });
  }

  let parseResultWithAutoMatch = parseResult;
  if (parseResult.parse_status === 'parsed') {
    const autoMatch = await triggerDeterministicAutoMatchAfterImport({
      req,
      adminClient,
      accessToken,
      empresaId: auth.empresaId,
      userId: auth.userId,
      importId,
    });
    parseResultWithAutoMatch = appendParseWarning(parseResult, autoMatch.warning);
  }

  const { data: refreshedImport, error: refreshError } = await adminClient
    .from('extratos_import')
    .select('*')
    .eq('id', importId)
    .eq('empresa_id', auth.empresaId)
    .maybeSingle();

  if (refreshError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar importacao atualizada: ${refreshError.message}`,
    });
  }

  return res.status(200).json({
    ok: parseResultWithAutoMatch.ok,
    import_row: refreshedImport || importRow,
    parse_result: parseResultWithAutoMatch,
    ai_trigger: null,
  });
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = readAction(req);

  if (action === 'notice-ack') {
    return importNoticeAckHandler(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis do Supabase nao configuradas para conciliacao bancaria.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Sessao expirada. Faca login novamente.',
    });
  }

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error: unknown) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
    });
  }

  let body: ImportRequestBody;
  try {
    body = (parseJsonBody(req) || {}) as ImportRequestBody;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  if (action === 'reprocess') {
    return handleReprocessRequest(req, res, auth, adminClient, accessToken);
  }

  const contaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const storageBucket = String(body?.file_storage_bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
  const storageKey = String(body?.file_storage_key || '').trim();
  const source = normalizeSource(body?.source);
  const fileFormat = normalizeFormat(body?.file_format);
  const originalFilename = String(body?.original_filename || '').trim() || null;

  if (!contaBancariaId || !storageKey || !source || !fileFormat) {
    return res.status(400).json({
      error: 'Invalid input',
      message:
        'conta_bancaria_id, file_storage_key, source (bradesco|itau|ofx_generic) e file_format (csv|ofx) sao obrigatorios.',
    });
  }

  if (isBankReconciliationOfxOnlyEnabled() && fileFormat !== 'ofx') {
    return res.status(409).json({
      error: 'Import blocked by policy',
      message: 'Nesta etapa, use OFX para conciliação confiável. CSV está em quarentena.',
      ofx_required: true,
      ofx_required_reason: 'import_ofx_only_policy',
    });
  }

  if (storageBucket !== DEFAULT_BUCKET) {
    return res.status(400).json({
      error: 'Invalid input',
      message: `file_storage_bucket invalido. Use ${DEFAULT_BUCKET}.`,
    });
  }

  if (!storageKey.startsWith(`${auth.empresaId}/`)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'file_storage_key deve iniciar com o prefixo da empresa.',
    });
  }

  const { data: contaRow, error: contaError } = await adminClient
    .from('contas_bancarias')
    .select('id,empresa_id')
    .eq('id', contaBancariaId)
    .eq('empresa_id', auth.empresaId)
    .maybeSingle();

  if (contaError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao validar conta bancaria: ${contaError.message}`,
    });
  }

  if (!contaRow) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Conta bancaria nao pertence a empresa autenticada.',
    });
  }

  const { data: fileBlob, error: downloadError } = await adminClient.storage
    .from(storageBucket)
    .download(storageKey);

  if (downloadError || !fileBlob) {
    return res.status(422).json({
      error: 'Storage error',
      message: downloadError?.message || 'Arquivo nao encontrado no storage.',
    });
  }

  let fileSha256 = '';
  try {
    fileSha256 = await toHexSha256(fileBlob);
  } catch {
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Falha ao calcular hash do arquivo.',
    });
  }

  const insertPayload = {
    empresa_id: auth.empresaId,
    conta_bancaria_id: contaBancariaId,
    source,
    file_format: fileFormat,
    file_storage_bucket: storageBucket,
    file_storage_key: storageKey,
    original_filename: originalFilename,
    file_sha256: fileSha256,
    parse_status: 'received',
    created_by: auth.userId,
  };

  const { data: insertedImportRow, error: insertError } = await adminClient
    .from('extratos_import')
    .insert(insertPayload)
    .select('*')
    .maybeSingle();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const { data: existingImport, error: existingError } = await adminClient
        .from('extratos_import')
        .select('*')
        .eq('empresa_id', auth.empresaId)
        .eq('conta_bancaria_id', contaBancariaId)
        .eq('file_sha256', fileSha256)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existingError || !existingImport) {
        return res.status(409).json({
          error: 'Duplicate import',
          message: 'Arquivo duplicado detectado, mas nao foi possivel carregar o registro original.',
        });
      }

      await safeInsertBankAuditLog(adminClient, {
        empresa_id: auth.empresaId,
        extrato_import_id: existingImport.id,
        action: 'import_duplicate_file_detected',
        status: 'warning',
        message: 'Arquivo duplicado bloqueado por file_sha256.',
        created_by: auth.userId,
        details: {
          conta_bancaria_id: contaBancariaId,
          file_sha256: fileSha256,
          file_storage_key: storageKey,
        },
      });

      let duplicateParseResult: Record<string, unknown> = {
        ok: existingImport.parse_status === 'parsed',
        import_id: existingImport.id,
        parse_status: existingImport.parse_status,
        inserted_count: 0,
        skipped_count: 0,
        periodo_inicio: existingImport.periodo_inicio,
        periodo_fim: existingImport.periodo_fim,
        warnings: ['Arquivo duplicado: importacao anterior reaproveitada.'],
        errors: [],
      };

      if (existingImport.parse_status === 'failed') {
        try {
          const reparsed = await processBankImport({
            adminClient,
            empresaId: auth.empresaId,
            importId: existingImport.id,
            userId: auth.userId,
            forceReprocess: true,
          });

          duplicateParseResult = reparsed as unknown as Record<string, unknown>;
        } catch (reprocessError: unknown) {
          await safeInsertBankAuditLog(adminClient, {
            empresa_id: auth.empresaId,
            extrato_import_id: existingImport.id,
            action: 'import_duplicate_reprocess_exception',
            status: 'error',
            message: getErrorMessage(reprocessError, 'Falha ao reprocessar importacao duplicada com status failed.'),
            created_by: auth.userId,
          });
        }
      }

      return res.status(200).json({
        ok: true,
        duplicate: true,
        import_row: existingImport,
        parse_result: duplicateParseResult,
      });
    }

    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao criar importacao: ${insertError.message}`,
    });
  }

  if (!insertedImportRow) {
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Nao foi possivel criar o registro de importacao.',
    });
  }

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    extrato_import_id: insertedImportRow.id,
    action: 'import_requested',
    status: 'info',
    message: 'Importacao de extrato recebida para processamento.',
    created_by: auth.userId,
    details: {
      source,
      file_format: fileFormat,
      conta_bancaria_id: contaBancariaId,
      file_storage_key: storageKey,
      file_sha256: fileSha256,
    },
  });

  let parseResult: Awaited<ReturnType<typeof processBankImport>>;
  try {
    parseResult = await processBankImport({
      adminClient,
      empresaId: auth.empresaId,
      importId: insertedImportRow.id,
      userId: auth.userId,
    });
  } catch (error: unknown) {
    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      extrato_import_id: insertedImportRow.id,
      action: 'import_processing_exception',
      status: 'error',
      message: getErrorMessage(error, 'Falha ao processar importacao.'),
      created_by: auth.userId,
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: getErrorMessage(error, 'Falha ao processar importacao.'),
      import_row: insertedImportRow,
    });
  }

  let parseResultWithAutoMatch = parseResult;
  if (parseResult.parse_status === 'parsed') {
    const autoMatch = await triggerDeterministicAutoMatchAfterImport({
      req,
      adminClient,
      accessToken,
      empresaId: auth.empresaId,
      userId: auth.userId,
      importId: insertedImportRow.id,
    });
    parseResultWithAutoMatch = appendParseWarning(parseResult, autoMatch.warning);
  }

  return res.status(200).json({
    ok: parseResultWithAutoMatch.ok,
    duplicate: false,
    import_row: insertedImportRow,
    parse_result: parseResultWithAutoMatch,
  });
}
