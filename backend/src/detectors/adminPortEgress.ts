/**
 * `admin_port_egress` detector — internal devices reaching out to admin
 * ports (SSH 22, Telnet 23, RDP 3389, VNC 5900-5905, WinRM 5985/5986) on
 * external IPs. Almost never legitimate from non-admin hosts; commonly seen
 * with compromised devices, lateral-movement attempts, or
 * misconfigurations.
 *
 * Severity:
 *   - Allowed → HIGH   (something got out)
 *   - Blocked → LOW    (UniFi blocked it; still worth surfacing)
 *
 * Fingerprint: detector:srcMac|srcIp:dstPort → one finding per (device, port).
 */
import type { Severity } from '@prisma/client';
import prisma from '../services/database';
import type {
  Detector,
  DetectorContext,
  DetectionResult,
} from './framework';

const DEFAULT_ADMIN_PORTS = [22, 23, 3389, 5900, 5901, 5902, 5985, 5986];

function adminPorts(): number[] {
  const raw = process.env.ADMIN_EGRESS_PORTS;
  if (!raw) return DEFAULT_ADMIN_PORTS;
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
}

function isPrivateIp(ip: string): boolean {
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('127.'))
    return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return false;
}

function severityFor(action: string | null | undefined): Severity {
  if (!action) return 'HIGH';
  return action.toLowerCase() === 'blocked' ? 'LOW' : 'HIGH';
}

export const adminPortEgressDetector: Detector = {
  id: 'admin_port_egress',
  description:
    'Internal device contacted an admin port (SSH/RDP/VNC/...) on an external IP.',
  defaultWindowMinutes: 60,
  async evaluate(ctx: DetectorContext): Promise<DetectionResult[]> {
    const ports = adminPorts();
    if (ports.length === 0) return [];

    const flows = await prisma.firewallFlowEvent.findMany({
      where: {
        occurredAt: { gte: new Date(ctx.beginTime), lte: new Date(ctx.endTime) },
        dstPort: { in: ports },
        dstIp: { not: null },
      },
      select: {
        id: true,
        action: true,
        srcMac: true,
        srcIp: true,
        srcClientName: true,
        dstIp: true,
        dstPort: true,
      },
    });

    const dedupe = new Map<string, DetectionResult>();
    for (const flow of flows) {
      if (!flow.dstIp || flow.dstPort == null) continue;
      if (isPrivateIp(flow.dstIp)) continue; // internal admin traffic ignored here

      const srcKey = flow.srcMac ?? flow.srcIp ?? 'unknown';
      const fingerprint = `admin_port_egress:${srcKey}:${flow.dstPort}`;
      const existing = dedupe.get(fingerprint);
      if (existing) {
        existing.evidence.push({ kind: 'flow', id: flow.id });
        if (severityFor(flow.action) === 'HIGH') existing.severity = 'HIGH';
        continue;
      }
      const actor =
        flow.srcClientName ?? flow.srcMac ?? flow.srcIp ?? 'unknown device';
      dedupe.set(fingerprint, {
        fingerprint,
        severity: severityFor(flow.action),
        title: `${actor} attempted egress to admin port ${flow.dstPort}`,
        description: `Outbound traffic to an admin / remote-management port on the public internet. Rarely legitimate; investigate the source device.`,
        affectedResource: actor,
        srcMac: flow.srcMac ?? undefined,
        evidence: [{ kind: 'flow', id: flow.id }],
        metadata: { dstPort: flow.dstPort, action: flow.action },
      });
    }

    if (dedupe.size > 0) {
      ctx.log.info(`admin_port_egress emitted ${dedupe.size} finding(s)`);
    }
    return Array.from(dedupe.values());
  },
};
