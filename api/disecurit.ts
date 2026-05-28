import disecuritImportHandler from '../api_legacy/disecurit-import.js';
import disecuritParseHandler from '../api_legacy/disecurit-parse.js';
import disecuritReprocessHandler from '../api_legacy/disecurit-reprocess.js';
import operacoesIaPreviewHandler from '../api_legacy/operacoes-ia/preview.js';
import operacoesIaConfirmHandler from '../api_legacy/operacoes-ia/confirm.js';
import operacoesIaMessageHandler from '../api_legacy/operacoes-ia/message.js';
import operacoesIaHistoryEventHandler from '../api_legacy/operacoes-ia/history-event.js';
import operacoesIaHistoryHandler from '../api_legacy/operacoes-ia/history.js';
import operacoesIaChatSessionsHandler from '../api_legacy/operacoes-ia/chat-sessions.js';
import operacoesIaChatMessagesHandler from '../api_legacy/operacoes-ia/chat-messages.js';
import type { VercelRequest, VercelResponse } from '../src/server/bank-statement/_shared.js';

export const config = {
  maxDuration: 60,
};

type ApiAction =
  | 'import'
  | 'reprocess'
  | 'parse'
  | 'operacoes-preview'
  | 'operacoes-confirm'
  | 'operacoes-message'
  | 'operacoes-history'
  | 'operacoes-history-event'
  | 'operacoes-chat-sessions'
  | 'operacoes-chat-messages';

const getFirstString = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value.find((item) => typeof item === 'string');
    return typeof first === 'string' ? first : null;
  }
  return null;
};

const normalizeAction = (value: unknown): ApiAction | null => {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'import' || raw === 'reprocess' || raw === 'parse') return raw;
  if (
    raw === 'operacoes-preview' ||
    raw === 'operacoes-confirm' ||
    raw === 'operacoes-message' ||
    raw === 'operacoes-history' ||
    raw === 'operacoes-history-event' ||
    raw === 'operacoes-chat-sessions' ||
    raw === 'operacoes-chat-messages'
  ) {
    return raw;
  }
  return null;
};

const resolveAction = (req: VercelRequest): ApiAction | null => {
  const queryAction = normalizeAction(getFirstString(req.query?.action));
  if (queryAction) return queryAction;

  const bodyAction =
    typeof req.body === 'object' && req.body !== null
      ? normalizeAction((req.body as Record<string, unknown>).action)
      : null;
  if (bodyAction) return bodyAction;

  return null;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = resolveAction(req);

  if (!action) {
    return res.status(400).json({
      error: 'Invalid action',
      message:
        'Informe ?action=import|reprocess|parse|operacoes-preview|operacoes-confirm|operacoes-message|operacoes-history|operacoes-history-event|operacoes-chat-sessions|operacoes-chat-messages.',
    });
  }

  if (action === 'import') {
    return disecuritImportHandler(req, res);
  }

  if (action === 'reprocess') {
    return disecuritReprocessHandler(req, res);
  }

  if (action === 'operacoes-preview') {
    return operacoesIaPreviewHandler(req, res);
  }

  if (action === 'operacoes-confirm') {
    return operacoesIaConfirmHandler(req, res);
  }

  if (action === 'operacoes-message') {
    return operacoesIaMessageHandler(req, res);
  }

  if (action === 'operacoes-history') {
    return operacoesIaHistoryHandler(req, res);
  }

  if (action === 'operacoes-history-event') {
    return operacoesIaHistoryEventHandler(req, res);
  }

  if (action === 'operacoes-chat-sessions') {
    return operacoesIaChatSessionsHandler(req, res);
  }

  if (action === 'operacoes-chat-messages') {
    return operacoesIaChatMessagesHandler(req, res);
  }

  return disecuritParseHandler(req, res);
}
