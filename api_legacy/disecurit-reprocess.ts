interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: any) => void;
}

type DisecuritProgram = 'SPPRO' | 'SOI';
type ImportParseStatus =
  | 'received'
  | 'processing'
  | 'parsed'
  | 'parse_partial'
  | 'failed'
  | 'duplicate';

type N8nWebhookResponse = {
  import_file_id?: string;
  status?: string;
  reason?: string | null;
  existing_import_file_id?: string | null;
  existing_linked_operacao_id?: number | null;
  workflow_version?: string | null;
};

const ALLOWED_STATUSES = new Set<ImportParseStatus>([
  'received',
  'processing',
  'parsed',
  'parse_partial',
  'failed',
  'duplicate',
]);

function getHeaderValue(req: VercelRequest, headerName: string): string | null {
  const direct = req.headers[headerName];
  if (typeof direct === 'string') return direct;
  if (Array.isArray(direct)) return direct[0] ?? null;

  const lowered = headerName.toLowerCase();
  const foundKey = Object.keys(req.headers).find((k) => k.toLowerCase() === lowered);
  if (!foundKey) return null;

  const value = req.headers[foundKey];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function getSupabaseUrl(): string {
  return process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

function getSupabaseAnonKey(): string {
  return process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

function getSupabaseServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || '';
}

function getReprocessWebhookUrl(): string {
  return (
    process.env.N8N_DISECURIT_REPROCESS_WEBHOOK_URL ||
    process.env.DISECURIT_N8N_REPROCESS_WEBHOOK_URL ||
    process.env.N8N_DISECURIT_IMPORT_WEBHOOK_URL ||
    process.env.DISECURIT_N8N_IMPORT_WEBHOOK_URL ||
    ''
  );
}

function getN8nSecret(): string {
  return (
    process.env.N8N_DISECURIT_INTEGRATION_SECRET ||
    process.env.DISECURIT_N8N_SECRET ||
    ''
  );
}

function normalizeProgramHint(value: unknown): DisecuritProgram | null {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SPPRO' || normalized === 'SOI') return normalized;
  return null;
}

function isParsedLikeStatus(status: unknown): boolean {
  return status === 'parsed' || status === 'parse_partial';
}

async function verifyTokenAndGetEmpresaId(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<{ userId: string; empresaId: string }> {
  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userResp.ok) {
    throw new Error('Sessão inválida');
  }

  const user = await userResp.json().catch(() => null);
  const userId = user?.id;
  if (!userId) {
    throw new Error('Usuário inválido');
  }

  const profileResp = await fetch(
    `${supabaseUrl}/rest/v1/profiles?select=empresa_id&id=eq.${encodeURIComponent(userId)}&limit=1`,
    {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );

  if (!profileResp.ok) {
    throw new Error('Não foi possível identificar empresa do usuário');
  }

  const profiles = await profileResp.json().catch(() => []);
  const empresaId = Array.isArray(profiles) ? profiles[0]?.empresa_id : profiles?.empresa_id;
  if (!empresaId) {
    throw new Error('Empresa não encontrada para o usuário');
  }

  return { userId, empresaId };
}

async function insertAuditEvent(
  supabaseUrl: string,
  serviceRoleKey: string,
  payload: Record<string, any>
): Promise<void> {
  if (!serviceRoleKey) return;

  await fetch(`${supabaseUrl}/rest/v1/integration_audit_log`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  }).catch(() => null);
}

async function loadImportRow(
  supabaseUrl: string,
  serviceRoleKey: string,
  importFileId: string,
  empresaId: string
) {
  const resp = await fetch(
    `${supabaseUrl}/rest/v1/operation_import_files?select=id,parse_status,parsed_payload,error_message,linked_operacao_id&id=eq.${encodeURIComponent(importFileId)}&empresa_id=eq.${encodeURIComponent(empresaId)}&limit=1`,
    {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
    }
  );

  if (!resp.ok) return null;
  const rows = await resp.json().catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function normalizeSourceMethod(value: unknown): 'regex' | 'ocr' | 'heuristic' | 'manual' {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'regex' || normalized === 'ocr' || normalized === 'heuristic' || normalized === 'manual') {
    return normalized;
  }
  return 'heuristic';
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d,.-]/g, '').trim();
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    normalized = lastComma > lastDot ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildExtractionHistoryRows(input: {
  empresaId: string;
  importFileId: string;
  userId: string;
  parsedPayload: any;
  phase: 'parse' | 'reprocess';
  parseStatus: string;
}) {
  const diagnosticsRaw = Array.isArray(input.parsedPayload?.debug?.extraction_diagnostics)
    ? input.parsedPayload.debug.extraction_diagnostics
    : [];

  const rows = diagnosticsRaw
    .map((diagnostic: Record<string, unknown>) => {
      const fieldName = String(diagnostic?.field_name || '').trim();
      if (!fieldName) return null;
      const resolvedValue = toNumber(diagnostic?.resolved_value);
      const confidence = toNumber(diagnostic?.confidence);
      return {
        empresa_id: input.empresaId,
        import_file_id: input.importFileId,
        line_index: null,
        field_name: fieldName,
        raw_value:
          typeof diagnostic?.reason === 'string'
            ? diagnostic.reason.slice(0, 500)
            : null,
        normalized_value: resolvedValue,
        source_method: normalizeSourceMethod(diagnostic?.source_method),
        confidence,
        conflict_flag: Boolean(diagnostic?.conflict_flag),
        status: Boolean(diagnostic?.conflict_flag) ? 'flagged' : 'accepted',
        actor_user_id: input.userId,
        metadata: {
          phase: input.phase,
          parse_status: input.parseStatus,
          critical: Boolean(diagnostic?.critical),
          reason: typeof diagnostic?.reason === 'string' ? diagnostic.reason : null,
          compared_value: toNumber(diagnostic?.compared_value),
          tolerance: toNumber(diagnostic?.tolerance),
          difference: toNumber(diagnostic?.difference),
        },
      };
    })
    .filter(Boolean);

  if (rows.length > 0) return rows;

  const values = input.parsedPayload?.values || {};
  const fallbackFields = ['face_value', 'purchase_value', 'net_value'];
  return fallbackFields
    .map((fieldName) => {
      const normalizedValue = toNumber(values?.[fieldName]);
      if (normalizedValue === null) return null;
      return {
        empresa_id: input.empresaId,
        import_file_id: input.importFileId,
        line_index: null,
        field_name: fieldName,
        raw_value: null,
        normalized_value: normalizedValue,
        source_method: 'heuristic',
        confidence: null,
        conflict_flag: false,
        status: 'accepted',
        actor_user_id: input.userId,
        metadata: {
          phase: input.phase,
          parse_status: input.parseStatus,
          fallback: true,
        },
      };
    })
    .filter(Boolean);
}

async function insertExtractionHistoryRows(
  supabaseUrl: string,
  serviceRoleKey: string,
  rows: Array<Record<string, unknown>>
) {
  if (!rows.length) return;
  await fetch(`${supabaseUrl}/rest/v1/operation_import_extraction_history`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  }).catch(() => null);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const n8nWebhookUrl = getReprocessWebhookUrl();
  const n8nSecret = getN8nSecret();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Supabase não configurado para reprocessamento DISECURIT.',
    });
  }

  if (!n8nWebhookUrl || !n8nSecret) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Webhook de reprocesso DISECURIT não configurado.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Sessão expirada. Faça login novamente.',
    });
  }

  let body: any;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo inválido.' });
  }

  const importFileId = String(body?.import_file_id || '').trim();
  const reason = String(body?.reason || '').trim() || null;
  const rootProgramHint = normalizeProgramHint(body?.program_hint);

  if (!importFileId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Campo import_file_id é obrigatório.',
    });
  }

  if (body?.program_hint && !rootProgramHint) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'program_hint inválido. Use SPPRO ou SOI.',
    });
  }

  let authData: { userId: string; empresaId: string };

  try {
    authData = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error: any) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: error?.message || 'Não foi possível validar sessão.',
    });
  }

  const { userId, empresaId } = authData;

  const importResp = await fetch(
    `${supabaseUrl}/rest/v1/operation_import_files?select=id,empresa_id,file_storage_bucket,file_storage_key,source,parse_status,parse_attempts,operation_number,parsed_payload,program_hint&id=eq.${encodeURIComponent(importFileId)}&limit=1`,
    {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Accept: 'application/json',
      },
    }
  );

  if (!importResp.ok) {
    return res.status(500).json({
      error: 'Internal server error',
      message: 'Falha ao validar importação.',
    });
  }

  const importRows = await importResp.json().catch(() => []);
  const importRow = Array.isArray(importRows) ? importRows[0] : importRows;

  const persistedProgramHint = normalizeProgramHint(
    importRow?.program_hint || importRow?.parsed_payload?.program || null
  );
  const programHint = rootProgramHint || persistedProgramHint;

  if (!importRow) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Importação não encontrada.',
    });
  }

  if (importRow.empresa_id !== empresaId) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Importação não pertence à empresa do usuário.',
    });
  }

  const currentStatus = String(importRow.parse_status || '');
  if (!['failed', 'parse_partial', 'parsed', 'duplicate'].includes(currentStatus)) {
    return res.status(400).json({
      error: 'Invalid state',
      message: `Reprocesso não permitido para status atual: ${currentStatus || 'desconhecido'}.`,
    });
  }

  const nextAttempts = Number(importRow.parse_attempts || 0) + 1;

  await fetch(
    `${supabaseUrl}/rest/v1/operation_import_files?id=eq.${encodeURIComponent(importFileId)}&empresa_id=eq.${encodeURIComponent(empresaId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        parse_status: 'processing',
        parse_attempts: nextAttempts,
        program_hint: programHint,
        error_message: null,
      }),
    }
  ).catch(() => null);

  await insertAuditEvent(supabaseUrl, serviceRoleKey, {
    import_file_id: importFileId,
    empresa_id: empresaId,
    source: 'disecurit',
    event_type: 'reprocess_requested',
    status: 'processing',
    message: reason || 'Reprocessamento solicitado manualmente pelo usuário.',
    details: {
      previous_status: currentStatus,
      parse_attempts: nextAttempts,
      operation_number: importRow.operation_number || null,
      program_hint: programHint,
    },
    created_by: userId,
  });

  try {
    const n8nResp = await fetch(n8nWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-integration-secret': n8nSecret,
      },
      body: JSON.stringify({
        action: 'reprocess',
        import_file_id: importFileId,
        empresa_id: empresaId,
        user_id: userId,
        source: 'disecurit',
        storage_bucket: importRow.file_storage_bucket,
        storage_key: importRow.file_storage_key,
        program_hint: programHint,
        hints: {
          program_hint: programHint || undefined,
        },
        reason,
        triggered_at: new Date().toISOString(),
      }),
    });

    if (!n8nResp.ok) {
      const n8nText = await n8nResp.text().catch(() => 'Erro desconhecido no n8n');

      await fetch(
        `${supabaseUrl}/rest/v1/operation_import_files?id=eq.${encodeURIComponent(importFileId)}&empresa_id=eq.${encodeURIComponent(empresaId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            parse_status: 'failed',
            program_hint: programHint,
            error_message: n8nText.substring(0, 1000),
          }),
        }
      ).catch(() => null);

      await insertAuditEvent(supabaseUrl, serviceRoleKey, {
        import_file_id: importFileId,
        empresa_id: empresaId,
        source: 'disecurit',
        event_type: 'reprocess_failed',
        status: 'failed',
        message: 'n8n retornou erro ao reprocessar import.',
        details: {
          status_code: n8nResp.status,
          response_text: n8nText.substring(0, 2000),
          program_hint: programHint,
        },
        created_by: userId,
      });

      return res.status(502).json({
        error: 'External service error',
        message: 'Falha ao acionar n8n para reprocessamento.',
      });
    }

    const payload = (await n8nResp.json().catch(() => ({}))) as N8nWebhookResponse;
    const parsedStatusRaw = String(payload?.status || '').toLowerCase();
    const parsedStatus = ALLOWED_STATUSES.has(parsedStatusRaw as ImportParseStatus)
      ? (parsedStatusRaw as ImportParseStatus)
      : null;
    let finalStatus: ImportParseStatus | 'processing' = parsedStatus || 'processing';
    let finalReason = payload?.reason || null;

    if (parsedStatus) {
      await fetch(
        `${supabaseUrl}/rest/v1/operation_import_files?id=eq.${encodeURIComponent(importFileId)}&empresa_id=eq.${encodeURIComponent(empresaId)}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            parse_status: parsedStatus,
            program_hint: programHint,
          }),
        }
      ).catch(() => null);
    }

    if (isParsedLikeStatus(parsedStatus) || parsedStatus === 'duplicate') {
      const latestRow = await loadImportRow(supabaseUrl, serviceRoleKey, importFileId, empresaId);
      if (!latestRow?.parsed_payload) {
        const inconsistentMessage =
          'Inconsistência: parse_status sem parsed_payload. Reprocessar import.';
        finalStatus = 'failed';
        finalReason = inconsistentMessage;

        await fetch(
          `${supabaseUrl}/rest/v1/operation_import_files?id=eq.${encodeURIComponent(importFileId)}&empresa_id=eq.${encodeURIComponent(empresaId)}`,
          {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({
              parse_status: 'failed',
              program_hint: programHint,
              error_message: inconsistentMessage,
            }),
          }
        ).catch(() => null);

        await insertAuditEvent(supabaseUrl, serviceRoleKey, {
          import_file_id: importFileId,
          empresa_id: empresaId,
          source: 'disecurit',
          event_type: 'payload_inconsistent',
          status: 'failed',
          message: inconsistentMessage,
          details: {
            n8n_status: parsedStatus,
            workflow_version: payload?.workflow_version || null,
            context: 'reprocess',
          },
          created_by: userId,
        });
      } else {
        const extractionHistoryRows = buildExtractionHistoryRows({
          empresaId,
          importFileId,
          userId,
          parsedPayload: latestRow?.parsed_payload || null,
          phase: 'reprocess',
          parseStatus: parsedStatus || finalStatus,
        });
        await insertExtractionHistoryRows(supabaseUrl, serviceRoleKey, extractionHistoryRows);
      }
    }

    await insertAuditEvent(supabaseUrl, serviceRoleKey, {
      import_file_id: importFileId,
      empresa_id: empresaId,
      source: 'disecurit',
      event_type: 'reprocess_triggered',
      status: finalStatus,
      message: 'Reprocessamento acionado no n8n com sucesso.',
      details: {
        response: payload,
        final_status: finalStatus,
        final_reason: finalReason,
        existing_import_file_id: payload?.existing_import_file_id || null,
        existing_linked_operacao_id: payload?.existing_linked_operacao_id || null,
        workflow_version: payload?.workflow_version || null,
        program_hint: programHint,
      },
      created_by: userId,
    });

    return res.status(200).json({
      ok: true,
      import_file_id: importFileId,
      status: finalStatus,
      reason: finalReason,
      existing_import_file_id: payload?.existing_import_file_id || null,
      existing_linked_operacao_id: payload?.existing_linked_operacao_id ?? null,
      workflow_version: payload?.workflow_version || null,
    });
  } catch (error: any) {
    await insertAuditEvent(supabaseUrl, serviceRoleKey, {
      import_file_id: importFileId,
      empresa_id: empresaId,
      source: 'disecurit',
      event_type: 'reprocess_exception',
      status: 'failed',
      message: error?.message || 'Erro inesperado no reprocesso',
      details: {
        stack: error?.stack?.substring?.(0, 2000) || null,
        program_hint: programHint,
      },
      created_by: userId,
    });

    return res.status(500).json({
      error: 'Internal server error',
      message: 'Erro ao solicitar reprocessamento DISECURIT.',
    });
  }
}
