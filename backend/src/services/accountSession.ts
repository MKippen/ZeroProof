import { createHash, timingSafeEqual } from 'node:crypto';
import type { SessionData } from 'express-session';
import prisma from './database';

export interface AuthenticatedAccount {
  id: number;
  mustChangePassword: boolean;
  lastLogin: Date | null;
}

/** A server-side session version, never a credential or part of an API response. */
export function credentialVersion(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex');
}

/**
 * Validate a session against current account state. A password reset changes the
 * bcrypt hash (including its salt), invalidating every older session without a
 * schema migration or cooperation from the reset command.
 *
 * Legacy sessions have no fingerprint and must sign in once. Adopting today's
 * hash for an old cookie would accidentally revive that cookie after a reset.
 * Database errors deliberately propagate so callers can fail closed with a
 * retryable response instead of misreporting a valid user as signed out.
 */
export async function getSessionAccount(
  session: Partial<SessionData> | null | undefined
): Promise<AuthenticatedAccount | null> {
  const userId = session?.userId;
  const version = session?.credentialVersion;
  if (typeof userId !== 'number' || !Number.isInteger(userId) || userId <= 0 ||
      typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version)) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, mustChangePassword: true, lastLogin: true },
  });
  if (!user || !timingSafeEqual(
    Buffer.from(version, 'hex'),
    Buffer.from(credentialVersion(user.passwordHash), 'hex')
  )) return null;

  return { id: user.id, mustChangePassword: user.mustChangePassword, lastLogin: user.lastLogin };
}
