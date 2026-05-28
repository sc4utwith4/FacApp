#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { config: loadEnv } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

const ENV_FILE = path.resolve(process.cwd(), '.env.local');

function required(name, fallback = '') {
  const value = String(process.env[name] || fallback).trim();
  if (!value) throw new Error(`Env obrigatoria ausente: ${name}`);
  return value;
}

function optional(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function parseBooleanEnv(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isLikelyQaEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return false;

  return (
    email.endsWith('@assfac.local') ||
    email.startsWith('qa.') ||
    email.startsWith('qa_') ||
    email.startsWith('qa-') ||
    email.includes('+qa') ||
    email.includes('.qa.') ||
    email.includes('_qa_') ||
    email.includes('-qa-') ||
    email.includes('teste') ||
    email.includes('test') ||
    email.includes('automacao') ||
    email.includes('automation')
  );
}

function validateQaEmailPolicy(preferredEmail, allowPersonalEmail) {
  const email = normalizeEmail(preferredEmail);
  if (!email) return;
  if (isLikelyQaEmail(email)) return;
  if (allowPersonalEmail) return;

  throw new Error(
    [
      `BANK_RECONCILIATION_QA_EMAIL (${preferredEmail}) parece ser e-mail pessoal.`,
      'Provisionamento QA bloqueado para evitar sobrescrever senha de usuario principal.',
      'Use um e-mail dedicado de QA/teste (ex.: alias +qa) ou habilite conscientemente',
      'BANK_RECONCILIATION_QA_ALLOW_PERSONAL_EMAIL=true para override temporario.',
    ].join(' ')
  );
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***';
  const localMask = local.length <= 2 ? `${local[0] || '*'}*` : `${local.slice(0, 2)}***`;
  return `${localMask}@${domain}`;
}

function createPassword() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  const upper = alphabet.toUpperCase();
  const digits = '0123456789';
  const specials = '!@#$%^&*()_+-=[]{};\':"|<>?,./`~';
  const randomChunk = crypto.randomBytes(20).toString('base64url');

  const pick = (source) => source[Math.floor(Math.random() * source.length)];
  return `${pick(upper)}${pick(alphabet)}${pick(digits)}${pick(specials)}${randomChunk}`;
}

function isLikelyPlaceholderEmpresaId(value) {
  return value === '00000000-0000-0000-0000-000000000001';
}

function ensureEnvVar(key, value) {
  const content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const line = `${key}=${value}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');

  if (regex.test(content)) {
    const next = content.replace(regex, line);
    fs.writeFileSync(ENV_FILE, next, 'utf8');
    return 'updated';
  }

  const separator = content && !content.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(ENV_FILE, `${content}${separator}${line}\n`, 'utf8');
  return 'added';
}

async function listAllAuthUsers(admin) {
  const result = [];
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Falha ao listar usuarios auth: ${error.message}`);
    const users = data?.users || [];
    result.push(...users);
    if (users.length < perPage) break;
    page += 1;
  }

  return result;
}

function buildAuthEmailMap(authUsers) {
  const map = new Map();
  for (const user of authUsers) {
    const key = normalizeEmail(user.email);
    if (key) map.set(key, user);
  }
  return map;
}

function findAuthUserByEmail(authUsers, email) {
  const key = normalizeEmail(email);
  if (!key) return null;
  return authUsers.find((user) => normalizeEmail(user.email) === key) || null;
}

async function pickEmpresaWithConta(admin, preferredEmpresaId) {
  if (preferredEmpresaId && !isLikelyPlaceholderEmpresaId(preferredEmpresaId)) {
    const { data: preferredConta, error: preferredError } = await admin
      .from('contas_bancarias')
      .select('id, empresa_id')
      .eq('empresa_id', preferredEmpresaId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!preferredError && preferredConta?.empresa_id) {
      return String(preferredConta.empresa_id);
    }
  }

  const { data: firstConta, error: contaError } = await admin
    .from('contas_bancarias')
    .select('id, empresa_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (contaError || !firstConta?.empresa_id) {
    throw new Error(`Falha ao resolver empresa via contas_bancarias: ${contaError?.message || 'nenhuma conta encontrada'}`);
  }

  return String(firstConta.empresa_id);
}

