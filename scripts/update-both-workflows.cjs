#!/usr/bin/env node

/**
 * Script para ATUALIZAR ambos os workflows no n8n via API HTTP (API v1).
 *
 * Requer:
 *  - N8N_URL: URL do n8n (padrão: https://editor.epistemecompany.com.br)
 *  - N8N_API_KEY: API Key do n8n
 */

const fs = require('fs');
const path = require('path');

/**
 * Carrega variáveis de ambiente de `.env.local` e `.env` (se existirem).
 */
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

const WORKFLOWS = [
  {
    name: 'ASSFAC AI Assistant',
    path: path.join(__dirname, '..', 'workflows', 'assfac-ai-assistant.json'),
  },
  {
    name: 'ASSFAC AI Assistant API',
    path: path.join(__dirname, '..', 'workflows', 'assfac-ai-assistant-api.json'),
  },
  {
    name: 'Bank Reconciliation AI Suggestions',
    path: path.join(__dirname, '..', 'workflows', 'bank-reconciliation-ai-suggestions.json'),
  },
];

async function request(url, options) {
  const res = await fetch(url, options);
  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore parse errors
  }
  return { res, text, json };
}

async function updateWorkflow(workflowName, workflowPath) {
  console.log(`\n📖 Processando: ${workflowName}...`);
  const workflowJson = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));

  console.log(`🔍 Buscando workflow por nome: "${workflowName}"...`);
  const { res, json, text } = await request(`${N8N_URL}/api/v1/workflows`, {
    method: 'GET',
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Falha ao listar workflows: ${res.status} - ${text.substring(0, 200)}`);
  }

  const list = json?.data || [];
  const matches = list.filter((w) => w?.name === workflowName || w?.name === workflowJson.name);
  if (!matches.length) {
    console.log(`⚠️  Workflow "${workflowName}" não encontrado no n8n. Pulando...`);
    return false;
  }

  const active = matches.find((w) => w?.active);
  const sortedByUpdated = [...matches].sort((a, b) => {
    const ta = Date.parse(a?.updatedAt || a?.createdAt || 0) || 0;
    const tb = Date.parse(b?.updatedAt || b?.createdAt || 0) || 0;
    return tb - ta;
  });
  const picked = active || sortedByUpdated[0];

  if (matches.length > 1) {
    console.log('⚠️  Aviso: múltiplos workflows encontrados. Selecionando automaticamente:');
    console.log(
      matches
        .map((w) => `- id=${w.id} active=${!!w.active} updatedAt=${w.updatedAt || 'n/a'}`)
        .join('\n'),
    );
    console.log(`➡️  Selecionado: id=${picked.id} (active=${!!picked.active})`);
  }

  const workflowId = picked.id;
  console.log(`🛠️  Atualizando workflow (id=${workflowId})...`);

  const payload = {
    name: workflowJson.name,
    nodes: workflowJson.nodes,
    connections: workflowJson.connections,
    settings: workflowJson.settings,
  };

  const { res: updateRes, text: updateText } = await request(
    `${N8N_URL}/api/v1/workflows/${encodeURIComponent(workflowId)}`,
    {
      method: 'PUT',
      headers: {
        'X-N8N-API-KEY': N8N_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  if (!updateRes.ok) {
    throw new Error(`Falha ao atualizar workflow: ${updateRes.status} - ${updateText.substring(0, 500)}`);
  }

  console.log(`✅ Workflow "${workflowName}" atualizado com sucesso.`);
  return true;
}

async function main() {
  if (!N8N_API_KEY) {
    console.error('❌ Erro: N8N_API_KEY não configurada');
    console.error('Defina a variável de ambiente N8N_API_KEY e execute novamente.');
    console.error('\nPara obter a API Key:');
    console.error('1. Acesse o n8n: https://editor.epistemecompany.com.br');
    console.error('2. Vá em Settings → API');
    console.error('3. Crie uma nova API Key');
    console.error('4. Execute: export N8N_API_KEY="sua-api-key"');
    console.error('5. Execute novamente este script');
    process.exit(1);
  }

  console.log('🚀 Iniciando atualização de workflows...');
  console.log(`📍 URL do n8n: ${N8N_URL}`);

  let successCount = 0;
  for (const workflow of WORKFLOWS) {
    try {
      const success = await updateWorkflow(workflow.name, workflow.path);
      if (success) successCount++;
    } catch (err) {
      console.error(`❌ Erro ao atualizar "${workflow.name}":`, err?.message || err);
    }
  }

  console.log(`\n✅ Concluído! ${successCount}/${WORKFLOWS.length} workflows atualizados.`);
}

main().catch((err) => {
  console.error('❌ Erro:', err?.message || err);
  process.exit(1);
});
