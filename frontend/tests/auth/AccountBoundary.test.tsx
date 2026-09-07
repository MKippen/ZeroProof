import { StrictMode, useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import api from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useNotificationStore } from '@/stores/notificationStore';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), toast: vi.fn() }));
vi.mock('@/api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), invalidateCsrfToken: vi.fn() } }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mocks.toast, toasts: [] }) }));
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }));
vi.mock('@/stores/websocketStore', () => ({ useWebSocketStore: Object.assign(() => mocks, { getState: () => mocks }) }));
vi.mock('@/components/layout/Layout', () => ({
  Layout: () => {
    const { credentialChangePending, sessionVersion } = useAuthStore();
    useEffect(() => {
      if (!credentialChangePending) mocks.connect();
      return mocks.disconnect;
    }, [credentialChangePending, sessionVersion]);
    return <Outlet />;
  },
}));
vi.mock('@/pages/DashboardPage', () => ({ DashboardPage: () => <h1>Protected dashboard</h1> }));
vi.mock('@/components/SystemUpdateCard', () => ({ SystemUpdateCard: () => null }));

const currentUser = (mustChangePassword = false) => ({ success: true, data: { user: { id: 1, mustChangePassword } } });
const unauthorized = { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
const outage = { success: false, error: { code: 'AUTH_UNAVAILABLE', message: 'Account service unavailable' } };

function renderApp(path = '/dashboard', strict = false) {
  window.history.replaceState({}, '', path);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const app = <QueryClientProvider client={queryClient}><App /></QueryClientProvider>;
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { ...view, queryClient };
}

async function fillPasswordChange() {
  await userEvent.type(await screen.findByLabelText('Current Password', { exact: true }), 'current-password');
  await userEvent.type(screen.getByLabelText('New Password', { exact: true }), 'replacement-password');
  await userEvent.type(screen.getByLabelText('Confirm New Password', { exact: true }), 'replacement-password');
}

describe('authoritative account routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    useAuthStore.setState({
      user: null, isAuthenticated: false, mustChangePassword: false, initialized: null,
      verificationStatus: 'checking', verificationError: null,
      credentialChangePending: false,
      logoutPending: false,
      sessionVersion: useAuthStore.getState().sessionVersion + 1,
    });
    useNotificationStore.getState().reset();
  });

  it('ignores a forged stored login and never mounts protected content before verification', async () => {
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ state: { user: { id: 1 }, isAuthenticated: true } }));
    let resolve!: (value: typeof unauthorized) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((done) => { resolve = done; }))
      .mockResolvedValueOnce({ success: true, data: { initialized: true } });
    renderApp();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your account');
    expect(screen.queryByText('Protected dashboard')).not.toBeInTheDocument();
    expect(mocks.connect).not.toHaveBeenCalled();
    await act(async () => { resolve(unauthorized); });
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.removeItem).toHaveBeenCalledWith('auth-storage');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('restores a valid cookie session with no persisted user and deduplicates StrictMode verification', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser());
    renderApp('/dashboard', true);
    expect(await screen.findByText('Protected dashboard')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/auth/me');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('preserves a retryable account error instead of inventing a logout or setup state', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(outage).mockResolvedValueOnce(currentUser());
    renderApp();
    expect(await screen.findByRole('alert')).toHaveTextContent('Account service unavailable');
    expect(window.location.pathname).toBe('/dashboard');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Sign In' })).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith('/auth/setup-status');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
    expect(await screen.findByText('Protected dashboard')).toBeInTheDocument();
  });

  it('requires a successful setup-status probe before routing an unauthenticated installation', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(unauthorized).mockResolvedValueOnce(outage);
    renderApp('/setup');
    expect(await screen.findByRole('alert')).toHaveTextContent('Account service unavailable');
    expect(screen.queryByRole('button', { name: 'Create administrator account' })).not.toBeInTheDocument();
    vi.mocked(api.get).mockResolvedValueOnce(unauthorized).mockResolvedValueOnce({ success: true, data: { initialized: false } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
    expect(await screen.findByRole('button', { name: 'Create administrator account' })).toBeInTheDocument();
  });

  it('requires a password change before any protected layout or websocket can mount', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser(true));
    renderApp();
    expect(await screen.findByText('Change your password')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/change-password');
    expect(mocks.connect).not.toHaveBeenCalled();
    act(() => {
      window.history.pushState({}, '', '/settings');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await waitFor(() => expect(window.location.pathname).toBe('/change-password'));
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('keeps the required-password form authenticated after one rejected current password', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser(true));
    vi.mocked(api.post).mockResolvedValue({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } });
    renderApp();
    await fillPasswordChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(window.location.pathname).toBe('/change-password');
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('blocks sign-out during a required password change, including a click before the disabled state rerenders', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser(true));
    renderApp();
    const signOut = await screen.findByRole('button', { name: 'Sign out' });
    act(() => {
      useAuthStore.getState().beginCredentialChange();
      fireEvent.click(signOut);
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(signOut).toBeDisabled();
    act(() => useAuthStore.getState().finishCredentialChange());
    await fillPasswordChange();
    let resolve!: (value: { success: boolean; error: { code: string; message: string } }) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    await userEvent.click(signOut);
    expect(signOut).toBeDisabled();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/change-password', expect.anything());
    await act(async () => resolve({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } }));
    expect(signOut).toBeEnabled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it.each([true, false])('blocks required password submission during logout and preserves its result (success=%s)', async (success) => {
    vi.mocked(api.get).mockResolvedValue(currentUser(true));
    let resolve!: (response: { success: boolean; error?: { code: string; message: string } }) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderApp();
    await fillPasswordChange();
    const version = useAuthStore.getState().sessionVersion;
    const changePassword = screen.getByRole('button', { name: 'Change Password', exact: true });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(changePassword).toBeDisabled();
    expect(screen.getByLabelText('Current Password', { exact: true })).toBeDisabled();
    fireEvent.submit(changePassword.closest('form')!);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/auth/logout');
    expect(useAuthStore.getState().sessionVersion).toBe(version);
    expect(useAuthStore.getState().credentialChangePending).toBe(false);
    await act(async () => resolve(success ? { success } : { success, error: { code: 'NETWORK_ERROR', message: 'Connection lost' } }));
    expect(useAuthStore.getState().logoutPending).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(!success);
    if (success) {
      expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    } else {
      expect(changePassword).toBeEnabled();
      expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    }
  });

  it('opens the console only after a password change is authoritatively verified', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(currentUser(true));
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderApp();
    await fillPasswordChange();
    let resolve!: (value: ReturnType<typeof currentUser>) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Checking your account');
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(useAuthStore.getState().mustChangePassword).toBe(true);
    await act(async () => { resolve(currentUser()); });
    expect(await screen.findByText('Protected dashboard')).toBeInTheDocument();
    expect(useAuthStore.getState().mustChangePassword).toBe(false);
    expect(api.invalidateCsrfToken).toHaveBeenCalled();
  });

  it('retries only verification after password-change success followed by an outage', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(currentUser(true)).mockResolvedValueOnce(outage);
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderApp();
    await fillPasswordChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Account service unavailable');
    expect(mocks.connect).not.toHaveBeenCalled();
    vi.mocked(api.get).mockResolvedValueOnce(currentUser());
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading data' }));
    expect(await screen.findByText('Protected dashboard')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('keeps password-change restrictions when authoritative verification still requires them', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser(true));
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { mustChangePassword: false } });
    renderApp();
    await fillPasswordChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(await screen.findByLabelText('Current Password', { exact: true })).toHaveValue('');
    expect(window.location.pathname).toBe('/change-password');
    expect(useAuthStore.getState().mustChangePassword).toBe(true);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('shows the changed-password sign-in notice after a committed change loses its session', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser(true));
    vi.mocked(api.post).mockImplementationOnce(async () => {
      // The API client handles this distinct 401 by expiring local auth.
      useAuthStore.getState().logout();
      return { success: false, error: { code: 'PASSWORD_CHANGED_SESSION_EXPIRED', message: 'Password changed. Sign in with your new password.' } };
    });
    renderApp();
    await fillPasswordChange();
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'Password changed', description: 'Sign in with your new password.' });
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('updates shared setup state after another tab creates the administrator', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(unauthorized).mockResolvedValueOnce({ success: true, data: { initialized: false } });
    vi.mocked(api.post).mockResolvedValue({ success: false, error: { code: 'ALREADY_INITIALIZED', message: 'Setup has already been completed' } });
    renderApp('/setup');
    await userEvent.type(await screen.findByLabelText('Password', { exact: true }), 'first-admin-password');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'first-admin-password');
    await userEvent.click(screen.getByRole('button', { name: 'Create administrator account' }));
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/login');
    expect(useAuthStore.getState().initialized).toBe(true);
  });

  it('clears query and notification caches when the account logs out', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser());
    const { queryClient } = renderApp();
    await screen.findByText('Protected dashboard');
    queryClient.setQueryData(['private-findings'], { secret: 'prior-account-data' });
    useNotificationStore.setState({ unreadCount: 5, notifications: [{
      id: 'old-account', type: 'CONFIG_CHANGED', severity: 'INFO', title: 'Private finding',
      message: 'Prior account details', isRead: false, createdAt: '2026-09-06T12:00:00Z',
    }] });
    act(() => useAuthStore.getState().logout());
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useNotificationStore.getState().notifications).toEqual([]);
    expect(useNotificationStore.getState().unreadCount).toBe(0);
    expect(mocks.disconnect).toHaveBeenCalled();
  });

  it('does not resurrect a session from a delayed verification after logout', async () => {
    let resolve!: (value: ReturnType<typeof currentUser>) => void;
    vi.mocked(api.get).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    renderApp();
    act(() => useAuthStore.getState().logout());
    await act(async () => { resolve(currentUser()); });
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('preserves the ordinary Settings password-change flow and verifies the rotated session', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser());
    vi.mocked(api.post).mockResolvedValue({ success: true });
    renderApp('/settings');
    await fillPasswordChange();
    const callsBeforeChange = vi.mocked(api.get).mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(callsBeforeChange + 1));
    expect(await screen.findByLabelText('Current Password', { exact: true })).toHaveValue('');
    expect(window.location.pathname).toBe('/settings');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(mocks.connect.mock.calls.length).toBeGreaterThan(1);
  });

  it('pauses live updates without clearing active account queries while a password submission is pending', async () => {
    vi.mocked(api.get).mockResolvedValue(currentUser());
    let resolve!: (response: { success: boolean; error: { code: string; message: string } }) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const { queryClient } = renderApp('/settings');
    await fillPasswordChange();
    queryClient.setQueryData(['private-findings'], { lastGood: true });
    const connections = mocks.connect.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Change Password', exact: true }));
    expect(queryClient.getQueryData(['private-findings'])).toEqual({ lastGood: true });
    expect(useAuthStore.getState().credentialChangePending).toBe(true);
    expect(mocks.connect).toHaveBeenCalledTimes(connections);
    await act(async () => resolve({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' } }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect');
    expect(useAuthStore.getState().credentialChangePending).toBe(false);
    expect(mocks.connect).toHaveBeenCalledTimes(connections + 1);
    expect(queryClient.getQueryData(['private-findings'])).toEqual({ lastGood: true });
  });
});
