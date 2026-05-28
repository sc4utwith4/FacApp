import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../src/server/bank-statement/_shared.js';
import type {
  OperationIaHistoryEvent,
  OperationIaHistoryResponse,
  OperationIaProgram,
} from '../../src/types/operacoes-ia.js';

const SOURCE = 'disecurit';
const APP_TIMEZONE = 'America/Sao_Paulo';

const IMPORTANT_AUDIT_EVENTS = new Set([
  'import_requested',
  'n8n_triggered',
  'n8n_error',
  'n8n_exception',
  'payload_inconsistent',
]);

const readQueryValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
};

const toRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const toText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const normalizeProgram = (value: unknown): OperationIaProgram | null => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SOI' || normalized === 'SPPRO') return normalized;
  return null;
};

const toIsoDateInTimeZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    return new Date().toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
};

const readTimeZoneParts = (date: Date, timeZone: string): Record<string, number> => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const values: Record<string, number> = {
    year: 1970,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  };

  for (const part of parts) {
    if (part.type in values) {
      const parsed = Number.parseInt(part.value, 10);
      values[part.type] = Number.isFinite(parsed) ? parsed : values[part.type];
    }
  }

  return values;
};

const getTimeZoneOffsetMs = (date: Date, timeZone: string): number => {
  const values = readTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second,
    0
  );
  return asUtc - date.getTime();
};

const zonedDateTimeToUtcMs = (
  dateRef: string,
  timeZone: string,
  hour: number,
  minute: number,
  second: number,
  ms: number
): number => {
  const [yearRaw, monthRaw, dayRaw] = String(dateRef || '').split('-');
  const year = Number.parseInt(yearRaw || '', 10);
  const month = Number.parseInt(monthRaw || '', 10);
  const day = Number.parseInt(dayRaw || '', 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return Date.now();
  }

  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset1 = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  let corrected = utcGuess - offset1;
  const offset2 = getTimeZoneOffsetMs(new Date(corrected), timeZone);
  if (offset2 !== offset1) {
    corrected = utcGuess - offset2;
  }
  return corrected;
};

const getDayRangeUtc = (dateRef: string, timeZone: string): { start: string; end: string } => {
  const startMs = zonedDateTimeToUtcMs(dateRef, timeZone, 0, 0, 0, 0);
  const endMs = zonedDateTimeToUtcMs(dateRef, timeZone, 23, 59, 59, 999);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
  };
};

const normalizeAuditStatus = (value: unknown): OperationIaHistoryEvent['status'] => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'success') return 'success';
  if (normalized === 'warning') return 'warning';
  if (normalized === 'error' || normalized === 'failed') return 'error';
  return 'info';
};

const parseStatusToSeverity = (parseStatus: string): OperationIaHistoryEvent['status'] => {
  if (parseStatus === 'parsed') return 'success';
  if (parseStatus === 'parse_partial') return 'warning';
  if (parseStatus === 'failed') return 'error';
  if (parseStatus === 'duplicate') return 'warning';
  return 'info';
};

const parseStatusToMessage = (parseStatus: string, errorMessage: string | null): string => {
  if (parseStatus === 'parsed') return 'Import processado com sucesso.';
  if (parseStatus === 'parse_partial') return 'Import processado parcialmente. Revisao recomendada.';
  if (parseStatus === 'processing') return 'Import em processamento.';
  if (parseStatus === 'received') return 'Import recebido e aguardando processamento.';
  if (parseStatus === 'duplicate') return 'Import identificado como duplicado.';
  if (parseStatus === 'failed') return errorMessage || 'Falha no processamento do import.';
  return `Import em status ${parseStatus || 'desconhecido'}.`;
};

const shouldIncludeAuditEvent = (eventType: string): boolean => {
  if (!eventType) return false;
  if (eventType.startsWith('operations_ia_')) return true;
  return IMPORTANT_AUDIT_EVENTS.has(eventType);
};

const classifyAuditCategory = (
  eventType: string,
  status: OperationIaHistoryEvent['status']
): OperationIaHistoryEvent['categoria'] => {
  if (eventType.includes('item_created')) return 'created';
  if (eventType === 'operations_ia_batch_confirm') return 'created';
  if (eventType.includes('import_') || eventType.startsWith('n8n_') || eventType === 'payload_inconsistent') {
    return 'imports';
  }
  if (status === 'error' || eventType.includes('failed') || eventType.includes('blocked')) {
    return 'errors';
  }
  return 'other';
};

const resolveProgramFromPayload = (payloadLike: unknown): OperationIaProgram | null => {
  const payload = toRecord(payloadLike);
  const document = toRecord(payload.document);
  return normalizeProgram(payload.program || document.program || payload.program_hint);
};

