/**
 * Corroborate IOC evidence with IDS activity from the same source IP and
 * immutable controller/site scope. Display labels and the reporting gateway's
 * MAC are never endpoint identity. Both underlying events must be in the window.
 * The historical detector id is retained for configuration/API compatibility.
 * A deterministic rule match is not proof that an intrusion succeeded.
 */
import type { Prisma } from '@prisma/client';
import prisma from '../services/database';
import type { Detector, DetectorContext, DetectionEvidence, DetectionResult } from './framework';
import {
  createDetectorIdentity, detectorFingerprint, deviceIdentityKey, normalizeIp,
  parseDetectorIdentity, type DetectorIdentity,
} from './identity';

const PAGE_SIZE = 200;

interface Candidate {
  id: string;
  identity: DetectorIdentity;
  indicator: string;
  flowIds: Set<string>;
  indicators: Array<Extract<DetectionEvidence, { kind: 'ioc' }>>;
}

const flowSelect = {
  id: true, connectionId: true, scopeId: true, occurredAt: true,
  srcIp: true, srcMac: true, srcClientName: true, dstIp: true,
} satisfies Prisma.FirewallFlowEventSelect;
type Flow = Prisma.FirewallFlowEventGetPayload<{ select: typeof flowSelect }>;

interface FlowMatch {
  candidate: Candidate;
  flow: Flow;
  identity: DetectorIdentity;
}

interface Correlation {
  result: DetectionResult;
  evidence: Map<string, DetectionEvidence>;
  iocFindingIds: Set<string>;
  threatIds: Set<string>;
  threatCategories: Set<string>;
  sourceIps: Set<string>;
  firstObservedAt: number;
  lastObservedAt: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function candidateFrom(row: { id: string; metadata: unknown; evidence: unknown }): Candidate | null {
  const metadata = record(row.metadata);
  const identity = parseDetectorIdentity(metadata?.identity);
  // AdGuard and UniFi ids belong to different namespaces. DNS requires an
  // explicit network binding before it can corroborate controller IDS data.
  if (!identity || identity.sourceKind !== 'unifi' || !identity.connectionId || !identity.scopeId) return null;
  if (!identity.srcMac && !identity.srcIp) return null;
  const indicator = normalizeIp(typeof metadata?.matchedValue === 'string' ? metadata.matchedValue : null);
  if (!indicator || !Array.isArray(row.evidence)) return null;

  const flowIds = new Set<string>();
  const indicators: Candidate['indicators'] = [];
  for (const item of row.evidence) {
    const evidence = record(item);
    if (!evidence) continue;
    if (evidence.kind === 'flow' && typeof evidence.id === 'string' && evidence.id) flowIds.add(evidence.id);
    if (evidence.kind === 'ioc' && typeof evidence.ioc === 'string' &&
        normalizeIp(evidence.ioc) === indicator && typeof evidence.feed === 'string' && evidence.feed) {
      indicators.push({ kind: 'ioc', ioc: indicator, feed: evidence.feed });
    }
  }
  return flowIds.size && indicators.length ? { id: row.id, identity, indicator, flowIds, indicators } : null;
}

function sourceKey(scopeId: string, srcIp: string): string {
  return JSON.stringify([scopeId, srcIp]);
}

function inWindow(date: Date, ctx: DetectorContext): boolean {
  const value = date.getTime();
  return value >= ctx.beginTime && value <= ctx.endTime;
}

export const validatedCompromiseDetector: Detector = {
  id: 'validated_compromise',
  description: 'IOC and IDS activity share a source IP, controller/site, and event window.',
  defaultWindowMinutes: 120,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const window = { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) };
    const correlations = new Map<string, Correlation>();
    let afterId: string | undefined;

