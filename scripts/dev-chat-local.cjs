#!/usr/bin/env node
const { spawn } = require('node:child_process');
const { runBankApiPreflight, normalizeProxyTarget } = require('./dev-bank-api-preflight.cjs');

const color = {
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

function logInfo(message) {
  console.log(`${color.cyan}[dev:chat-local] ${message}${color.reset}`);
}

function logWarn(message) {
  console.warn(`${color.yellow}[dev:chat-local] ${message}${color.reset}`);
}

function logError(message) {
  console.error(`${color.red}[dev:chat-local] ${message}${color.reset}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForApiReady(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    const result = await runBankApiPreflight({ quiet: true, timeoutMs: 1500 });
    if (result.ok) return result;
    await sleep(500);
  }
  return null;
}

function stopChild(child, signal = 'SIGTERM') {
  if (!child || child.killed) return;
  try {
    child.kill(signal);
  } catch {
    // noop
  }
}

async function main() {
  const proxyTarget = normalizeProxyTarget(process.env.VITE_API_PROXY_TARGET).origin;
  logInfo(`Iniciando stack local oficial (API + frontend). Proxy alvo: ${proxyTarget}`);

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const api = spawn(npmCmd, ['run', 'dev:api'], {
    stdio: 'inherit',
    env: process.env,
  });

  let web = null;
  let shuttingDown = false;

  const shutdown = (signal = 'SIGTERM', exitCode = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopChild(web, signal);
    stopChild(api, signal);
    setTimeout(() => process.exit(exitCode), 120);
  };

  process.on('SIGINT', () => shutdown('SIGINT', 130));
  process.on('SIGTERM', () => shutdown('SIGTERM', 143));

  api.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (!web) {
      logError(`API encerrou antes do frontend iniciar (code=${code ?? 'null'} signal=${signal || 'none'}).`);
      shutdown('SIGTERM', code ?? 1);
      return;
    }
    logError(`API local encerrou durante a sessao (code=${code ?? 'null'} signal=${signal || 'none'}).`);
    shutdown('SIGTERM', code ?? 1);
  });

  const readiness = await waitForApiReady();
  if (!readiness) {
    logError('API local nao ficou pronta dentro do tempo limite.');
    logError('Acao recomendada: revise logs da API e tente novamente.');
    shutdown('SIGTERM', 1);
    return;
  }

  logInfo(`API pronta em ${readiness.proxyTarget}. Iniciando frontend.`);
  web = spawn(npmCmd, ['run', 'dev:web'], {
    stdio: 'inherit',
    env: process.env,
  });

  web.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      logWarn(`Frontend finalizou por sinal ${signal}. Encerrando API local.`);
      shutdown('SIGTERM', 0);
      return;
    }
    if ((code ?? 0) !== 0) {
      logError(`Frontend encerrou com erro (code=${code}).`);
      shutdown('SIGTERM', code ?? 1);
      return;
    }
    shutdown('SIGTERM', 0);
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logError(`Falha ao iniciar ambiente local: ${message}`);
  process.exit(1);
});
