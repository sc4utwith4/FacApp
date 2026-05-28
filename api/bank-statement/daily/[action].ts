import closeHandler from '../../../api_legacy/bank-statement/daily/close.js';
import reopenHandler from '../../../api_legacy/bank-statement/daily/reopen.js';
import summaryHandler from '../../../api_legacy/bank-statement/daily/summary.js';
import type {
  VercelRequest,
  VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

const HANDLERS: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<unknown>
> = {
  close: closeHandler,
  reopen: reopenHandler,
  summary: summaryHandler,
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
      message: `Rota de daily bank-statement invalida: ${action || '(vazia)'}`,
    });
  }

  return selected(req, res);
}
