import prisma from './database';
import logger from '../utils/logger';
import { objectIdToDate } from '../utils/objectId';
import { UniFiClient, UniFiFullConfig } from './unifiClient';

/**
 * Bootstrap historical timeline entries from UniFi data on first sync.
 *
 * Uses three sources:
 * 1. MongoDB ObjectId creation dates on all config objects (networks, WLANs,
 *    firewall rules, devices, traffic rules, etc.)
 * 2. Device timestamp fields (connected_at, provisioned_at, etc.)
 * 3. UniFi event log (/stat/event) for firmware upgrades, WAN transitions, etc.
 * 4. UniFi alarm log (/stat/alarm) for AP disconnections, security events
 */
export async function bootstrapHistoricalTimeline(
  connectionId: string,
  config: UniFiFullConfig,
  client: UniFiClient
): Promise<number> {
  // Only bootstrap if this connection has no config changes yet
  const existingChanges = await prisma.uniFiConfigChange.count({
    where: { connectionId },
  });

  if (existingChanges > 0) {
    logger.debug('Skipping history bootstrap — timeline already has entries');
    return 0;
  }

  logger.info('Bootstrapping historical timeline from UniFi data...');
  let totalEntries = 0;

  // 1. Config object creation dates from ObjectIds
  totalEntries += await bootstrapConfigObjects(connectionId, config);

  // 2. Events and alarms from the API
  totalEntries += await bootstrapEvents(connectionId, client);
  totalEntries += await bootstrapAlarms(connectionId, client);

  logger.info(`Bootstrap complete: ${totalEntries} historical timeline entries created`);
  return totalEntries;
}

/**
 * Create CREATED entries for all config objects using their ObjectId creation dates.
 */
async function bootstrapConfigObjects(
  connectionId: string,
  config: UniFiFullConfig
): Promise<number> {
  let count = 0;

  const entries: {
    resourceType: string;
    items: { _id: string; name?: string; [key: string]: any }[];
    getName: (item: any) => string;
  }[] = [
    {
      resourceType: 'network',
      items: config.networks,
      getName: (n) => n.name,
    },
    {
      resourceType: 'wlan',
      items: config.wlans,
      getName: (w) => w.name,
    },
    {
      resourceType: 'firewallRule',
      items: config.firewallRules,
      getName: (r) => r.name,
    },
    {
      resourceType: 'firewallPolicy',
      items: config.firewallPolicies,
      getName: (p) => p.name,
    },
    {
      resourceType: 'aclRule',
      items: config.aclRules,
      getName: (a) => a.name || a._id,
    },
    {
      resourceType: 'trafficRule',
      items: config.trafficRules,
      getName: (t) => t.name || t.description || t._id,
    },
    {
      resourceType: 'portForward',
      items: config.portForwards,
      getName: (p) => p.name,
    },
    {
      resourceType: 'vpnServer',
      items: config.vpnServers,
      getName: (v) => v.name,
    },
    {
      resourceType: 'device',
      items: config.devices,
      getName: (d) => d.name || d.model || d.mac,
    },
  ];

  for (const { resourceType, items, getName } of entries) {
    for (const item of items) {
      const createdAt = objectIdToDate(item._id);
      if (!createdAt) continue;

      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'CREATED',
          resourceType,
          resourceId: item._id,
          resourceName: getName(item),
          newValue: item,
          detectedAt: createdAt,
        },
      });
      count++;
    }
  }

  // Bootstrap client first-seen dates from UniFi client data
  const clients = config.clients || [];
  for (const client of clients) {
    if (!client.mac) continue;
    // Use first_seen (unix seconds) if available, otherwise skip
    const firstSeen = client.first_seen ? new Date(client.first_seen * 1000) : null;
    if (!firstSeen || isNaN(firstSeen.getTime())) continue;

    await prisma.uniFiConfigChange.create({
      data: {
        connectionId,
        changeType: 'CREATED',
        resourceType: 'client',
        resourceId: client.mac,
        resourceName: client.name || client.hostname || client.mac,
        newValue: {
          mac: client.mac,
          hostname: client.hostname,
          name: client.name,
          oui: client.oui,
          ip: client.ip,
          is_wired: client.is_wired,
          network_id: client.network_id,
        },
        detectedAt: firstSeen,
      },
    });
    count++;
  }

  logger.info(`Bootstrapped ${count} config object and client creation dates`);
  return count;
}

