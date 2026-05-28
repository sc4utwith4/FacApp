import agentToolsHandler from '../../../../api_legacy/bank-statement/chat/agent-tools/[action].js';
import type {
  VercelRequest,
  VercelResponse,
} from '../../../../src/server/bank-statement/_shared.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return agentToolsHandler(req, res);
}
