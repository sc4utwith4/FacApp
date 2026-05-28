import { describe, expect, it } from 'vitest';

const mod = await import('../provision-bank-qa-user.cjs');

describe('provision-bank-qa-user', () => {
  it('identifica email de QA por alias +qa', () => {
    expect(mod.isLikelyQaEmail('daviolborges14+qa@gmail.com')).toBe(true);
  });

  it('identifica email pessoal como nao-QA', () => {
    expect(mod.isLikelyQaEmail('daviolborges14@gmail.com')).toBe(false);
  });

  it('bloqueia email pessoal sem override', () => {
    expect(() => mod.validateQaEmailPolicy('daviolborges14@gmail.com', false)).toThrow(
      /Provisionamento QA bloqueado/
    );
  });

  it('permite email pessoal com override explicito', () => {
    expect(() => mod.validateQaEmailPolicy('daviolborges14@gmail.com', true)).not.toThrow();
  });

  it('parseBooleanEnv entende valores truthy esperados', () => {
    expect(mod.parseBooleanEnv('true')).toBe(true);
    expect(mod.parseBooleanEnv('1')).toBe(true);
    expect(mod.parseBooleanEnv('yes')).toBe(true);
    expect(mod.parseBooleanEnv('on')).toBe(true);
    expect(mod.parseBooleanEnv('false')).toBe(false);
    expect(mod.parseBooleanEnv('')).toBe(false);
  });
});
