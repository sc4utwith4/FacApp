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

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
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

function parseArgs(argv) {
  const args = {
    email: '',
    password: '',
    updateQaEnv: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '').trim();
    if (!token) continue;

    if (token === '--help' || token === '-h') {
      args.help = true;
      continue;
    }

    if (token === '--update-qa-env') {
      args.updateQaEnv = true;
      continue;
    }

    if (token === '--password' || token === '-p') {
      const next = String(argv[i + 1] || '').trim();
      if (!next) throw new Error('Flag --password requer valor.');
      args.password = next;
      i += 1;
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`Flag desconhecida: ${token}`);
    }

    if (!args.email) {
      args.email = token;
      continue;
    }

    throw new Error(`Argumento inesperado: ${token}`);
  }

  return args;
}

function validateArgs(args) {
  if (args.help) return;
  if (!args.email) {
    throw new Error('Uso: npm run auth:set-password-admin -- <email> [--password <senha>] [--update-qa-env]');
  }
  if (!args.email.includes('@')) {
    throw new Error(`Email invalido: ${args.email}`);
  }
  if (!args.password && !args.updateQaEnv) {
    throw new Error('Informe --password ou use --update-qa-env para persistir senha gerada em .env.local.');
  }
}

async function findUserByEmail(admin, email) {
  const target = normalizeEmail(email);
  let page = 1;
  const perPage = 200;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Falha ao listar usuarios auth: ${error.message}`);
    const users = data?.users || [];
    const found = users.find((entry) => normalizeEmail(entry.email) === target);
    if (found) return found;
    if (users.length < perPage) return null;
    page += 1;
  }
}

async function main(rawArgv = process.argv.slice(2)) {
  const args = parseArgs(rawArgv);
  validateArgs(args);

  if (args.help) {
    console.log('Uso: npm run auth:set-password-admin -- <email> [--password <senha>] [--update-qa-env]');
    console.log('Exemplo: npm run auth:set-password-admin -- daviolborges14@gmail.com --password "Senha@Forte2026"');
    console.log('Exemplo QA: npm run auth:set-password-admin -- daviolborges14@gmail.com --update-qa-env');
    return;
  }

  const supabaseUrl = required('VITE_SUPABASE_URL', optional('NEXT_PUBLIC_SUPABASE_URL'));
  const serviceRoleKey = required(
    'SUPABASE_SERVICE_ROLE_KEY',
    optional('SUPABASE_SERVICE_KEY', optional('SUPABASE_SERVICE_ROLE'))
  );

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const user = await findUserByEmail(admin, args.email);
  if (!user?.id) {
    throw new Error(`Usuario nao encontrado no Auth para o email ${args.email}.`);
  }

  const password = args.password || createPassword();
  const { error: updateError } = await admin.auth.admin.updateUserById(String(user.id), {
    password,
    email_confirm: true,
  });

  if (updateError) {
    throw new Error(`Falha ao atualizar senha no Auth: ${updateError.message}`);
  }

  let qaEmailStatus = 'skipped';
  let qaPasswordStatus = 'skipped';
  if (args.updateQaEnv) {
    qaEmailStatus = ensureEnvVar('BANK_RECONCILIATION_QA_EMAIL', args.email);
    qaPasswordStatus = ensureEnvVar('BANK_RECONCILIATION_QA_PASSWORD', password);
  }

  console.log(`[auth-set-password-admin] Senha atualizada para ${maskEmail(args.email)}.`);
  console.log(`[auth-set-password-admin] user_id=${user.id}`);
  console.log(`[auth-set-password-admin] password_source=${args.password ? 'explicit' : 'generated'}`);
  console.log(
    `[auth-set-password-admin] qa_env_email=${qaEmailStatus} qa_env_password=${qaPasswordStatus} (senha nunca exibida em logs)`
  );
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[auth-set-password-admin] ERRO: ${message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  validateArgs,
  createPassword,
  main,
};
