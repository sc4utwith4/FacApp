#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULT_WEBHOOK = 'https://workflow.epistemecompany.com.br/webhook/bank-reconciliation/ai-trigger';
const DEFAULT_TIMEOUT_MS = '30000';

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
  const value = String(raw || 'production');
  const out = value
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  const allowed = new Set(['production', 'preview', 'development']);
  const filtered = out.filter((t) => allowed.has(t));
  return filtered.length ? [...new Set(filtered)] : ['production'];
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

async function ensureEnv(token, base, teamParam, existing, key, value, targets) {
  const matches = existing.filter((envItem) => {
    const sameKey = String(envItem?.key || '') === key;
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
    key,
    value,
    type: 'encrypted',
    target: targets,
  });

  console.log(`OK env ${key} -> targets [${targets.join(', ')}]`);
}

function hasRequiredKey(existing, key, target) {
  return existing.some((envItem) => {
    if (String(envItem?.key || '') !== key) return false;
    const targets = (envItem?.target || []).map((t) => String(t).toLowerCase());
    return targets.includes(target);
  });
}

async function main() {
  const projectFile = path.join(process.cwd(), '.vercel', 'project.json');
  if (!fs.existsSync(projectFile)) {
    throw new Error('Arquivo .vercel/project.json nao encontrado. Rode `vercel link` primeiro.');
  }

  const { projectId, orgId, projectName } = readJson(projectFile);
  if (!projectId || !orgId) {
    throw new Error('projectId/orgId ausentes em .vercel/project.json.');
  }

  const token = String(process.env.VERCEL_TOKEN || getTokenFromAuthFile()).trim();
  if (!token) {
    throw new Error('VERCEL_TOKEN nao encontrado (nem no env nem no auth local da CLI).');
  }

  const webhookUrl = String(process.env.N8N_BANK_RECONCILIATION_WEBHOOK_URL || DEFAULT_WEBHOOK).trim();
  const integrationSecret = String(process.env.N8N_BANK_RECONCILIATION_INTEGRATION_SECRET || '').trim();
  const timeoutMs = String(process.env.N8N_BANK_RECONCILIATION_TIMEOUT_MS || DEFAULT_TIMEOUT_MS).trim();
  const disableBalanceMutation = String(
    process.env.BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION || 'true'
  ).trim();
  const targets = parseTargets(process.env.VERCEL_TARGETS);

  if (!integrationSecret) {
    throw new Error('N8N_BANK_RECONCILIATION_INTEGRATION_SECRET obrigatorio.');
  }

  if (!/^https:\/\//i.test(webhookUrl)) {
    throw new Error('N8N_BANK_RECONCILIATION_WEBHOOK_URL precisa ser URL https valida.');
  }

  const teamParam = `teamId=${encodeURIComponent(orgId)}`;
  const base = `https://api.vercel.com/v10/projects/${encodeURIComponent(projectId)}`;

  await apiRequest(token, 'GET', `https://api.vercel.com/v2/user`, null);

  const envList = await apiRequest(token, 'GET', `${base}/env?${teamParam}`, null);
  const existing = envList?.envs || [];

  await ensureEnv(token, base, teamParam, existing, 'N8N_BANK_RECONCILIATION_WEBHOOK_URL', webhookUrl, targets);
  await ensureEnv(token, base, teamParam, existing, 'N8N_BANK_RECONCILIATION_INTEGRATION_SECRET', integrationSecret, targets);
  await ensureEnv(token, base, teamParam, existing, 'N8N_BANK_RECONCILIATION_TIMEOUT_MS', timeoutMs, targets);
  await ensureEnv(
    token,
    base,
    teamParam,
    existing,
    'BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION',
    disableBalanceMutation,
    targets
  );
  await ensureEnv(
    token,
    base,
    teamParam,
    existing,
    'VITE_BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION',
    disableBalanceMutation,
    targets
  );

  const refreshed = await apiRequest(token, 'GET', `${base}/env?${teamParam}`, null);
  const refreshedEnvs = refreshed?.envs || [];

  const targetToCheck = targets[0];
  const mustHave = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];

  for (const key of mustHave) {
    const ok = hasRequiredKey(refreshedEnvs, key, targetToCheck);
    console.log(`${ok ? 'OK' : 'WARN'} baseline env ${key} on ${targetToCheck}`);
  }

  console.log(`\nVercel envs BANK RECONCILIATION atualizadas no projeto ${projectName || projectId}.`);
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
