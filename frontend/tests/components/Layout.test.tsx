import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { useAuthStore } from '@/stores/authStore';
import api from '@/api/client';

const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), toast: vi.fn() }));
vi.mock('@/api/client', () => ({ default: { post: vi.fn(), invalidateCsrfToken: vi.fn() } }));
vi.mock('@/stores/websocketStore', () => ({ useWebSocketStore: () => mocks }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/layout/NotificationBell', () => ({ NotificationBell: () => null }));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route element={<Layout />}><Route path="dashboard" element={<p>Dashboard content</p>} /></Route>
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
