/**
 * Bridges `@uguard/unifi-client` typed responses → Prisma rows for
 * FirewallFlowEvent / FirewallThreatEvent. Lives in the backend (not the lib)
 * because it owns ZeroProof-specific concerns: Prisma persistence,
 * high-water-mark cursor management, retention windowing.
 */
import type { UniFiConnection } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  UnifiClient as LibUnifiClient,
  type FlowEvent,
  type ThreatAlert,
} from '@uguard/unifi-client';
import prisma from '../database';
import { decrypt } from '../../utils/encryption';
import { resolveControllerHost } from '../unifiClient';
import logger from '../../utils/logger';

export interface SyncResult {
  flowsInserted: number;
  flowsSkipped: number;
  threatsInserted: number;
  threatsSkipped: number;
  flowsHighWater: Date | null;
  threatsHighWater: Date | null;
}

/**
 * Pulls flow + threat events from the controller for the given connection,
 * upserts them into the per-type tables, and advances the high-water-mark
 * cursors. Idempotent — re-running with the same data is a no-op via
 * the unique constraint on `unifiId`.
 */
export async function syncFirewallTelemetry(
  connectionId: string
): Promise<SyncResult> {
  const conn = await prisma.uniFiConnection.findUnique({ where: { id: connectionId } });
  if (!conn) throw new Error(`UniFi connection ${connectionId} not found`);
  if (!conn.isActive) throw new Error(`UniFi connection ${connectionId} is not active`);

  const lib = buildLibClient(conn);
  await lib.login();

  try {
    const flowsResult = await pullFlows(lib, conn);
    const threatsResult = await pullThreats(lib, conn);

    return { ...flowsResult, ...threatsResult };
  } finally {
    await lib.logout().catch(() => {});
  }
}

function buildLibClient(conn: UniFiConnection): LibUnifiClient {
  return new LibUnifiClient({
    host: resolveControllerHost(conn.host),
    port: conn.port,
    username: decrypt(conn.usernameEnc),
    password: decrypt(conn.passwordEnc),
    siteId: conn.siteId,
    allowSelfSigned: true,
    timeoutMs: 30_000,
    logger: {
      debug: (msg, meta) => logger.debug(msg, meta as object),
      info: (msg, meta) => logger.info(msg, meta as object),
      warn: (msg, meta) => logger.warn(msg, meta as object),
      error: (msg, meta) => logger.error(msg, meta as object),
    },
  });
}

interface FlowSyncOutput {
  flowsInserted: number;
  flowsSkipped: number;
  flowsHighWater: Date | null;
}

