import { EventEmitter } from 'node:events';
import type { Request } from 'express';
import { closeSessionWebSockets, protectWebSocket } from '../../../src/api/middleware/websocket';

function socket() {
  const ws = new EventEmitter() as EventEmitter & { close: jest.Mock };
  ws.close = jest.fn(() => ws.emit('close'));
  return ws as unknown as Parameters<typeof protectWebSocket>[0];
}

function request(origin: string | undefined = 'https://zeroproof.local', host = 'zeroproof.local') {
  return {
    sessionID: 'session-1', protocol: 'https',
    get: (name: string) => ({ origin, host })[name],
    session: { userId: 1, cookie: {}, reload: jest.fn((done) => done(null)) },
  } as unknown as Request;
}

describe('WebSocket telemetry authorization', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { closeSessionWebSockets('session-1'); jest.useRealTimers(); });

  it('rejects unauthenticated connections before subscribing to telemetry', () => {
    const ws = socket();
    const req = request();
    delete req.session.userId;
    expect(protectWebSocket(ws, req)).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Authentication required');
  });

  it.each(['https://attacker.example', 'null', 'https://zeroproof.local.attacker.example'])(
    'rejects an authenticated browser from origin %s', (origin) => {
      expect(protectWebSocket(socket(), request(origin))).toBe(false);
    }
  );

  it('allows same-origin sessions and explicitly configured frontend origins', () => {
    expect(protectWebSocket(socket(), request())).toBe(true);
    expect(protectWebSocket(socket(), request('http://localhost:5173'), ['http://localhost:5173'])).toBe(true);
  });

  it.each(['127.0.0.1:5173', '192.168.1.20:5173'])('accepts a proxied development origin with its public port (%s)', (host) => {
    const req = request(`http://${host}`, host);
    Object.defineProperty(req, 'protocol', { value: 'http' });
    expect(protectWebSocket(socket(), req)).toBe(true);
  });

  it('preserves the origin boundary between two ports on the same hostname', () => {
    expect(protectWebSocket(socket(), request('https://zeroproof.local:8443', 'zeroproof.local:8443'))).toBe(true);
    expect(protectWebSocket(socket(), request('https://zeroproof.local:9443', 'zeroproof.local:8443'))).toBe(false);
  });

  it('closes subscriptions immediately on logout and cancels revalidation', () => {
    const ws = socket();
    const req = request();
    protectWebSocket(ws, req);
    closeSessionWebSockets(req.sessionID);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Session ended');
    jest.advanceTimersByTime(60_000);
    expect(req.session.reload).not.toHaveBeenCalled();
  });

  it('closes idle sockets when their session expires or is revoked in another process', () => {
    const ws = socket();
    const req = request();
    jest.mocked(req.session.reload).mockImplementation((done) => {
      done(new Error('missing session'));
      return req.session;
    });
    protectWebSocket(ws, req);
    jest.advanceTimersByTime(30_000);
    expect(ws.close).toHaveBeenCalledWith(1008, 'Session ended');
  });
});
