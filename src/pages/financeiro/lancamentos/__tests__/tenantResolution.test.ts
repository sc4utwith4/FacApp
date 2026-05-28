import { describe, expect, it } from 'vitest';

import { resolveTenantEmpresaId } from '../tenantResolution';

describe('tenantResolution', () => {
  it('retorna missing_profile quando perfil não existe', () => {
    expect(resolveTenantEmpresaId(null)).toEqual({
      reason: 'missing_profile',
      empresaId: null,
    });
  });

  it('retorna missing_empresa_id quando perfil não tem empresa vinculada', () => {
    expect(resolveTenantEmpresaId({ empresa_id: null })).toEqual({
      reason: 'missing_empresa_id',
      empresaId: null,
    });
  });

  it('retorna invalid_empresa_id quando empresa_id não é UUID válido', () => {
    expect(resolveTenantEmpresaId({ empresa_id: 'empresa-fixa-legada' })).toEqual({
      reason: 'invalid_empresa_id',
      empresaId: null,
    });
  });

  it('retorna ok com empresa_id válido de tenant', () => {
    expect(
      resolveTenantEmpresaId({
        empresa_id: '11111111-2222-4333-8444-555555555555',
      }),
    ).toEqual({
      reason: 'ok',
      empresaId: '11111111-2222-4333-8444-555555555555',
    });
  });
});
