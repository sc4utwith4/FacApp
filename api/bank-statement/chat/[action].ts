import messageHandler from '../../../api_legacy/bank-statement/chat/message.js';
import messagesHandler from '../../../api_legacy/bank-statement/chat/messages.js';
import sessionsHandler from '../../../api_legacy/bank-statement/chat/sessions.js';
import webhookHandler from '../../../api_legacy/bank-statement/chat/webhook.js';
import conciliationHistoryHandler from '../../../api_legacy/bank-statement/conciliation/history.js';
import type {
  VercelRequest,
  VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

const HANDLERS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  message: messageHandler,
  messages: messagesHandler,
  sessions: sessionsHandler,
  webhook: webhookHandler,
  history: conciliationHistoryHandler,
};

function readAction(req: VercelRequest): string {
  const raw = req.query?.action;
  if (raw) {
    const v = Array.isArray(raw) ? raw[0] : raw;
    if (v && String(v).trim()) return String(v).trim().toLowerCase();
  }
  const url = (req as { url?: string }).url || '';
  const match = url.match(/\/chat\/([^/?]+)/);
  return match ? String(match[1] || '').trim().toLowerCase() : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = readAction(req);
  const selected = HANDLERS[action];

  if (!selected) {
    return res.status(404).json({
      error: 'Not found',
      message: `Rota de chat bank-statement invalida: ${action || '(vazia)'}`,
    });
  }

  return selected(req, res);
}
