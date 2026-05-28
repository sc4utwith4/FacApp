import type { AiIntegrationTriggerRequest } from '../../../src/types/bank-reconciliation.js';
import { triggerBankReconciliationAiWorkflow } from '../../../src/server/bank-statement/_ai-trigger.js';
import {
  extractBearerToken,
  getAdminClient,
  getBankReconciliationIntegrationSecret,
  getErrorMessage,
  getHeaderValue,
  getSupabaseAnonKey,
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  isEmpresaHeaderConsistent,
  isValidIntegrationSecret,
  parseIntegrationScope,
  parseJsonBody,
  verifyTokenAndGetEmpresaId,
  type VercelRequest,
  type VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

interface ResolvedAuthContext {
  mode: 'user' | 'integration';
  userId: string | null;
  empresaId: string;
  contaBancariaId: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = getSupabaseUrl();
  const supabaseAnonKey = getSupabaseAnonKey();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  const integrationSecret = getBankReconciliationIntegrationSecret();

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return res.status(500).json({
      error: 'Configuration error',
      message: 'Variaveis do Supabase nao configuradas para conciliacao bancaria.',
    });
  }

  let body: AiIntegrationTriggerRequest;
  try {
    body = (parseJsonBody(req) || {}) as AiIntegrationTriggerRequest;
  } catch {
    return res.status(400).json({ error: 'Invalid JSON', message: 'Corpo invalido.' });
  }

  const importId = String(body?.extrato_import_id || body?.import_id || '').trim();

  if (!importId) {
    return res.status(400).json({
      error: 'Invalid input',
      message: 'extrato_import_id/import_id obrigatorio.',
    });
  }

  const accessToken = extractBearerToken(getHeaderValue(req, 'authorization'));
  const isIntegrationCall = Boolean(getHeaderValue(req, 'x-integration-secret'));

  let auth: ResolvedAuthContext;

  if (isIntegrationCall) {
    if (!integrationSecret || !isValidIntegrationSecret(req, integrationSecret)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'x-integration-secret invalido para trigger IA.',
      });
    }

    const parsedScope = parseIntegrationScope(body as unknown as Record<string, unknown>, {
      requireContaBancariaId: true,
      requireImportId: true,
    });

    if (parsedScope.error || !parsedScope.scope) {
      return res.status(400).json({
        error: 'Invalid input',
        message: parsedScope.error || 'Escopo de integracao invalido.',
      });
    }

    if (!isEmpresaHeaderConsistent(req, parsedScope.scope.empresaId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'x-empresa-id inconsistente com empresa_id do payload.',
      });
    }

    auth = {
      mode: 'integration',
      userId: null,
      empresaId: parsedScope.scope.empresaId,
      contaBancariaId: parsedScope.scope.contaBancariaId,
    };
  } else {
    if (!accessToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Sessao expirada. Faca login novamente.',
      });
    }

    let userAuth;
    try {
      userAuth = await verifyTokenAndGetEmpresaId(supabaseUrl, supabaseAnonKey, accessToken);
    } catch (error: unknown) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: getErrorMessage(error, 'Nao foi possivel validar sessao.'),
      });
    }

    auth = {
      mode: 'user',
      userId: userAuth.userId,
      empresaId: userAuth.empresaId,
      contaBancariaId: String(body?.conta_bancaria_id || '').trim() || null,
    };
  }

  const adminClient = getAdminClient(supabaseUrl, serviceRoleKey);

  const { data: importRow, error: importError } = await adminClient
    .from('extratos_import')
    .select('id,empresa_id,conta_bancaria_id,parse_status,error_message')
    .eq('id', importId)
    .eq('empresa_id', auth.empresaId)
    .maybeSingle();

  if (importError) {
    return res.status(500).json({
      error: 'Internal server error',
      message: `Falha ao carregar importacao: ${importError.message}`,
    });
  }

  if (!importRow) {
    return res.status(404).json({
      error: 'Not found',
      message: 'Importacao nao encontrada para a empresa.',
    });
  }

  if (auth.contaBancariaId && importRow.conta_bancaria_id !== auth.contaBancariaId) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Importacao nao pertence a conta_bancaria_id informada.',
    });
  }

  if (importRow.parse_status !== 'parsed') {
    return res.status(409).json({
      error: 'Invalid state',
      message: `Importacao precisa estar em parsed. Status atual: ${importRow.parse_status}`,
      import_id: importRow.id,
      parse_status: importRow.parse_status,
      parse_error_message: importRow.error_message || null,
    });
  }

  const triggerResult = await triggerBankReconciliationAiWorkflow({
    adminClient,
    empresaId: auth.empresaId,
    contaBancariaId: importRow.conta_bancaria_id,
    extratoImportId: importId,
    initiatedByUserId: auth.userId,
    source:
      auth.mode === 'integration'
        ? 'bank_reconciliation_ai_trigger_integration'
        : 'bank_reconciliation_ai_trigger_manual',
    reason: auth.mode === 'integration' ? 'integration_trigger' : 'manual_retry',
  });

  return res.status(200).json({
    ok: triggerResult.triggered,
    import_id: importId,
    correlation_id: triggerResult.correlation_id || null,
    trigger: triggerResult,
  });
}
