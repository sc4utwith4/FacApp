import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeBankChatReviewInteraction } from '../actionExecutor';

function makeAdminClientPilotGateMock() {
  return {
    from: vi.fn((table: string) => {
      if (table === 'extratos_import') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { id: 'import-1', file_format: 'ofx' },
                    error: null,
                  })),
                })),
              })),
            })),
          })),
        };
      }

      if (table === 'bank_reconciliation_audit_log') {
        return {
          insert: vi.fn(async () => ({ error: null })),
        };
      }

      throw new Error(`Unexpected table access during pilot gate test: ${table}`);
    }),
  };
}

describe('executeBankChatReviewInteraction pilot gate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns operational message and skips queue processing outside pilot scope', async () => {
    vi.stubEnv('BANK_RECONCILIATION_PILOT_EMPRESA_ID', 'empresa-piloto');

    const adminClient = makeAdminClientPilotGateMock();

    const result = await executeBankChatReviewInteraction({
      adminClient: adminClient as never,
      baseUrl: 'https://assfac-plataforma.vercel.app',
      accessToken: 'token',
      empresaId: 'empresa-fora-piloto',
      userId: 'user-1',
      sessionId: 'session-1',
      contaBancariaId: 'conta-1',
      dataReferencia: '2026-02-23',
      importId: 'import-1',
      interaction: {
        kind: 'review_answer',
        case_id: 'case-1',
        decision: 'keep_pending',
      },
    });

    expect(result.assistant_message).toContain('Revisao guiada indisponivel');
    expect(result.review_guidance).toBeNull();
    expect(adminClient.from).toHaveBeenCalledWith('bank_reconciliation_audit_log');
  });
});
