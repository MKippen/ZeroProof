/**
 * Persists DetectionResult objects from the framework as Detection rows.
 * Owns the dedupe + retention semantics so detectors stay pure.
 *
 * Dedupe rule: same `fingerprint` → upsert that increments `occurrences`,
 * advances `lastSeen`, and never overwrites the original `firstSeen`. Severity
 * is updated to `max(old, new)` so an escalation lands but a downgrade
 * doesn't silently mask the worst-seen severity.
 */
import { Severity, Prisma } from "@prisma/client";
import prisma from '../database';
import type { DetectionResult } from '../../detectors/framework';
import logger from '../../utils/logger';

/** How long a finding survives without re-firing. */
const DEFAULT_RETENTION_DAYS = 14;

const SEVERITY_ORDER: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

export interface DetectionPersistContext {
  /** Detector id — stamped on every row for filtering. */
  detectorId: string;
  /** Suggested remediation lifted from the rule YAML. */
  remediation?: string;
  /** Reference URLs lifted from the rule YAML. */
  references?: string[];
  /** Override the default 14-day retention. */
  retentionDays?: number;
}

export interface PersistOutcome {
  inserted: number;
  refreshed: number;
}

export async function persistDetectionResults(
  results: ReadonlyArray<DetectionResult>,
  ctx: DetectionPersistContext
): Promise<PersistOutcome> {
  const retentionDays = ctx.retentionDays ?? DEFAULT_RETENTION_DAYS;
  let inserted = 0;
  let refreshed = 0;

  for (const result of results) {
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    const existing = await prisma.detection.findUnique({
      where: { fingerprint: result.fingerprint },
      select: { id: true, severity: true, occurrences: true, firstSeen: true },
    });

    if (existing) {
      await prisma.detection.update({
        where: { fingerprint: result.fingerprint },
        data: {
          severity: maxSeverity(existing.severity, result.severity),
          title: result.title,
          description: result.description,
          remediation: result.remediation ?? ctx.remediation ?? null,
          references: ctx.references ?? undefined,
          affectedResource: result.affectedResource ?? null,
          srcMac: result.srcMac ?? null,
          confidence: result.confidence ?? 1.0,
          evidence: result.evidence as unknown as Prisma.InputJsonValue,
          metadata: (result.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          lastSeen: new Date(),
          expiresAt,
          occurrences: { increment: 1 },
        },
      });
      refreshed += 1;
    } else {
      await prisma.detection.create({
        data: {
          detectorId: ctx.detectorId,
          fingerprint: result.fingerprint,
          severity: result.severity,
          title: result.title,
          description: result.description,
          remediation: result.remediation ?? ctx.remediation ?? null,
          references: ctx.references ?? undefined,
          affectedResource: result.affectedResource ?? null,
          srcMac: result.srcMac ?? null,
          confidence: result.confidence ?? 1.0,
          evidence: result.evidence as unknown as Prisma.InputJsonValue,
          metadata: (result.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          expiresAt,
        },
      });
      inserted += 1;
    }
  }

  if (inserted > 0 || refreshed > 0) {
    logger.info(
      `Detection ${ctx.detectorId}: +${inserted} new, ${refreshed} refreshed`
    );
  }
  return { inserted, refreshed };
}

/**
 * Daily retention sweep. Removes detections past their TTL AND any that have
 * been resolved or dismissed for >7 days. Mirrors the DNS retention pattern.
 */
export async function cleanupExpiredDetections(): Promise<number> {
  const now = new Date();
  const cutoffForResolved = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const expired = await prisma.detection.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: now } },
        { status: { in: ['RESOLVED', 'DISMISSED'] }, lastSeen: { lt: cutoffForResolved } },
      ],
    },
  });
  if (expired.count > 0) {
    logger.info(`Detection retention sweep: pruned ${expired.count} rows`);
  }
  return expired.count;
}
