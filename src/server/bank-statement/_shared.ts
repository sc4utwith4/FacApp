import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[] | undefined>;
}

export interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => void;
}

export interface AuthContext {
  userId: string;
  empresaId: string;
  accessToken: string;
}

export function getErrorMessage(error: unknown, fallback = 'Erro inesperado'): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

export function getHeaderValue(req: VercelRequest, headerName: string): string | null {
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

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function parseJsonBody(req: VercelRequest): unknown {
  if (typeof req.body === 'string') {
    return JSON.parse(req.body);
  }
  return req.body;
}

const readFirstHeaderToken = (value: string | null): string | null => {
  if (!value) return null;
  const token = String(value)
    .split(',')
    .map((item) => item.trim())
    .find(Boolean);
  return token || null;
};

const extractHostnameFromHostHeader = (hostHeader: string): string => {
  const candidate = String(hostHeader || '').trim();
  if (!candidate) return '';

  try {
    return new URL(`http://${candidate}`).hostname.toLowerCase();
  } catch {
    const normalized = candidate.replace(/^\[/, '').replace(/\]$/, '');
    return normalized.split(':')[0]?.toLowerCase() || normalized.toLowerCase();
  }
};

const isLikelyLocalHost = (hostHeader: string): boolean => {
  const hostname = extractHostnameFromHostHeader(hostHeader);
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
};

export function resolveInternalApiBaseUrlFromRequest(
  req: VercelRequest,
  options?: { missingHostMessage?: string }
): string {
  const forwardedHost =
    readFirstHeaderToken(getHeaderValue(req, 'x-forwarded-host')) ||
    readFirstHeaderToken(getHeaderValue(req, 'host'));

  if (!forwardedHost) {
    throw new Error(options?.missingHostMessage || 'Nao foi possivel resolver host da requisicao.');
  }

  const forwardedProto = readFirstHeaderToken(getHeaderValue(req, 'x-forwarded-proto'))?.toLowerCase() || null;
  const protocol =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : isLikelyLocalHost(forwardedHost)
        ? 'http'
        : 'https';

  return `${protocol}://${forwardedHost}`;
}

export function getSupabaseUrl(): string {
  return process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
}

export function getSupabaseAnonKey(): string {
  return process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
}

export function getSupabaseServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    ''
  );
}

export function getBankReconciliationIntegrationSecret(): string {
  return (
    process.env.N8N_BANK_RECONCILIATION_INTEGRATION_SECRET ||
    process.env.BANK_RECONCILIATION_INTEGRATION_SECRET ||
    ''
  );
}

export function getBankReconciliationWebhookUrl(): string {
  return (
    process.env.N8N_BANK_RECONCILIATION_WEBHOOK_URL ||
    process.env.BANK_RECONCILIATION_WEBHOOK_URL ||
    ''
  );
}

export function getBankReconciliationWebhookTimeoutMs(): number {
  const fallback = 15000;
  const raw = Number(process.env.N8N_BANK_RECONCILIATION_TIMEOUT_MS || process.env.BANK_RECONCILIATION_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(raw, 120000);
}

export function isBankReconciliationBalanceMutationDisabled(): boolean {
  const raw = String(
    process.env.BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION ||
    process.env.N8N_BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION ||
    'true'
  )
    .trim()
    .toLowerCase();

  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') {
    return false;
  }

  return true;
}

export function isBankReconciliationOfxOnlyEnabled(): boolean {
  const raw = String(
    process.env.BANK_RECONCILIATION_IMPORT_OFX_ONLY ||
    process.env.N8N_BANK_RECONCILIATION_IMPORT_OFX_ONLY ||
    'true'
  )
    .trim()
    .toLowerCase();

  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') {
    return false;
  }

  return true;
}

export function getBankReconciliationChatWebhookUrl(): string {
  return (
    process.env.N8N_BANK_RECONCILIATION_CHAT_WEBHOOK_URL ||
    process.env.BANK_RECONCILIATION_CHAT_WEBHOOK_URL ||
    ''
  );
}

