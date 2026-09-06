import type { Request } from 'express';
import type { WebsocketRequestHandler } from 'express-ws';

type Socket = Parameters<WebsocketRequestHandler>[0];
const sessionSockets = new Map<string, Set<Socket>>();

export function closeSessionWebSockets(sessionId: string): void {
  const sockets = sessionSockets.get(sessionId);
  sessionSockets.delete(sessionId);
  for (const socket of sockets ?? []) socket.close(1008, 'Session ended');
}

/** Gate telemetry subscription; CORS middleware does not protect WebSockets. */
export function protectWebSocket(
  ws: Socket,
  req: Request,
  allowedOrigins: string[] = []
): boolean {
  if (!req.session?.userId) {
    ws.close(1008, 'Authentication required');
    return false;
  }

  const origin = req.get('origin');
  // Browsers always send Origin. Authenticated non-browser clients may omit it.
  if (origin && origin !== `${req.protocol}://${req.get('host')}` && !allowedOrigins.includes(origin)) {
    ws.close(1008, 'Origin not allowed');
    return false;
  }

  const sessionId = req.sessionID;
  const userId = req.session.userId;
  const sockets = sessionSockets.get(sessionId) ?? new Set<Socket>();
  sockets.add(ws);
  sessionSockets.set(sessionId, sockets);

  // Revalidate idle subscriptions as well: the backing session can expire or
  // be invalidated by another backend process while the socket remains open.
  const interval = setInterval(() => {
    req.session.reload((error) => {
      const expires = req.session?.cookie.expires;
      if (error || req.session?.userId !== userId || (expires && new Date(expires).getTime() <= Date.now())) {
        ws.close(1008, 'Session ended');
      }
    });
  }, 30_000);
  interval.unref();
  ws.once('close', () => {
    clearInterval(interval);
    sockets.delete(ws);
    if (sockets.size === 0) sessionSockets.delete(sessionId);
  });
  return true;
}
