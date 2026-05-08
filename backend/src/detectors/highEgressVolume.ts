/**
 * `high_egress_volume` detector — single internal device that egressed more
 * than `HIGH_EGRESS_BYTES_THRESHOLD` bytes during the window. The default
 * (1 GiB / hour) is intentionally generous; the value is to spot the very
 * top of the distribution (data exfil, compromised CDN bypass, IoT sending
 * way more than expected) and surface it for review.
 *
 * Severity:
 *   - over threshold              → MEDIUM
 *   - over 5x threshold           → HIGH
 *
 * Fingerprint: detector:srcMac|srcIp → one finding per device per window.
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionEvidence,
  DetectionResult,
} from './framework';

const DEFAULT_THRESHOLD = BigInt(1024) * BigInt(1024) * BigInt(1024); // 1 GiB

function threshold(): bigint {
  const raw = process.env.HIGH_EGRESS_BYTES_THRESHOLD;
  if (!raw) return DEFAULT_THRESHOLD;
  try {
    const n = BigInt(raw);
    return n > BigInt(0) ? n : DEFAULT_THRESHOLD;
  } catch {
    return DEFAULT_THRESHOLD;
  }
}

function isPrivateIp(ip: string | null | undefined): boolean {
  if (!ip) return false;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.'))
    return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return false;
}

function formatBytes(n: bigint): string {
  const gb = Number(n) / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GiB`;
  const mb = Number(n) / (1024 * 1024);
  return `${mb.toFixed(2)} MiB`;
}

export const highEgressVolumeDetector: Detector = {
  id: 'high_egress_volume',
  description:
    'A single internal device sent unusually large amounts of data outbound during the window.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const limit = threshold();

    const flows = await prisma.firewallFlowEvent.findMany({
      where: {
        occurredAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
        bytesTotal: { not: null },
      },
      select: {
        id: true,
        srcMac: true,
        srcIp: true,
        srcClientName: true,
        dstIp: true,
        bytesTotal: true,
      },
    });

    const groups = new Map<
      string,
      {
        bytes: bigint;
        evidence: DetectionEvidence[];
        actor: string;
        srcMac?: string;
      }
    >();
    for (const flow of flows) {
      // Only count outbound (private src → public dst) — UniFi flow events
      // include both directions, we don't want LAN-to-LAN sums.
      if (!isPrivateIp(flow.srcIp) || isPrivateIp(flow.dstIp)) continue;
      const srcKey = flow.srcMac ?? flow.srcIp ?? 'unknown';
      const bucket = groups.get(srcKey) ?? {
        bytes: BigInt(0),
        evidence: [],
        actor:
          flow.srcClientName ?? flow.srcMac ?? flow.srcIp ?? 'unknown device',
        srcMac: flow.srcMac ?? undefined,
      };
      bucket.bytes += BigInt(flow.bytesTotal ?? 0);
      // Cap evidence at 10 IDs per finding to keep payload sane.
      if (bucket.evidence.length < 10) {
        bucket.evidence.push({ kind: 'flow', id: flow.id });
      }
      groups.set(srcKey, bucket);
    }

    const findings: DetectionResult[] = [];
    for (const [srcKey, bucket] of groups) {
      if (bucket.bytes < limit) continue;
      const severity: Severity = bucket.bytes >= limit * BigInt(5) ? 'HIGH' : 'MEDIUM';
      findings.push({
        fingerprint: `high_egress_volume:${srcKey}`,
        severity,
        title: `${bucket.actor} egressed ${formatBytes(bucket.bytes)}`,
        description: `Total outbound traffic from this device exceeded the configured threshold (${formatBytes(limit)}). Confirm this matches expected device behavior.`,
        affectedResource: bucket.actor,
        srcMac: bucket.srcMac,
        evidence: bucket.evidence,
        metadata: { totalBytes: bucket.bytes.toString(), threshold: limit.toString() },
      });
    }

    if (findings.length > 0) {
      ctx.log.info(`high_egress_volume emitted ${findings.length} finding(s)`);
    }
    return findings;
  },
};
