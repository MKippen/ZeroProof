import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { PasswordChangeForm } from '@/components/PasswordChangeForm';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), toast: vi.fn() }));
vi.mock('@/api/client', () => ({ default: { post: vi.fn(), invalidateCsrfToken: vi.fn() } }));
vi.mock('@/stores/websocketStore', () => ({ useWebSocketStore: () => mocks }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/layout/NotificationBell', () => ({ NotificationBell: () => null }));

function renderLayout(withPasswordForm = false) {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="dashboard" element={<><p>Dashboard content</p>{withPasswordForm && <PasswordChangeForm />}</>} />
        </Route>
        <Route path="login" element={<p>Login screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Layout session lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.getState().setUser({ id: 1 });
  });

  it('disconnects live updates when protected content unmounts', () => {
    const view = renderLayout();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
  });

  it('pauses live updates during password rotation and reconnects after successful verification', () => {
    renderLayout();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    act(() => useAuthStore.getState().beginCredentialChange());
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Logout' })).toBeDisabled();
    act(() => useAuthStore.getState().beginVerification());
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    act(() => useAuthStore.getState().setUser({ id: 1, mustChangePassword: false }));
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it('resumes live updates after a rejected password without logging out', () => {
    renderLayout();
    act(() => useAuthStore.getState().beginCredentialChange());
    act(() => useAuthStore.getState().finishCredentialChange());
    expect(mocks.connect).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('does not submit logout when password rotation starts before the disabled button rerenders', () => {
    renderLayout();
    const logout = screen.getByRole('button', { name: 'Logout' });
    act(() => {
      useAuthStore.getState().beginCredentialChange();
      fireEvent.click(logout);
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(logout).toBeDisabled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it.each([true, false])('blocks password submission while logout is pending and preserves its result (success=%s)', async (success) => {
    let resolve!: (response: { success: boolean; error?: { code: string; message: string } }) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderLayout(true);
    fireEvent.change(screen.getByLabelText('Current Password', { exact: true }), { target: { value: 'current-password' } });
    fireEvent.change(screen.getByLabelText('New Password', { exact: true }), { target: { value: 'replacement-password' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'replacement-password' } });
    const changePassword = screen.getByRole('button', { name: 'Change Password', exact: true });
    const version = useAuthStore.getState().sessionVersion;
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(changePassword).toBeDisabled();
    fireEvent.submit(changePassword.closest('form')!);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/logout');
    expect(useAuthStore.getState().sessionVersion).toBe(version);
    expect(useAuthStore.getState().credentialChangePending).toBe(false);
    await act(async () => resolve(success ? { success } : { success, error: { code: 'NETWORK_ERROR', message: 'Connection lost' } }));
    expect(useAuthStore.getState().logoutPending).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(!success);
    if (success) {
      expect(await screen.findByText('Login screen')).toBeInTheDocument();
    } else {
      expect(changePassword).toBeEnabled();
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not sign out' }));
    }
  });

  it('reports failed logout and keeps the session available for retry', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: false, error: { code: 'NETWORK_ERROR', message: 'Connection lost' } });
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Could not sign out' })));
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(mocks.disconnect).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeEnabled();
    expect(screen.getByText('Dashboard content')).toBeInTheDocument();
  });

  it('clears authentication and disconnects after server logout succeeds', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderLayout();
    await userEvent.click(screen.getByRole('button', { name: 'Logout' }));
    expect(await screen.findByText('Login screen')).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(api.invalidateCsrfToken).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalled();
  });
});
