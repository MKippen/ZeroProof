import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});
const csrf = (token = 'token-1') => json({ success: true, data: { csrfToken: token } });
const failure = (code: string, status: number) => json({
  success: false, error: { code, message: code },
}, status);

describe('API client', () => {
  let client: ApiClient;
  const fetchMock = vi.mocked(fetch);

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    client = new ApiClient();
    window.history.replaceState({}, '', '/login');
    useAuthStore.getState().setUser({ id: 1 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    useAuthStore.getState().logout();
  });

  it('keeps the session and submits once when the current password is incorrect', async () => {
    fetchMock.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(failure('INVALID_PASSWORD', 401));

    const result = await client.post('/auth/change-password', {
      currentPassword: 'incorrect', newPassword: 'a-new-password',
    });

    expect(result.error?.code).toBe('INVALID_PASSWORD');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not expire the session for an upstream authentication failure', async () => {
    fetchMock.mockResolvedValueOnce(failure('CONTROLLER_AUTH_FAILED', 401));
    expect((await client.get('/unifi/status')).success).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves an unauthenticated /me response to the account bootstrap without a retry or logout', async () => {
    fetchMock.mockResolvedValueOnce(failure('UNAUTHORIZED', 401));
    expect((await client.get('/auth/me')).error?.code).toBe('UNAUTHORIZED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('requires password change after a privileged 403 without replaying the mutation', async () => {
    fetchMock.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(failure('PASSWORD_CHANGE_REQUIRED', 403));
    expect((await client.post('/devices/run')).error?.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(useAuthStore.getState().mustChangePassword).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports password-change partial success distinctly and signs out without replay', async () => {
    useAuthStore.getState().beginCredentialChange();
    fetchMock.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(failure('PASSWORD_CHANGED_SESSION_EXPIRED', 401));
    expect((await client.post('/auth/change-password', { currentPassword: 'old-password', newPassword: 'new-password' })).error?.code)
      .toBe('PASSWORD_CHANGED_SESSION_EXPIRED');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().credentialChangePending).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards a delayed 401 from before password rotation without expiring the current session', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const oldRead = client.get('/dashboard');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    useAuthStore.getState().beginCredentialChange();
    resolve(failure('UNAUTHORIZED', 401));
    expect((await oldRead).error?.code).toBe('SESSION_CHANGED');
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not send background requests started during password rotation', async () => {
    useAuthStore.getState().beginCredentialChange();
    expect((await client.get('/dashboard')).error?.code).toBe('SESSION_CHANGED');
    expect((await client.post('/devices/run')).error?.code).toBe('SESSION_CHANGED');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    fetchMock.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json({ success: true }));
    expect((await client.post('/auth/change-password', { currentPassword: 'old-password', newPassword: 'new-password' })).success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not submit a mutation waiting for CSRF if the account logs out', async () => {
    let resolve!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    const pending = client.post('/devices/run');
    useAuthStore.getState().logout();
    resolve(csrf());
    expect((await pending).error?.code).toBe('SESSION_CHANGED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an expired read once, then clears the session', async () => {
    fetchMock.mockImplementation(async () => failure('UNAUTHORIZED', 401));
    const result = client.get('/dashboard');
    await vi.advanceTimersByTimeAsync(1500);

    expect((await result).error?.code).toBe('UNAUTHORIZED');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('recovers a read after a brief session interruption', async () => {
    fetchMock.mockResolvedValueOnce(failure('UNAUTHORIZED', 401))
      .mockResolvedValueOnce(json({ success: true, data: { ready: true } }));
    const result = client.get('/dashboard');
    await vi.advanceTimersByTimeAsync(1500);

    expect((await result).success).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('never replays a mutation after an authentication failure', async () => {
    fetchMock.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(failure('UNAUTHORIZED', 401));
    expect((await client.post('/devices/run')).success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes CSRF for uploads and lets the browser set the multipart boundary', async () => {
    const file = new FormData();
    file.append('file', new Blob(['configuration']), 'config.json');
    fetchMock.mockResolvedValueOnce(csrf('old'))
      .mockResolvedValueOnce(failure('CSRF_TOKEN_INVALID', 403))
      .mockResolvedValueOnce(csrf('fresh'))
      .mockResolvedValueOnce(json({ success: true }));

    expect((await client.upload('/config/import', file)).success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const index of [1, 3]) {
      const config = fetchMock.mock.calls[index][1]!;
      expect(config.body).toBe(file);
      expect(config.credentials).toBe('include');
      expect(new Headers(config.headers).has('Content-Type')).toBe(false);
    }
    expect(new Headers(fetchMock.mock.calls[3][1]!.headers).get('X-CSRF-Token')).toBe('fresh');
  });

  it('does not loop when the refreshed CSRF token is rejected', async () => {
    fetchMock.mockImplementation(async (url) => String(url).endsWith('/csrf')
      ? csrf() : failure('CSRF_TOKEN_INVALID', 403));
    expect((await client.post('/settings')).error?.code).toBe('CSRF_TOKEN_INVALID');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not cache an in-flight token from a previous session after invalidation', async () => {
    let resolveOld!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(csrf('new-session'))
      .mockResolvedValue(json({ success: true }));

    const oldRequest = client.post('/before-login');
    client.invalidateCsrfToken();
    await client.post('/after-login');
    resolveOld(csrf('old-session'));
    await oldRequest;
    await client.post('/settings');

    const config = fetchMock.mock.calls.at(-1)![1]!;
    expect(new Headers(config.headers).get('X-CSRF-Token')).toBe('new-session');
  });

  it.each(['<html>Bad gateway</html>', '', 'null', '[]', '{"message":"ok"}'])(
    'returns a structured failure for an invalid response: %s', async (body) => {
      fetchMock.mockResolvedValueOnce(new Response(body));
      expect((await client.get('/dashboard')).error?.code).toBe('INVALID_RESPONSE');
    },
  );

  it('accepts a successful no-content response', async () => {
    fetchMock.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await client.delete('/notifications/1')).toEqual({ success: true });
  });

  it.each([false, 0, '', null])('preserves a JSON body of %s', async (body) => {
    fetchMock.mockResolvedValueOnce(csrf()).mockResolvedValueOnce(json({ success: true }));
    await client.post('/settings', body);
    expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify(body));
  });
});
