#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const { config: loadEnv } = require('dotenv');

loadEnv({ path: '.env.local', override: true });
loadEnv({ path: '.env', override: false });

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Env obrigatoria ausente: ${name}`);
  }
  return value;
};

const optional = (name, fallback = '') => String(process.env[name] || fallback).trim();

const supabaseUrl = required('VITE_SUPABASE_URL');
const supabaseAnonKey = required('VITE_SUPABASE_PUBLISHABLE_KEY');
const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
const qaEmail = required('BANK_RECONCILIATION_QA_EMAIL');
const qaPassword = required('BANK_RECONCILIATION_QA_PASSWORD');
const apiBaseUrl = optional('BANK_RECONCILIATION_API_BASE_URL', `http://127.0.0.1:${optional('BANK_RECONCILIATION_API_PORT', '3100')}`);
const webBaseUrl = optional('BANK_RECONCILIATION_WEB_BASE_URL');

const fail = (message) => {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
};

const logOk = (message) => console.log(`[OK] ${message}`);
const logInfo = (message) => console.log(`[INFO] ${message}`);

async function authenticate() {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ email: qaEmail, password: qaPassword }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(`Falha no login QA (${response.status}): ${payload?.msg || payload?.error_description || payload?.error || 'sem detalhe'}`);
  }

  return String(payload.access_token);
}

async function resolveQaContext(accessToken) {
  const authResp = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const authJson = await authResp.json().catch(() => null);
  if (!authResp.ok || !authJson?.id) {
    throw new Error(`Falha ao resolver usuario QA (${authResp.status})`);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('empresa_id')
    .eq('id', authJson.id)
    .maybeSingle();

  if (profileError || !profile?.empresa_id) {
    throw new Error(`Falha ao resolver empresa QA: ${profileError?.message || 'empresa_id ausente'}`);
  }

  const { data: conta, error: contaError } = await admin
    .from('contas_bancarias')
    .select('id, descricao')
    .eq('empresa_id', profile.empresa_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (contaError || !conta?.id) {
    throw new Error(`Falha ao resolver conta QA: ${contaError?.message || 'conta ausente'}`);
  }

  return {
    userId: authJson.id,
    empresaId: profile.empresa_id,
    contaId: conta.id,
    contaLabel: conta.descricao || conta.id,
    dataReferencia: new Date().toISOString().slice(0, 10),
  };
}

async function expectStatus(url, expectedStatus, headers = {}) {
  const response = await fetch(url, { headers });
  const text = await response.text().catch(() => '');
  if (response.status !== expectedStatus) {
    throw new Error(`${url} retornou ${response.status}, esperado ${expectedStatus}. Body: ${text.slice(0, 300)}`);
  }
  return text;
}

async function smokeBase(baseUrl, accessToken, context, label) {
  logInfo(`Smoke ${label}: ${baseUrl}`);

  await expectStatus(`${baseUrl}/api/bank-statement/rules`, 401);
  await expectStatus(`${baseUrl}/api/bank-statement/chat/sessions?limit=5`, 401);
  await expectStatus(
    `${baseUrl}/api/bank-statement/daily/summary?conta_bancaria_id=${encodeURIComponent(context.contaId)}&data_referencia=${encodeURIComponent(context.dataReferencia)}`,
    401
  );
  logOk(`${label} sem token retorna 401 nas rotas base`);

  const authHeaders = {
    Authorization: `Bearer ${accessToken}`,
  };

  await expectStatus(`${baseUrl}/api/bank-statement/rules`, 200, authHeaders);
  await expectStatus(`${baseUrl}/api/bank-statement/chat/sessions?limit=5`, 200, authHeaders);
  await expectStatus(
    `${baseUrl}/api/bank-statement/daily/summary?conta_bancaria_id=${encodeURIComponent(context.contaId)}&data_referencia=${encodeURIComponent(context.dataReferencia)}`,
    200,
    authHeaders
  );
  logOk(`${label} autenticado retorna 200 em rules/chat-sessions/daily-summary`);
}

(async () => {
  try {
    logInfo(`API base configurada: ${apiBaseUrl}`);
    if (webBaseUrl) {
      logInfo(`Frontend base configurado: ${webBaseUrl}`);
    } else {
      logInfo('BANK_RECONCILIATION_WEB_BASE_URL ausente: smoke via proxy do frontend sera pulado');
    }

    const accessToken = await authenticate();
    logOk('Login QA validado no Supabase');

    const context = await resolveQaContext(accessToken);
    logOk(`Contexto QA resolvido: conta ${context.contaLabel} em ${context.dataReferencia}`);

    await smokeBase(apiBaseUrl, accessToken, context, 'API local');

    if (webBaseUrl) {
      await smokeBase(webBaseUrl, accessToken, context, 'Proxy frontend');
    }

    logOk('Smoke local da conciliacao bancaria concluido');
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
})();
