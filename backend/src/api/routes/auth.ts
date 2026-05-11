import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import rateLimit from 'express-rate-limit';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { ensureCsrfToken } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { LoginSchema, ChangePasswordSchema, ApiResponse, SessionUser } from '../../types';
import { isProd } from '../../config';
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
//
// ZeroProof is single-admin: setup is gated on an empty user table and the
// UI never exposes a way to add a second user. We treat the User row as a
// singleton and authenticate by password alone — no username to remember,
// no username to type wrong, no username field to design around.
router.post('/login', loginLimiter, validate(LoginSchema), async (req: Request, res: Response) => {
  try {
    const { password } = req.body;

    const user = await prisma.user.findFirst({ orderBy: { id: 'asc' } });

    if (!user) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_INITIALIZED', message: 'No admin account exists yet. Complete setup first.' },
      };
      res.status(409).json(response);
      return;
    }

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid password' },
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
    const sessionUser: SessionUser = { id: user.id };
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

    logger.info(`Admin logged in (user id ${user.id})`);

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
      select: { id: true, mustChangePassword: true, lastLogin: true },
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

// GET /api/v1/auth/csrf — returns the per-session CSRF token. The frontend
// fetches this once on boot (and again after login) and replays it as the
// X-CSRF-Token header on every mutating request. No auth required: the
// token is bound to the session, which is in turn bound to the (httpOnly,
// SameSite=Strict) cookie, so an unauthenticated session still gets a token
// it can use after login.
router.get('/csrf', (req: Request, res: Response) => {
  const csrfToken = ensureCsrfToken(req);
  const response: ApiResponse = { success: true, data: { csrfToken } };
  res.json(response);
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

      logger.info(`Admin password changed (user id ${user.id})`);

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

// GET /api/v1/auth/setup-status — public; the frontend uses this to redirect
// users to /setup on a fresh install before showing the login screen.
router.get('/setup-status', async (_req: Request, res: Response) => {
  try {
    const userCount = await prisma.user.count();
    const response: ApiResponse<{ initialized: boolean }> = {
      success: true,
      data: { initialized: userCount > 0 },
    };
    res.json(response);
  } catch (error) {
    logger.error('setup-status error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SETUP_STATUS_ERROR', message: 'Unable to read setup status' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/auth/setup — public; creates the first admin account on a
// fresh install. Returns 409 once any user exists so this endpoint cannot be
// abused to overwrite or add admins after bootstrap.
const setupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many setup attempts. Try again later.' } },
});

router.post('/setup', setupLimiter, async (req: Request, res: Response) => {
  try {
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'ALREADY_INITIALIZED', message: 'Setup has already been completed' },
      };
      res.status(409).json(response);
      return;
    }

    const password = String(req.body?.password ?? '');

    if (!password || password.length < 12) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 12 characters' },
      };
      res.status(400).json(response);
      return;
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: {
        passwordHash: hash,
        mustChangePassword: false,
      },
      select: { id: true },
    });

    logger.info(`First-run setup completed; created admin (user id ${user.id})`);

    // Auto-login the just-created admin: stamp the session and persist it
    // before responding so the frontend can route straight to the dashboard
    // instead of bouncing through the login page.
    const sessionUser: SessionUser = { id: user.id };
    req.session.userId = user.id;
    req.session.user = sessionUser;
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          logger.error('Session save error during /setup auto-login:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });

    const response: ApiResponse<{ user: { id: number } }> = {
      success: true,
      data: { user },
    };
    res.status(201).json(response);
  } catch (error) {
    logger.error('Setup error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SETUP_ERROR', message: 'Failed to complete setup' },
    };
    res.status(500).json(response);
  }
});

// Bootstrap the first admin user when DEFAULT_ADMIN_PASSWORD is set.
//
// We deliberately do NOT auto-create an `admin` / `admin123!` account on a
// fresh install. Shipping a default password — even one flagged for
// must-change-on-first-login — leaks a foothold during the brief window
// before first login, leaks confusion ("what is the password?"), and trains
// users to expect a known credential. Instead, when no DEFAULT_ADMIN_PASSWORD
// is provided the database stays empty and the frontend's first-run flow
// directs the user through POST /api/v1/auth/setup to create their own
// admin account.
//
// The env-var path remains for non-interactive provisioning (CI bring-up,
// IaC stamping, scripted demos) — those callers know the password they set
// and can pass it through.
export async function initializeDefaultUser(): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount > 0) return;

  // Read directly from process.env (not config.DEFAULT_ADMIN_PASSWORD, which is
  // frozen at module load time) so tests and orchestration scripts can control
  // bootstrap behavior dynamically.
  const seedPassword = process.env.DEFAULT_ADMIN_PASSWORD?.trim();
  if (!seedPassword || seedPassword.length < 8) {
    if (isProd) {
      logger.info(
        'No users in database and DEFAULT_ADMIN_PASSWORD is unset; first-run setup will be required at /setup'
      );
    }
    return;
  }

  const hash = await bcrypt.hash(seedPassword, BCRYPT_ROUNDS);
  await prisma.user.create({
    data: {
      passwordHash: hash,
      mustChangePassword: true,
    },
  });

  logger.info('Created seed admin from DEFAULT_ADMIN_PASSWORD');
  logger.warn('⚠️  Change the seed admin password after first login.');
}

export default router;
