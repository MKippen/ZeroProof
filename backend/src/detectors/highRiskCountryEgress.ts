/**
 * `high_risk_country_egress` detector — flag flows whose destination region
 * (UniFi GeoIP-resolved `dstRegion`) is in a high-risk-country allowlist that
 * the network owner has explicitly opted into. Default list is the four
 * countries most commonly named in OFAC / SOC playbooks; operators can
 * override via `HIGH_RISK_COUNTRIES` env var (comma-separated ISO codes).
 *
 * This is intentionally an INFO/MEDIUM signal, not an automatic alert —
 * legitimate traffic to these regions exists. The value is in the dashboard
 * surface ("here is everything you may want to review"), not in paging.
 *
 * Severity:
 *   - blocked traffic to a high-risk region → INFO (UniFi already blocked)
 *   - allowed/established traffic           → MEDIUM
 *
 * Fingerprint: detector:srcMac|srcIp:dstRegion → all flows from one device
 * to one region in the window collapse into one finding.
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionResult,
} from './framework';

const DEFAULT_HIGH_RISK = ['CN', 'RU', 'KP', 'IR'];

function highRiskCountries(): string[] {
  const raw = process.env.HIGH_RISK_COUNTRIES;
  if (!raw) return DEFAULT_HIGH_RISK;
  return raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

function severityFor(action: string | null | undefined): Severity {
  if (!action) return 'MEDIUM';
  return action.toLowerCase() === 'blocked' ? 'INFO' : 'MEDIUM';
}

export const highRiskCountryEgressDetector: Detector = {
  id: 'high_risk_country_egress',
  description: 'Allowed flow to a high-risk country (per operator-defined list).',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const watch = highRiskCountries();
    if (watch.length === 0) return [];

    const flows = await prisma.firewallFlowEvent.findMany({
      where: {
        occurredAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
        dstRegion: { in: watch },
      },
      select: {
        id: true,
        action: true,
        srcMac: true,
        srcIp: true,
        srcClientName: true,
        dstIp: true,
        dstRegion: true,
        bytesTotal: true,
      },
    });

    const dedupe = new Map<string, DetectionResult>();
    for (const flow of flows) {
      const region = flow.dstRegion;
      if (!region) continue;
      const srcKey = flow.srcMac ?? flow.srcIp ?? 'unknown';
      const fingerprint = `high_risk_country_egress:${srcKey}:${region}`;

      const existing = dedupe.get(fingerprint);
      if (existing) {
        existing.evidence.push({ kind: 'flow', id: flow.id });
        // Allowed traffic outranks blocked when scoring severity.
        if (severityFor(flow.action) === 'MEDIUM') existing.severity = 'MEDIUM';
        const meta = existing.metadata ?? {};
        const totalBytes = (meta.totalBytes as bigint | undefined) ?? BigInt(0);
        meta.totalBytes = totalBytes + BigInt(flow.bytesTotal ?? 0);
        existing.metadata = meta;
        continue;
      }

      const actor = flow.srcClientName ?? flow.srcMac ?? flow.srcIp ?? 'unknown device';
      dedupe.set(fingerprint, {
        fingerprint,
        severity: severityFor(flow.action),
        title: `${actor} egressed to ${region}`,
        description: `Flow destination resolved to ${region}, which is on the high-risk country watch list.`,
        affectedResource: actor,
        srcMac: flow.srcMac ?? undefined,
        evidence: [{ kind: 'flow', id: flow.id }],
        metadata: {
          dstRegion: region,
          totalBytes: BigInt(flow.bytesTotal ?? 0),
          action: flow.action,
        },
      });
    }

    // Convert BigInt totals to string for JSON storage (Prisma Json doesn't
    // serialize BigInt). Detectors emit plain JSON-friendly metadata.
    for (const finding of dedupe.values()) {
      const meta = finding.metadata;
      if (meta && typeof meta.totalBytes === 'bigint') {
        meta.totalBytes = meta.totalBytes.toString();
      }
    }

    if (dedupe.size > 0) {
      ctx.log.info(`high_risk_country_egress emitted ${dedupe.size} finding(s)`);
    }
    return Array.from(dedupe.values());
  },
};
