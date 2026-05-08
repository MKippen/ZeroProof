/**
 * `repeating_threat` detector — UniFi's IDS surfaces individual threat
 * events; on its own each one is a single data point. This detector
 * groups by `srcIp` and fires when a single source crosses a per-window
 * threshold, which is far more interesting (sustained scan / brute-force).
 *
 * Severity:
 *   - >= REPEATING_THRESHOLD_HIGH events  → HIGH
 *   - >= REPEATING_THRESHOLD_MED  events  → MEDIUM (default lower bar)
 *
 * Fingerprint: detector:srcIp → one finding per source per window.
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionEvidence,
  DetectionResult,
} from './framework';

const DEFAULT_THRESHOLD_MEDIUM = 5;
const DEFAULT_THRESHOLD_HIGH = 20;

function threshold(envName: string, fallback: number): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const repeatingThreatDetector: Detector = {
  id: 'repeating_threat',
  description:
    'Same source IP triggers UniFi IDS multiple times in a short window.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const medium = threshold('REPEATING_THRESHOLD_MED', DEFAULT_THRESHOLD_MEDIUM);
    const high = threshold('REPEATING_THRESHOLD_HIGH', DEFAULT_THRESHOLD_HIGH);

    const events = await prisma.firewallThreatEvent.findMany({
      where: {
        occurredAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
        srcIp: { not: null },
      },
      select: {
        id: true,
        srcIp: true,
        category: true,
        subcategory: true,
        severity: true,
      },
    });

    const groups = new Map<
      string,
      {
        ids: string[];
        categories: Set<string>;
        upstreamSeverities: Set<string>;
      }
    >();
    for (const event of events) {
      if (!event.srcIp) continue;
      const bucket = groups.get(event.srcIp) ?? {
        ids: [],
        categories: new Set<string>(),
        upstreamSeverities: new Set<string>(),
      };
      bucket.ids.push(event.id);
      if (event.category) bucket.categories.add(event.category);
      if (event.severity) bucket.upstreamSeverities.add(event.severity);
      groups.set(event.srcIp, bucket);
    }

    const findings: DetectionResult[] = [];
    for (const [srcIp, bucket] of groups) {
      const count = bucket.ids.length;
      if (count < medium) continue;
      const severity: Severity = count >= high ? 'HIGH' : 'MEDIUM';
      const evidence: DetectionEvidence[] = bucket.ids.map((id) => ({
        kind: 'threat',
        id,
      }));
      findings.push({
        fingerprint: `repeating_threat:${srcIp}`,
        severity,
        title: `${count} IDS hits from ${srcIp}`,
        description: `UniFi IDS reported ${count} threat events from this source during the window. Categories: ${
          Array.from(bucket.categories).join(', ') || 'unspecified'
        }.`,
        affectedResource: srcIp,
        evidence,
        metadata: {
          srcIp,
          count,
          categories: Array.from(bucket.categories),
          upstreamSeverities: Array.from(bucket.upstreamSeverities),
        },
      });
    }

    if (findings.length > 0) {
      ctx.log.info(`repeating_threat emitted ${findings.length} finding(s)`);
    }
    return findings;
  },
};
