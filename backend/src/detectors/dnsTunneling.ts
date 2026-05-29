/**
 * `dns_tunneling` detector — high-entropy / oversized DNS queries from one
 * source client. Classic indicator of DNS tunneling exfiltration: malware
 * encodes payload bytes into the labels of a query, sending it to an
 * attacker-controlled domain that decodes it.
 *
 * Heuristics (conservative — DNS tunneling has a wide signature surface):
 *   - The `domain` field is longer than `DNS_TUNNEL_MIN_LENGTH` (default 50)
 *   - Per-label Shannon entropy > `DNS_TUNNEL_MIN_ENTROPY` bits (default 3.5)
 *   - Same client produced >= `DNS_TUNNEL_MIN_HITS` such queries in the window
 *
 * Severity:
 *   - hits..2x threshold → MEDIUM
 *   - over 2x threshold   → HIGH
 *
 * Fingerprint: detector:clientIp:parentDomain
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import { loadAllowlistSnapshot, isAllowlisted } from '../services/dnsAllowlist';
import type {
  Detector,
  DetectorContext,
  DetectionEvidence,
  DetectionResult,
} from './framework';

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Shannon entropy of a string in bits per character. */
export function shannonEntropy(str: string): number {
  if (!str) return 0;
  const freq = new Map<string, number>();
  for (const ch of str) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Strip the eTLD+1 down to the parent domain we'll fingerprint by. */
export function parentDomain(domain: string): string {
  const parts = domain.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  return parts.slice(-2).join('.');
}

export const dnsTunnelingDetector: Detector = {
  id: 'dns_tunneling',
  description:
    'Suspiciously long, high-entropy DNS queries from one client — classic DNS-exfil signature.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const minLength = envNumber('DNS_TUNNEL_MIN_LENGTH', 50);
    const minEntropy = envNumber('DNS_TUNNEL_MIN_ENTROPY', 3.5);
    const minHits = envNumber('DNS_TUNNEL_MIN_HITS', 5);

    const allowlist = await loadAllowlistSnapshot();

    const queries = await prisma.dnsQueryEvent.findMany({
      where: {
        queriedAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
      },
      select: {
        id: true,
        domain: true,
        clientIp: true,
        clientName: true,
      },
    });

    const groups = new Map<
      string,
      {
        evidence: DetectionEvidence[];
        actor: string;
        clientIp: string;
        parent: string;
      }
    >();
    for (const q of queries) {
      if (!q.domain || !q.clientIp) continue;
      if (q.domain.length < minLength) continue;
      if (shannonEntropy(q.domain) < minEntropy) continue;
      const parent = parentDomain(q.domain);
      if (isAllowlisted(parent, q.clientIp, allowlist)) continue;
      const key = `${q.clientIp}:${parent}`;
      const bucket = groups.get(key) ?? {
        evidence: [],
        actor: q.clientName ?? q.clientIp,
        clientIp: q.clientIp,
        parent,
      };
      if (bucket.evidence.length < 25) {
        bucket.evidence.push({ kind: 'dns_query', id: q.id });
      }
      groups.set(key, bucket);
    }

    const findings: DetectionResult[] = [];
    for (const [key, bucket] of groups) {
      const count = bucket.evidence.length;
      if (count < minHits) continue;
      const severity: Severity = count >= minHits * 2 ? 'HIGH' : 'MEDIUM';
      findings.push({
        fingerprint: `dns_tunneling:${key}`,
        severity,
        title: `${bucket.actor} sent ${count} long high-entropy DNS queries to *.${bucket.parent}`,
        description: `Repeated suspiciously-shaped DNS queries (length ≥ ${minLength}, entropy ≥ ${minEntropy} bits/char) — characteristic of DNS-tunneling exfiltration.`,
        affectedResource: bucket.actor,
        evidence: bucket.evidence,
        metadata: {
          parentDomain: bucket.parent,
          clientIp: bucket.clientIp,
          queryCount: count,
        },
      });
    }

    if (findings.length > 0) {
      ctx.log.warn(`dns_tunneling emitted ${findings.length} finding(s)`);
    }
    return findings;
  },
};
