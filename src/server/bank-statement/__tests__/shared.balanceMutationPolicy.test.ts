import { afterEach, describe, expect, it, vi } from 'vitest';
import { isBankReconciliationBalanceMutationDisabled } from '../_shared';

describe('isBankReconciliationBalanceMutationDisabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to true when env is not set', () => {
    vi.stubEnv('BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION', '');
    vi.stubEnv('N8N_BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION', '');
    expect(isBankReconciliationBalanceMutationDisabled()).toBe(true);
  });

  it('returns false for explicit disabled tokens', () => {
    vi.stubEnv('BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION', 'false');
    expect(isBankReconciliationBalanceMutationDisabled()).toBe(false);

    vi.stubEnv('BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION', '0');
    expect(isBankReconciliationBalanceMutationDisabled()).toBe(false);
  });

  it('returns true for explicit truthy tokens', () => {
    vi.stubEnv('BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION', 'true');
    expect(isBankReconciliationBalanceMutationDisabled()).toBe(true);

    vi.stubEnv('BANK_RECONCILIATION_DISABLE_BALANCE_MUTATION', 'on');
    expect(isBankReconciliationBalanceMutationDisabled()).toBe(true);
  });
});
