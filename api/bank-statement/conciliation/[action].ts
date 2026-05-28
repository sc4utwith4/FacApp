import historyHandler from '../../../api_legacy/bank-statement/conciliation/history.js';
import workspaceHandler from '../../../api_legacy/bank-statement/conciliation/workspace.js';
import type {
  VercelRequest,
  VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

const HANDLERS: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<unknown>> = {
  history: historyHandler,
  workspace: workspaceHandler,
};

function readAction(req: VercelRequest): string {
  const raw = req.query?.action;
  if (Array.isArray(raw)) return String(raw[0] || '').trim().toLowerCase();
  if (raw) return String(raw).trim().toLowerCase();

  const url = (req as { url?: string }).url || '';
  const match = url.match(/\/conciliation\/([^/?]+)/);
  return match ? String(match[1] || '').trim().toLowerCase() : '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = readAction(req);
  const selected = HANDLERS[action];

  if (!selected) {
    return res.status(404).json({
      error: 'Not found',
      message: `Rota de conciliation bank-statement inválida: ${action || '(vazia)'}`,
    });
  }

  return selected(req, res);
}
