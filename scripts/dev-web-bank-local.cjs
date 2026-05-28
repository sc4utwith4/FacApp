#!/usr/bin/env node
const { spawn } = require('node:child_process');
const path = require('node:path');
const { runBankApiPreflight, normalizeProxyTarget } = require('./dev-bank-api-preflight.cjs');

const color = {
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
};

function logInfo(message) {
  console.log(`${color.cyan}[dev:web] ${message}${color.reset}`);
}

function logWarn(message) {
  console.warn(`${color.yellow}[dev:web] ${message}${color.reset}`);
}

async function main() {
  const preflight = await runBankApiPreflight();
  if (!preflight.ok) {
    process.exit(1);
  }

  const proxyTarget = normalizeProxyTarget(process.env.VITE_API_PROXY_TARGET).origin;
  logInfo(`Preflight OK. Iniciando frontend (modo avancado) com proxy /api -> ${proxyTarget}`);
  logWarn('Fluxo recomendado para operacao normal: npm run dev:chat-local');

  const viteBin = path.join(process.cwd(), 'node_modules', '.bin', 'vite');
  const child = spawn(viteBin, [], {
    stdio: 'inherit',
    env: process.env,
  });

  const stop = (signal) => {
    if (child.killed) return;
    child.kill(signal);
  };

  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev:web] Falha ao iniciar frontend local: ${message}`);
  process.exit(1);
});
