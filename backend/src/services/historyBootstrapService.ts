import prisma from './database';
import type { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { objectIdToDate } from '../utils/objectId';
import type { UniFiClient, UniFiFullConfig } from './unifiClient';

type HistoryClient = Pick<UniFiClient, 'getEvents' | 'getAlarms'>;
type HistoryDatabase = Pick<Prisma.TransactionClient, 'uniFiConfigChange'>;
export type HistoricalTimelineRow = Prisma.UniFiConfigChangeCreateManyInput;

/** Read controller history and assemble rows without publishing database state. */
export async function collectHistoricalTimeline(
  connectionId: string,
  config: UniFiFullConfig,
  client: HistoryClient
): Promise<HistoricalTimelineRow[]> {
  const rows: HistoricalTimelineRow[] = [];
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
    for (const item of items || []) {
      const detectedAt = objectIdToDate(item._id);
      if (!detectedAt) continue;
      rows.push({
        connectionId, changeType: 'CREATED', resourceType,
        resourceId: item._id, resourceName: getName(item),
        newValue: item as Prisma.InputJsonValue, detectedAt,
      });
    }
  }
  for (const observed of config.clients || []) {
    const detectedAt = observed.first_seen ? new Date(observed.first_seen * 1000) : null;
    if (!observed.mac || !detectedAt || !Number.isFinite(detectedAt.getTime())) continue;
    rows.push({
      connectionId, changeType: 'CREATED', resourceType: 'client', resourceId: observed.mac,
      resourceName: observed.name || observed.hostname || observed.mac,
      newValue: { mac: observed.mac, hostname: observed.hostname, name: observed.name,
        oui: observed.oui, ip: observed.ip, is_wired: observed.is_wired,
        network_id: observed.network_id } as Prisma.InputJsonValue,
      detectedAt,
    });
  }

  // Only remote collection failures are optional; publication failures must
  // propagate so a fenced transaction can roll back every local result.
  let events: Awaited<ReturnType<HistoryClient['getEvents']>> = [];
  let alarms: Awaited<ReturnType<HistoryClient['getAlarms']>> = [];
  try { events = await client.getEvents(3000); }
  catch (error) { logger.warn('Failed to fetch events for bootstrap:', error); }
  try { alarms = await client.getAlarms(3000); }
  catch (error) { logger.warn('Failed to fetch alarms for bootstrap:', error); }

  for (const event of events) {
    if (!TIMELINE_EVENT_KEYS.has(event.key)) continue;
    const detectedAt = new Date(event.time);
    if (!Number.isFinite(detectedAt.getTime())) continue;
    rows.push({
      connectionId, changeType: 'MODIFIED', resourceType: eventToResourceType(event.key),
      resourceId: event._id, resourceName: eventToResourceName(event),
      newValue: { eventKey: event.key, message: event.msg, datetime: event.datetime,
        subsystem: event.subsystem,
        ...(event.version_from && { versionFrom: event.version_from }),
        ...(event.version_to && { versionTo: event.version_to }),
      } as Prisma.InputJsonValue,
      detectedAt,
    });
  }
  for (const alarm of alarms) {
    const detectedAt = new Date(alarm.time);
    if (!Number.isFinite(detectedAt.getTime())) continue;
    rows.push({
      connectionId, changeType: 'MODIFIED', resourceType: 'alarm',
      resourceId: alarm._id, resourceName: eventToResourceName(alarm),
      newValue: { eventKey: alarm.key, message: alarm.msg, datetime: alarm.datetime,
        subsystem: alarm.subsystem, archived: alarm.archived } as Prisma.InputJsonValue,
      detectedAt,
    });
  }
  return rows;
}

/** Publish the already-collected baseline through the caller's transaction. */
export async function persistHistoricalTimeline(
  connectionId: string,
  rows: HistoricalTimelineRow[],
  db: HistoryDatabase = prisma
): Promise<number> {
  if (!rows.length || await db.uniFiConfigChange.count({ where: { connectionId } })) return 0;
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += 500) {
    const batch = await db.uniFiConfigChange.createMany({ data: rows.slice(offset, offset + 500) });
    inserted += batch.count;
  }
  return inserted;
}

/** Compatibility wrapper for callers that do not manage a publication lease. */
export async function bootstrapHistoricalTimeline(
  connectionId: string,
  config: UniFiFullConfig,
  client: HistoryClient
): Promise<number> {
  if (await prisma.uniFiConfigChange.count({ where: { connectionId } })) return 0;
  const rows = await collectHistoricalTimeline(connectionId, config, client);
  return persistHistoricalTimeline(connectionId, rows);
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
