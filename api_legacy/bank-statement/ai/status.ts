import type { AiExecutionStatusCallbackRequest } from '../../../src/types/bank-reconciliation.js';
import {
  getAdminClient,
  getBankReconciliationIntegrationSecret,
  getHeaderValue,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isEmpresaHeaderConsistent,
  isValidIntegrationSecret,
  parseJsonBody,
  safeInsertBankAuditLog,
  type VercelRequest,
  type VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';
import { updateBankAiExecutionRunStatus } from '../../../src/server/bank-statement/aiExecutionRuns.js';

const VALID_STATUSES = new Set(['processing', 'completed', 'no_pending', 'failed']);

const toCountMap = (value: unknown): AiExecutionStatusCallbackRequest['counts'] => {
  let source: unknown = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      source = null;
    }
  }
  if (!source || typeof source !== 'object') return undefined;
  const row = source as Record<string, unknown>;
  const normalize = (key: string) => {
    const n = Number(row[key]);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : undefined;
  };
  return {
    sugestoes_total: normalize('sugestoes_total'),
    match_existing_count: normalize('match_existing_count'),
    create_new_count: normalize('create_new_count'),
    ignore_count: normalize('ignore_count'),
    needs_review_count: normalize('needs_review_count'),
  };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const integrationSecret = getBankReconciliationIntegrationSecret();

  if (!supabaseUrl || !serviceRoleKey || !integrationSecret) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis de integracao/Supabase nao configuradas para ai/status.',
    });
  }

  if (!isValidIntegrationSecret(req, integrationSecret)) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'x-integration-secret invalido para ai/status.',
    });
  }

  let body: AiExecutionStatusCallbackRequest;
  try {
    body = (parseJsonBody(req) || {}) as AiExecutionStatusCallbackRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const empresaId = String(body?.empresa_id || '').trim();
  const contaBancariaId = String(body?.conta_bancaria_id || '').trim();
  const extratoImportId = String(body?.extrato_import_id || '').trim();
  const correlationId = String(body?.correlation_id || '').trim();
  const status = String(body?.status || '').trim() as AiExecutionStatusCallbackRequest['status'];
  const errorMessage = typeof body?.error_message === 'string' ? body.error_message : null;
  const metadata = body?.metadata && typeof body.metadata === 'object'
    ? (body.metadata as Record<string, unknown>)
    : {};
  const counts = toCountMap(body?.counts);

  if (!empresaId || !contaBancariaId || !extratoImportId || !correlationId || !VALID_STATUSES.has(status)) {
    return res.status(400).json({
      error: 'Invalid input',
      message:
        'empresa_id, conta_bancaria_id, extrato_import_id, correlation_id e status (processing|completed|no_pending|failed) sao obrigatorios.',
    });
  }

  if (!isEmpresaHeaderConsistent(req, empresaId)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'x-empresa-id inconsistente com empresa_id do payload.',
    });
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  try {
    const updated = await updateBankAiExecutionRunStatus({
      adminClient,
      empresaId,
      correlationId,
      status,
      errorMessage: status === 'failed' ? errorMessage || 'Workflow IA falhou.' : undefined,
      counts,
      metadataPatch: {
        callback_status: status,
        callback_at: new Date().toISOString(),
        ...(Object.keys(metadata).length ? { callback_metadata: metadata } : {}),
      },
      setCompletedAt: status === 'completed' || status === 'no_pending' || status === 'failed',
    });

    if (!updated) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Execucao IA nao encontrada para correlation_id informado.',
      });
    }

    const ignoredStatusTransition = updated.status !== status;

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: empresaId,
      extrato_import_id: extratoImportId,
      action: 'ai_execution_status_callback',
      status: status === 'failed' ? 'error' : 'info',
      message: `Callback de status IA recebido: ${status}.`,
      details: {
        correlation_id: correlationId,
        conta_bancaria_id: contaBancariaId,
        status,
        persisted_status: updated.status,
        ignored_status_transition: ignoredStatusTransition,
        counts: counts || null,
        error_message: errorMessage,
      },
    });

    return res.status(200).json({
      ok: true,
      data: {
        id: updated.id,
        correlation_id: updated.correlation_id,
        status: updated.status,
        requested_status: status,
        ignored_status_transition: ignoredStatusTransition,
        updated_at: updated.updated_at,
        completed_at: updated.completed_at,
        counts: {
          sugestoes_total: updated.sugestoes_total,
          match_existing_count: updated.match_existing_count,
          create_new_count: updated.create_new_count,
          ignore_count: updated.ignore_count,
          needs_review_count: updated.needs_review_count,
        },
      },
    });
  } catch (error: unknown) {
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Falha ao atualizar status de execucao IA.',
    });
  }
}
