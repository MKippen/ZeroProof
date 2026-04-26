import { Request, Response, NextFunction } from 'express';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  logger.debug(`Auth check - sessionID: ${req.sessionID}, userId: ${req.session?.userId}`);

  if (!req.session?.userId) {
    logger.warn(`Auth failed for ${req.method} ${req.path} - no userId in session`);
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    };
    res.status(401).json(response);
    return;
  }
  next();
}

export function requirePasswordChange(req: Request, _res: Response, next: NextFunction): void {
  if (req.session?.user && req.path !== '/api/v1/auth/change-password') {
    // Allow access even if password change is required
    // Frontend should handle the redirect
  }
  next();
}
