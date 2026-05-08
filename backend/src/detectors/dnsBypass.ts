/**
 * `dns_bypass` detector — flow events where an internal device sent traffic
 * to an EXTERNAL DNS server (port 53) other than the resolvers we know
 * about. Indicates a device bypassing the configured DNS proxy (e.g., a
 * smart-TV using 8.8.8.8 directly, or malware avoiding monitored DNS).
 *
 * "Known resolvers" come from the `KNOWN_DNS_RESOLVERS` env var (CSV) —
 * defaults to the common public resolvers operators usually allowlist
 * deliberately, plus loopback/RFC1918 (handled separately).
 *
 * Severity:
 *   - Allowed traffic   → MEDIUM (something got past the policy)
 *   - Blocked traffic   → INFO   (UniFi blocked it, surface for awareness)
 *
 * Fingerprint: detector:srcMac|srcIp:dstIp → one finding per (device, resolver).
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionResult,
} from './framework';

const DEFAULT_KNOWN_RESOLVERS = [
  '1.1.1.1',
  '1.0.0.1',
  '8.8.8.8',
  '8.8.4.4',
  '9.9.9.9',
  '149.112.112.112',
];

function knownResolvers(): Set<string> {
  const raw = process.env.KNOWN_DNS_RESOLVERS;
  if (!raw) return new Set(DEFAULT_KNOWN_RESOLVERS);
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('127.')) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd'))
    return true;
  return false;
}

function severityFor(action: string | null | undefined): Severity {
  if (!action) return 'MEDIUM';
  return action.toLowerCase() === 'blocked' ? 'INFO' : 'MEDIUM';
}

export const dnsBypassDetector: Detector = {
  id: 'dns_bypass',
  description:
    'Internal device sent DNS traffic (port 53) to an unapproved external resolver.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const allowed = knownResolvers();

    const flows = await prisma.firewallFlowEvent.findMany({
      where: {
        occurredAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
        dstPort: 53,
        dstIp: { not: null },
      },
      select: {
        id: true,
        action: true,
        srcMac: true,
        srcIp: true,
        srcClientName: true,
        dstIp: true,
      },
    });

    const dedupe = new Map<string, DetectionResult>();
    for (const flow of flows) {
      const dstIp = flow.dstIp;
      if (!dstIp) continue;
      if (allowed.has(dstIp)) continue;
      if (isPrivateIp(dstIp)) continue; // internal resolver — not a bypass

      const srcKey = flow.srcMac ?? flow.srcIp ?? 'unknown';
      const fingerprint = `dns_bypass:${srcKey}:${dstIp}`;
      const existing = dedupe.get(fingerprint);
      if (existing) {
        existing.evidence.push({ kind: 'flow', id: flow.id });
        if (severityFor(flow.action) === 'MEDIUM') existing.severity = 'MEDIUM';
        continue;
      }
      const actor =
        flow.srcClientName ?? flow.srcMac ?? flow.srcIp ?? 'unknown device';
      dedupe.set(fingerprint, {
        fingerprint,
        severity: severityFor(flow.action),
        title: `${actor} used external DNS server ${dstIp}`,
        description: `Device queried an external DNS resolver that is not on the allowlist. This bypasses the monitored DNS proxy.`,
        affectedResource: actor,
        srcMac: flow.srcMac ?? undefined,
        evidence: [{ kind: 'flow', id: flow.id }],
        metadata: { resolver: dstIp, action: flow.action },
      });
    }

    if (dedupe.size > 0) {
      ctx.log.info(`dns_bypass emitted ${dedupe.size} finding(s)`);
    }
    return Array.from(dedupe.values());
  },
};
