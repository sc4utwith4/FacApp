import type { ImportNoticeAckRequest } from '../../../../src/types/bank-reconciliation.js';
import {
  extractBearerToken,
  getAdminClient,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  parseJsonBody,
  safeInsertBankAuditLog,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../../../src/server/bank-statement/_shared.js';

const readValue = (value: string | string[] | undefined): string => {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return String(value || '').trim();
};

const VALID_NOTICE_TYPES = new Set<ImportNoticeAckRequest['notice_type']>(['duplicate_suspect']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
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

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  if (req.method === 'GET') {
    const extratoImportId = readValue(req.query?.extrato_import_id);
    const noticeTypeRaw = readValue(req.query?.notice_type) || 'duplicate_suspect';
    const noticeType = noticeTypeRaw as ImportNoticeAckRequest['notice_type'];

    if (!extratoImportId) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'extrato_import_id e obrigatorio.',
      });
    }
    if (!VALID_NOTICE_TYPES.has(noticeType)) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'notice_type invalido.',
      });
    }

    const { data: importRow, error: importError } = await adminClient
      .from('extratos_import')
      .select('id,conta_bancaria_id')
      .eq('empresa_id', auth.empresaId)
      .eq('id', extratoImportId)
      .maybeSingle();

    if (importError) {
      return res.status(500).json({
        error: 'Import error',
        message: `Falha ao validar importacao: ${importError.message}`,
      });
    }
    if (!importRow) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Importacao nao encontrada para a empresa autenticada.',
      });
    }

    const { data: ackRow, error: ackError } = await adminClient
      .from('bank_reconciliation_import_notice_ack')
      .select('id,acknowledged_at')
      .eq('empresa_id', auth.empresaId)
      .eq('user_id', auth.userId)
      .eq('extrato_import_id', extratoImportId)
      .eq('notice_type', noticeType)
      .maybeSingle();

    if (ackError) {
      return res.status(500).json({
        error: 'Ack error',
        message: `Falha ao carregar estado do aviso: ${ackError.message}`,
      });
    }

    return res.status(200).json({
      ok: true,
      data: {
        extrato_import_id: extratoImportId,
        conta_bancaria_id: String(importRow.conta_bancaria_id || ''),
        notice_type: noticeType,
        acknowledged: Boolean(ackRow?.id),
        acknowledged_at: ackRow?.acknowledged_at || null,
      },
    });
  }

  let body: ImportNoticeAckRequest;
  try {
    body = (parseJsonBody(req) || {}) as ImportNoticeAckRequest;
  } catch {
    return res.status(400).json({
      error: 'Invalid JSON',
      message: 'Corpo invalido.',
    });
  }

  const extratoImportId = String(body?.extrato_import_id || '').trim();
  const noticeTypeRaw = String(body?.notice_type || '').trim() || 'duplicate_suspect';
  const noticeType = noticeTypeRaw as ImportNoticeAckRequest['notice_type'];

  if (!extratoImportId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'extrato_import_id e obrigatorio.',
    });
  }
  if (!VALID_NOTICE_TYPES.has(noticeType)) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'notice_type invalido.',
    });
  }

  const { data: importRow, error: importError } = await adminClient
    .from('extratos_import')
    .select('id,conta_bancaria_id')
    .eq('empresa_id', auth.empresaId)
    .eq('id', extratoImportId)
    .maybeSingle();

  if (importError) {
    return res.status(500).json({
      error: 'Import error',
      message: `Falha ao validar importacao: ${importError.message}`,
    });
  }
  if (!importRow) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Importacao nao encontrada para a empresa autenticada.',
    });
  }

  const nowIso = new Date().toISOString();
  const ackPayload = {
    empresa_id: auth.empresaId,
    user_id: auth.userId,
    conta_bancaria_id: String(importRow.conta_bancaria_id || ''),
    extrato_import_id: extratoImportId,
    notice_type: noticeType,
    acknowledged_at: nowIso,
    metadata: {
      acknowledged_via: 'chat_shell',
    },
  };

  const { data: ackRow, error: ackError } = await adminClient
    .from('bank_reconciliation_import_notice_ack')
    .upsert(ackPayload, {
      onConflict: 'empresa_id,user_id,extrato_import_id,notice_type',
    })
    .select('id,acknowledged_at')
    .maybeSingle();

  if (ackError) {
    return res.status(422).json({
      error: 'Ack error',
      message: `Falha ao registrar confirmação do aviso: ${ackError.message}`,
    });
  }

  await safeInsertBankAuditLog(adminClient, {
    empresa_id: auth.empresaId,
    extrato_import_id: extratoImportId,
    action: 'duplicate_banner_acknowledged',
    status: 'success',
    message: 'Usuário confirmou aviso de possível duplicidade de importação.',
    created_by: auth.userId,
    details: {
      notice_type: noticeType,
      acknowledged_at: ackRow?.acknowledged_at || nowIso,
    },
  });

  return res.status(200).json({
    ok: true,
    data: {
      extrato_import_id: extratoImportId,
      notice_type: noticeType,
      acknowledged: true,
      acknowledged_at: ackRow?.acknowledged_at || nowIso,
    },
  });
}
