/**
 * `validated_compromise` detector — the highest-confidence finding the
 * engine produces. Fires only when a single source device shows BOTH:
 *   1. an ioc_match Detection (flow/DNS hit known-bad), AND
 *   2. a UniFi IDS threat event in the same window
 * within the configured time window.
 *
 * Two independent corroborations of "this device is bad" → near-zero
 * false-positive rate, and the on-call engineer should treat it as a real
 * incident.
 *
 * This detector reads from the *output* of other detectors (Detection rows)
 * rather than raw data — it sits one layer above the primary detectors.
 *
 * Fingerprint: detector:srcMac|srcIp → one finding per device per window.
 */
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionEvidence,
  DetectionResult,
} from './framework';

export const validatedCompromiseDetector: Detector = {
  id: 'validated_compromise',
  description:
    'Device shows both an IOC match AND a UniFi IDS hit in the same window.',
  defaultWindowMinutes: 120,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const begin = new Date(ctx.beginTime);
    const end = new Date(ctx.endTime);

    // Step 1: collect ioc_match findings from this window.
    const iocFindings = await prisma.detection.findMany({
      where: {
        detectorId: 'ioc_match',
        lastSeen: { gte: begin, lte: end },
      },
      select: {
        id: true,
        srcMac: true,
        affectedResource: true,
        evidence: true,
      },
    });
    if (iocFindings.length === 0) return [];

    // Step 2: collect UniFi threat events from this window, indexed by srcIp.
    const threats = await prisma.firewallThreatEvent.findMany({
      where: {
        occurredAt: { gte: begin, lte: end },
      },
      select: { id: true, srcIp: true, deviceMac: true, category: true },
    });
    if (threats.length === 0) return [];

    const threatsByMac = new Map<string, typeof threats>();
    const threatsByIp = new Map<string, typeof threats>();
    for (const t of threats) {
      if (t.deviceMac) {
        const k = t.deviceMac.toLowerCase();
        const arr = threatsByMac.get(k) ?? [];
        arr.push(t);
        threatsByMac.set(k, arr);
      }
      if (t.srcIp) {
        const arr = threatsByIp.get(t.srcIp) ?? [];
        arr.push(t);
        threatsByIp.set(t.srcIp, arr);
      }
    }

    const dedupe = new Map<string, DetectionResult>();
    for (const ioc of iocFindings) {
      const mac = ioc.srcMac?.toLowerCase();
      const matchedThreats = mac
        ? threatsByMac.get(mac) ?? []
        : threatsByIp.get(ioc.affectedResource ?? '') ?? [];
      if (matchedThreats.length === 0) continue;

      const srcKey = mac ?? ioc.affectedResource ?? 'unknown';
      const fingerprint = `validated_compromise:${srcKey}`;
      const existing = dedupe.get(fingerprint);
      const newEvidence: DetectionEvidence[] = [
        ...matchedThreats.map((t) => ({ kind: 'threat' as const, id: t.id })),
      ];
      if (existing) {
        existing.evidence.push(...newEvidence);
        continue;
      }
      dedupe.set(fingerprint, {
        fingerprint,
        severity: 'CRITICAL',
        title: `Validated compromise: ${ioc.affectedResource ?? srcKey}`,
        description:
          'This source matched a threat-intel indicator AND triggered the UniFi IDS in the same window. Two independent signals agree — treat as an active incident.',
        affectedResource: ioc.affectedResource ?? undefined,
        srcMac: ioc.srcMac ?? undefined,
        confidence: 1.0,
        evidence: newEvidence,
        metadata: {
          iocFindingId: ioc.id,
          threatCategories: Array.from(
            new Set(matchedThreats.map((t) => t.category).filter(Boolean))
          ),
          threatCount: matchedThreats.length,
        },
      });
    }

    if (dedupe.size > 0) {
      ctx.log.warn(`validated_compromise emitted ${dedupe.size} finding(s)`);
    }
    return Array.from(dedupe.values());
  },
};
