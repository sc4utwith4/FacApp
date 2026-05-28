import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../src/server/bank-statement/_shared.js';
import { insertExtractionHistoryRows } from '../../src/server/operacoes-ia/extractionHistory.js';

type HistoryEventInput = {
  import_file_id?: string;
  item_id?: string | null;
  field_name?: string;
  previous_value?: unknown;
  new_value?: unknown;
  line_index?: number | null;
  reason?: string | null;
};

const SOURCE = 'disecurit';

const uniqueIds = (values: string[]): string[] => Array.from(new Set(values.filter(Boolean)));

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
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
};

const toText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', message: 'Use POST para registrar histórico.' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variáveis do Supabase não configuradas para histórico Operações IA.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  if (!accessToken) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Sessão expirada. Faça login novamente.' });
  }

  let body: { events?: HistoryEventInput[] };
  try {
    body = (parseJsonBody(req) || {}) as { events?: HistoryEventInput[] };
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo inválido.' });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  if (!events.length) {
    return res.status(400).json({ error: 'Invalid input', message: 'events é obrigatório.' });
  }

  let auth;
  try {
    auth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
  } catch (error) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: getErrorMessage(error, 'Não foi possível validar sessão.'),
    });
  }

  const importIds = uniqueIds(events.map((event) => String(event.import_file_id || '').trim()).filter(Boolean));
  if (!importIds.length) {
    return res.status(400).json({ error: 'Invalid input', message: 'import_file_id é obrigatório em cada evento.' });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);
  const { data: importsData, error: importsError } = await adminClient
    .from('operation_import_files')
    .select('id,empresa_id,source')
    .eq('empresa_id', auth.empresaId)
    .eq('source', SOURCE)
    .in('id', importIds);

  if (importsError) {
    return res.status(500).json({
      error: 'History error',
      message: `Falha ao validar imports para histórico: ${importsError.message}`,
    });
  }

  const allowedImportIds = new Set((importsData || []).map((row: { id: string }) => row.id));

  const rows = events
    .map((event) => {
      const importFileId = String(event.import_file_id || '').trim();
      if (!importFileId || !allowedImportIds.has(importFileId)) return null;

      const fieldName = String(event.field_name || '').trim();
      if (!fieldName) return null;

      const newValue = toFiniteNumber(event.new_value);
      const previousText = toText(event.previous_value);
      const reason = toText(event.reason) || 'save';
      const lineIndexRaw = event.line_index;
      const lineIndex =
        typeof lineIndexRaw === 'number' && Number.isFinite(lineIndexRaw) ? lineIndexRaw : null;

      return {
        empresa_id: auth.empresaId,
        import_file_id: importFileId,
        line_index: lineIndex,
        field_name: fieldName,
        raw_value: previousText,
        normalized_value: newValue,
        source_method: 'manual' as const,
        confidence: null,
        conflict_flag: false,
        status: 'corrected' as const,
        actor_user_id: auth.userId,
        metadata: {
          phase: reason === 'confirm' ? 'confirm' : 'save',
          item_id: toText(event.item_id),
          previous_value: event.previous_value ?? null,
          new_value: event.new_value ?? null,
        },
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (!rows.length) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'Nenhum evento válido para gravação de histórico.',
    });
  }

  await insertExtractionHistoryRows(adminClient, rows);

  return res.status(200).json({
    ok: true,
    inserted: rows.length,
  });
}
