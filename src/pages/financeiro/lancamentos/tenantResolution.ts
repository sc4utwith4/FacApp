import { ensureUUID } from '@/lib/uuid';

export type ProfileEmpresaRow = {
  empresa_id: string | null;
} | null;

export type TenantResolution =
  | { reason: 'ok'; empresaId: string }
  | { reason: 'missing_profile'; empresaId: null }
  | { reason: 'missing_empresa_id'; empresaId: null }
  | { reason: 'invalid_empresa_id'; empresaId: null };

export function resolveTenantEmpresaId(profile: ProfileEmpresaRow): TenantResolution {
  if (!profile) {
    return { reason: 'missing_profile', empresaId: null };
  }
  if (!profile.empresa_id) {
    return { reason: 'missing_empresa_id', empresaId: null };
  }

  const empresaId = ensureUUID(profile.empresa_id);
  if (!empresaId) {
    return { reason: 'invalid_empresa_id', empresaId: null };
  }

  return { reason: 'ok', empresaId };
}
