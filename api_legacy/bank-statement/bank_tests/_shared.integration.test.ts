import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBankReconciliationWebhookTimeoutMs,
  isEmpresaHeaderConsistent,
  isValidIntegrationSecret,
  parseIntegrationScope,
  type VercelRequest,
} from '../../../src/server/bank-statement/_shared';

const makeRequest = (headers: Record<string, string> = {}): VercelRequest => ({
  method: 'POST',
  headers,
  body: {},
});

describe('bank _shared integration helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('valida x-integration-secret com sucesso', () => {
    const req = makeRequest({ 'x-integration-secret': 'secret-123' });

    expect(isValidIntegrationSecret(req, 'secret-123')).toBe(true);
    expect(isValidIntegrationSecret(req, 'secret-999')).toBe(false);
  });

  it('garante consistencia opcional de x-empresa-id', () => {
    const noHeaderReq = makeRequest();
    expect(isEmpresaHeaderConsistent(noHeaderReq, 'empresa-1')).toBe(true);

    const consistentReq = makeRequest({ 'x-empresa-id': 'empresa-1' });
    expect(isEmpresaHeaderConsistent(consistentReq, 'empresa-1')).toBe(true);

    const inconsistentReq = makeRequest({ 'x-empresa-id': 'empresa-2' });
    expect(isEmpresaHeaderConsistent(inconsistentReq, 'empresa-1')).toBe(false);
  });

  it('parseia escopo de integracao com validacoes obrigatorias', () => {
    const ok = parseIntegrationScope(
      {
        empresa_id: 'empresa-1',
        conta_bancaria_id: 'conta-1',
        import_id: 'import-1',
      },
      {
        requireContaBancariaId: true,
        requireImportId: true,
      }
    );

    expect(ok.error).toBeNull();
    expect(ok.scope).toMatchObject({
      empresaId: 'empresa-1',
      contaBancariaId: 'conta-1',
      importId: 'import-1',
    });

    const missingConta = parseIntegrationScope(
      {
        empresa_id: 'empresa-1',
      },
      {
        requireContaBancariaId: true,
      }
    );

    expect(missingConta.scope).toBeNull();
    expect(missingConta.error).toContain('conta_bancaria_id');
  });

  it('normaliza timeout do webhook de conciliacao bancaria', () => {
    vi.stubEnv('N8N_BANK_RECONCILIATION_TIMEOUT_MS', '25000');
    expect(getBankReconciliationWebhookTimeoutMs()).toBe(25000);

    vi.stubEnv('N8N_BANK_RECONCILIATION_TIMEOUT_MS', '0');
    expect(getBankReconciliationWebhookTimeoutMs()).toBe(15000);

    vi.stubEnv('N8N_BANK_RECONCILIATION_TIMEOUT_MS', '999999');
    expect(getBankReconciliationWebhookTimeoutMs()).toBe(120000);
  });
});