export function getBankReconciliationChatIntegrationSecret(): string {
  return (
    process.env.N8N_BANK_RECONCILIATION_CHAT_INTEGRATION_SECRET ||
    process.env.BANK_RECONCILIATION_CHAT_INTEGRATION_SECRET ||
    process.env.N8N_BANK_RECONCILIATION_INTEGRATION_SECRET ||
    process.env.BANK_RECONCILIATION_INTEGRATION_SECRET ||
    ''
  );
}

export function getBankReconciliationAgentWebhookUrl(): string {
  return (
    process.env.N8N_BANK_RECONCILIATION_AGENT_WEBHOOK_URL ||
    process.env.BANK_RECONCILIATION_AGENT_WEBHOOK_URL ||
    getBankReconciliationChatWebhookUrl()
  );
}

export function getBankReconciliationAgentIntegrationSecret(): string {
  return (
    process.env.N8N_BANK_RECONCILIATION_AGENT_INTEGRATION_SECRET ||
    process.env.BANK_RECONCILIATION_AGENT_INTEGRATION_SECRET ||
    getBankReconciliationChatIntegrationSecret()
  );
}

export type BankReconciliationChatAgentMode = 'off' | 'assist' | 'full';

export function getBankReconciliationChatAgentMode(): BankReconciliationChatAgentMode {
  const raw = String(
    process.env.BANK_RECONCILIATION_CHAT_AGENT_MODE ||
    process.env.N8N_BANK_RECONCILIATION_CHAT_AGENT_MODE ||
    ''
  )
    .trim()
    .toLowerCase();

  if (raw === 'off' || raw === 'assist' || raw === 'full') {
    return raw;
  }

  // Default conservador: agente apenas assistivo, sem tomar o fluxo operacional principal.
  return 'assist';
}

export function getBankReconciliationChatTimeoutMs(): number {
  const fallback = 15000;
  const raw = Number(
    process.env.BANK_RECONCILIATION_CHAT_TIMEOUT_MS ||
    process.env.N8N_BANK_RECONCILIATION_CHAT_TIMEOUT_MS
  );
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(raw, 120000);
}

export function getRuntimeBuildId(): string {
  const raw = String(
    process.env.BANK_RECONCILIATION_BUILD_ID ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.GIT_COMMIT_SHA ||
    ''
  ).trim();

  if (raw) return raw;
  return 'runtime-dev';
}

const readCsvEnvValues = (...envValues: Array<string | undefined>): string[] => {
  const raw = envValues.find((value) => Boolean(value && String(value).trim()));
  if (!raw) return [];
  return String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

export interface BankReconciliationPilotGateResult {
  enabled: boolean;
  allowed: boolean;
  reason: string | null;
}

export function validateBankReconciliationPilotScope(
  empresaId: string,
  contaBancariaId: string
): BankReconciliationPilotGateResult {
  const pilotEmpresaId = String(
    process.env.BANK_RECONCILIATION_PILOT_EMPRESA_ID ||
    process.env.N8N_BANK_RECONCILIATION_PILOT_EMPRESA_ID ||
    ''
  ).trim();

  const pilotContaIds = new Set(
    readCsvEnvValues(
      process.env.BANK_RECONCILIATION_PILOT_CONTA_IDS,
      process.env.N8N_BANK_RECONCILIATION_PILOT_CONTA_IDS
    )
  );

  const enabled = Boolean(pilotEmpresaId || pilotContaIds.size > 0);
  if (!enabled) {
    return {
      enabled: false,
      allowed: true,
      reason: null,
    };
  }

  if (pilotEmpresaId && empresaId !== pilotEmpresaId) {
    return {
      enabled: true,
      allowed: false,
      reason: 'empresa fora do escopo configurado',
    };
  }

  if (pilotContaIds.size > 0 && !pilotContaIds.has(contaBancariaId)) {
    return {
      enabled: true,
      allowed: false,
      reason: 'conta fora do escopo configurado',
    };
  }

  return {
    enabled: true,
    allowed: true,
    reason: null,
  };
}

export function getAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function verifyTokenAndGetEmpresaId(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): Promise<AuthContext> {
  const userResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!userResp.ok) {
    throw new Error('Sessao invalida');
  }

  const user = await userResp.json().catch(() => null);
  const userId = user?.id;
  if (!userId) {
    throw new Error('Usuario invalido');
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
    throw new Error('Nao foi possivel identificar empresa');
  }

  const profiles = await profileResp.json().catch(() => []);
  const empresaId = Array.isArray(profiles) ? profiles[0]?.empresa_id : profiles?.empresa_id;

  if (!empresaId) {
    throw new Error('Empresa nao encontrada para o usuario');
  }

  return {
    userId,
    empresaId,
    accessToken,
  };
}

