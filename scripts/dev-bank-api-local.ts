import http from 'node:http';
import { URL } from 'node:url';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local', override: true });
loadEnv({ path: '.env', override: false });

type JsonRecord = Record<string, string | string[] | undefined>;

type LocalRequest = {
  method?: string;
  url?: string;
  headers: JsonRecord;
  body?: string;
  query?: JsonRecord;
};

type LocalResponse = {
  status: (code: number) => LocalResponse;
  json: (data: unknown) => void;
};

type HandlerModule = {
  default: (req: LocalRequest, res: LocalResponse) => Promise<unknown> | unknown;
};

type RouteMatch = {
  loader: () => Promise<HandlerModule>;
  extraQuery?: Record<string, string>;
};

const toQueryRecord = (url: URL, extraQuery?: Record<string, string>): JsonRecord => {
  const query: JsonRecord = {};
  for (const [key, value] of url.searchParams.entries()) {
    const current = query[key];
    if (typeof current === 'undefined') {
      query[key] = value;
    } else if (Array.isArray(current)) {
      current.push(value);
      query[key] = current;
    } else {
      query[key] = [current, value];
    }
  }
  for (const [key, value] of Object.entries(extraQuery || {})) {
    query[key] = value;
  }
  return query;
};

const readBody = async (req: http.IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
};

const routeRequest = (pathname: string): RouteMatch | null => {
  if (pathname === '/api/bank-statement/import') {
    return { loader: () => import('../api/bank-statement/import.ts') };
  }

  if (pathname === '/api/bank-statement/import/notice/ack') {
    return {
      loader: () => import('../api/bank-statement/import.ts'),
      extraQuery: { action: 'notice-ack' },
    };
  }

  if (pathname === '/api/bank-statement/reprocess') {
    return {
      loader: () => import('../api/bank-statement/import.ts'),
      extraQuery: { action: 'reprocess' },
    };
  }

  if (pathname === '/api/bank-statement/match') {
    return { loader: () => import('../api/bank-statement/match.ts') };
  }

  if (pathname === '/api/bank-statement/rules') {
    return { loader: () => import('../api/bank-statement/rules/index.ts') };
  }

  let match = pathname.match(/^\/api\/bank-statement\/ai\/([^/]+)$/);
  if (match) {
    return {
      loader: () => import('../api/bank-statement/ai/[action].ts'),
      extraQuery: { action: match[1] || '' },
    };
  }

  match = pathname.match(/^\/api\/bank-statement\/daily\/([^/]+)$/);
  if (match) {
    return {
      loader: () => import('../api/bank-statement/daily/[action].ts'),
      extraQuery: { action: match[1] || '' },
    };
  }

  match = pathname.match(/^\/api\/bank-statement\/reconcile\/([^/]+)$/);
  if (match) {
    return {
      loader: () => import('../api/bank-statement/reconcile/[action].ts'),
      extraQuery: { action: match[1] || '' },
    };
  }

  match = pathname.match(/^\/api\/bank-statement\/chat\/action\/([^/]+)$/);
  if (match) {
    return {
      loader: () => import('../api/bank-statement/chat/action/[action].ts'),
      extraQuery: { action: match[1] || '' },
    };
  }

  match = pathname.match(/^\/api\/bank-statement\/chat\/agent-tools\/([^/]+)$/);
  if (match) {
    return {
      loader: () => import('../api/bank-statement/chat/agent-tools/[action].ts'),
      extraQuery: { action: match[1] || '' },
    };
  }

  match = pathname.match(/^\/api\/bank-statement\/chat\/([^/]+)$/);
  if (match) {
    return {
      loader: () => import('../api/bank-statement/chat/[action].ts'),
      extraQuery: { action: match[1] || '' },
    };
  }

  match = pathname.match(/^\/api\/bank-statement\/conciliation\/([^/]+)$/);
  if (match) {
    return {
      loader: () => import('../api/bank-statement/conciliation/[action].ts'),
      extraQuery: { action: match[1] || '' },
    };
  }

  if (pathname === '/api/operacoes-ia/chat/sessions') {
    return {
      loader: () => import('../api/disecurit.ts'),
      extraQuery: { action: 'operacoes-chat-sessions' },
    };
  }

  if (pathname === '/api/operacoes-ia/chat/messages') {
    return {
      loader: () => import('../api/disecurit.ts'),
      extraQuery: { action: 'operacoes-chat-messages' },
    };
  }

  if (pathname === '/api/operacoes-ia/history') {
    return {
      loader: () => import('../api/disecurit.ts'),
      extraQuery: { action: 'operacoes-history' },
    };
  }

  match = pathname.match(/^\/api\/operacoes-ia\/([^/]+)$/);
  if (match) {
    const actionRaw = String(match[1] || '').trim().toLowerCase();
    const actionMap: Record<string, string> = {
      preview: 'operacoes-preview',
      confirm: 'operacoes-confirm',
      message: 'operacoes-message',
      'history-event': 'operacoes-history-event',
    };
    const mappedAction = actionMap[actionRaw];
    if (!mappedAction) {
      return {
        loader: () => import('../api/disecurit.ts'),
        extraQuery: { action: actionRaw },
      };
    }
    return {
      loader: () => import('../api/disecurit.ts'),
      extraQuery: { action: mappedAction },
    };
  }

  if (pathname === '/api/disecurit-import') {
    return {
      loader: () => import('../api/disecurit.ts'),
      extraQuery: { action: 'import' },
    };
  }

  if (pathname === '/api/disecurit-reprocess') {
    return {
      loader: () => import('../api/disecurit.ts'),
      extraQuery: { action: 'reprocess' },
    };
  }

  if (pathname === '/api/disecurit-parse') {
    return {
      loader: () => import('../api/disecurit.ts'),
      extraQuery: { action: 'parse' },
    };
  }

  return null;
};

const server = http.createServer(async (req, res) => {
  const baseUrl = `http://${req.headers.host || 'localhost'}`;
  const url = new URL(req.url || '/', baseUrl);
  const matched = routeRequest(url.pathname);

  if (!matched) {
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Not found', message: `Rota local nao suportada: ${url.pathname}` }));
    return;
  }

  const body = req.method && req.method !== 'GET' && req.method !== 'HEAD' ? await readBody(req) : undefined;
  const localReq: LocalRequest = {
    method: req.method,
    url: req.url,
    headers: req.headers as JsonRecord,
    body,
    query: toQueryRecord(url, matched.extraQuery),
  };

  let statusCode = 200;
  let responded = false;

  const localRes: LocalResponse = {
    status(code: number) {
      statusCode = code;
      res.statusCode = code;
      return localRes;
    },
    json(payload: unknown) {
      if (responded) return;
      responded = true;
      res.statusCode = statusCode;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(payload));
    },
  };

  try {
    const mod = await matched.loader();
    await mod.default(localReq, localRes);
    if (!responded) {
      res.statusCode = statusCode === 200 ? 204 : statusCode;
      res.end();
    }
  } catch (error) {
    if (responded) return;
    const message = error instanceof Error ? error.message : 'Erro inesperado no servidor local';
    console.error('[dev-bank-api-local] handler failure', { pathname: url.pathname, message, error });
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Internal server error', message }));
  }
});

const port = Number(process.env.BANK_RECONCILIATION_API_PORT || 3100);
server.listen(port, () => {
  console.log(`[dev-bank-api-local] listening on http://localhost:${port}`);
});
