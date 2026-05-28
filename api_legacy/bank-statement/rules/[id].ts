import type {
  RuleDirection,
  RuleMatchType,
  UpdateReconciliationRuleRequest,
} from '../../../src/types/bank-reconciliation.js';
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
} from '../../../src/server/bank-statement/_shared.js';

const VALID_MATCH_TYPES = new Set<RuleMatchType>(['contains', 'startswith', 'regex', 'exact']);
const VALID_DIRECTIONS = new Set<RuleDirection>(['credit', 'debit', 'both']);

const getRuleId = (req: VercelRequest, body?: Record<string, unknown>): string => {
  const rawQuery = req.query?.id;
  if (typeof rawQuery === 'string' && rawQuery.trim()) return rawQuery.trim();
  if (Array.isArray(rawQuery) && rawQuery.length && rawQuery[0]) return String(rawQuery[0]).trim();

  const rawBody = String(body?.id || '').trim();
  return rawBody;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

  if (req.method === 'PATCH') {
    let body: UpdateReconciliationRuleRequest & Record<string, unknown>;
    try {
      body = (parseJsonBody(req) || {}) as UpdateReconciliationRuleRequest & Record<string, unknown>;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
    }

    const ruleId = getRuleId(req, body);
    if (!ruleId) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'id da regra e obrigatorio.',
      });
    }

    const patch: Record<string, unknown> = {};

    if (body.match_type !== undefined) {
      if (!VALID_MATCH_TYPES.has(body.match_type as RuleMatchType)) {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'match_type invalido. Use contains|startswith|regex|exact.',
        });
      }
      patch.match_type = body.match_type;
    }

    if (body.direction !== undefined) {
      if (!VALID_DIRECTIONS.has(body.direction as RuleDirection)) {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'direction invalido. Use credit|debit|both.',
        });
      }
      patch.direction = body.direction;
    }

    if (body.pattern !== undefined) {
      const pattern = String(body.pattern || '').trim();
      if (!pattern) {
        return res.status(400).json({
          error: 'Invalid input',
          message: 'pattern nao pode ser vazio.',
        });
      }
      patch.pattern = pattern;
    }

    if (body.conta_bancaria_id !== undefined) patch.conta_bancaria_id = body.conta_bancaria_id || null;
    if (body.default_grupo_contas_id !== undefined) patch.default_grupo_contas_id = body.default_grupo_contas_id || null;
    if (body.default_centro_custo !== undefined) patch.default_centro_custo = body.default_centro_custo || null;
    if (body.auto_create !== undefined) patch.auto_create = body.auto_create === true;
    if (body.auto_confirm !== undefined) patch.auto_confirm = body.auto_confirm === true;
    if (body.active !== undefined) patch.active = body.active === true;
    if (body.priority !== undefined) patch.priority = Number(body.priority || 0);

    if (!Object.keys(patch).length) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'Nenhum campo para atualizacao foi informado.',
      });
    }

    patch.updated_at = new Date().toISOString();

    const { data, error } = await adminClient
      .from('regras_conciliacao')
      .update(patch)
      .eq('id', ruleId)
      .eq('empresa_id', auth.empresaId)
      .select('*')
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao atualizar regra: ${error.message}`,
      });
    }

    if (!data) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Regra nao encontrada para a empresa.',
      });
    }

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      action: 'rule_updated',
      status: 'success',
      message: `Regra ${ruleId} atualizada.`,
      created_by: auth.userId,
      details: {
        rule_id: ruleId,
        patch,
      },
    });

    return res.status(200).json({
      ok: true,
      data,
    });
  }

  if (req.method === 'DELETE') {
    let body: Record<string, unknown> = {};
    try {
      body = (parseJsonBody(req) || {}) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const ruleId = getRuleId(req, body);
    if (!ruleId) {
      return res.status(400).json({
        error: 'Invalid input',
        message: 'id da regra e obrigatorio.',
      });
    }

    const { data: deleted, error } = await adminClient
      .from('regras_conciliacao')
      .delete()
      .eq('id', ruleId)
      .eq('empresa_id', auth.empresaId)
      .select('id')
      .maybeSingle();

    if (error) {
      return res.status(500).json({
        error: 'Internal server error',
        message: `Falha ao remover regra: ${error.message}`,
      });
    }

    if (!deleted) {
      return res.status(404).json({
        error: 'Not found',
        message: 'Regra nao encontrada para a empresa.',
      });
    }

    await safeInsertBankAuditLog(adminClient, {
      empresa_id: auth.empresaId,
      action: 'rule_deleted',
      status: 'warning',
      message: `Regra ${ruleId} removida.`,
      created_by: auth.userId,
      details: {
        rule_id: ruleId,
      },
    });

    return res.status(200).json({
      ok: true,
      deleted_id: ruleId,
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
