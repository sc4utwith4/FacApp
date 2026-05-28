import confirmHandler from '../../../../api_legacy/bank-statement/chat/action/confirm.js';
import type {
  VercelRequest,
  VercelResponse,
} from '../../../../src/server/bank-statement/_shared.js';

const HANDLERS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  confirm: confirmHandler,
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
      message: `Rota de chat/action invalida: ${action || '(vazia)'}`,
    });
  }

  return selected(req, res);
}
