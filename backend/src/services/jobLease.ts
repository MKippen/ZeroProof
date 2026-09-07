import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from './database';
import logger from '../utils/logger';

export class JobLeaseBusyError extends Error {
  constructor() { super('Another sync is already running. Try again shortly.'); this.name = 'JobLeaseBusyError'; }
}

export class JobLeaseLostError extends Error {
  constructor() { super('Sync ownership expired or could not be verified. Retry the sync.'); this.name = 'JobLeaseLostError'; }
}

export interface JobLeaseOptions {
  ttlMs?: number;
  renewIntervalMs?: number;
  transactionTimeoutMs?: number;
}

export interface JobLease {
  readonly key: string;
  readonly ownerToken: string;
  readonly signal: AbortSignal;
  /** Local database writes only. No controller or other network calls here. */
  publish<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  renew(): Promise<void>;
  release(): Promise<void>;
}

function leaseOptions(options: JobLeaseOptions): Required<JobLeaseOptions> {
  const ttlMs = options.ttlMs ?? 120_000;
  const renewIntervalMs = options.renewIntervalMs ?? Math.floor(ttlMs / 4);
  const transactionTimeoutMs = options.transactionTimeoutMs ?? 30_000;
  for (const value of [ttlMs, renewIntervalMs, transactionTimeoutMs]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 3_600_000) throw new Error('Invalid job lease duration');
  }
  if (renewIntervalMs >= ttlMs) throw new Error('Lease renewal must occur before expiration');
  return { ttlMs, renewIntervalMs, transactionTimeoutMs };
}

/** Atomic claim using the database clock; low-level handles do not auto-renew. */
export async function acquireJobLease(key: string, options: JobLeaseOptions = {}): Promise<JobLease | null> {
  if (!key.trim() || key.length > 200) throw new Error('Invalid job lease key');
  const { ttlMs, transactionTimeoutMs } = leaseOptions(options);
  const ownerToken = randomUUID();
  const claimed = await prisma.$queryRaw<Array<{ ownerToken: string }>>`
    INSERT INTO "JobLease" ("key", "ownerToken", "expiresAt", "updatedAt")
    VALUES (${key}, ${ownerToken}, clock_timestamp() + (${ttlMs}::double precision * interval '1 millisecond'), clock_timestamp())
    ON CONFLICT ("key") DO UPDATE SET
      "ownerToken" = EXCLUDED."ownerToken",
      "expiresAt" = clock_timestamp() + (${ttlMs}::double precision * interval '1 millisecond'),
      "updatedAt" = clock_timestamp()
    WHERE "JobLease"."expiresAt" <= clock_timestamp()
    RETURNING "ownerToken"`;
  if (!claimed.length) return null;

  const controller = new AbortController();
  let released = false;
  const lose = (): JobLeaseLostError => {
    const error = new JobLeaseLostError();
    controller.abort(error);
    return error;
  };
  const assertUsable = (): void => {
    if (released || controller.signal.aborted) throw new JobLeaseLostError();
  };

  return {
    key, ownerToken, signal: controller.signal,
    async publish<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      assertUsable();
      try {
        return await prisma.$transaction(async (tx) => {
          // Lock first, then check time/owner in a second statement. Checking
          // expiry before waiting for a row lock can accept an expired owner.
          await tx.$queryRaw`SELECT "key" FROM "JobLease" WHERE "key" = ${key} FOR UPDATE`;
          assertUsable();
          const owned = await tx.$queryRaw<Array<{ key: string }>>`
            UPDATE "JobLease" SET
              "expiresAt" = clock_timestamp() + (${ttlMs}::double precision * interval '1 millisecond'),
              "updatedAt" = clock_timestamp()
            WHERE "key" = ${key} AND "ownerToken" = ${ownerToken} AND "expiresAt" > clock_timestamp()
            RETURNING "key"`;
          if (owned.length !== 1) throw lose();
          const result = await work(tx);
          assertUsable();
          // The row lock has prevented a takeover throughout publication.
          // Refresh on completion so a long transaction does not leave a stale
          // expiry immediately after a successful commit.
          await tx.$executeRaw`
            UPDATE "JobLease" SET
              "expiresAt" = clock_timestamp() + (${ttlMs}::double precision * interval '1 millisecond'),
              "updatedAt" = clock_timestamp()
            WHERE "key" = ${key} AND "ownerToken" = ${ownerToken}`;
          return result;
        }, { maxWait: 5_000, timeout: transactionTimeoutMs });
      } catch (error) {
        if (error instanceof JobLeaseLostError) lose();
        throw error;
      }
    },
    async renew(): Promise<void> {
      assertUsable();
      try {
        const renewed = await prisma.$executeRaw`
          UPDATE "JobLease" SET
            "expiresAt" = clock_timestamp() + (${ttlMs}::double precision * interval '1 millisecond'),
            "updatedAt" = clock_timestamp()
          WHERE "key" = ${key} AND "ownerToken" = ${ownerToken} AND "expiresAt" > clock_timestamp()`;
        if (renewed !== 1) throw lose();
      } catch {
        // An uncertain renewal must never authorize later publication.
        throw lose();
      }
    },
    async release(): Promise<void> {
      if (released) return;
      released = true;
      controller.abort(new JobLeaseLostError());
      // An expired owner's cleanup cannot delete a replacement owner's lease.
      await prisma.$executeRaw`DELETE FROM "JobLease" WHERE "key" = ${key} AND "ownerToken" = ${ownerToken}`;
    },
  };
}

/** One shared owner, non-overlapping renewal, and unconditional safe cleanup. */
export async function withJobLease<T>(
  key: string,
  work: (lease: JobLease) => Promise<T>,
  options: JobLeaseOptions = {}
): Promise<T> {
  const settings = leaseOptions(options);
  const lease = await acquireJobLease(key, settings);
  if (!lease) throw new JobLeaseBusyError();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;
  const schedule = (): void => {
    if (stopped || lease.signal.aborted) return;
    timer = setTimeout(() => {
      renewal = lease.renew().catch(() => {
        logger.warn(`Job lease renewal failed for ${key}; publication disabled`);
      }).finally(schedule);
    }, settings.renewIntervalMs);
    timer.unref();
  };
  schedule();
  try {
    return await work(lease);
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    // Revoke the local handle immediately, even when an earlier renewal is
    // stalled. Both SQL operations are owner-qualified, so release may safely
    // run alongside that renewal without touching a replacement owner's row.
    const release = lease.release().catch((error) => {
      // Publication may already have committed. Do not misreport its outcome
      // because cleanup failed; the database expiry still permits recovery.
      logger.warn(`Job lease cleanup failed for ${key}`, { error });
    });
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const cleaned = await Promise.race([
        Promise.all([renewal, release]).then(() => true),
        new Promise<false>((resolve) => { cleanupTimer = setTimeout(() => resolve(false), 5_000); }),
      ]);
      if (!cleaned) logger.warn(`Job lease cleanup deadline reached for ${key}; expiry permits recovery`);
    } finally {
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
  }
}
