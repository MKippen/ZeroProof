/**
 * `internal_scanning` detector — single internal source contacted many
 * distinct internal IPs during the window. Strong signal of host-based
 * reconnaissance (e.g., a worm, an admin scanning tool gone rogue, or a
 * compromised host doing lateral discovery).
 *
 * Tunable: `INTERNAL_SCAN_THRESHOLD` distinct destinations (default 25).
 *
 * Severity:
 *   - threshold..2x threshold → MEDIUM
 *   - over 2x threshold        → HIGH
 *
 * Fingerprint: detector:srcMac|srcIp → one finding per source per window.
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionEvidence,
  DetectionResult,
} from './framework';

const DEFAULT_THRESHOLD = 25;

function threshold(): number {
  const raw = process.env.INTERNAL_SCAN_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD;
}

function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.'))
    return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return false;
}

export const internalScanningDetector: Detector = {
  id: 'internal_scanning',
  description:
    'A single internal device contacted an unusually large number of distinct internal IPs.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const limit = threshold();

    const flows = await prisma.firewallFlowEvent.findMany({
      where: {
        occurredAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
        srcIp: { not: null },
        dstIp: { not: null },
      },
      select: {
        id: true,
        srcMac: true,
        srcIp: true,
        srcClientName: true,
        dstIp: true,
      },
    });

    const groups = new Map<
      string,
      {
        targets: Set<string>;
        evidence: DetectionEvidence[];
        actor: string;
        srcMac?: string;
      }
    >();
    for (const flow of flows) {
      if (!isPrivateIp(flow.srcIp) || !isPrivateIp(flow.dstIp)) continue;
      if (flow.srcIp === flow.dstIp) continue;

      const srcKey = flow.srcMac ?? flow.srcIp ?? 'unknown';
      const bucket = groups.get(srcKey) ?? {
        targets: new Set<string>(),
        evidence: [],
        actor:
          flow.srcClientName ?? flow.srcMac ?? flow.srcIp ?? 'unknown device',
        srcMac: flow.srcMac ?? undefined,
      };
      bucket.targets.add(flow.dstIp!);
      if (bucket.evidence.length < 20) {
        bucket.evidence.push({ kind: 'flow', id: flow.id });
      }
      groups.set(srcKey, bucket);
    }

    const findings: DetectionResult[] = [];
    for (const [srcKey, bucket] of groups) {
      const distinct = bucket.targets.size;
      if (distinct < limit) continue;
      const severity: Severity = distinct >= limit * 2 ? 'HIGH' : 'MEDIUM';
      findings.push({
        fingerprint: `internal_scanning:${srcKey}`,
        severity,
        title: `${bucket.actor} contacted ${distinct} distinct internal IPs`,
        description: `Source talked to ${distinct} unique LAN addresses during the window — characteristic of reconnaissance / scanning behavior.`,
        affectedResource: bucket.actor,
        srcMac: bucket.srcMac,
        evidence: bucket.evidence,
        metadata: {
          distinctTargets: distinct,
          threshold: limit,
          sampleTargets: Array.from(bucket.targets).slice(0, 10),
        },
      });
    }

    if (findings.length > 0) {
      ctx.log.info(`internal_scanning emitted ${findings.length} finding(s)`);
    }
    return findings;
  },
};
