#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_WEBHOOK = 'https://workflow.epistemecompany.com.br/webhook/disecurit/import-fase1';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getTokenFromAuthFile() {
  const authPath = path.join(process.env.HOME || '', 'Library', 'Application Support', 'com.vercel.cli', 'auth.json');
  if (!fs.existsSync(authPath)) return '';
  try {
    const auth = readJson(authPath);
    return String(auth?.token || '').trim();
  } catch {
    return '';
  }
}

function parseTargets(raw) {
  const value = String(raw || 'production,preview');
  const out = value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const allowed = new Set(['production', 'preview', 'development']);
  const filtered = out.filter((t) => allowed.has(t));
  return filtered.length ? [...new Set(filtered)] : ['production', 'preview'];
}

async function apiRequest(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text().catch(() => '');
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const detail = json?.error?.message || text || `HTTP ${res.status}`;
    throw new Error(`[${res.status}] ${detail}`);
  }

  return json;
}

function intersects(targetsA, targetsB) {
  const a = new Set((targetsA || []).map((t) => String(t).toLowerCase()));
  return (targetsB || []).some((t) => a.has(String(t).toLowerCase()));
}

async function main() {
  const projectFile = path.join(process.cwd(), '.vercel', 'project.json');
  if (!fs.existsSync(projectFile)) {
    throw new Error('Arquivo .vercel/project.json não encontrado. Rode `vercel link` primeiro.');
  }

  const { projectId, orgId, projectName } = readJson(projectFile);
  if (!projectId || !orgId) {
    throw new Error('projectId/orgId ausentes em .vercel/project.json.');
  }

  const token = String(process.env.VERCEL_TOKEN || getTokenFromAuthFile()).trim();
  if (!token) {
    throw new Error('VERCEL_TOKEN não encontrado (nem no env nem no auth local da CLI).');
  }

  const importWebhook = String(process.env.N8N_DISECURIT_IMPORT_WEBHOOK_URL || DEFAULT_WEBHOOK).trim();
  const reprocessWebhook = String(process.env.N8N_DISECURIT_REPROCESS_WEBHOOK_URL || importWebhook).trim();
  const integrationSecret = String(process.env.N8N_DISECURIT_INTEGRATION_SECRET || '').trim();
  const targets = parseTargets(process.env.VERCEL_TARGETS);

  if (!integrationSecret) {
    throw new Error('N8N_DISECURIT_INTEGRATION_SECRET obrigatório para configurar a Vercel.');
  }

  const teamParam = `teamId=${encodeURIComponent(orgId)}`;
  const base = `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}`;

  await apiRequest(token, 'GET', `https://api.vercel.com/v2/user`, null);

  const envList = await apiRequest(token, 'GET', `${base}/env?${teamParam}`, null);
  const existing = envList?.envs || [];

  const desired = [
    { key: 'N8N_DISECURIT_IMPORT_WEBHOOK_URL', value: importWebhook },
    { key: 'N8N_DISECURIT_REPROCESS_WEBHOOK_URL', value: reprocessWebhook },
    { key: 'N8N_DISECURIT_INTEGRATION_SECRET', value: integrationSecret },
  ];

  for (const item of desired) {
    const matches = existing.filter((envItem) => {
      const sameKey = String(envItem?.key || '') === item.key;
      const envTargets = envItem?.target || [];
      return sameKey && intersects(envTargets, targets);
    });

    for (const match of matches) {
      await apiRequest(
        token,
        'DELETE',
        `${base}/env/${encodeURIComponent(match.id)}?${teamParam}`,
        null
      );
    }

    await apiRequest(token, 'POST', `${base}/env?${teamParam}`, {
      key: item.key,
      value: item.value,
      type: 'encrypted',
      target: targets,
    });

    console.log(`OK env ${item.key} -> targets [${targets.join(', ')}]`);
  }

  console.log(`\nVercel envs DISECURIT atualizadas no projeto ${projectName || projectId}.`);
  console.log('Próximo passo: fazer deploy (ex.: npx vercel deploy --prod --yes --token $VERCEL_TOKEN).');
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
