#!/usr/bin/env node
const { config: loadEnv } = require('dotenv');
const { createClient } = require('@supabase/supabase-js');

loadEnv({ path: '.env.local', override: false });
loadEnv({ path: '.env', override: false });

function required(name, fallback = '') {
  const value = String(process.env[name] || fallback).trim();
  if (!value) throw new Error(`Env obrigatoria ausente: ${name}`);
  return value;
}

function optional(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}

async function main() {
  const emailArg = String(process.argv[2] || '').trim();
  if (!emailArg || !emailArg.includes('@')) {
    throw new Error('Uso: node scripts/send-password-reset-email.cjs <email>');
  }

  const supabaseUrl = required('VITE_SUPABASE_URL', optional('NEXT_PUBLIC_SUPABASE_URL'));
  const anonKey = required('VITE_SUPABASE_PUBLISHABLE_KEY', optional('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
  const appBaseUrl = optional('BANK_RECONCILIATION_WEB_BASE_URL');
  const redirectTo = appBaseUrl ? `${appBaseUrl.replace(/\/$/, '')}/auth/confirm` : undefined;

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await client.auth.resetPasswordForEmail(emailArg, redirectTo ? { redirectTo } : undefined);
  if (error) {
    throw new Error(`Falha ao disparar reset por email: ${error.message}`);
  }

  console.log(`[auth-reset] Email de redefinicao enviado para ${maskEmail(emailArg)}.`);
  if (redirectTo) {
    console.log(`[auth-reset] redirectTo=${redirectTo}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[auth-reset] ERRO: ${message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
};
