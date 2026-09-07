import { EventEmitter } from 'node:events';
import type { Request } from 'express';
import { closeAccountWebSockets, closeSessionWebSockets, protectWebSocket } from '../../../src/api/middleware/websocket';
import { credentialVersion } from '../../../src/services/accountSession';
import prisma from '../../../src/services/database';

function socket() {
  const ws = new EventEmitter() as EventEmitter & { close: jest.Mock; readyState: number };
  ws.readyState = 1;
  ws.close = jest.fn(() => { ws.readyState = 3; ws.emit('close'); });
  return ws as unknown as Parameters<typeof protectWebSocket>[0];
}

function request(origin: string | undefined = 'https://zeroproof.local', host = 'zeroproof.local') {
  const req = {
    sessionID: 'session-1', protocol: 'https',
    get: (name: string) => ({ origin, host })[name],
    session: { userId: 1, credentialVersion: credentialVersion('original-hash'), cookie: {} },
    sessionStore: { get: jest.fn() },
  };
  req.sessionStore.get.mockImplementation((_id, done) => done(null, req.session));
  return req as unknown as Request;
}

describe('WebSocket telemetry authorization', () => {
  let account: any;
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    account = { id: 1, passwordHash: 'original-hash', mustChangePassword: false, lastLogin: null };
    (prisma.user.findUnique as jest.Mock).mockImplementation(async () => account);
  });
  afterEach(() => { closeAccountWebSockets(1); jest.useRealTimers(); });

  it('rejects unauthenticated connections before subscribing to telemetry', async () => {
    const ws = socket();
    const req = request();
    delete req.session.userId;
    expect(await protectWebSocket(ws, req)).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Authentication required');
  });

  it.each(['https://attacker.example', 'null', 'https://zeroproof.local.attacker.example'])(
    'rejects an authenticated browser from origin %s', async (origin) => {
      expect(await protectWebSocket(socket(), request(origin))).toBe(false);
    }
  );

  it('allows same-origin sessions and explicitly configured frontend origins', async () => {
    expect(await protectWebSocket(socket(), request())).toBe(true);
    expect(await protectWebSocket(socket(), request('http://localhost:5173'), ['http://localhost:5173'])).toBe(true);
  });

  it.each(['127.0.0.1:5173', '192.168.1.20:5173'])('accepts a proxied development origin with its public port (%s)', async (host) => {
    const req = request(`http://${host}`, host);
    Object.defineProperty(req, 'protocol', { value: 'http' });
    expect(await protectWebSocket(socket(), req)).toBe(true);
  });

  it('preserves the origin boundary between two ports on the same hostname', async () => {
    expect(await protectWebSocket(socket(), request('https://zeroproof.local:8443', 'zeroproof.local:8443'))).toBe(true);
    expect(await protectWebSocket(socket(), request('https://zeroproof.local:9443', 'zeroproof.local:8443'))).toBe(false);
  });

  it.each(['legacy', 'reset', 'deleted', 'password-required'])('rejects connection when current account state is %s', async (state) => {
    const req = request();
    if (state === 'legacy') delete req.session.credentialVersion;
    if (state === 'reset') account.passwordHash = 'reset-hash';
    if (state === 'deleted') account = null;
    if (state === 'password-required') account.mustChangePassword = true;
    const ws = socket();
    expect(await protectWebSocket(ws, req)).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
  });

  it('closes subscriptions immediately on logout and cancels revalidation', async () => {
    const ws = socket();
    const req = request();
    await protectWebSocket(ws, req);
    closeSessionWebSockets(req.sessionID);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Session ended');
    await jest.advanceTimersByTimeAsync(60_000);
    expect(req.sessionStore.get).not.toHaveBeenCalled();
  });

  it('closes every account session immediately after a password change', async () => {
    const first = socket();
    const second = socket();
    const secondReq = request();
    Object.defineProperty(secondReq, 'sessionID', { value: 'session-2' });
    await protectWebSocket(first, request());
    await protectWebSocket(second, secondReq);
    closeAccountWebSockets(1);
    expect(first.close).toHaveBeenCalledWith(1008, 'Session ended');
    expect(second.close).toHaveBeenCalledWith(1008, 'Session ended');
  });

  it.each(['missing-session', 'reset', 'deleted', 'password-required', 'expired'])('revokes idle sockets after %s', async (state) => {
    const ws = socket();
    const req = request();
    await protectWebSocket(ws, req);
    if (state === 'missing-session') jest.mocked(req.sessionStore.get).mockImplementation((_id, done) => done(null, null));
    if (state === 'reset') account.passwordHash = 'reset-hash';
    if (state === 'deleted') account = null;
    if (state === 'password-required') account.mustChangePassword = true;
    if (state === 'expired') req.session.cookie.expires = new Date(Date.now() - 1);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
  });

  it('fails closed with retryable 1013 if the account lookup is unavailable', async () => {
    jest.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('database unavailable'));
    const ws = socket();
    expect(await protectWebSocket(ws, request())).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(1013, 'Authentication temporarily unavailable');
  });

  it.each(['session-store', 'account-database'])('fails closed with retryable 1013 during periodic %s failure', async (source) => {
    const ws = socket();
    const req = request();
    await protectWebSocket(ws, req);
    if (source === 'session-store') {
      jest.mocked(req.sessionStore.get).mockImplementation((_id, done) => done(new Error('store unavailable')));
    } else {
      jest.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('database unavailable'));
    }
    await jest.advanceTimersByTimeAsync(30_000);
    expect(ws.close).toHaveBeenCalledWith(1013, 'Authentication temporarily unavailable');
  });

  it('does not subscribe a client that disconnected during account lookup', async () => {
    let finish!: (value: any) => void;
    jest.mocked(prisma.user.findUnique).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }) as any);
    const ws = socket();
    const pending = protectWebSocket(ws, request());
    ws.close();
    finish(account);
    expect(await pending).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });

  it.each(['logout', 'password-change'])('does not subscribe an old account snapshot after %s during lookup', async (action) => {
    let finish!: (value: any) => void;
    jest.mocked(prisma.user.findUnique).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }) as any);
    const ws = socket();
    const req = request();
    const pending = protectWebSocket(ws, req);
    if (action === 'logout') closeSessionWebSockets(req.sessionID);
    else closeAccountWebSockets(1);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Session ended');
    finish(account);
    expect(await pending).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
  });
});
