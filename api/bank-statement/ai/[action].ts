import pendingHandler from '../../../api_legacy/bank-statement/ai/pending.js';
import reviewHandler from '../../../api_legacy/bank-statement/ai/review.js';
import statusHandler from '../../../api_legacy/bank-statement/ai/status.js';
import suggestHandler from '../../../api_legacy/bank-statement/ai/suggest.js';
import triggerHandler from '../../../api_legacy/bank-statement/ai/trigger.js';
import type {
  VercelRequest,
  VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

const HANDLERS: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<unknown>
> = {
  pending: pendingHandler,
  review: reviewHandler,
  status: statusHandler,
  suggest: suggestHandler,
  trigger: triggerHandler,
};

function readAction(req: VercelRequest): string {
  const raw = req.query?.action;
  if (Array.isArray(raw)) return String(raw[0] || '').trim().toLowerCase();
  return String(raw || '').trim().toLowerCase();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = readAction(req);
  const selected = HANDLERS[action];

  if (!selected) {
    return res.status(404).json({
      error: 'Not found',
      message: `Rota de IA bank-statement invalida: ${action || '(vazia)'}`,
    });
  }

  return selected(req, res);
}
