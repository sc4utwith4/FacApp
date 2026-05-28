import confirmHandler from '../../../api_legacy/bank-statement/reconcile/confirm.js';
import createHandler from '../../../api_legacy/bank-statement/reconcile/create.js';
import ignoreHandler from '../../../api_legacy/bank-statement/reconcile/ignore.js';
import linkExistingHandler from '../../../api_legacy/bank-statement/reconcile/link-existing.js';
import rejectHandler from '../../../api_legacy/bank-statement/reconcile/reject.js';
import searchExistingHandler from '../../../api_legacy/bank-statement/reconcile/search-existing.js';
import splitHandler from '../../../api_legacy/bank-statement/reconcile/split.js';
import unignoreHandler from '../../../api_legacy/bank-statement/reconcile/unignore.js';
import type {
  VercelRequest,
  VercelResponse,
} from '../../../src/server/bank-statement/_shared.js';

const HANDLERS: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<unknown>
> = {
  confirm: confirmHandler,
  create: createHandler,
  ignore: ignoreHandler,
  'link-existing': linkExistingHandler,
  reject: rejectHandler,
  'search-existing': searchExistingHandler,
  split: splitHandler,
  unignore: unignoreHandler,
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
      message: `Rota de reconcile bank-statement invalida: ${action || '(vazia)'}`,
    });
  }

  return selected(req, res);
}
