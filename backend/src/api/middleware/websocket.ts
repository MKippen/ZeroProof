import type { Request } from 'express';
import type { WebsocketRequestHandler } from 'express-ws';
import type { SessionData } from 'express-session';
import { getSessionAccount } from '../../services/accountSession';
import logger from '../../utils/logger';

type Socket = Parameters<WebsocketRequestHandler>[0];
const sessionSockets = new Map<string, { userId: number; sockets: Set<Socket> }>();

export function closeSessionWebSockets(sessionId: string): void {
  const entry = sessionSockets.get(sessionId);
  sessionSockets.delete(sessionId);
  for (const socket of entry?.sockets ?? []) socket.close(1008, 'Session ended');
}

export function closeAccountWebSockets(userId: number): void {
  for (const [sessionId, entry] of sessionSockets) {
    if (entry.userId === userId) closeSessionWebSockets(sessionId);
  }
}

/** Gate telemetry subscription; CORS middleware does not protect WebSockets. */
export async function protectWebSocket(
  ws: Socket,
  req: Request,
  allowedOrigins: string[] = []
): Promise<boolean> {
  const origin = req.get('origin');
  // Browsers always send Origin. Authenticated non-browser clients may omit it.
  if (origin && origin !== `${req.protocol}://${req.get('host')}` && !allowedOrigins.includes(origin)) {
    ws.close(1008, 'Origin not allowed');
    return false;
  }
  const userId = req.session?.userId;
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0) {
    ws.close(1008, 'Authentication required');
    return false;
  }
  if (ws.readyState !== 1) return false;

  // Register pending authorization before querying. Logout/password change may
  // happen while the query is running; its old account snapshot must never
  // subscribe a socket after local revocation already closed that session.
  const sessionId = req.sessionID;
  const entry = sessionSockets.get(sessionId) ?? { userId, sockets: new Set<Socket>() };
  entry.sockets.add(ws);
  sessionSockets.set(sessionId, entry);
  let interval: ReturnType<typeof setInterval> | null = null;
  ws.once('close', () => {
    if (interval) clearInterval(interval);
    entry.sockets.delete(ws);
    if (entry.sockets.size === 0 && sessionSockets.get(sessionId) === entry) sessionSockets.delete(sessionId);
  });

  let account;
  try {
    account = await getSessionAccount(req.session);
  } catch (error) {
    logger.error('Unable to verify WebSocket account:', error);
    ws.close(1013, 'Authentication temporarily unavailable');
    return false;
  }
  if (!account || account.mustChangePassword) {
    ws.close(1008, account ? 'Password change required' : 'Authentication required');
    return false;
  }
  // The client may disconnect while the database query is in flight.
  if (ws.readyState !== 1) return false;

  let checking = false;
  interval = setInterval(() => {
    if (checking) return;
    checking = true;
    void (async () => {
      try {
        const saved = await new Promise<SessionData | null>((resolve, reject) => {
          req.sessionStore.get(sessionId, (error, session) => {
            if (error) reject(error);
            else resolve(session ?? null);
          });
        });
        const current = await getSessionAccount(saved);
        const expires = saved?.cookie.expires;
        if (!current || current.id !== account.id || current.mustChangePassword ||
            (expires && new Date(expires).getTime() <= Date.now())) {
          ws.close(1008, current?.mustChangePassword ? 'Password change required' : 'Session ended');
        }
      } catch (error) {
        logger.error('Unable to revalidate WebSocket account:', error);
        ws.close(1013, 'Authentication temporarily unavailable');
      } finally {
        checking = false;
      }
    })();
  }, 30_000);
  interval.unref();
  return true;
}
