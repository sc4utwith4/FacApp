#!/usr/bin/env node

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = new Set(process.argv.slice(2));
const scanAll = args.has('--all');

const EXT_ALLOWLIST = new Set([
  '.md',
  '.txt',
  '.html',
  '.json',
  '.yaml',
  '.yml',
  '.env',
  '.cjs',
  '.mjs',
  '.js',
  '.ts',
  '.tsx',
  '.sh',
  '.toml',
]);

const PATH_DENYLIST = [
  'node_modules/',
  '.git/',
  'dist/',
  'coverage/',
  '.next/',
  'build/',
  'playwright-report/',
  'test-results/',
  'supabase/.temp/',
  'scripts/__tests__/',
];

const SECRET_ASSIGNMENT_KEYS = [
  'N8N_API_KEY',
  'VERCEL_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'N8N_BANK_RECONCILIATION_INTEGRATION_SECRET',
  'N8N_DISECURIT_INTEGRATION_SECRET',
  'BANK_RECONCILIATION_QA_PASSWORD',
  'DB_PASSWORD',
  'STORAGE_KEY',
];

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function unique(list) {
  return Array.from(new Set(list));
}

function isAllowedFile(filePath) {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  if (PATH_DENYLIST.some((prefix) => normalized.startsWith(prefix))) return false;

  const base = path.basename(normalized);
  if (base.startsWith('.env')) return true;

  if (!path.extname(base)) {
    const extensionlessAllowlist = new Set(['ContextoCodex', 'ContextoConversa']);
    if (extensionlessAllowlist.has(base)) return true;
  }

  return EXT_ALLOWLIST.has(path.extname(base));
}

function getCandidateFiles() {
  if (scanAll) {
    return run('git ls-files');
  }

  const fromBase = process.env.SECURITY_SCAN_DIFF_BASE?.trim();
  if (fromBase) {
    try {
      return run(`git diff --name-only --diff-filter=ACMRTUXB ${fromBase}...HEAD`);
    } catch {
      // Fallback to local diff when merge-base ref is unavailable.
    }
  }

  const changed = run('git diff --name-only --diff-filter=ACMRTUXB');
  const staged = run('git diff --name-only --cached --diff-filter=ACMRTUXB');
  const untracked = run('git ls-files --others --exclude-standard');
  return unique([...changed, ...staged, ...untracked]);
}

function looksLikePlaceholder(value) {
  if (!value) return true;
  const normalized = value.trim();
  if (!normalized) return true;
  const normalizedUpper = normalized.toUpperCase();

  const placeholderTokens = [
    '[REDACTED]',
    '[REDACTED_TOKEN]',
    '[REDACTED_EMAIL]',
    '***REDACTED***',
    '<REDACTED>',
    '<novo>',
    '<mesmo valor do n8n>',
    '<mesmo do n8n>',
    '<SEU_SECRET',
    'SEU_SECRET',
    'SEU_SEGREDO',
    'SEU_',
    'SEU_TOKEN',
    'SUA_SERVICE_ROLE_KEY',
    'SUA-SERVICE-ROLE-KEY',
    'SUA_CHAVE_SERVICE_ROLE',
    'SUA_CHAVE',
    'SUA_KEY',
    'NOVO_SECRET',
    'MESMO_SECRET',
    'YOUR_',
    'SuaSenha@',
    'example',
  ];

  if (placeholderTokens.some((token) => normalizedUpper.includes(token.toUpperCase()))) {
    return true;
  }

  if (normalized.startsWith('$') || normalized.includes('${')) {
    return true;
  }

  return false;
}

function hasSecretShape(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  if (looksLikePlaceholder(trimmed)) return false;
  if (trimmed.startsWith('process.env.')) return false;
  if (trimmed.length < 20) return false;
  if (!/^[A-Za-z0-9._:/\\-]+$/.test(trimmed)) return false;

  const hasUpper = /[A-Z]/.test(trimmed);
  const hasLower = /[a-z]/.test(trimmed);
  const hasNumber = /[0-9]/.test(trimmed);
  const hasSpecial = /[._:/\\-]/.test(trimmed);
  const bucketCount = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

  return bucketCount >= 2;
}

function scanLine(filePath, line, lineNumber) {
  const findings = [];

  const jwtRegex = /(?:^|[^A-Za-z0-9_-])(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/g;
  if (jwtRegex.test(line)) {
    findings.push({
      filePath,
      lineNumber,
      reason: 'JWT/token em claro detectado',
    });
  }

  if (/\bEmail:\s*[^\s]+@gmail\.com\b/i.test(line)) {
    findings.push({
      filePath,
      lineNumber,
      reason: 'Email pessoal em texto livre detectado',
    });
  }

  const senhaMatch = line.match(/\bSenha:\s*(.+)$/i);
  const senhaValue = String(senhaMatch?.[1] || '').trim();
  const looksLikeRealPassword =
    senhaValue &&
    !looksLikePlaceholder(senhaValue) &&
    !/\s/.test(senhaValue) &&
    /[A-Za-z]/.test(senhaValue) &&
    /[0-9]/.test(senhaValue) &&
    /[^A-Za-z0-9]/.test(senhaValue);

  if (looksLikeRealPassword) {
    findings.push({
      filePath,
      lineNumber,
      reason: 'Senha em claro detectada',
    });
  }

  for (const key of SECRET_ASSIGNMENT_KEYS) {
    const assignRegex = new RegExp(`\\b${key}\\s*[:=]\\s*(["']?)([^"'\\s]+)\\1`);
    const match = line.match(assignRegex);
    if (!match) continue;

    const value = String(match[2] || '').trim();
    if (hasSecretShape(value)) {
      findings.push({
        filePath,
        lineNumber,
        reason: `${key} com valor potencialmente sensível`,
      });
    }
  }

  const integrationSecretHeaderMatch = line.match(/x-integration-secret\s*[:=]\s*(["']?)([^"'\s]+)\1/i);
  if (integrationSecretHeaderMatch && hasSecretShape(integrationSecretHeaderMatch[2])) {
    findings.push({
      filePath,
      lineNumber,
      reason: 'Header x-integration-secret com valor explícito',
    });
  }

  return findings;
}

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const findings = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    findings.push(...scanLine(filePath, lines[idx], idx + 1));
  }

  return findings;
}

function main() {
  const files = getCandidateFiles().filter(isAllowedFile);

  if (files.length === 0) {
    console.log('[security:scan-secrets] Nenhum arquivo elegível para varredura incremental.');
    return;
  }

  const findings = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    try {
      findings.push(...scanFile(file));
    } catch (error) {
      console.warn(`[security:scan-secrets] Aviso: falha ao ler ${file}: ${error.message}`);
    }
  }

  if (findings.length === 0) {
    console.log(`[security:scan-secrets] OK - ${files.length} arquivo(s) verificados sem segredos em claro.`);
    return;
  }

  console.error('[security:scan-secrets] Falha - potenciais segredos detectados:');
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.lineNumber} -> ${finding.reason}`);
  }
  process.exit(1);
}

main();
