/**
 * CSRF protection middleware.
 *
 * Implements the synchronizer-token pattern: a per-session random token is
 * minted on first request and stored on `req.session.csrfToken`. Browser
 * code reads it via `GET /api/v1/auth/csrf` (a same-origin call protected
 * by SameSite cookies) and replays it as the `X-CSRF-Token` header on every
 * mutating request. The middleware compares the header against the session
 * token and rejects mismatches with HTTP 403.
 *
 * Bypasses:
 *   - Safe HTTP methods (GET / HEAD / OPTIONS) — they don't mutate state.
 *   - `/api/v1/esp32/*` — ESP32 sentinels POST telemetry over MQTT-style
 *     direct HTTP and don't carry a browser session, so synchronizer-token
 *     CSRF doesn't apply. They authenticate via per-device tokens elsewhere.
 *   - `NODE_ENV === 'test'` — unit tests inject sessions directly and don't
 *     boot a real frontend; CSRF is exercised through dedicated tests.
 */
import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import type { ApiResponse } from '../../types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ESP32_PATH_PREFIX = '/esp32/';

/** Mint or return the per-session CSRF token. Idempotent. */
export function ensureCsrfToken(req: Request): string {
  const session = req.session as unknown as { csrfToken?: string };
  if (!session.csrfToken) {
    session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return session.csrfToken;
}

/** True if the path should bypass CSRF validation. */
function isExempt(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  // Path is mounted under /api/v1/* in server.ts, so req.path here starts after.
  if (req.path.startsWith(ESP32_PATH_PREFIX)) return true;
  return false;
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // Tests inject the session object directly and don't go through a browser.
  if (process.env.NODE_ENV === 'test') {
    next();
    return;
  }

  if (isExempt(req)) {
    next();
    return;
  }

  // Mint the token on first contact so a fresh login can fetch it. Without
  // this, clients would have to hit /auth/csrf BEFORE any other request.
  const expected = ensureCsrfToken(req);
  const provided = req.get('X-CSRF-Token');

  if (!provided || provided !== expected) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'CSRF_TOKEN_INVALID',
        message: 'CSRF token missing or invalid',
      },
    };
    res.status(403).json(response);
    return;
  }
  next();
}
