/**
 * Aggregations the /detections page needs. Pure read-only — built from the
 * Detection table that the runner populates. Each function takes a window
 * (in hours) so we can scope dashboards consistently.
 */
import prisma from '../database';
import type { Severity } from '@prisma/client';

export interface DetectionAnalyticsParams {
  /** Look-back window in hours (1 - 168). */
  windowHours: number;
}

export interface SeverityBreakdown {
  severity: Severity;
  count: number;
}

export interface DetectorBreakdown {
  detectorId: string;
  count: number;
}

export interface DetectionSummary {
  windowHours: number;
  since: string;
  total: number;
  open: number;
  resolved: number;
  dismissed: number;
  bySeverity: SeverityBreakdown[];
  byDetector: DetectorBreakdown[];
  topAffected: Array<{ resource: string; count: number; maxSeverity: Severity }>;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

function maxSeverity(values: ReadonlyArray<Severity>): Severity {
  let best: Severity = 'INFO';
  for (const v of values) {
    if (SEVERITY_ORDER[v] > SEVERITY_ORDER[best]) best = v;
  }
  return best;
}

export async function getDetectionSummary(
  params: DetectionAnalyticsParams
): Promise<DetectionSummary> {
  const since = new Date(Date.now() - params.windowHours * 60 * 60 * 1000);

  const [
    total,
    open,
    resolved,
    dismissed,
    bySeverityRaw,
    byDetectorRaw,
    affected,
  ] = await Promise.all([
    prisma.detection.count({ where: { lastSeen: { gte: since } } }),
    prisma.detection.count({
      where: { lastSeen: { gte: since }, status: 'OPEN' },
    }),
    prisma.detection.count({
      where: { lastSeen: { gte: since }, status: 'RESOLVED' },
    }),
    prisma.detection.count({
      where: { lastSeen: { gte: since }, status: 'DISMISSED' },
    }),
    prisma.detection.groupBy({
      by: ['severity'],
      where: { lastSeen: { gte: since } },
      _count: { _all: true },
    }),
    prisma.detection.groupBy({
      by: ['detectorId'],
      where: { lastSeen: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { detectorId: 'desc' } },
      take: 10,
    }),
    prisma.detection.findMany({
      where: { lastSeen: { gte: since }, affectedResource: { not: null } },
      select: { affectedResource: true, severity: true },
    }),
  ]);

  const bySeverity: SeverityBreakdown[] = (
    bySeverityRaw as Array<{ severity: Severity; _count: { _all: number } }>
  ).map((row) => ({ severity: row.severity, count: row._count._all }));

  const byDetector: DetectorBreakdown[] = (
    byDetectorRaw as Array<{ detectorId: string; _count: { _all: number } }>
  ).map((row) => ({ detectorId: row.detectorId, count: row._count._all }));

  const topMap = new Map<
    string,
    { count: number; severities: Severity[] }
  >();
  for (const a of affected) {
    if (!a.affectedResource) continue;
    const bucket = topMap.get(a.affectedResource) ?? { count: 0, severities: [] };
    bucket.count += 1;
    bucket.severities.push(a.severity);
    topMap.set(a.affectedResource, bucket);
  }
  const topAffected = Array.from(topMap.entries())
    .map(([resource, b]) => ({
      resource,
      count: b.count,
      maxSeverity: maxSeverity(b.severities),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    windowHours: params.windowHours,
    since: since.toISOString(),
    total,
    open,
    resolved,
    dismissed,
    bySeverity,
    byDetector,
    topAffected,
  };
}

export interface DetectionRow {
  id: string;
  detectorId: string;
  fingerprint: string;
  severity: Severity;
  status: string;
  title: string;
  description: string;
  affectedResource: string | null;
  srcMac: string | null;
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  expiresAt: string;
  remediation: string | null;
  references: unknown;
  evidence: unknown;
  metadata: unknown;
}

export interface ListDetectionsOptions {
  windowHours: number;
  /** Filter to a specific status. */
  status?: string;
  /** Filter to a specific detector. */
  detectorId?: string;
  /** Filter to severity at or above the supplied tier. */
  severityAtLeast?: Severity;
  limit?: number;
}

export async function listDetections(
  options: ListDetectionsOptions
): Promise<DetectionRow[]> {
  const since = new Date(Date.now() - options.windowHours * 60 * 60 * 1000);
  const where: Record<string, unknown> = { lastSeen: { gte: since } };
  if (options.status) where.status = options.status;
  if (options.detectorId) where.detectorId = options.detectorId;
  if (options.severityAtLeast) {
    const tiers: Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const min = SEVERITY_ORDER[options.severityAtLeast];
    where.severity = { in: tiers.filter((s) => SEVERITY_ORDER[s] >= min) };
  }

  const rows = await prisma.detection.findMany({
    where,
    orderBy: [{ severity: 'desc' }, { lastSeen: 'desc' }],
    take: options.limit ?? 100,
  });

  return rows.map((r) => ({
    id: r.id,
    detectorId: r.detectorId,
    fingerprint: r.fingerprint,
    severity: r.severity,
    status: r.status,
    title: r.title,
    description: r.description,
    affectedResource: r.affectedResource,
    srcMac: r.srcMac,
    occurrences: r.occurrences,
    firstSeen: r.firstSeen.toISOString(),
    lastSeen: r.lastSeen.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    remediation: r.remediation,
    references: r.references,
    evidence: r.evidence,
    metadata: r.metadata,
  }));
}