async function pullFlows(lib: LibUnifiClient, conn: UniFiConnection): Promise<FlowSyncOutput> {
  const since =
    conn.flowsHighWater ??
    new Date(Date.now() - conn.flowRetentionDays * 24 * 60 * 60 * 1000);
  const beginTime = since.getTime();
  const endTime = Date.now();

  let inserted = 0;
  let skipped = 0;
  let maxOccurredAt: Date | null = conn.flowsHighWater;

  // Buffer rows and batch-insert with skipDuplicates so the Prisma logger
  // doesn't fire per-row error events on duplicates. UniFi exposes a
  // ~5000-row sliding window; 500-row batches keep memory bounded.
  const BATCH_SIZE = 500;
  let buffer: Prisma.FirewallFlowEventUncheckedCreateInput[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const result = await prisma.firewallFlowEvent.createMany({
      data: buffer,
      skipDuplicates: true,
    });
    inserted += result.count;
    skipped += buffer.length - result.count;
    buffer = [];
  };

  for await (const flow of lib.flows.iterate({ beginTime, endTime, limit: 200 })) {
    const occurredAt = new Date(flow.time ?? flow.flow_start_time ?? endTime);
    if (!maxOccurredAt || occurredAt > maxOccurredAt) maxOccurredAt = occurredAt;
    buffer.push(mapFlowToRow(flow, occurredAt, conn.id));
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  if (maxOccurredAt && (!conn.flowsHighWater || maxOccurredAt > conn.flowsHighWater)) {
    await prisma.uniFiConnection.update({
      where: { id: conn.id },
      data: { flowsHighWater: maxOccurredAt },
    });
  }

  logger.info(
    `Flows: +${inserted} new, ${skipped} dup, watermark=${maxOccurredAt?.toISOString() ?? 'unchanged'}`
  );

  return { flowsInserted: inserted, flowsSkipped: skipped, flowsHighWater: maxOccurredAt };
}

interface ThreatSyncOutput {
  threatsInserted: number;
  threatsSkipped: number;
  threatsHighWater: Date | null;
}

async function pullThreats(lib: LibUnifiClient, conn: UniFiConnection): Promise<ThreatSyncOutput> {
  const since =
    conn.threatsHighWater ??
    new Date(Date.now() - conn.flowRetentionDays * 24 * 60 * 60 * 1000);
  const beginTime = since.getTime();
  const endTime = Date.now();

  let inserted = 0;
  let skipped = 0;
  let maxOccurredAt: Date | null = conn.threatsHighWater;

  const BATCH_SIZE = 500;
  let buffer: Prisma.FirewallThreatEventUncheckedCreateInput[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const result = await prisma.firewallThreatEvent.createMany({
      data: buffer,
      skipDuplicates: true,
    });
    inserted += result.count;
    skipped += buffer.length - result.count;
    buffer = [];
  };

  for await (const threat of lib.threats.iterate({ beginTime, endTime, limit: 200 })) {
    const occurredAt = new Date(threat.timestamp ?? endTime);
    if (!maxOccurredAt || occurredAt > maxOccurredAt) maxOccurredAt = occurredAt;
    buffer.push(mapThreatToRow(threat, occurredAt, conn.id));
    if (buffer.length >= BATCH_SIZE) await flush();
  }
  await flush();

  if (maxOccurredAt && (!conn.threatsHighWater || maxOccurredAt > conn.threatsHighWater)) {
    await prisma.uniFiConnection.update({
      where: { id: conn.id },
      data: { threatsHighWater: maxOccurredAt },
    });
  }

  logger.info(
    `Threats: +${inserted} new, ${skipped} dup, watermark=${maxOccurredAt?.toISOString() ?? 'unchanged'}`
  );

  return { threatsInserted: inserted, threatsSkipped: skipped, threatsHighWater: maxOccurredAt };
}

function mapFlowToRow(
  flow: FlowEvent,
  occurredAt: Date,
  connectionId: string
): Prisma.FirewallFlowEventUncheckedCreateInput {
  const primaryPolicy = flow.policies?.[0];
  return {
    unifiId: flow.id,
    occurredAt,
    flowStartAt: flow.flow_start_time ? new Date(flow.flow_start_time) : null,
    flowEndAt: flow.flow_end_time ? new Date(flow.flow_end_time) : null,
    durationMs: flow.duration_milliseconds ?? null,
    action: flow.action,
    count: flow.count ?? 1,
    protocol: flow.protocol ?? null,
    service: flow.service ?? null,
    risk: flow.risk ?? null,
    direction: flow.direction ?? null,
    bytesTotal: flow.traffic_data?.bytes_total ? BigInt(flow.traffic_data.bytes_total) : null,
    packetsTotal: flow.traffic_data?.packets_total ?? null,

    srcMac: flow.source?.mac ?? null,
    srcIp: flow.source?.ip ?? null,
    srcPort: flow.source?.port ?? null,
    srcClientName: flow.source?.client_name ?? null,
    srcHostName: flow.source?.host_name ?? null,
    srcOui: flow.source?.client_oui ?? null,
    srcNetworkId: flow.source?.network_id ?? null,
    srcNetworkName: flow.source?.network_name ?? null,
    srcZoneName: flow.source?.zone_name ?? null,
    srcSubnet: flow.source?.subnet ?? null,

    dstMac: flow.destination?.mac ?? null,
    dstIp: flow.destination?.ip ?? null,
    dstPort: flow.destination?.port ?? null,
    dstClientName: flow.destination?.client_name ?? null,
    dstHostName: flow.destination?.host_name ?? null,
    dstNetworkId: flow.destination?.network_id ?? null,
    dstNetworkName: flow.destination?.network_name ?? null,
    dstZoneName: flow.destination?.zone_name ?? null,
    dstRegion: flow.destination?.region ?? null,
    dstDomains:
      flow.destination?.domains && flow.destination.domains.length > 0
        ? (flow.destination.domains as Prisma.InputJsonValue)
        : Prisma.JsonNull,

    inNetworkId: flow.in?.network_id ?? null,
    inNetworkName: flow.in?.network_name ?? null,
    outNetworkId: flow.out?.network_id ?? null,
    outNetworkName: flow.out?.network_name ?? null,

    policies: (flow.policies ?? []) as Prisma.InputJsonValue,
    primaryPolicyName: primaryPolicy?.name ?? null,

    connectionId,
  };
}

function mapThreatToRow(
  threat: ThreatAlert,
  occurredAt: Date,
  connectionId: string
): Prisma.FirewallThreatEventUncheckedCreateInput {
  const params = threat.parameters;
  const device = params?.DEVICE;
  return {
    unifiId: threat.id,
    occurredAt,
    category: threat.category ?? null,
    subcategory: threat.subcategory ?? null,
    event: threat.event ?? null,
    key: threat.key ?? null,
    severity: threat.severity ?? null,
    status: threat.status ?? null,
    message: threat.message ?? null,
    type: threat.type ?? null,
    srcIp: params?.SRC_IP?.id ?? null,
    dstIp: params?.DST_IP?.id ?? null,
    deviceMac: device?.id ?? null,
    deviceModel: device?.model ?? null,
    rawJson: threat as unknown as Prisma.InputJsonValue,
    connectionId,
  };
}

/**
 * Deletes flow + threat rows older than the per-connection retention window.
 * Returns counts deleted per type. Mirrors the DNS proxy retention pattern.
 */
export async function cleanupExpiredFirewallTelemetry(): Promise<{
  flowsDeleted: number;
  threatsDeleted: number;
}> {
  const connections = await prisma.uniFiConnection.findMany({
    where: { isActive: true },
    select: { id: true, flowRetentionDays: true },
  });

  let flowsDeleted = 0;
  let threatsDeleted = 0;

  for (const conn of connections) {
    const cutoff = new Date(Date.now() - conn.flowRetentionDays * 24 * 60 * 60 * 1000);
    const flows = await prisma.firewallFlowEvent.deleteMany({
      where: { connectionId: conn.id, occurredAt: { lt: cutoff } },
    });
    const threats = await prisma.firewallThreatEvent.deleteMany({
      where: { connectionId: conn.id, occurredAt: { lt: cutoff } },
    });
    flowsDeleted += flows.count;
    threatsDeleted += threats.count;
  }

  if (flowsDeleted > 0 || threatsDeleted > 0) {
    logger.info(
      `Firewall retention sweep: pruned ${flowsDeleted} flow rows, ${threatsDeleted} threat rows`
    );
  }
  return { flowsDeleted, threatsDeleted };
}
