const fs = require('fs');
const path = require('path');

const N8N_BASE_URL = (process.env.N8N_BASE_URL || 'https://editor.epistemecompany.com.br').replace(/\/$/, '');
const N8N_API_KEY = process.env.N8N_API_KEY;
const WORKFLOW_FILE = process.env.N8N_WORKFLOW_FILE || path.join(__dirname, '../workflows/bank-reconciliation-ai-suggestions.json');
const WORKFLOW_NAME_OVERRIDE = (process.env.N8N_WORKFLOW_NAME || '').trim();
const WORKFLOW_ID_OVERRIDE = (process.env.N8N_WORKFLOW_ID || '').trim();

if (!N8N_API_KEY) {
  console.error('ERRO: N8N_API_KEY nao definida.');
  process.exit(1);
}

if (!fs.existsSync(WORKFLOW_FILE)) {
  console.error(`ERRO: arquivo de workflow nao encontrado: ${WORKFLOW_FILE}`);
  process.exit(1);
}

const workflowJson = JSON.parse(fs.readFileSync(WORKFLOW_FILE, 'utf8'));
const workflowName = WORKFLOW_NAME_OVERRIDE || workflowJson.name;

if (!workflowName) {
  console.error('ERRO: workflow sem nome. Defina N8N_WORKFLOW_NAME ou inclua "name" no JSON.');
  process.exit(1);
}

const headers = {
  'X-N8N-API-KEY': N8N_API_KEY,
  'Content-Type': 'application/json',
};

async function n8nRequest(method, endpoint, body) {
  const response = await fetch(`${N8N_BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text().catch(() => '');
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    throw new Error(`N8N ${method} ${endpoint} -> ${response.status}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
  }

  return parsed;
}

async function findWorkflowIdByName(name) {
  const result = await n8nRequest('GET', '/api/v1/workflows?limit=250');
  const data = Array.isArray(result?.data) ? result.data : [];
  const found = data.find((item) => item?.name === name);
  return found?.id ? String(found.id) : null;
}

function buildUpsertPayload() {
  const payload = { ...workflowJson };
  delete payload.id;
  delete payload.active;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.versionId;
  delete payload.tags;
  delete payload.n8n_workflow_id;
  return payload;
}

(async () => {
  try {
    const payload = buildUpsertPayload();
    let workflowId = WORKFLOW_ID_OVERRIDE;

    if (!workflowId) {
      workflowId = await findWorkflowIdByName(workflowName);
    }

    let result;
    if (workflowId) {
      console.log(`Atualizando workflow existente [${workflowId}] ${workflowName}`);
      result = await n8nRequest('PUT', `/api/v1/workflows/${workflowId}`, payload);
    } else {
      console.log(`Criando novo workflow ${workflowName}`);
      result = await n8nRequest('POST', '/api/v1/workflows', payload);
    }

    console.log('Workflow publicado com sucesso.');
    console.log(JSON.stringify({ id: result?.id || workflowId || null, name: result?.name || workflowName }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Falha ao publicar workflow:', message);
    process.exit(1);
  }
})();
