/**
 * `ioc_match` detector — flag any FirewallFlowEvent or DnsQueryEvent whose
 * destination matches the IocEntry cache. This is the "hot lead" detector:
 * a single match against a curated feed (URLhaus, Spamhaus, ...) is enough
 * to fire HIGH or CRITICAL.
 *
 * Severity rule: feed.category drives the ceiling.
 *   - malware-c2 / cryptominer  → CRITICAL
 *   - phishing                   → HIGH
 *   - default                    → HIGH
 *
 * Fingerprint: detector:srcMac|srcIp:matchedValue → coalesces repeated
 * sightings of the same device hitting the same IOC into one Detection
 * with `occurrences` incrementing.
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import {
  lookupDomain,
  lookupIp,
  type IocLookupHit,
} from '../services/threatIntel/iocFeedService';
import type {
  Detector,
  DetectorContext,
  DetectionEvidence,
  DetectionResult,
} from './framework';

const CRITICAL_CATEGORIES = new Set(['malware-c2', 'cryptominer']);

function severityFor(hits: ReadonlyArray<IocLookupHit>): Severity {
  for (const hit of hits) {
    if (hit.category && CRITICAL_CATEGORIES.has(hit.category)) return 'CRITICAL';
  }
  return 'HIGH';
}

function feedSummary(hits: ReadonlyArray<IocLookupHit>): string {
  const feeds = Array.from(new Set(hits.map((h) => h.feed)));
  return feeds.join(', ');
}

function evidenceFor(
  matchedValue: string,
  hits: ReadonlyArray<IocLookupHit>,
  source: { kind: 'flow' | 'dns_query'; id: string }
): DetectionEvidence[] {
  const out: DetectionEvidence[] = [{ kind: source.kind, id: source.id }];
  for (const hit of hits) {
    out.push({ kind: 'ioc', ioc: matchedValue, feed: hit.feed });
  }
  return out;
}

export const iocMatchDetector: Detector = {
  id: 'ioc_match',
  description: 'Flow or DNS query matches a known threat-intel indicator.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const begin = new Date(ctx.beginTime);
    const end = new Date(ctx.endTime);
    const findings: DetectionResult[] = [];

    // Flow side — outbound destinations against the IP cache.
    const flows = await prisma.firewallFlowEvent.findMany({
      where: { occurredAt: { gte: begin, lte: end }, dstIp: { not: null } },
      select: {
        id: true,
        srcMac: true,
        srcIp: true,
        srcClientName: true,
        dstIp: true,
        dstHostName: true,
      },
    });

    const dedupe = new Map<string, DetectionResult>();
    for (const flow of flows) {
      if (!flow.dstIp) continue;
      const hits = await lookupIp(flow.dstIp);
      if (hits.length === 0) continue;
      mergeFinding(dedupe, {
        srcKey: flow.srcMac ?? flow.srcIp ?? 'unknown',
        srcMac: flow.srcMac ?? undefined,
        actor: flow.srcClientName ?? flow.srcMac ?? flow.srcIp ?? 'unknown device',
        matchedValue: flow.dstIp,
        hits,
        evidence: evidenceFor(flow.dstIp, hits, { kind: 'flow', id: flow.id }),
      });
    }

    // DNS side — queried domains against the domain cache.
    const queries = await prisma.dnsQueryEvent.findMany({
      where: { queriedAt: { gte: begin, lte: end } },
      select: { id: true, domain: true, clientIp: true, clientName: true },
    });
    for (const query of queries) {
      if (!query.domain) continue;
      const hits = await lookupDomain(query.domain);
      if (hits.length === 0) continue;
      mergeFinding(dedupe, {
        srcKey: query.clientIp ?? 'unknown',
        actor: query.clientName ?? query.clientIp ?? 'unknown client',
        matchedValue: query.domain.toLowerCase(),
        hits,
        evidence: evidenceFor(query.domain.toLowerCase(), hits, {
          kind: 'dns_query',
          id: query.id,
        }),
      });
    }

    findings.push(...dedupe.values());
    if (findings.length > 0) {
      ctx.log.info(`ioc_match emitted ${findings.length} finding(s)`);
    }
    return findings;
  },
};

interface MergeArgs {
  srcKey: string;
  srcMac?: string;
  actor: string;
  matchedValue: string;
  hits: ReadonlyArray<IocLookupHit>;
  evidence: DetectionEvidence[];
}

function mergeFinding(dedupe: Map<string, DetectionResult>, args: MergeArgs): void {
  const fingerprint = `ioc_match:${args.srcKey}:${args.matchedValue}`;
  const existing = dedupe.get(fingerprint);
  if (existing) {
    existing.evidence.push(...args.evidence);
    return;
  }
  dedupe.set(fingerprint, {
    fingerprint,
    severity: severityFor(args.hits),
    title: `${args.actor} contacted known-bad ${args.matchedValue}`,
    description: `Destination matched threat-intel feed(s): ${feedSummary(args.hits)}.`,
    affectedResource: args.actor,
    srcMac: args.srcMac,
    evidence: args.evidence,
    metadata: {
      matchedValue: args.matchedValue,
      feeds: Array.from(new Set(args.hits.map((h) => h.feed))),
      categories: Array.from(
        new Set(args.hits.map((h) => h.category).filter(Boolean))
      ),
    },
  });
}