// Event types we care about for the timeline
const TIMELINE_EVENT_KEYS = new Set([
  // Firmware upgrades
  'EVT_AP_Upgraded',
  'EVT_SW_Upgraded',
  'EVT_GW_Upgraded',
  // Device connectivity
  'EVT_AP_Connected',
  'EVT_AP_Lost_Contact',
  'EVT_AP_Adopted',
  'EVT_SW_Connected',
  'EVT_SW_Lost_Contact',
  'EVT_SW_Adopted',
  'EVT_AP_Restarted',
  'EVT_AP_RestartedUnknown',
  'EVT_SW_RestartedUnknown',
  // WAN
  'EVT_GW_WANTransition',
  // Security
  'EVT_AP_DetectRogueAP',
  'EVT_AP_Isolated',
  'EVT_AP_RadarDetected',
  'EVT_AP_PossibleInterference',
  // Hotspot auth
  'EVT_HS_AuthedByPassword',
  // Admin
  'EVT_AD_Login',
]);

function eventToResourceType(key: string): string {
  if (key.includes('Upgraded')) return 'firmware';
  if (key.includes('WANTransition')) return 'network';
  if (key.includes('RogueAP') || key.includes('Isolated') || key.includes('Radar')) return 'securityEvent';
  if (key.includes('AD_Login')) return 'adminEvent';
  return 'device';
}

function eventToResourceName(event: any): string {
  if (event.ap_name) return event.ap_name;
  if (event.sw_name) return event.sw_name;
  if (event.gw_name) return event.gw_name;
  if (event.ap) return `AP ${event.ap}`;
  if (event.sw) return `Switch ${event.sw}`;
  return event.key;
}

/**
 * Pull events from UniFi and create timeline entries for significant ones.
 */
async function bootstrapEvents(
  connectionId: string,
  client: UniFiClient
): Promise<number> {
  let count = 0;

  try {
    const events = await client.getEvents(3000);
    logger.info(`Fetched ${events.length} events from UniFi for bootstrap`);

    for (const event of events) {
      if (!TIMELINE_EVENT_KEYS.has(event.key)) continue;

      const detectedAt = new Date(event.time);
      // Sanity: skip events with bad timestamps
      if (isNaN(detectedAt.getTime())) continue;

      const resourceType = eventToResourceType(event.key);

      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'MODIFIED', // Events represent state changes, not creation
          resourceType,
          resourceId: event._id,
          resourceName: eventToResourceName(event),
          newValue: {
            eventKey: event.key,
            message: event.msg,
            datetime: event.datetime,
            subsystem: event.subsystem,
            ...(event.version_from && { versionFrom: event.version_from }),
            ...(event.version_to && { versionTo: event.version_to }),
          },
          detectedAt,
        },
      });
      count++;
    }
  } catch (error: any) {
    logger.warn(`Failed to fetch events for bootstrap: ${error.message}`);
  }

  logger.info(`Bootstrapped ${count} events from UniFi event log`);
  return count;
}

/**
 * Pull alarms from UniFi and create timeline entries.
 */
async function bootstrapAlarms(
  connectionId: string,
  client: UniFiClient
): Promise<number> {
  let count = 0;

  try {
    const alarms = await client.getAlarms(3000);
    logger.info(`Fetched ${alarms.length} alarms from UniFi for bootstrap`);

    for (const alarm of alarms) {
      const detectedAt = new Date(alarm.time);
      if (isNaN(detectedAt.getTime())) continue;

      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'MODIFIED',
          resourceType: 'alarm',
          resourceId: alarm._id,
          resourceName: eventToResourceName(alarm),
          newValue: {
            eventKey: alarm.key,
            message: alarm.msg,
            datetime: alarm.datetime,
            subsystem: alarm.subsystem,
            archived: alarm.archived,
          },
          detectedAt,
        },
      });
      count++;
    }
  } catch (error: any) {
    logger.warn(`Failed to fetch alarms for bootstrap: ${error.message}`);
  }

  logger.info(`Bootstrapped ${count} alarms from UniFi alarm log`);
  return count;
}
