import prisma from './database';
import logger from '../utils/logger';

/**
 * Stable JSON stringify with sorted keys for consistent comparison.
 * Prevents phantom "MODIFIED" changes caused by key ordering differences
 * between JavaScript objects from the API vs objects round-tripped through PostgreSQL jsonb.
 */
function stableStringify(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((obj as any)[k])).join(',') + '}';
}

export function normalizeClientForTimeline(client: any): any {
  return {
    mac: client?.mac,
    name: client?.name || null,
    hostname: client?.hostname || null,
    network_id: client?.network_id || null,
    is_wired: !!client?.is_wired,
    oui: client?.oui || null,
  };
}

export function normalizeDeviceForTimeline(device: any): any {
  return {
    mac: device?.mac,
    name: device?.name || null,
    model: device?.model || null,
    version: device?.version || null,
    adopted: device?.adopted ?? null,
    type: device?.type || null,
  };
}

/**
 * Compare two arrays of resources and record changes in UniFiConfigChange.
 */
export async function compareResources(
  connectionId: string,
  resourceType: string,
  previous: any[],
  current: any[],
  getId: (r: any) => string,
  getName: (r: any) => string,
  detectedAt?: Date
): Promise<number> {
  let changes = 0;
  const previousMap = new Map(previous.map((r) => [getId(r), r]));
  const currentMap = new Map(current.map((r) => [getId(r), r]));

  // Check for new and modified
  for (const [id, resource] of currentMap) {
    const prev = previousMap.get(id);
    if (!prev) {
      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'CREATED',
          resourceType,
          resourceId: id,
          resourceName: getName(resource),
          newValue: resource,
          ...(detectedAt ? { detectedAt } : {}),
        },
      });
      changes++;
    } else if (stableStringify(prev) !== stableStringify(resource)) {
      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'MODIFIED',
          resourceType,
          resourceId: id,
          resourceName: getName(resource),
          previousValue: prev,
          newValue: resource,
          ...(detectedAt ? { detectedAt } : {}),
        },
      });
      changes++;
    }
  }

  // Check for deleted
  for (const [id, resource] of previousMap) {
    if (!currentMap.has(id)) {
      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'DELETED',
          resourceType,
          resourceId: id,
          resourceName: getName(resource),
          previousValue: resource,
          ...(detectedAt ? { detectedAt } : {}),
        },
      });
      changes++;
    }
  }

  return changes;
}

/**
 * One-time backfill for ACL rule timeline support.
 * If ACL rules exist in config but no ACL timeline rows exist yet, create CREATED entries
 * so existing ACLs are visible in timeline without requiring a future ACL edit.
 */
async function seedAclRuleBaselineIfMissing(
  connectionId: string,
  aclRules: any[]
): Promise<number> {
  if (!Array.isArray(aclRules) || aclRules.length === 0) return 0;

  const existingAclChanges = await prisma.uniFiConfigChange.count({
    where: {
      connectionId,
      resourceType: 'aclRule',
    },
  });

  if (existingAclChanges > 0) return 0;

  let inserted = 0;
  for (const rule of aclRules) {
    const resourceId = rule?._id || rule?.id;
    if (!resourceId) continue;

    await prisma.uniFiConfigChange.create({
      data: {
        connectionId,
        changeType: 'CREATED',
        resourceType: 'aclRule',
        resourceId,
        resourceName: rule?.name || resourceId,
        newValue: rule,
      },
    });
    inserted++;
  }

  if (inserted > 0) {
    logger.info(`Seeded ${inserted} ACL rule baseline changes for connection ${connectionId}`);
  }

  return inserted;
}

/**
 * Detect all configuration changes between previous and new configs.
 * Extended to include trafficRules, firewallPolicies, clients, and firmware.
 */
