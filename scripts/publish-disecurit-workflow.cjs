#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;

    const key = trimmed.slice(0, idx).trim();
    if (!key) continue;
    if (process.env[key] !== undefined && process.env[key] !== '') continue;

    let value = trimmed.slice(idx + 1).trim();

    if (value && !value.startsWith('"') && !value.startsWith("'")) {
      const hashIdx = value.indexOf(' #');
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function loadDotEnv() {
  const root = path.join(__dirname, '..');
  loadEnvFile(path.join(root, '.env.local'));
  loadEnvFile(path.join(root, '.env'));
}

loadDotEnv();

const N8N_URL = process.env.N8N_URL || 'https://editor.epistemecompany.com.br';
const N8N_API_KEY = process.env.N8N_API_KEY || '';
const N8N_WORKFLOW_ID = process.env.N8N_DISECURIT_WORKFLOW_ID || 'ygvj8117DyXCFXJR';
const WORKFLOW_PATH = path.join(__dirname, '..', 'workflows', 'disecurit-pdf-import-fase1.json');

async function request(url, options) {
  const res = await fetch(url, options);
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  return { res, text, json };
}

async function main() {
  if (!N8N_API_KEY) {
    console.error('Erro: N8N_API_KEY não configurada.');
    process.exit(1);
  }

  if (!fs.existsSync(WORKFLOW_PATH)) {
    console.error('Erro: workflow não encontrado em', WORKFLOW_PATH);
    process.exit(1);
  }

  const workflowJson = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

  const payload = {
    name: workflowJson.name,
    nodes: workflowJson.nodes,
    connections: workflowJson.connections,
    settings: workflowJson.settings || {},
  };

  const { res, text } = await request(`${N8N_URL}/api/v1/workflows/${encodeURIComponent(N8N_WORKFLOW_ID)}`, {
    method: 'PUT',
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Falha ao atualizar workflow (${res.status}): ${text.slice(0, 500)}`);
  }

  const activationResp = await request(`${N8N_URL}/api/v1/workflows/${encodeURIComponent(N8N_WORKFLOW_ID)}/activate`, {
    method: 'POST',
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!activationResp.res.ok && activationResp.res.status !== 400) {
    throw new Error(
      `Falha ao ativar workflow (${activationResp.res.status}): ${activationResp.text.slice(0, 500)}`
    );
  }

  console.log('Workflow DISECURIT publicado com sucesso no n8n.');
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
