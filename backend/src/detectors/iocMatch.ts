/** IOC matches remain separate from any subsequent compromise correlation. */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import { lookupDomain, lookupIp, type IocLookupHit } from '../services/threatIntel/iocFeedService';
import type { Detector, DetectorContext, DetectionEvidence, DetectionResult } from './framework';
import { createDetectorIdentity, detectorFingerprint, normalizeIp, type DetectorIdentity } from './identity';

const CRITICAL_CATEGORIES = new Set(['malware-c2', 'cryptominer']);
const EVENT_PAGE_SIZE = 500;

export interface IocMatchMetadata extends Record<string, unknown> {
  identity: DetectorIdentity;
  matchedValue: string;
  indicatorKind: 'ip' | 'domain';
  observedDestinations: string[];
  feeds: string[];
  categories: string[];
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  sourceEventCount: number;
}

interface Match {
  identity: DetectorIdentity;
  actor: string;
  destination: string;
  kind: 'ip' | 'domain';
  hits: ReadonlyArray<IocLookupHit>;
  evidence: { kind: 'flow' | 'dns_query'; id: string };
}

interface FindingAccumulator {
  finding: DetectionResult;
  evidenceKeys: Set<string>;
  feeds: Set<string>;
  categories: Set<string>;
  destinations: Set<string>;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

function severityFor(hits: ReadonlyArray<IocLookupHit>): Severity {
  return hits.some((hit) => hit.severity?.toUpperCase() === 'CRITICAL' ||
    CRITICAL_CATEGORIES.has(hit.category?.trim().toLowerCase() ?? '')) ? 'CRITICAL' : 'HIGH';
}

function mergeFinding(dedupe: Map<string, FindingAccumulator>, match: Match): void {
  // A parent-domain hit identifies the listed parent indicator; keep the
  // actual queried hostname separately rather than inventing a feed entry.
  const indicators = new Map<string, IocLookupHit[]>();
  for (const hit of match.hits) {
    const indicator = match.kind === 'ip' ? normalizeIp(hit.value) : normalizeDomain(hit.value);
    if (!indicator || hit.kind !== match.kind) continue;
    const hits = indicators.get(indicator) ?? [];
    hits.push(hit);
    indicators.set(indicator, hits);
  }

  for (const [matchedValue, hits] of indicators) {
    const fingerprint = detectorFingerprint('ioc_match', match.identity, `${match.kind}:${matchedValue}`);
    const accumulator = dedupe.get(fingerprint);
    const prior = accumulator?.finding;
    const metadata: IocMatchMetadata = prior ? prior.metadata as IocMatchMetadata : {
      identity: match.identity,
      matchedValue,
      indicatorKind: match.kind,
      observedDestinations: [],
      feeds: [],
      categories: [],
      firstObservedAt: null,
      lastObservedAt: null,
      sourceEventCount: 0,
    };
    const feeds = accumulator?.feeds ?? new Set<string>();
    const categories = accumulator?.categories ?? new Set<string>();
    const destinations = accumulator?.destinations ?? new Set<string>();
    for (const hit of hits) {
      feeds.add(hit.feed);
      if (hit.category?.trim()) categories.add(hit.category.trim().toLowerCase());
    }
    destinations.add(match.destination);
    const observedAt = match.identity.observedAt;
    const newest = !!observedAt && (!metadata.lastObservedAt || observedAt > metadata.lastObservedAt ||
      (observedAt === metadata.lastObservedAt && match.identity.eventId > metadata.identity.eventId));
    if (observedAt) {
      if (!metadata.firstObservedAt || observedAt < metadata.firstObservedAt) metadata.firstObservedAt = observedAt;
      if (!metadata.lastObservedAt || observedAt > metadata.lastObservedAt) metadata.lastObservedAt = observedAt;
    }
    if (newest) metadata.identity = match.identity;

    const newEvidence: DetectionEvidence[] = [
      match.evidence,
      ...hits.map((hit) => ({ kind: 'ioc' as const, ioc: matchedValue, feed: hit.feed })),
    ];
    const seen = accumulator?.evidenceKeys ?? new Set<string>();
    const evidence = prior?.evidence ?? [];
    for (const item of newEvidence) {
      const key = JSON.stringify(item);
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(item);
      if (item.kind === 'flow' || item.kind === 'dns_query') metadata.sourceEventCount += 1;
    }
    const actor = prior && !newest ? prior.affectedResource ?? match.actor : match.actor;
    const finding: DetectionResult = {
      fingerprint,
      severity: prior?.severity === 'CRITICAL' ? 'CRITICAL' : severityFor(hits),
      title: `${actor} matched threat indicator ${matchedValue}`,
      description: '', // Completed after merging all matching feeds.
      affectedResource: actor,
      srcMac: metadata.identity.srcMac ?? undefined,
      evidence,
      metadata,
    };
    dedupe.set(fingerprint, { finding, evidenceKeys: seen, feeds, categories, destinations });
  }
}

export const iocMatchDetector: Detector = {
  id: 'ioc_match',
  description: 'Flow or DNS query matches a known threat-intel indicator.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const begin = new Date(ctx.beginTime);
    const end = new Date(ctx.endTime);
    const dedupe = new Map<string, FindingAccumulator>();

    let flowCursor: string | undefined;
    for (;;) {
      const flows = await prisma.firewallFlowEvent.findMany({
        where: {
          occurredAt: { gte: begin, lte: end }, dstIp: { not: null },
          ...(flowCursor ? { id: { gt: flowCursor } } : {}),
        },
        select: {
          id: true, connectionId: true, scopeId: true, occurredAt: true,
          srcMac: true, srcIp: true, srcClientName: true, dstIp: true,
        },
        orderBy: { id: 'asc' },
        take: EVENT_PAGE_SIZE,
      });
      const lookups = new Map<string, IocLookupHit[]>();
      for (const flow of flows) {
        const destination = normalizeIp(flow.dstIp);
        if (!destination) continue;
        // Preserve exact-cache lookup spelling until feed ingestion itself
        // canonicalizes IPv6. Device keys and emitted indicators normalize it.
        const lookupValue = flow.dstIp!.trim().toLowerCase();
        let hits = lookups.get(lookupValue);
        if (!hits) {
          hits = await lookupIp(lookupValue);
          lookups.set(lookupValue, hits);
        }
        if (hits.length === 0) continue;
        const identity = createDetectorIdentity({
          sourceKind: 'unifi', connectionId: flow.connectionId, scopeId: flow.scopeId,
          srcIp: flow.srcIp, srcMac: flow.srcMac, eventId: flow.id, observedAt: flow.occurredAt,
        });
        mergeFinding(dedupe, {
          identity, destination, kind: 'ip', hits,
          actor: flow.srcClientName?.trim() || identity.srcMac || identity.srcIp || 'Unknown device',
          evidence: { kind: 'flow', id: flow.id },
        });
      }
      if (flows.length < EVENT_PAGE_SIZE) break;
      flowCursor = flows[flows.length - 1]!.id;
    }

    let queryCursor: string | undefined;
    for (;;) {
      const queries = await prisma.dnsQueryEvent.findMany({
        where: {
          queriedAt: { gte: begin, lte: end },
          ...(queryCursor ? { id: { gt: queryCursor } } : {}),
        },
        select: { id: true, connectionId: true, queriedAt: true, domain: true, clientIp: true, clientName: true },
        orderBy: { id: 'asc' },
        take: EVENT_PAGE_SIZE,
      });
      const lookups = new Map<string, IocLookupHit[]>();
      for (const query of queries) {
        const destination = normalizeDomain(query.domain);
        if (!destination) continue;
        let hits = lookups.get(destination);
        if (!hits) {
          hits = await lookupDomain(destination);
          lookups.set(destination, hits);
        }
        if (hits.length === 0) continue;
        const identity = createDetectorIdentity({
          sourceKind: 'adguard', connectionId: query.connectionId, srcIp: query.clientIp,
          eventId: query.id, observedAt: query.queriedAt,
        });
        mergeFinding(dedupe, {
          identity, destination, kind: 'domain', hits,
          actor: query.clientName?.trim() || identity.srcIp || 'Unknown client',
          evidence: { kind: 'dns_query', id: query.id },
        });
      }
      if (queries.length < EVENT_PAGE_SIZE) break;
      queryCursor = queries[queries.length - 1]!.id;
    }

    if (dedupe.size > 0) ctx.log.info(`ioc_match emitted ${dedupe.size} finding(s)`);
    return Array.from(dedupe.values(), ({ finding, feeds, categories, destinations }) => {
      const metadata = finding.metadata as IocMatchMetadata;
      metadata.feeds = Array.from(feeds).sort();
      metadata.categories = Array.from(categories).sort();
      metadata.observedDestinations = Array.from(destinations).sort();
      finding.description = `Destination matched threat-intel feed(s): ${metadata.feeds.join(', ')}.`;
      return finding;
    });
  },
};
