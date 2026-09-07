import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';
import { getSessionAccount } from '../../services/accountSession';
import { closeSessionWebSockets } from './websocket';

export function rejectSession(
  req: Request, res: Response,
  error = { code: 'UNAUTHORIZED', message: 'Please sign in again' }
): void {
  closeSessionWebSockets(req.sessionID);
  req.session?.destroy((error) => {
    if (error) logger.warn('Failed to remove invalid session:', error);
  });
  res.clearCookie('connect.sid', { path: '/' });
  const response: ApiResponse = {
    success: false,
    error,
  };
  res.status(401).json(response);
}

function permitsPasswordMaintenance(req: Request): boolean {
  if (!req.baseUrl.toLowerCase().endsWith('/auth')) return false;
  const route = req.path.toLowerCase().replace(/\/$/, '');
  return (req.method === 'GET' && route === '/me') ||
    (req.method === 'POST' && (route === '/change-password' || route === '/logout'));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Some routers apply this guard both globally and on individual routes.
    // Reuse this request's verified account, never cached session user fields.
    const account = req.authAccount ?? await getSessionAccount(req.session);
    if (!account) {
      rejectSession(req, res);
      return;
    }
    req.authAccount = account;

    if (account.mustChangePassword && !permitsPasswordMaintenance(req)) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password before continuing' },
      };
      res.status(403).json(response);
      return;
    }
    next();
  } catch (error) {
    logger.error('Unable to verify account state:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'AUTH_UNAVAILABLE', message: 'Unable to verify your session. Please try again.' },
    };
    res.status(503).json(response);
  }
}