    // lastSeen is processing time; only the raw event time establishes activity.
    for (;;) {
      const findings = await prisma.detection.findMany({
        where: { detectorId: 'ioc_match', ...(afterId ? { id: { gt: afterId } } : {}) },
        select: { id: true, evidence: true, metadata: true },
        orderBy: { id: 'asc' }, take: PAGE_SIZE,
      });
      if (!findings.length) break;
      const candidates = findings.map(candidateFrom).filter((value): value is Candidate => value !== null);
      const byFlowId = new Map<string, Candidate[]>();
      for (const candidate of candidates) {
        for (const id of candidate.flowIds) {
          const entries = byFlowId.get(id) ?? [];
          entries.push(candidate);
          byFlowId.set(id, entries);
        }
      }

      const flowIds = Array.from(byFlowId.keys());
      const matchesBySource = new Map<string, FlowMatch[]>();
      const scopes = new Set<string>();
      for (let offset = 0; offset < flowIds.length; offset += PAGE_SIZE) {
        const flows = await prisma.firewallFlowEvent.findMany({
          where: { id: { in: flowIds.slice(offset, offset + PAGE_SIZE) }, occurredAt: window, scopeId: { not: null } },
          select: flowSelect, take: PAGE_SIZE,
        });
        for (const flow of flows) {
          const srcIp = normalizeIp(flow.srcIp);
          if (!flow.scopeId || !srcIp || !inWindow(flow.occurredAt, ctx)) continue;
          const identity = createDetectorIdentity({
            sourceKind: 'unifi', connectionId: flow.connectionId, scopeId: flow.scopeId,
            srcIp, srcMac: flow.srcMac, eventId: flow.id, observedAt: flow.occurredAt,
          });
          for (const candidate of byFlowId.get(flow.id) ?? []) {
            if (candidate.identity.connectionId !== flow.connectionId || candidate.identity.scopeId !== flow.scopeId ||
                deviceIdentityKey(candidate.identity) !== deviceIdentityKey(identity) ||
                normalizeIp(flow.dstIp) !== candidate.indicator) continue;
            const key = sourceKey(flow.scopeId, srcIp);
            const matches = matchesBySource.get(key) ?? [];
            matches.push({ candidate, flow, identity });
            matchesBySource.set(key, matches);
            scopes.add(flow.scopeId);
          }
        }
      }

      const scopeIds = Array.from(scopes);
      for (let offset = 0; offset < scopeIds.length; offset += PAGE_SIZE) {
        let afterThreatId: string | undefined;
        for (;;) {
          const threats = await prisma.firewallThreatEvent.findMany({
            where: {
              scopeId: { in: scopeIds.slice(offset, offset + PAGE_SIZE) }, occurredAt: window,
              OR: [{ type: 'THREAT_DETECTION_AND_PREVENTION' }, { subcategory: 'SECURITY_INTRUSION_PREVENTION' }],
              ...(afterThreatId ? { id: { gt: afterThreatId } } : {}),
            },
            select: { id: true, connectionId: true, scopeId: true, srcIp: true, occurredAt: true, category: true, type: true, subcategory: true },
            orderBy: { id: 'asc' }, take: PAGE_SIZE,
          });
          for (const threat of threats) {
            const srcIp = normalizeIp(threat.srcIp);
            if (!threat.scopeId || !srcIp || !inWindow(threat.occurredAt, ctx)) continue;
            if (threat.type !== 'THREAT_DETECTION_AND_PREVENTION' && threat.subcategory !== 'SECURITY_INTRUSION_PREVENTION') continue;
            for (const match of matchesBySource.get(sourceKey(threat.scopeId, srcIp)) ?? []) {
              if (match.flow.connectionId !== threat.connectionId) continue;
              const fingerprint = detectorFingerprint('validated_compromise', match.identity);
              let correlation = correlations.get(fingerprint);
              const flowTime = match.flow.occurredAt.getTime();
              const threatTime = threat.occurredAt.getTime();
              if (!correlation) {
                const actor = match.flow.srcClientName || match.identity.srcMac || srcIp;
                correlation = {
                  result: {
                    fingerprint, severity: 'CRITICAL',
                    title: `Corroborated IOC and IDS activity: ${actor}`,
                    description: 'A threat-intel match and a UniFi IDS event share the same source IP and controller/site within the event window. Investigate promptly; blocked traffic alone does not establish successful compromise.',
                    affectedResource: actor, srcMac: match.identity.srcMac ?? undefined,
                    // Deterministic rule match, not a calibrated compromise probability.
                    confidence: 1.0, evidence: [], metadata: { identity: match.identity },
                  },
                  evidence: new Map(), iocFindingIds: new Set(), threatIds: new Set(),
                  threatCategories: new Set(), sourceIps: new Set(),
                  firstObservedAt: Math.min(flowTime, threatTime), lastObservedAt: Math.max(flowTime, threatTime),
                };
                correlations.set(fingerprint, correlation);
              }
              const evidence: DetectionEvidence[] = [
                { kind: 'flow', id: match.flow.id }, ...match.candidate.indicators, { kind: 'threat', id: threat.id },
              ];
              for (const item of evidence) correlation.evidence.set(JSON.stringify(item), item);
              correlation.iocFindingIds.add(match.candidate.id);
              correlation.threatIds.add(threat.id);
              if (threat.category) correlation.threatCategories.add(threat.category);
              correlation.sourceIps.add(srcIp);
              correlation.firstObservedAt = Math.min(correlation.firstObservedAt, flowTime, threatTime);
              correlation.lastObservedAt = Math.max(correlation.lastObservedAt, flowTime, threatTime);
              const latest = parseDetectorIdentity(correlation.result.metadata?.identity);
              if (!latest?.observedAt || flowTime > Date.parse(latest.observedAt)) {
                correlation.result.metadata = { identity: match.identity };
              }
            }
          }
          if (threats.length < PAGE_SIZE) break;
          afterThreatId = threats[threats.length - 1]!.id;
        }
      }
      if (findings.length < PAGE_SIZE) break;
      afterId = findings[findings.length - 1]!.id;
    }

    const results = Array.from(correlations.values(), (correlation): DetectionResult => ({
      ...correlation.result,
      evidence: Array.from(correlation.evidence.values()),
      metadata: {
        ...correlation.result.metadata,
        correlationBasis: 'same_source_ip_and_immutable_controller_site_within_event_window',
        confidenceBasis: 'deterministic_rule_match_not_compromise_probability',
        iocFindingId: Array.from(correlation.iocFindingIds)[0],
        iocFindingIds: Array.from(correlation.iocFindingIds).sort(),
        threatCategories: Array.from(correlation.threatCategories).sort(),
        threatCount: correlation.threatIds.size,
        sourceIps: Array.from(correlation.sourceIps).sort(),
        firstObservedAt: new Date(correlation.firstObservedAt).toISOString(),
        lastObservedAt: new Date(correlation.lastObservedAt).toISOString(),
      },
    }));
    if (results.length) ctx.log.warn(`validated_compromise emitted ${results.length} finding(s)`);
    return results;
  },
};
