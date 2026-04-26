import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';

describe('Auth Store', () => {
  beforeEach(() => {
    // Reset store state before each test
    const { logout } = useAuthStore.getState();
    logout();
    vi.clearAllMocks();
  });

  it('should start unauthenticated', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('should set user and authenticate', () => {
    const { setUser } = useAuthStore.getState();
    const user = { id: 1, username: 'admin' };

    setUser(user);

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user).toEqual(user);
  });

  it('should logout user', () => {
    const { setUser, logout } = useAuthStore.getState();

    // First set user
    setUser({ id: 1, username: 'admin' });
    expect(useAuthStore.getState().isAuthenticated).toBe(true);

    // Then logout
    logout();

    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
  });

  it('should handle mustChangePassword flag', () => {
    const { setMustChangePassword } = useAuthStore.getState();

    expect(useAuthStore.getState().mustChangePassword).toBe(false);

    setMustChangePassword(true);
    expect(useAuthStore.getState().mustChangePassword).toBe(true);

    setMustChangePassword(false);
    expect(useAuthStore.getState().mustChangePassword).toBe(false);
  });

  it('should clear mustChangePassword on logout', () => {
    const { setUser, setMustChangePassword, logout } = useAuthStore.getState();

    setUser({ id: 1, username: 'admin' });
    setMustChangePassword(true);

    expect(useAuthStore.getState().mustChangePassword).toBe(true);

    logout();

    expect(useAuthStore.getState().mustChangePassword).toBe(false);
  });
});
