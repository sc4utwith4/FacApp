try {
  // Carrega env local para facilitar validação em desenvolvimento.
  // Em produção (Vercel), process.env já vem preenchido.
  require('dotenv').config();
  require('dotenv').config({ path: '.env.local', override: true });
} catch {
  // noop: validação continua somente com process.env atual
}

const required = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY:
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY:
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE,
  N8N_BANK_RECONCILIATION_WEBHOOK_URL:
    process.env.N8N_BANK_RECONCILIATION_WEBHOOK_URL || process.env.BANK_RECONCILIATION_WEBHOOK_URL,
  N8N_BANK_RECONCILIATION_INTEGRATION_SECRET:
    process.env.N8N_BANK_RECONCILIATION_INTEGRATION_SECRET || process.env.BANK_RECONCILIATION_INTEGRATION_SECRET,
};

const optionalChat = {
  N8N_BANK_RECONCILIATION_CHAT_WEBHOOK_URL:
    process.env.N8N_BANK_RECONCILIATION_CHAT_WEBHOOK_URL || process.env.BANK_RECONCILIATION_CHAT_WEBHOOK_URL,
  N8N_BANK_RECONCILIATION_CHAT_INTEGRATION_SECRET:
    process.env.N8N_BANK_RECONCILIATION_CHAT_INTEGRATION_SECRET || process.env.BANK_RECONCILIATION_CHAT_INTEGRATION_SECRET,
  BANK_RECONCILIATION_CHAT_TIMEOUT_MS:
    process.env.BANK_RECONCILIATION_CHAT_TIMEOUT_MS || process.env.N8N_BANK_RECONCILIATION_CHAT_TIMEOUT_MS,
  VITE_BANK_RECONCILIATION_CHAT_MODE:
    process.env.VITE_BANK_RECONCILIATION_CHAT_MODE,
  BANK_RECONCILIATION_PILOT_EMPRESA_ID:
    process.env.BANK_RECONCILIATION_PILOT_EMPRESA_ID || process.env.N8N_BANK_RECONCILIATION_PILOT_EMPRESA_ID,
  BANK_RECONCILIATION_PILOT_CONTA_IDS:
    process.env.BANK_RECONCILIATION_PILOT_CONTA_IDS || process.env.N8N_BANK_RECONCILIATION_PILOT_CONTA_IDS,
};

let hasError = false;

for (const [key, value] of Object.entries(required)) {
  if (!value) {
    console.error(`[ERRO] ${key} nao configurada`);
    hasError = true;
  } else {
    console.log(`[OK] ${key} configurada`);
  }
}

if (hasError) {
  console.error('\nVariaveis faltando para APIs e integracao n8n da conciliacao bancaria.');
  process.exit(1);
}

const timeout = Number(
  process.env.N8N_BANK_RECONCILIATION_TIMEOUT_MS || process.env.BANK_RECONCILIATION_TIMEOUT_MS || 15000
);
console.log(
  `\nAmbiente minimo validado para conciliacao bancaria. Timeout n8n configurado: ${Number.isFinite(timeout) ? timeout : 15000}ms`
);

for (const [key, value] of Object.entries(optionalChat)) {
  if (!value) {
    console.warn(`[WARN] ${key} nao configurada (chat operacional usara fallback deterministico).`);
  } else {
    console.log(`[OK] ${key} configurada`);
  }
}
