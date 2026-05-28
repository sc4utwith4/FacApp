#!/usr/bin/env node
const { config: loadEnv } = require('dotenv');

loadEnv({ path: '.env.local', override: true });
loadEnv({ path: '.env', override: false });

const DEFAULT_PROXY_TARGET = 'http://localhost:3100';
const HEALTHCHECK_PATH = '/api/bank-statement/rules';
const DISECURIT_PATHS = ['/api/disecurit-import', '/api/disecurit-reprocess', '/api/disecurit-parse'];
/** Sem token: esperado 401/403 se a rota existe; 404 indica servidor local sem dispatcher/rota. */
const OPERACOES_IA_CHAT_SESSIONS_PATH = '/api/operacoes-ia/chat/sessions?limit=1';

const color = {
  red: '\x1b[31m',
  reset: '\x1b[0m',
};

function logInfo(message) {
  console.log(`[bank-preflight] ${message}`);
}

function logError(message) {
  console.error(`${color.red}[bank-preflight] ${message}${color.reset}`);
}

function normalizeProxyTarget(rawValue) {
  const raw = String(rawValue || DEFAULT_PROXY_TARGET).trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Protocolo nao suportado: ${parsed.protocol}`);
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`VITE_API_PROXY_TARGET invalido (${raw}): ${message}`);
  }
}

function summarizeBody(body) {
  const normalized = String(body || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '(vazio)';
  return normalized.length > 220 ? `${normalized.slice(0, 220)}...` : normalized;
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function probePaths(origin, paths, timeoutMs) {
  const results = [];
  for (const pathname of paths) {
    const url = `${origin}${pathname}`;
    try {
      const response = await fetchWithTimeout(url, timeoutMs);
      results.push({ pathname, url, ok: true, status: response.status });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ pathname, url, ok: false, status: 0, errorMessage: message });
    }
  }
  return results;
}

async function runBankApiPreflight(options = {}) {
  const timeoutMs = Number(options.timeoutMs || 3500);
  const target = normalizeProxyTarget(process.env.VITE_API_PROXY_TARGET);
  const url = `${target.origin}${HEALTHCHECK_PATH}`;

  try {
    const response = await fetchWithTimeout(url, timeoutMs);
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const rawText = await response.text().catch(() => '');
    const bodyPreview = summarizeBody(rawText);

    if (response.status === 401 || response.status === 403 || response.status === 200) {
      if (!options.quiet) {
        const probes = await probePaths(target.origin, DISECURIT_PATHS, Math.min(1800, timeoutMs));
        const missing = probes.filter((probe) => probe.ok && probe.status === 404);
        if (missing.length > 0) {
          logError(
            [
              'Aviso: rotas DISECURIT parecem ausentes no proxy target (404).',
              `Proxy target: ${target.origin}`,
              ...missing.map((probe) => `- GET ${probe.url} -> 404`),
              'Isso costuma causar erro ao anexar arquivos (POST /api/disecurit-import).',
              'Acao recomendada: execute `npm run dev:chat-local` (stack oficial) ou ajuste o servidor local da API para incluir as rotas.',
            ].join('\n')
          );
        }

        const chatProbes = await probePaths(
          target.origin,
          [OPERACOES_IA_CHAT_SESSIONS_PATH],
          Math.min(1800, timeoutMs)
        );
        const chatMissing = chatProbes.filter((probe) => probe.ok && probe.status === 404);
        if (chatMissing.length > 0) {
          logError(
            [
              'Aviso: rota Operacoes IA (historico de chat) retornou 404 no proxy target.',
              `Proxy target: ${target.origin}`,
              ...chatMissing.map((probe) => `- GET ${probe.url} -> 404`),
              'Sem essa rota, o menu Conversas no copiloto falha. Use `npm run dev:chat-local` ou api/disecurit com action operacoes-chat-sessions.',
            ].join('\n')
          );
        } else {
          const chatProbe = chatProbes[0];
          if (chatProbe?.ok && ![401, 403, 200].includes(chatProbe.status)) {
            logInfo(
              `Sonda Operacoes IA chat/sessions: GET ${chatProbe.url} -> ${chatProbe.status} (esperado 401/403 sem token ou 200).`
            );
          }
        }
      }
      if (!options.quiet) {
        const statusLabel =
          response.status === 200
            ? '200 (endpoint publico ou autenticado)'
            : `${response.status} (auth guard ativo)`;
        logInfo(`Conectividade OK em ${url}: ${statusLabel}`);
      }
      return {
        ok: true,
        status: response.status,
        url,
        proxyTarget: target.origin,
      };
    }

    if (!options.quiet) {
      logError(
        [
          'API local nao respondeu no formato esperado.',
          `Proxy target: ${target.origin}`,
          `Healthcheck: GET ${url}`,
          `Status recebido: ${response.status}`,
          `Content-Type: ${contentType || '(ausente)'}`,
          `Body: ${bodyPreview}`,
          'Esperado: 401/403 sem token (ou 200 em casos autenticados).',
          'Acao recomendada: execute `npm run dev:chat-local`.',
        ].join('\n')
      );
    }

    return {
      ok: false,
      status: response.status,
      contentType,
      bodyPreview,
      url,
      proxyTarget: target.origin,
      reason: 'unexpected_status',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!options.quiet) {
      logError(
        [
          'Nao foi possivel conectar na API local configurada para o proxy.',
          `Proxy target: ${target.origin}`,
          `Healthcheck: GET ${url}`,
          `Detalhe: ${message}`,
          'Acao recomendada: execute `npm run dev:chat-local`.',
        ].join('\n')
      );
    }
    return {
      ok: false,
      status: 0,
      contentType: '',
      bodyPreview: '',
      url,
      proxyTarget: target.origin,
      reason: 'connection_error',
      errorMessage: message,
    };
  }
}

if (require.main === module) {
  runBankApiPreflight()
    .then((result) => {
      if (result.ok) process.exit(0);
      process.exit(1);
    })
    .catch((error) => {
      logError(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}

module.exports = {
  DEFAULT_PROXY_TARGET,
  HEALTHCHECK_PATH,
  OPERACOES_IA_CHAT_SESSIONS_PATH,
  runBankApiPreflight,
  normalizeProxyTarget,
};
