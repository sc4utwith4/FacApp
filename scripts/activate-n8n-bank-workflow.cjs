#!/usr/bin/env node

const DEFAULT_N8N_BASE_URL = 'https://editor.epistemecompany.com.br';
const DEFAULT_WORKFLOW_ID = 'Y9g1a9ym7nkmv0dk';

const N8N_BASE_URL = (process.env.N8N_BASE_URL || DEFAULT_N8N_BASE_URL).replace(/\/$/, '');
const N8N_API_KEY = (process.env.N8N_API_KEY || '').trim();
const WORKFLOW_ID = (process.env.N8N_WORKFLOW_ID || DEFAULT_WORKFLOW_ID).trim();

const BANK_RECONCILIATION_APP_BASE_URL = (process.env.BANK_RECONCILIATION_APP_BASE_URL || '').trim();
const APP_BASE_URL = (process.env.APP_BASE_URL || '').trim();
const INTEGRATION_SECRET = (process.env.N8N_BANK_RECONCILIATION_INTEGRATION_SECRET || '').trim();

if (!N8N_API_KEY) {
  console.error('ERRO: N8N_API_KEY nao definida.');
  process.exit(1);
}

if (!WORKFLOW_ID) {
  console.error('ERRO: N8N_WORKFLOW_ID nao definido.');
  process.exit(1);
}

async function request(method, path, body) {
  const res = await fetch(`${N8N_BASE_URL}${path}`, {
    method,
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }

  return { ok: res.ok, status: res.status, json, text };
}

async function upsertVariable(key, value) {
  const list = await request('GET', '/api/v1/variables');
  if (!list.ok) {
    console.warn(`WARN variables API indisponivel (${list.status}). Configure ${key} manualmente no n8n.`);
    return false;
  }

  const rows = Array.isArray(list.json?.data) ? list.json.data : Array.isArray(list.json) ? list.json : [];
  const existing = rows.find((v) => String(v?.key || '') === key);

  if (existing?.id) {
    const upd = await request('PUT', `/api/v1/variables/${encodeURIComponent(existing.id)}`, {
      key,
      value,
    });

    if (!upd.ok) {
      console.warn(`WARN falha ao atualizar variavel ${key}: [${upd.status}] ${upd.text}`);
      return false;
    }

    console.log(`OK variavel n8n atualizada: ${key}`);
    return true;
  }

  const create = await request('POST', '/api/v1/variables', {
    key,
    value,
  });

  if (!create.ok) {
    console.warn(`WARN falha ao criar variavel ${key}: [${create.status}] ${create.text}`);
    return false;
  }

  console.log(`OK variavel n8n criada: ${key}`);
  return true;
}

async function main() {
  const wf = await request('GET', `/api/v1/workflows/${encodeURIComponent(WORKFLOW_ID)}`);
  if (!wf.ok) {
    throw new Error(`Workflow ${WORKFLOW_ID} nao encontrado: [${wf.status}] ${wf.text}`);
  }

  console.log(`OK workflow encontrado: ${wf.json?.name || WORKFLOW_ID}`);

  if (BANK_RECONCILIATION_APP_BASE_URL) {
    await upsertVariable('BANK_RECONCILIATION_APP_BASE_URL', BANK_RECONCILIATION_APP_BASE_URL);
  } else {
    console.log(
      'INFO BANK_RECONCILIATION_APP_BASE_URL nao informado; mantendo configuracao dedicada de conciliacao no n8n.'
    );
  }

  if (APP_BASE_URL) {
    await upsertVariable('APP_BASE_URL', APP_BASE_URL);
  } else {
    console.log('INFO APP_BASE_URL nao informado; mantendo configuracao atual do n8n.');
  }

  if (INTEGRATION_SECRET) {
    await upsertVariable('N8N_BANK_RECONCILIATION_INTEGRATION_SECRET', INTEGRATION_SECRET);
  } else {
    console.log('INFO N8N_BANK_RECONCILIATION_INTEGRATION_SECRET nao informado; mantendo configuracao atual do n8n.');
  }

  const activate = await request('POST', `/api/v1/workflows/${encodeURIComponent(WORKFLOW_ID)}/activate`);
  if (!activate.ok) {
    throw new Error(`Falha ao ativar workflow: [${activate.status}] ${activate.text}`);
  }

  console.log(`OK workflow ativado: ${WORKFLOW_ID}`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
