import prisma from './database';
import logger from '../utils/logger';

type TimelineFilter = 'all' | 'security' | 'config' | 'devices' | 'clients' | 'firmware';
type TimelineGroupBy = 'day' | 'week' | 'month';

const SECURITY_TYPES = ['firewallRule', 'firewallPolicy', 'aclRule', 'trafficRule', 'portForward', 'securityEvent', 'alarm', 'vpnServer'];
const CONFIG_TYPES = ['network', 'wlan', 'settings'];
const DEVICE_TYPES = ['device'];
const CLIENT_TYPES = ['client'];
const FIRMWARE_TYPES = ['firmware'];
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getResourceTypesForFilter(filter: TimelineFilter): string[] | null {
  switch (filter) {
    case 'security': return SECURITY_TYPES;
    case 'config': return CONFIG_TYPES;
    case 'devices': return DEVICE_TYPES;
    case 'clients': return CLIENT_TYPES;
    case 'firmware': return FIRMWARE_TYPES;
    default: return null; // all
  }
}

function normalizeTimeZone(timeZone?: string): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(date);

  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value);
  const weekday = parts.find(p => p.type === 'weekday')?.value || 'Mon';

  return { year, month, day, weekday };
}

function formatUtcYmd(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getGroupKey(date: Date, groupBy: TimelineGroupBy, timeZone: string): string {
  const { year, month, day, weekday } = getDatePartsInTimeZone(date, timeZone);
  const dayKey = `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  switch (groupBy) {
    case 'day':
      return dayKey;
    case 'week': {
      const weekdayIndex = WEEKDAY_TO_INDEX[weekday] ?? 1;
      const daysSinceMonday = (weekdayIndex + 6) % 7;
      const monday = new Date(Date.UTC(year, month - 1, day));
      monday.setUTCDate(monday.getUTCDate() - daysSinceMonday);
      return formatUtcYmd(monday);
    }
    case 'month':
      return `${String(year)}-${String(month).padStart(2, '0')}-01`;
  }
}

function getGroupLabel(period: string, groupBy: TimelineGroupBy): string {
  const date = new Date(period + 'T00:00:00Z');
  switch (groupBy) {
    case 'day':
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    case 'week':
      {
        const weekEnd = new Date(date);
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        const start = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        const end = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
        return `Week of ${start} - ${end}`;
      }
    case 'month':
      return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
}

interface GetTimelineEventsParams {
  from?: Date;
  to?: Date;
  groupBy?: TimelineGroupBy;
  filter?: TimelineFilter;
  page?: number;
  limit?: number;
  timezone?: string;
}

export async function getTimelineEvents(params: GetTimelineEventsParams = {}) {
  const groupBy = params.groupBy || 'day';
  const filter = params.filter || 'all';
  const page = params.page || 1;
  const limit = params.limit || 20;
  const timeZone = normalizeTimeZone(params.timezone);

  const where: any = {};

  if (params.from || params.to) {
    where.detectedAt = {};
    if (params.from) where.detectedAt.gte = params.from;
    if (params.to) where.detectedAt.lte = params.to;
  }

  const resourceTypes = getResourceTypesForFilter(filter);
  if (resourceTypes) {
    where.resourceType = { in: resourceTypes };
  }

  // Fetch all matching events (we group in JS for flexibility)
  const events = await prisma.uniFiConfigChange.findMany({
    where,
    orderBy: { detectedAt: 'desc' },
  });

  // Group events by period
  const groupMap = new Map<string, any[]>();
  for (const event of events) {
    const key = getGroupKey(event.detectedAt, groupBy, timeZone);
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
    }
    groupMap.get(key)!.push(event);
  }

  // Convert to sorted array of groups
  const allGroups = Array.from(groupMap.entries())
    .sort(([a], [b]) => b.localeCompare(a)) // Newest first
    .map(([period, groupEvents]) => {
      const summary = {
        total: groupEvents.length,
        newClients: groupEvents.filter(e => e.resourceType === 'client' && e.changeType === 'CREATED').length,
        removedClients: groupEvents.filter(e => e.resourceType === 'client' && e.changeType === 'DELETED').length,
        deviceChanges: groupEvents.filter(e => DEVICE_TYPES.includes(e.resourceType)).length,
        configChanges: groupEvents.filter(e => CONFIG_TYPES.includes(e.resourceType)).length,
        securityChanges: groupEvents.filter(e => SECURITY_TYPES.includes(e.resourceType)).length,
        firmwareUpdates: groupEvents.filter(e => e.resourceType === 'firmware').length,
      };

      return {
        period,
        label: getGroupLabel(period, groupBy),
        summary,
        events: groupEvents.map(e => ({
          id: e.id,
          changeType: e.changeType,
          resourceType: e.resourceType,
          resourceId: e.resourceId,
          resourceName: e.resourceName,
          detectedAt: e.detectedAt.toISOString(),
        })),
      };
    });

  // Paginate groups
  const skip = (page - 1) * limit;
  const paginatedGroups = allGroups.slice(skip, skip + limit);
  const total = allGroups.length;

  return {
    groups: paginatedGroups,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getTimelineEventDetail(changeId: string) {
  return prisma.uniFiConfigChange.findUnique({
    where: { id: changeId },
  });
}

export async function getClientDetail(mac: string) {
  const client = await prisma.networkClient.findUnique({
    where: { mac },
  });

  if (!client) return null;

  // Enrich with context from active config
  let network: any = null;
  let applicableFirewallRules: any[] = [];
  let wifiNetwork: any = null;

  try {
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
      select: { configJson: true },
    });

    if (activeConfig) {
      const config = activeConfig.configJson as any;
      const networkList = config.networks || config.networkConf || [];
      const wlanList = config.wlans || config.wlanConf || [];

      // Find client's network
      if (client.lastNetworkId) {
        const net = networkList.find((n: any) => n._id === client.lastNetworkId);
        if (net) {
          network = {
            name: net.name,
            vlan: net.vlan_enabled ? net.vlan : undefined,
            subnet: net.ip_subnet,
            isGuest: net.purpose === 'guest',
          };
        }
      }

      // Find applicable firewall rules — check both legacy and zone-based policies
      const fwRules = config.firewallRules || [];
      const fwPolicies = config.firewallPolicies || [];
      if (client.lastNetworkId && (fwRules.length > 0 || fwPolicies.length > 0)) {
        applicableFirewallRules = [...fwRules, ...fwPolicies]
          .filter((r: any) => {
            const srcGroups = r.src_firewallgroup_ids || [];
            const dstGroups = r.dst_firewallgroup_ids || [];
            return srcGroups.length > 0 || dstGroups.length > 0 || r.source_zone || r.destination_zone;
          })
          .slice(0, 10)
          .map((r: any) => ({
            name: r.name || r.description || 'Unnamed',
            action: r.action,
            direction: r.ruleset || r.source_zone || 'unknown',
          }));
      }

      // Find WiFi network
      if (wlanList.length > 0 && !client.isWired && client.lastNetworkId) {
        const matchedNetwork = networkList.find((n: any) => n._id === client.lastNetworkId);
        const networkVlan = matchedNetwork?.vlan_enabled ? matchedNetwork.vlan : null;
        const wlan = wlanList.find((w: any) => {
          if (w.networkconf_id === client.lastNetworkId) return true;
          return networkVlan !== null && w.vlan_enabled && w.vlan === networkVlan;
        });
        if (wlan) {
          wifiNetwork = {
            ssid: wlan.name,
            security: wlan.security,
          };
        }
      }
    }
  } catch (err) {
    logger.debug('Error enriching client detail:', err);
  }

  return {
    mac: client.mac,
    hostname: client.hostname,
    displayName: client.displayName,
    oui: client.oui,
    lastIp: client.lastIp,
    lastNetworkName: client.lastNetworkName,
    isWired: client.isWired,
    unifiFirstSeen: client.unifiFirstSeen?.toISOString(),
    unifiLastSeen: client.unifiLastSeen?.toISOString(),
    network,
    applicableFirewallRules,
    wifiNetwork,
  };
}

/**
 * Get event counts for the histogram chart.
 * When days=0, returns all-time data; otherwise returns the last `days` days.
 * Auto-buckets by month when the range exceeds 365 days.
 */
export async function getTimelineHistogram(days: number = 90, timezone?: string) {
  const timeZone = normalizeTimeZone(timezone);
  const now = new Date();

  let since: Date;
  if (days === 0) {
    // All-time: find the earliest event
    const firstEvent = await prisma.uniFiConfigChange.findFirst({
      orderBy: { detectedAt: 'asc' },
      select: { detectedAt: true },
    });
    since = firstEvent?.detectedAt || now;
  } else {
    since = new Date();
    since.setDate(since.getDate() - days);
  }

  const events = await prisma.uniFiConfigChange.findMany({
    where: { detectedAt: { gte: since } },
    select: { detectedAt: true, resourceType: true },
    orderBy: { detectedAt: 'asc' },
  });

  // Auto-bucket by month for wide ranges (>365 days)
  const rangeDays = Math.ceil((now.getTime() - since.getTime()) / (1000 * 60 * 60 * 24));
  const groupBy: TimelineGroupBy = rangeDays > 365 ? 'month' : 'day';

  // Build a map of period -> category counts
  const buckets = new Map<string, { security: number; config: number; clients: number; devices: number; firmware: number }>();

  // Pre-fill all periods so the chart has no gaps.
  // Use getGroupKey on actual UTC dates to ensure timezone-consistent bucket keys.
  if (groupBy === 'month') {
    // Step through months using UTC midday to avoid DST edge cases
    const startParts = getDatePartsInTimeZone(since, timeZone);
    const endParts = getDatePartsInTimeZone(now, timeZone);
    let y = startParts.year, m = startParts.month;
    while (y < endParts.year || (y === endParts.year && m <= endParts.month)) {
      const key = `${String(y)}-${String(m).padStart(2, '0')}-01`;
      buckets.set(key, { security: 0, config: 0, clients: 0, devices: 0, firmware: 0 });
      m++;
      if (m > 12) { m = 1; y++; }
    }
  } else {
    for (let d = new Date(since); d <= now; d.setDate(d.getDate() + 1)) {
      const key = getGroupKey(d, 'day', timeZone);
      buckets.set(key, { security: 0, config: 0, clients: 0, devices: 0, firmware: 0 });
    }
  }

  for (const event of events) {
    const key = getGroupKey(event.detectedAt, groupBy, timeZone);
    // Auto-create bucket if pre-fill missed it (timezone edge cases)
    if (!buckets.has(key)) {
      buckets.set(key, { security: 0, config: 0, clients: 0, devices: 0, firmware: 0 });
    }
    const bucket = buckets.get(key)!;

    if (SECURITY_TYPES.includes(event.resourceType)) bucket.security++;
    else if (CONFIG_TYPES.includes(event.resourceType)) bucket.config++;
    else if (CLIENT_TYPES.includes(event.resourceType)) bucket.clients++;
    else if (DEVICE_TYPES.includes(event.resourceType)) bucket.devices++;
    else if (FIRMWARE_TYPES.includes(event.resourceType)) bucket.firmware++;
  }

  return Array.from(buckets.entries()).map(([date, counts]) => ({
    date,
    ...counts,
    total: counts.security + counts.config + counts.clients + counts.devices + counts.firmware,
  }));
}

export async function getTimelineStats() {
  const [totalSyncs, totalChanges, totalClients, firstSync, latestSync, firstEvent, changesByType] = await Promise.all([
    prisma.uniFiSyncHistory.count(),
    prisma.uniFiConfigChange.count(),
    prisma.networkClient.count(),
    prisma.uniFiSyncHistory.findFirst({ orderBy: { startedAt: 'asc' }, select: { startedAt: true } }),
    prisma.uniFiSyncHistory.findFirst({ orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    prisma.uniFiConfigChange.findFirst({ orderBy: { detectedAt: 'asc' }, select: { detectedAt: true } }),
    prisma.uniFiConfigChange.groupBy({
      by: ['resourceType'],
      _count: true,
    }),
  ]);

  const changesByTypeMap: Record<string, number> = {};
  for (const entry of changesByType) {
    changesByTypeMap[entry.resourceType] = entry._count;
  }

  return {
    totalSyncs,
    totalChanges,
    totalClients,
    firstSyncDate: firstSync?.startedAt?.toISOString() || null,
    latestSyncDate: latestSync?.startedAt?.toISOString() || null,
    firstEventDate: firstEvent?.detectedAt?.toISOString() || null,
    changesByType: changesByTypeMap,
  };
}

interface GetClientsByNetworkParams {
  search?: string;
}

export async function getClientsByNetwork(params: GetClientsByNetworkParams = {}) {
  // Build search filter (reuse the same OR pattern from getClients)
  const where: any = {};
  if (params.search) {
    where.OR = [
      { hostname: { contains: params.search, mode: 'insensitive' } },
      { displayName: { contains: params.search, mode: 'insensitive' } },
      { mac: { contains: params.search, mode: 'insensitive' } },
      { lastNetworkName: { contains: params.search, mode: 'insensitive' } },
      { oui: { contains: params.search, mode: 'insensitive' } },
      { lastIp: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  // Fetch all matching clients
  const clients = await prisma.networkClient.findMany({
    where,
    orderBy: [{ displayName: 'asc' }, { hostname: 'asc' }, { mac: 'asc' }],
  });

  // Fetch active config for network metadata + wlan info
  const activeConfig = await prisma.configuration.findFirst({
    where: { isActive: true },
    select: { configJson: true },
  });

  // Fetch intent profile for trust level mappings
  const intentSetting = await prisma.setting.findUnique({
    where: { key: 'network_intent_profile' },
  });

  const config = activeConfig?.configJson as any;
  const networkConf: any[] = config?.networks || config?.networkConf || [];
  const wlanConf: any[] = config?.wlans || config?.wlanConf || [];
  const rawClients: any[] = config?.clients || [];
  const intentProfile = intentSetting?.value as any;
  const networkMappings = intentProfile?.networkMappings || {};
  const hasIntentProfile = !!intentProfile;

  // Build MAC -> enriched info from raw config clients
  const deviceInfoMap = new Map<string, { deviceName?: string; uplinkName?: string }>();
  for (const rc of rawClients) {
    if (rc.mac) {
      deviceInfoMap.set(rc.mac.toLowerCase(), {
        deviceName: rc.device_name || undefined,
        uplinkName: rc.last_uplink_name || undefined,
      });
    }
  }

  // Build reverse mapping: networkId -> { trustLevel, intentPurpose }
  const trustMap = new Map<string, { trustLevel: 'trusted' | 'untrusted' | 'unknown'; intentPurpose: string }>();
  if (networkMappings.iotNetworkId) {
    trustMap.set(networkMappings.iotNetworkId, { trustLevel: 'untrusted', intentPurpose: 'IoT' });
  }
  if (networkMappings.guestNetworkId) {
    trustMap.set(networkMappings.guestNetworkId, { trustLevel: 'untrusted', intentPurpose: 'Guest' });
  }
  if (networkMappings.workNetworkId) {
    trustMap.set(networkMappings.workNetworkId, { trustLevel: 'trusted', intentPurpose: 'Work' });
  }
  if (networkMappings.trustedNetworkId) {
    trustMap.set(networkMappings.trustedNetworkId, { trustLevel: 'trusted', intentPurpose: 'Home' });
  }
  if (networkMappings.nasNetworkId) {
    trustMap.set(networkMappings.nasNetworkId, { trustLevel: 'trusted', intentPurpose: 'NAS' });
  }
  if (networkMappings.serverNetworkId) {
    trustMap.set(networkMappings.serverNetworkId, { trustLevel: 'trusted', intentPurpose: 'Server' });
  }

  // Group clients by lastNetworkId
  const clientsByNetwork = new Map<string, any[]>();
  const unassignedClients: any[] = [];

  for (const client of clients) {
    if (client.lastNetworkId) {
      if (!clientsByNetwork.has(client.lastNetworkId)) {
        clientsByNetwork.set(client.lastNetworkId, []);
      }
      clientsByNetwork.get(client.lastNetworkId)!.push(client);
    } else {
      unassignedClients.push(client);
    }
  }

  // Build network groups
  const networks: any[] = [];

  for (const net of networkConf) {
    // Skip WAN networks — no clients connect to these
    if (net.purpose === 'wan') {
      clientsByNetwork.delete(net._id);
      continue;
    }

    const netClients = clientsByNetwork.get(net._id) || [];
    clientsByNetwork.delete(net._id); // Mark as processed

    // Determine trust level
    let trustLevel: 'trusted' | 'untrusted' | 'unknown' = 'unknown';
    let intentPurpose: string | null = null;

    const mapping = trustMap.get(net._id);
    if (mapping) {
      trustLevel = mapping.trustLevel;
      intentPurpose = mapping.intentPurpose;
    } else if (!hasIntentProfile) {
      // Fallback when no intent profile
      if (net.purpose === 'guest') trustLevel = 'untrusted';
      else if (net.purpose === 'corporate') trustLevel = 'trusted';
    }

    // Find SSIDs associated with this network
    const ssids: string[] = [];
    for (const wlan of wlanConf) {
      if (wlan.networkconf_id === net._id) {
        ssids.push(wlan.name);
      }
    }

    networks.push({
      networkId: net._id,
      name: net.name,
      vlan: net.vlan_enabled ? net.vlan : null,
      subnet: net.ip_subnet || null,
      purpose: net.purpose || null,
      trustLevel,
      intentPurpose,
      ssids,
      clientCount: netClients.length,
      clients: netClients.map(c => formatClient(c, deviceInfoMap)),
    });
  }

  // Clients matched to network IDs not in networkConf (orphaned)
  for (const [, netClients] of clientsByNetwork) {
    unassignedClients.push(...netClients);
  }

  // Add unassigned group if there are any
  if (unassignedClients.length > 0) {
    networks.push({
      networkId: null,
      name: 'Unassigned',
      vlan: null,
      subnet: null,
      purpose: null,
      trustLevel: 'unknown' as const,
      intentPurpose: null,
      ssids: [],
      clientCount: unassignedClients.length,
      clients: unassignedClients.map(c => formatClient(c, deviceInfoMap)),
    });
  }

  return {
    networks,
    totalClients: clients.length,
    hasIntentProfile,
  };
}

function formatClient(client: any, deviceInfoMap: Map<string, { deviceName?: string; uplinkName?: string }>) {
  const info = deviceInfoMap.get(client.mac?.toLowerCase());
  return {
    mac: client.mac,
    hostname: client.hostname,
    displayName: client.displayName,
    oui: client.oui,
    lastIp: client.lastIp,
    isWired: client.isWired,
    deviceName: info?.deviceName || null,
    uplinkName: info?.uplinkName || null,
    unifiFirstSeen: client.unifiFirstSeen?.toISOString() || null,
    unifiLastSeen: client.unifiLastSeen?.toISOString() || null,
  };
}

interface GetClientsParams {
  page?: number;
  limit?: number;
  search?: string;
}

export async function getClients(params: GetClientsParams = {}) {
  const page = params.page || 1;
  const limit = params.limit || 50;
  const skip = (page - 1) * limit;

  const where: any = {};
  if (params.search) {
    where.OR = [
      { hostname: { contains: params.search, mode: 'insensitive' } },
      { displayName: { contains: params.search, mode: 'insensitive' } },
      { mac: { contains: params.search, mode: 'insensitive' } },
      { lastNetworkName: { contains: params.search, mode: 'insensitive' } },
      { oui: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const [clients, total] = await Promise.all([
    prisma.networkClient.findMany({
      where,
      orderBy: { lastUpdatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.networkClient.count({ where }),
  ]);

  return {
    clients,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
