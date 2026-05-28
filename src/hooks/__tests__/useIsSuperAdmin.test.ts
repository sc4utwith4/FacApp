import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { __resetUseIsSuperAdminCacheForTests, useIsSuperAdmin } from '../useIsSuperAdmin';

type SessionUser = {
  id: string;
  email?: string | null;
};

type ProfileRow = {
  id: string;
  is_super_admin?: boolean | null;
} | null;

const mocks = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
  mockMaybeSingle: vi.fn(),
  mockEq: vi.fn(),
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  authSubscription: { unsubscribe: vi.fn() },
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mocks.mockGetSession,
      onAuthStateChange: mocks.mockOnAuthStateChange,
    },
    from: mocks.mockFrom,
  },
}));

const setupSupabaseMocks = (opts: {
  user: SessionUser | null;
  profile: ProfileRow;
  profileError?: { message: string } | null;
}) => {
  const session = opts.user
    ? {
        user: opts.user,
      }
    : null;

  mocks.mockGetSession.mockResolvedValue({
    data: { session },
  });

  mocks.mockOnAuthStateChange.mockReturnValue({
    data: { subscription: mocks.authSubscription },
  });

  mocks.mockMaybeSingle.mockResolvedValue({
    data: opts.profile,
    error: opts.profileError ?? null,
  });

  mocks.mockEq.mockReturnValue({
    maybeSingle: mocks.mockMaybeSingle,
  });

  mocks.mockSelect.mockReturnValue({
    eq: mocks.mockEq,
  });

  mocks.mockFrom.mockReturnValue({
    select: mocks.mockSelect,
  });
};

describe('useIsSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetUseIsSuperAdminCacheForTests();
  });

  afterEach(() => {
    mocks.authSubscription.unsubscribe.mockClear();
  });

  it('retorna false quando nao ha sessao', async () => {
    setupSupabaseMocks({
      user: null,
      profile: null,
    });

    const { result } = renderHook(() => useIsSuperAdmin());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isSuperAdmin).toBe(false);
    expect(mocks.mockFrom).not.toHaveBeenCalled();
  });

  it('retorna true somente quando profiles.is_super_admin for true', async () => {
    setupSupabaseMocks({
      user: { id: 'user-1', email: 'admin@example.com' },
      profile: { id: 'user-1', is_super_admin: true },
    });

    const { result } = renderHook(() => useIsSuperAdmin());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isSuperAdmin).toBe(true);
  });

  it('nao concede super admin por fallback de email quando profile falha', async () => {
    const legacyEmail = ['daviolborges14', 'gmail.com'].join('@');

    setupSupabaseMocks({
      user: { id: 'user-2', email: legacyEmail },
      profile: null,
      profileError: { message: 'relation "profiles" does not exist' },
    });

    const { result } = renderHook(() => useIsSuperAdmin());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isSuperAdmin).toBe(false);
  });
});
