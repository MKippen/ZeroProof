/**
 * `honeypot_hit` detector — any flow whose destination is a configured
 * honeypot IP or MAC. Honeypots have no legitimate users; a single touch
 * from an internal client is high-confidence "this device is doing something
 * it shouldn't."
 *
 * Honeypot resources are configured via env vars (CSV):
 *   - HONEYPOT_IPS=10.0.99.10,10.0.99.11
 *   - HONEYPOT_MACS=de:ad:be:ef:00:01
 *
 * Severity is always CRITICAL — the false-positive rate of a real honeypot
 * is by design near zero. If you have low-confidence canaries, run them as
 * a separate detector with a lower severity.
 *
 * Fingerprint: detector:srcMac|srcIp:dstIp|dstMac → one finding per
 * (attacker, target) pair per window.
 */
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionResult,
} from './framework';

function csvFromEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const honeypotHitDetector: Detector = {
  id: 'honeypot_hit',
  description: 'Internal device contacted a configured honeypot resource.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const ips = csvFromEnv('HONEYPOT_IPS');
    const macs = csvFromEnv('HONEYPOT_MACS');
    if (ips.length === 0 && macs.length === 0) return [];

    const dstIpFilter = ips.length > 0 ? { dstIp: { in: ips } } : undefined;
    const dstMacFilter = macs.length > 0 ? { dstMac: { in: macs } } : undefined;
    const where = {
      occurredAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
      OR: [dstIpFilter, dstMacFilter].filter(Boolean) as Array<
        Record<string, unknown>
      >,
    };

    const flows = await prisma.firewallFlowEvent.findMany({
      where,
      select: {
        id: true,
        srcMac: true,
        srcIp: true,
        srcClientName: true,
        dstIp: true,
        dstMac: true,
        dstPort: true,
      },
    });

    const dedupe = new Map<string, DetectionResult>();
    for (const flow of flows) {
      const target = flow.dstIp ?? flow.dstMac ?? 'unknown-target';
      const srcKey = flow.srcMac ?? flow.srcIp ?? 'unknown';
      const fingerprint = `honeypot_hit:${srcKey}:${target}`;
      const existing = dedupe.get(fingerprint);
      if (existing) {
        existing.evidence.push({ kind: 'flow', id: flow.id });
        continue;
      }
      const actor =
        flow.srcClientName ?? flow.srcMac ?? flow.srcIp ?? 'unknown device';
      dedupe.set(fingerprint, {
        fingerprint,
        severity: 'CRITICAL',
        title: `${actor} touched honeypot ${target}`,
        description: `A honeypot resource has no legitimate clients. This source contacted it during the window — investigate immediately.`,
        affectedResource: actor,
        srcMac: flow.srcMac ?? undefined,
        evidence: [{ kind: 'flow', id: flow.id }],
        metadata: { target, port: flow.dstPort ?? undefined },
      });
    }

    if (dedupe.size > 0) {
      ctx.log.warn(`honeypot_hit emitted ${dedupe.size} finding(s)`);
    }
    return Array.from(dedupe.values());
  },
};
