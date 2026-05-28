import { describe, expect, it } from 'vitest';

const mod = await import('../auth-set-password-admin.cjs');

describe('auth-set-password-admin', () => {
  it('parseia argumentos com senha explicita', () => {
    const parsed = mod.parseArgs(['daviolborges14@gmail.com', '--password', 'Senha@123']);
    expect(parsed.email).toBe('daviolborges14@gmail.com');
    expect(parsed.password).toBe('Senha@123');
    expect(parsed.updateQaEnv).toBe(false);
  });

  it('parseia flag update qa env', () => {
    const parsed = mod.parseArgs(['daviolborges14@gmail.com', '--update-qa-env']);
    expect(parsed.updateQaEnv).toBe(true);
  });

  it('valida exigencia de senha explicita ou persistencia em env', () => {
    expect(() =>
      mod.validateArgs({
        email: 'daviolborges14@gmail.com',
        password: '',
        updateQaEnv: false,
        help: false,
      })
    ).toThrow(/Informe --password ou use --update-qa-env/);
  });

  it('aceita modo help sem email', () => {
    expect(() =>
      mod.validateArgs({
        email: '',
        password: '',
        updateQaEnv: false,
        help: true,
      })
    ).not.toThrow();
  });
});
