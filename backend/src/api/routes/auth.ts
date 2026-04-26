import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { LoginSchema, ChangePasswordSchema, ApiResponse, SessionUser } from '../../types';
import config, { isProd } from '../../config';
import logger from '../../utils/logger';

const router = Router();
const BCRYPT_ROUNDS = 12;

// Rate limiter for login: 10 attempts per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } },
});

// Rate limiter for password change: 5 attempts per 15 minutes
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many password change attempts. Try again later.' } },
});

// POST /api/v1/auth/login
router.post('/login', loginLimiter, validate(LoginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      };
      res.status(401).json(response);
      return;
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' },
      };
      res.status(401).json(response);
      return;
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Create session
    const sessionUser: SessionUser = { id: user.id, username: user.username };
    req.session.userId = user.id;
    req.session.user = sessionUser;

    // Explicitly save session before responding
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          logger.error('Session save error:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        ipAddress: req.ip,
      },
    });

    logger.info(`User ${username} logged in`);

    const response: ApiResponse = {
      success: true,
      data: {
        user: sessionUser,
        mustChangePassword: user.mustChangePassword,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Login error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'LOGIN_ERROR', message: 'Login failed' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/auth/logout
router.post('/logout', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.session.userId;

    await prisma.auditLog.create({
      data: {
        userId,
        action: 'LOGOUT',
        ipAddress: req.ip,
      },
    });

    req.session.destroy((err) => {
      if (err) {
        logger.error('Session destroy error:', err);
      }
    });

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Logout error:', error);
    const response: ApiResponse = { success: true };
    res.json(response);
  }
});

// GET /api/v1/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { id: true, username: true, mustChangePassword: true, lastLogin: true },
    });

    if (!user) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' },
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse = { success: true, data: { user } };
    res.json(response);
  } catch (error) {
    logger.error('Get user error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch user' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/auth/change-password
router.post(
  '/change-password',
  passwordChangeLimiter,
  requireAuth,
  validate(ChangePasswordSchema),
  async (req: Request, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.session.userId!;

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        const response: ApiResponse = {
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'User not found' },
        };
        res.status(404).json(response);
        return;
      }

      const validPassword = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!validPassword) {
        const response: ApiResponse = {
          success: false,
          error: { code: 'INVALID_PASSWORD', message: 'Current password is incorrect' },
        };
        res.status(401).json(response);
        return;
      }

      const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
      await prisma.user.update({
        where: { id: userId },
        data: { passwordHash: newHash, mustChangePassword: false },
      });

      await prisma.auditLog.create({
        data: {
          userId,
          action: 'PASSWORD_CHANGE',
          ipAddress: req.ip,
        },
      });

      logger.info(`User ${user.username} changed password`);

      const response: ApiResponse = { success: true };
      res.json(response);
    } catch (error) {
      logger.error('Change password error:', error);
      const response: ApiResponse = {
        success: false,
        error: { code: 'PASSWORD_CHANGE_ERROR', message: 'Failed to change password' },
      };
      res.status(500).json(response);
    }
  }
);

// Initialize default admin user if none exists
export async function initializeDefaultUser(): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const defaultPassword = config.DEFAULT_ADMIN_PASSWORD;
    if (!defaultPassword) {
      if (isProd) {
        throw new Error('DEFAULT_ADMIN_PASSWORD must be set in production when bootstrapping the first admin user');
      }
      logger.warn('DEFAULT_ADMIN_PASSWORD not set; falling back to admin123! (development only)');
    }
    const hash = await bcrypt.hash(defaultPassword || 'admin123!', BCRYPT_ROUNDS);

    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash: hash,
        mustChangePassword: true,
      },
    });

    logger.info('Created default admin user (username: admin)');
    if (isProd) {
      logger.info('Default admin password is set via DEFAULT_ADMIN_PASSWORD in the environment');
    }
    logger.warn('⚠️  Please change the default password immediately!');
  }
}

export default router;