async function hasContaForEmpresa(admin, empresaId) {
  const { data, error } = await admin
    .from('contas_bancarias')
    .select('id')
    .eq('empresa_id', empresaId)
    .limit(1)
    .maybeSingle();

  if (error) return false;
  return Boolean(data?.id);
}

async function ensureProfile(admin, args) {
  const { userId, email, empresaId, allowUpdateExisting = false } = args;
  const { data: existing, error: existingError } = await admin
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Falha ao consultar profile QA: ${existingError.message}`);
  }

  if (existing) {
    if (!allowUpdateExisting) return 'reused';

    const patch = { empresa_id: empresaId };
    if (Object.prototype.hasOwnProperty.call(existing, 'email')) patch.email = email;

    const { error: updateError } = await admin
      .from('profiles')
      .update(patch)
      .eq('id', userId);

    if (updateError) {
      throw new Error(`Falha ao atualizar profile QA existente: ${updateError.message}`);
    }
    return 'updated';
  }

  const attempts = [
    { id: userId, empresa_id: empresaId, email, nome: 'QA Conciliacao Local', perfil: 'admin' },
    { id: userId, empresa_id: empresaId, email, nome: 'QA Conciliacao Local' },
    { id: userId, empresa_id: empresaId, email },
    { id: userId, empresa_id: empresaId },
  ];

  let lastError = null;
  for (const payload of attempts) {
    const { error } = await admin.from('profiles').insert(payload);
    if (!error) return 'created';
    lastError = error;
  }

  throw new Error(`Falha ao criar profile QA: ${lastError?.message || 'erro desconhecido'}`);
}

async function pickExistingQaCandidate(admin, args) {
  const { authUsers, preferredEmail, preferredEmpresaId } = args;
  if (!authUsers.length) return null;

  const authByEmail = buildAuthEmailMap(authUsers);
  const preferredEmailKey = normalizeEmail(preferredEmail);

  const { data: profiles, error: profilesError } = await admin
    .from('profiles')
    .select('id, email, empresa_id, is_super_admin, created_at')
    .not('email', 'is', null)
    .order('created_at', { ascending: true })
    .limit(500);

  if (profilesError) {
    throw new Error(`Falha ao consultar profiles para QA: ${profilesError.message}`);
  }

  const { data: contas, error: contasError } = await admin
    .from('contas_bancarias')
    .select('empresa_id');

  if (contasError) {
    throw new Error(`Falha ao consultar contas_bancarias para QA: ${contasError.message}`);
  }

  const empresasComConta = new Set((contas || []).map((row) => String(row.empresa_id || '')));
  const candidates = [];

  for (const profile of profiles || []) {
    const emailKey = normalizeEmail(profile.email);
    if (!emailKey) continue;

    const authUser = authByEmail.get(emailKey);
    if (!authUser?.id) continue;
    if (!isLikelyQaEmail(authUser.email || profile.email)) continue;

    const empresaId = String(profile.empresa_id || '');
    if (!empresaId || !empresasComConta.has(empresaId)) continue;

    let score = 0;
    if (preferredEmailKey && emailKey === preferredEmailKey) score += 100;
    if (preferredEmpresaId && empresaId === preferredEmpresaId) score += 20;
    if (emailKey.includes('qa.conciliacao')) score += 5;

    candidates.push({
      userId: String(authUser.id),
      email: String(authUser.email || profile.email),
      empresaId,
      score,
      createdAt: String(profile.created_at || ''),
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.createdAt.localeCompare(b.createdAt);
  });

  if (preferredEmailKey && normalizeEmail(candidates[0].email) !== preferredEmailKey) {
    return null;
  }

  return candidates[0];
}

async function updateAuthPassword(admin, userId, qaPassword) {
  const { error: updateAuthError } = await admin.auth.admin.updateUserById(userId, {
    password: qaPassword,
    email_confirm: true,
    user_metadata: {
      qa_bank_local: true,
    },
  });

  if (updateAuthError) {
    throw new Error(`Falha ao atualizar usuario QA no Auth: ${updateAuthError.message}`);
  }
}

async function main() {
  const supabaseUrl = required('VITE_SUPABASE_URL', optional('NEXT_PUBLIC_SUPABASE_URL'));
  const serviceRoleKey = required(
    'SUPABASE_SERVICE_ROLE_KEY',
    optional('SUPABASE_SERVICE_KEY', optional('SUPABASE_SERVICE_ROLE'))
  );

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const preferredEmpresa = optional('BANK_RECONCILIATION_PILOT_EMPRESA_ID');
  const preferredEmail = optional('BANK_RECONCILIATION_QA_EMAIL');
  const allowPersonalEmail = parseBooleanEnv(optional('BANK_RECONCILIATION_QA_ALLOW_PERSONAL_EMAIL'));
  validateQaEmailPolicy(preferredEmail, allowPersonalEmail);
  const qaPassword = optional('BANK_RECONCILIATION_QA_PASSWORD') || createPassword();
  const authUsers = await listAllAuthUsers(admin);

  let qaEmail = preferredEmail || '';
  let userId = '';
  let empresaId = '';
  let authStatus = '';
  let profileStatus = 'reused';
  let strategy = '';

  const explicitUser = preferredEmail ? findAuthUserByEmail(authUsers, preferredEmail) : null;

  if (explicitUser?.id) {
    userId = String(explicitUser.id);
    qaEmail = String(explicitUser.email || preferredEmail);

    const { data: profile } = await admin
      .from('profiles')
      .select('empresa_id')
      .eq('id', userId)
      .maybeSingle();

    if (profile?.empresa_id && (await hasContaForEmpresa(admin, String(profile.empresa_id)))) {
      empresaId = String(profile.empresa_id);
      profileStatus = 'reused';
    } else {
      empresaId = await pickEmpresaWithConta(admin, preferredEmpresa);
      profileStatus = await ensureProfile(admin, {
        userId,
        email: qaEmail,
        empresaId,
        allowUpdateExisting: true,
      });
    }

    await updateAuthPassword(admin, userId, qaPassword);
    authStatus = 'updated-existing-explicit';
    strategy = 'reuse-explicit';
  } else {
    const autoCandidate = await pickExistingQaCandidate(admin, {
      authUsers,
      preferredEmail,
      preferredEmpresaId: preferredEmpresa,
    });

    if (autoCandidate) {
      userId = autoCandidate.userId;
      qaEmail = autoCandidate.email;
      empresaId = autoCandidate.empresaId;
      await updateAuthPassword(admin, userId, qaPassword);

      authStatus = 'updated-existing-auto';
      profileStatus = 'reused';
      strategy = 'reuse-auto';
    }
  }

  if (!userId) {
    throw new Error(
      [
        'Usuario QA nao encontrado no Auth em modo existing-only.',
        'Defina BANK_RECONCILIATION_QA_EMAIL para um usuario ja existente ou',
        'habilite temporariamente BANK_RECONCILIATION_QA_ALLOW_PERSONAL_EMAIL=true para emergencia consciente.',
      ].join(' ')
    );
  }

  ensureEnvVar('BANK_RECONCILIATION_QA_EMAIL', qaEmail);
  ensureEnvVar('BANK_RECONCILIATION_QA_PASSWORD', qaPassword);

  console.log('[provision-bank-qa-user] Usuario QA pronto para smoke local.');
  console.log(`[provision-bank-qa-user] override_personal_email=${allowPersonalEmail ? 'on' : 'off'}`);
  console.log(`[provision-bank-qa-user] strategy=${strategy}, auth=${authStatus}, profile=${profileStatus}`);
  console.log(`[provision-bank-qa-user] email=${maskEmail(qaEmail)} user_id=${userId}`);
  console.log(`[provision-bank-qa-user] empresa_id=${empresaId}`);
  console.log('[provision-bank-qa-user] Variaveis BANK_RECONCILIATION_QA_EMAIL e BANK_RECONCILIATION_QA_PASSWORD atualizadas em .env.local');
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[provision-bank-qa-user] ERRO: ${message}`);
    process.exit(1);
  });
}

module.exports = {
  parseBooleanEnv,
  isLikelyQaEmail,
  validateQaEmailPolicy,
  createPassword,
  main,
};
