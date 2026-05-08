/**
 * Aggregate analytics over FirewallFlowEvent / FirewallThreatEvent. These
 * mirror the panels on UniFi's "Traffic & Flow" view — Top Triggered Policies,
 * Top Affected Clients, Top Affected Regions, Flow Summary — but computed
 * from our own captured rows so they outlast UniFi's session window.
 */
import prisma from '../database';

export interface TrafficSummary {
  windowHours: number;
  since: string;
  totalBlocked: number;
  byRisk: { low: number; medium: number; high: number; concerning: number };
  uniqueSrcMacs: number;
  threatCount: number;
}

export interface TopPolicy {
  name: string;
  type: string | null;
  count: number;
}

export interface TopClient {
  mac: string;
  displayName: string;
  count: number;
}

export interface TopRegion {
  region: string;
  count: number;
}

export interface RecentFlow {
  id: string;
  occurredAt: string;
  action: string;
  protocol: string | null;
  service: string | null;
  risk: string | null;
  direction: string | null;
  srcMac: string | null;
  srcClientName: string | null;
  srcNetworkName: string | null;
  dstIp: string | null;
  dstRegion: string | null;
  dstClientName: string | null;
  inNetworkName: string | null;
  outNetworkName: string | null;
  primaryPolicyName: string | null;
}

export interface RecentThreat {
  id: string;
  occurredAt: string;
  severity: string | null;
  message: string | null;
  srcIp: string | null;
  dstIp: string | null;
  deviceMac: string | null;
}

interface AnalyticsParams {
  connectionId: string;
  windowHours: number;
}

function since(windowHours: number): Date {
  return new Date(Date.now() - windowHours * 60 * 60 * 1000);
}

export async function getTrafficSummary({
  connectionId,
  windowHours,
}: AnalyticsParams): Promise<TrafficSummary> {
  const cutoff = since(windowHours);

  const [byRiskRows, uniqueSrcs, totalBlocked, threatCount] = await Promise.all([
    prisma.firewallFlowEvent.groupBy({
      by: ['risk'],
      where: { connectionId, occurredAt: { gte: cutoff } },
      _count: { _all: true },
    }),
    prisma.firewallFlowEvent.findMany({
      where: { connectionId, occurredAt: { gte: cutoff }, srcMac: { not: null } },
      select: { srcMac: true },
      distinct: ['srcMac'],
    }),
    prisma.firewallFlowEvent.count({
      where: { connectionId, occurredAt: { gte: cutoff } },
    }),
    prisma.firewallThreatEvent.count({
      where: { connectionId, occurredAt: { gte: cutoff } },
    }),
  ]);

  const risk = { low: 0, medium: 0, high: 0, concerning: 0 };
  for (const row of byRiskRows) {
    const key = (row.risk ?? '').toLowerCase();
    if (key === 'low') risk.low += row._count._all;
    else if (key === 'medium') risk.medium += row._count._all;
    else if (key === 'high') risk.high += row._count._all;
    else risk.concerning += row._count._all;
  }

  return {
    windowHours,
    since: cutoff.toISOString(),
    totalBlocked,
    byRisk: risk,
    uniqueSrcMacs: uniqueSrcs.length,
    threatCount,
  };
}

export async function getTopPolicies(
  { connectionId, windowHours }: AnalyticsParams,
  limit = 10
): Promise<TopPolicy[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.firewallFlowEvent.groupBy({
    by: ['primaryPolicyName'],
    where: {
      connectionId,
      occurredAt: { gte: cutoff },
      primaryPolicyName: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { primaryPolicyName: 'desc' } },
    take: limit,
  });
  return rows
    .filter((r) => r.primaryPolicyName !== null)
    .map((r) => ({
      name: r.primaryPolicyName as string,
      type: null,
      count: r._count._all,
    }));
}

export async function getTopClients(
  { connectionId, windowHours }: AnalyticsParams,
  limit = 10
): Promise<TopClient[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.firewallFlowEvent.groupBy({
    by: ['srcMac', 'srcClientName'],
    where: {
      connectionId,
      occurredAt: { gte: cutoff },
      srcMac: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { srcMac: 'desc' } },
    take: limit,
  });
  return rows
    .filter((r): r is typeof r & { srcMac: string } => r.srcMac !== null)
    .map((r) => ({
      mac: r.srcMac,
      displayName: r.srcClientName ?? r.srcMac,
      count: r._count._all,
    }));
}

export async function getTopRegions(
  { connectionId, windowHours }: AnalyticsParams,
  limit = 10
): Promise<TopRegion[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.firewallFlowEvent.groupBy({
    by: ['dstRegion'],
    where: {
      connectionId,
      occurredAt: { gte: cutoff },
      dstRegion: { not: null },
    },
    _count: { _all: true },
    orderBy: { _count: { dstRegion: 'desc' } },
    take: limit,
  });
  return rows
    .filter((r): r is typeof r & { dstRegion: string } => r.dstRegion !== null)
    .map((r) => ({ region: r.dstRegion, count: r._count._all }));
}

export async function getRecentFlows(
  { connectionId, windowHours }: AnalyticsParams,
  limit = 100
): Promise<RecentFlow[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.firewallFlowEvent.findMany({
    where: { connectionId, occurredAt: { gte: cutoff } },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: {
      id: true,
      occurredAt: true,
      action: true,
      protocol: true,
      service: true,
      risk: true,
      direction: true,
      srcMac: true,
      srcClientName: true,
      srcNetworkName: true,
      dstIp: true,
      dstRegion: true,
      dstClientName: true,
      inNetworkName: true,
      outNetworkName: true,
      primaryPolicyName: true,
    },
  });
  return rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
}

export async function getRecentThreats(
  { connectionId, windowHours }: AnalyticsParams,
  limit = 50
): Promise<RecentThreat[]> {
  const cutoff = since(windowHours);
  const rows = await prisma.firewallThreatEvent.findMany({
    where: { connectionId, occurredAt: { gte: cutoff } },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: {
      id: true,
      occurredAt: true,
      severity: true,
      message: true,
      srcIp: true,
      dstIp: true,
      deviceMac: true,
    },
  });
  return rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
}