export async function detectConfigChanges(
  connectionId: string,
  previousConfig: any,
  newConfig: any,
  detectedAt?: Date
): Promise<number> {
  let changesDetected = 0;

  // Compare firewall rules
  changesDetected += await compareResources(
    connectionId,
    'firewallRule',
    previousConfig.firewallRules || [],
    newConfig.firewallRules || [],
    (r) => r._id,
    (r) => r.name,
    detectedAt
  );

  // Compare networks
  changesDetected += await compareResources(
    connectionId,
    'network',
    previousConfig.networkConf || [],
    newConfig.networkConf || [],
    (r) => r._id,
    (r) => r.name,
    detectedAt
  );

  // Compare WLANs
  changesDetected += await compareResources(
    connectionId,
    'wlan',
    previousConfig.wlanConf || [],
    newConfig.wlanConf || [],
    (r) => r._id,
    (r) => r.name,
    detectedAt
  );

  // Compare port forwards
  changesDetected += await compareResources(
    connectionId,
    'portForward',
    previousConfig.portForward || [],
    newConfig.portForward || [],
    (r) => r._id,
    (r) => r.name,
    detectedAt
  );

  // Compare traffic rules
  changesDetected += await compareResources(
    connectionId,
    'trafficRule',
    previousConfig.trafficRules || [],
    newConfig.trafficRules || [],
    (r) => r._id,
    (r) => r.name || r.description || r._id,
    detectedAt
  );

  // Compare firewall policies
  changesDetected += await compareResources(
    connectionId,
    'firewallPolicy',
    previousConfig.firewallPolicies || [],
    newConfig.firewallPolicies || [],
    (r) => r._id,
    (r) => r.name,
    detectedAt
  );

  // Compare ACL rules (Settings > Security > ACL)
  const aclChangesDetected = await compareResources(
    connectionId,
    'aclRule',
    previousConfig.aclRules || [],
    newConfig.aclRules || [],
    (r) => r._id,
    (r) => r.name || r._id,
    detectedAt
  );
  changesDetected += aclChangesDetected;

  // If ACL rules already existed before ACL tracking was introduced, seed baseline entries once.
  if (aclChangesDetected === 0) {
    changesDetected += await seedAclRuleBaselineIfMissing(connectionId, newConfig.aclRules || []);
  }

  // Compare VPN servers
  changesDetected += await compareResources(
    connectionId,
    'vpnServer',
    previousConfig.vpnServers || [],
    newConfig.vpnServers || [],
    (r) => r._id,
    (r) => r.name,
    detectedAt
  );

  // Compare clients (by MAC address)
  const previousClients = (previousConfig.clients || []).map(normalizeClientForTimeline);
  const currentClients = (newConfig.clients || []).map(normalizeClientForTimeline);
  changesDetected += await compareResources(
    connectionId,
    'client',
    previousClients,
    currentClients,
    (r) => r.mac,
    (r) => r.name || r.hostname || r.mac,
    detectedAt
  );

  // Compare devices (adopted/removed/renamed)
  const previousDevices = (previousConfig.devices || []).map(normalizeDeviceForTimeline);
  const currentDevices = (newConfig.devices || []).map(normalizeDeviceForTimeline);
  changesDetected += await compareResources(
    connectionId,
    'device',
    previousDevices,
    currentDevices,
    (r) => r.mac,
    (r) => r.name || r.model || r.mac,
    detectedAt
  );

  // Compare device firmware versions (separate resource type for clarity)
  const prevDevices = previousConfig.devices || [];
  const newDevices = newConfig.devices || [];
  for (const newDev of newDevices) {
    const prevDev = prevDevices.find((d: any) => d.mac === newDev.mac);
    if (prevDev && prevDev.version !== newDev.version) {
      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'MODIFIED',
          resourceType: 'firmware',
          resourceId: newDev.mac,
          resourceName: newDev.name || newDev.mac,
          previousValue: { version: prevDev.version, name: prevDev.name },
          newValue: { version: newDev.version, name: newDev.name },
          ...(detectedAt ? { detectedAt } : {}),
        },
      });
      changesDetected++;
    }
  }

  logger.info(`Detected ${changesDetected} config changes for connection ${connectionId}`);
  return changesDetected;
}