const parseTimestamp = (value: unknown): number => {
  const ts = new Date(String(value || '')).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', message: 'Use GET para consultar historico.' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis do Supabase nao configuradas para historico Operacoes IA.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Sessao expirada. Faca login novamente.' });
  }

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
    });
  }

  const requestedDate = readQueryValue(req.query?.date);
  const dateRef = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
    ? requestedDate
    : toIsoDateInTimeZone(new Date(), APP_TIMEZONE);

  const rawLimit = Number.parseInt(readQueryValue(req.query?.limit) || '200', 10);
  const limit = Number.isFinite(rawLimit) ? Math.max(20, Math.min(rawLimit, 500)) : 200;

  const range = getDayRangeUtc(dateRef, APP_TIMEZONE);
  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  try {
    const [importsResult, auditResult, extractionResult] = await Promise.all([
      adminClient
        .from('operation_import_files')
        .select(
          'id,parse_status,program_hint,operation_number,linked_operacao_id,error_message,created_at,created_by,original_filename,parsed_payload'
        )
        .eq('empresa_id', auth.empresaId)
        .eq('source', SOURCE)
        .gte('created_at', range.start)
        .lt('created_at', range.end)
        .order('created_at', { ascending: false })
        .limit(Math.max(limit, 200)),
      adminClient
        .from('integration_audit_log')
        .select('id,import_file_id,event_type,status,message,details,created_at,created_by,source')
        .eq('empresa_id', auth.empresaId)
        .gte('created_at', range.start)
        .lt('created_at', range.end)
        .order('created_at', { ascending: false })
        .limit(Math.max(limit * 2, 300)),
      adminClient
        .from('operation_import_extraction_history')
        .select(
          'id,import_file_id,line_index,field_name,status,source_method,conflict_flag,raw_value,normalized_value,metadata,created_at,actor_user_id'
        )
        .eq('empresa_id', auth.empresaId)
        .gte('created_at', range.start)
        .lt('created_at', range.end)
        .or('status.eq.corrected,field_name.eq.confirm,conflict_flag.eq.true')
        .order('created_at', { ascending: false })
        .limit(Math.max(limit * 3, 400)),
    ]);

    if (importsResult.error) {
      throw new Error(`Falha ao carregar imports do historico: ${importsResult.error.message}`);
    }
    if (auditResult.error) {
      throw new Error(`Falha ao carregar auditoria do historico: ${auditResult.error.message}`);
    }
    if (extractionResult.error) {
      throw new Error(`Falha ao carregar extracao do historico: ${extractionResult.error.message}`);
    }

    const importEvents: OperationIaHistoryEvent[] = ((importsResult.data || []) as Array<Record<string, unknown>>).map((row) => {
      const parseStatus = String(row.parse_status || '').trim().toLowerCase();
      const payloadProgram = resolveProgramFromPayload(row.parsed_payload);
      const payloadDocument = toText(toRecord(toRecord(row.parsed_payload).document).operation_number);
      const operationNumber = toText(row.operation_number) || payloadDocument;
      const linkedOperacaoId = Number(row.linked_operacao_id || 0);

      return {
        id: `import:${String(row.id || '')}`,
        timestamp: String(row.created_at || new Date().toISOString()),
        tipo_evento: `import_${parseStatus || 'unknown'}`,
        programa: normalizeProgram(row.program_hint) || payloadProgram,
        operacao: operationNumber || (linkedOperacaoId > 0 ? `#${linkedOperacaoId}` : null),
        documento: operationNumber,
        import_file_id: toText(row.id),
        status: parseStatusToSeverity(parseStatus),
        categoria: 'imports',
        mensagem: parseStatusToMessage(parseStatus, toText(row.error_message)),
        usuario: toText(row.created_by),
        metadata: {
          parse_status: parseStatus || 'unknown',
          linked_operacao_id: linkedOperacaoId > 0 ? linkedOperacaoId : null,
          original_filename: toText(row.original_filename),
        },
        origin: 'operation_import_files',
      };
    });

    const auditEvents: OperationIaHistoryEvent[] = ((auditResult.data || []) as Array<Record<string, unknown>>)
      .map((row) => {
        const eventType = String(row.event_type || '').trim();
        if (!shouldIncludeAuditEvent(eventType)) return null;

        const details = toRecord(row.details);
        const operationId = Number(details.operation_id || 0);
        const detailsProgram =
          normalizeProgram(details.program) ||
          normalizeProgram(details.program_hint) ||
          (details.soi_formula ? 'SOI' : null) ||
          (details.sppro_formula ? 'SPPRO' : null);
        const status = normalizeAuditStatus(row.status);

        return {
          id: `audit:${String(row.id || '')}`,
          timestamp: String(row.created_at || new Date().toISOString()),
          tipo_evento: eventType,
          programa: detailsProgram,
          operacao:
            operationId > 0
              ? `#${operationId}`
              : toText(details.operation_number) || toText(details.item_id) || null,
          documento: toText(details.documento) || toText(details.document),
          import_file_id: toText(row.import_file_id),
          status,
          categoria: classifyAuditCategory(eventType, status),
          mensagem: toText(row.message),
          usuario: toText(row.created_by) || toText(details.user_id),
          metadata: details,
          origin: 'integration_audit_log',
        } as OperationIaHistoryEvent;
      })
      .filter((event): event is OperationIaHistoryEvent => Boolean(event));

    const extractionEvents: OperationIaHistoryEvent[] = ((extractionResult.data || []) as Array<Record<string, unknown>>).map(
      (row) => {
        const metadata = toRecord(row.metadata);
        const fieldName = toText(row.field_name) || 'unknown';
        const statusRaw = String(row.status || '').trim().toLowerCase();
        const sourceMethod = String(row.source_method || '').trim().toLowerCase();
        const isConfirm = fieldName === 'confirm' || toText(metadata.event_type) === 'confirm_created_success';
        const isCorrection = statusRaw === 'corrected' || sourceMethod === 'manual';
        const isConflict = Boolean(row.conflict_flag);

        const category: OperationIaHistoryEvent['categoria'] = isConfirm
          ? 'created'
          : isCorrection
            ? 'corrections'
            : isConflict
              ? 'errors'
              : 'other';

        const severity: OperationIaHistoryEvent['status'] = isConfirm
          ? 'success'
          : isConflict
            ? 'warning'
            : isCorrection
              ? 'info'
              : 'info';

        const operationId = Number(metadata.operation_id || 0);

        return {
          id: `history:${String(row.id || '')}`,
          timestamp: String(row.created_at || new Date().toISOString()),
          tipo_evento: toText(metadata.event_type) || (isConfirm ? 'confirm_created_success' : 'manual_field_update'),
          programa:
            normalizeProgram(metadata.program) ||
            normalizeProgram(metadata.program_hint) ||
            (metadata.soi_formula ? 'SOI' : null) ||
            (metadata.sppro_formula ? 'SPPRO' : null),
          operacao:
            operationId > 0
              ? `#${operationId}`
              : toText(metadata.operation_number) || toText(metadata.item_id) || null,
          documento: toText(metadata.documento) || toText(metadata.document),
          import_file_id: toText(row.import_file_id),
          status: severity,
          categoria: category,
          mensagem: isConfirm
            ? 'Confirmacao registrada no historico tecnico.'
            : isCorrection
              ? `Correcao manual no campo ${fieldName}.`
              : `Evento tecnico de extracao no campo ${fieldName}.`,
          usuario: toText(row.actor_user_id),
          metadata: {
            ...metadata,
            field_name: fieldName,
            line_index: row.line_index ?? null,
            raw_value: row.raw_value ?? null,
            normalized_value: row.normalized_value ?? null,
            source_method: sourceMethod || null,
            status: statusRaw || null,
            conflict_flag: Boolean(row.conflict_flag),
          },
          origin: 'operation_import_extraction_history',
        };
      }
    );

    const merged = [...importEvents, ...auditEvents, ...extractionEvents]
      .sort((left, right) => parseTimestamp(right.timestamp) - parseTimestamp(left.timestamp))
      .slice(0, limit);

    const summary = merged.reduce(
      (acc, event) => {
        acc.total += 1;
        if (event.status === 'error' || event.categoria === 'errors') acc.errors += 1;
        if (event.categoria === 'created') acc.created += 1;
        if (event.categoria === 'corrections') acc.corrections += 1;
        if (event.categoria === 'imports') acc.imports += 1;
        return acc;
      },
      {
        total: 0,
        errors: 0,
        created: 0,
        corrections: 0,
        imports: 0,
      }
    );

    const payload: OperationIaHistoryResponse = {
      ok: true,
      data: {
        timezone: APP_TIMEZONE,
        date_ref: dateRef,
        range_start_utc: range.start,
        range_end_utc: range.end,
        fetched_at: new Date().toISOString(),
        summary,
        events: merged,
      },
    };

    return res.status(200).json(payload);
  } catch (error) {
    return res.status(422).json({
      error: 'History error',
      message: getErrorMessage(error, 'Falha ao carregar historico de Operacoes IA.'),
    });
  }
}