export async function callUserRpc(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string,
  rpcName: string,
  payload: Record<string, unknown>
): Promise<{ data: unknown; error: string | null; status: number }> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text().catch(() => '');
  let parsed: unknown = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const parsedRecord = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    const errorMessage =
      (parsedRecord?.message as string) ||
      (parsedRecord?.error_description as string) ||
      (parsedRecord?.hint as string) ||
      text ||
      'Erro RPC';
    return {
      data: null,
      error: errorMessage,
      status: response.status,
    };
  }

  return {
    data: parsed,
    error: null,
    status: response.status,
  };
}

export function extractIntegrationSecret(req: VercelRequest): string | null {
  return getHeaderValue(req, 'x-integration-secret');
}

export function isValidIntegrationSecret(req: VercelRequest, expectedSecret: string): boolean {
  const provided = extractIntegrationSecret(req);
  if (!provided || !expectedSecret) return false;
  return provided === expectedSecret;
}

export interface IntegrationScope {
  empresaId: string;
  contaBancariaId: string | null;
  importId: string | null;
}

export function parseIntegrationScope(
  body: Record<string, unknown>,
  options?: { requireContaBancariaId?: boolean; requireImportId?: boolean }
): { scope: IntegrationScope | null; error: string | null } {
  const requireContaBancariaId = options?.requireContaBancariaId === true;
  const requireImportId = options?.requireImportId === true;

  const empresaId = String(body?.empresa_id || '').trim();
  const contaBancariaId = String(body?.conta_bancaria_id || '').trim() || null;
  const importId =
    String(body?.extrato_import_id || '').trim() ||
    String(body?.import_id || '').trim() ||
    null;

  if (!empresaId) {
    return {
      scope: null,
      error: 'empresa_id obrigatorio para chamada de integracao.',
    };
  }

  if (requireContaBancariaId && !contaBancariaId) {
    return {
      scope: null,
      error: 'conta_bancaria_id obrigatorio para chamada de integracao.',
    };
  }

  if (requireImportId && !importId) {
    return {
      scope: null,
      error: 'extrato_import_id/import_id obrigatorio para chamada de integracao.',
    };
  }

  return {
    scope: {
      empresaId,
      contaBancariaId,
      importId,
    },
    error: null,
  };
}

export function isEmpresaHeaderConsistent(req: VercelRequest, empresaId: string): boolean {
  const headerEmpresa = String(getHeaderValue(req, 'x-empresa-id') || '').trim();
  if (!headerEmpresa) return true;
  return headerEmpresa === empresaId;
}

interface BankAuditLogInput {
  empresa_id: string;
  action: string;
  status?: 'info' | 'success' | 'warning' | 'error';
  message?: string | null;
  extrato_import_id?: string | null;
  extrato_transacao_id?: string | null;
  conciliacao_id?: string | null;
  details?: Record<string, unknown>;
  created_by?: string | null;
}

export async function safeInsertBankAuditLog(
  adminClient: SupabaseClient,
  input: BankAuditLogInput
): Promise<void> {
  try {
    await adminClient.from('bank_reconciliation_audit_log').insert({
      empresa_id: input.empresa_id,
      action: input.action,
      status: input.status || 'info',
      message: input.message || null,
      extrato_import_id: input.extrato_import_id || null,
      extrato_transacao_id: input.extrato_transacao_id || null,
      conciliacao_id: input.conciliacao_id || null,
      details: input.details || {},
      created_by: input.created_by || null,
    });
  } catch (error) {
    console.error('[bank-reconciliation][audit-log]', error);
  }
}
