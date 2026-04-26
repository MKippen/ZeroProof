import prisma from './database';
import logger from '../utils/logger';

export interface DeviceInfo {
  mac: string;
  ip?: string;
  name?: string;
  hostname?: string;
  oui?: string;
  networkId?: string;
  networkName?: string;
  isWired?: boolean;
}

interface DeviceLookupCache {
  configId: string;
  byIp: Map<string, DeviceInfo>;
  byMac: Map<string, DeviceInfo>;
  networks: Map<string, string>; // networkId -> name
  loadedAt: Date;
}

let cache: DeviceLookupCache | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads device data from the active UniFi configuration
 */
async function loadDeviceCache(): Promise<DeviceLookupCache | null> {
  try {
    // Get active config or most recent
    let config = await prisma.configuration.findFirst({
      where: { isActive: true },
      select: { id: true, configJson: true },
    });

    if (!config) {
      config = await prisma.configuration.findFirst({
        orderBy: { importedAt: 'desc' },
        select: { id: true, configJson: true },
      });
    }

    if (!config) {
      return null;
    }

    const json = config.configJson as any;

    // Build network name lookup
    const networks = new Map<string, string>();
    const rawNetworks = json.networks || json.networkConf || json.networkconf || [];
    for (const n of rawNetworks) {
      const id = n._id || n.id;
      if (id) {
        networks.set(id, n.name || 'Unknown');
      }
    }

    // Build device lookups from clients/stations
    const byIp = new Map<string, DeviceInfo>();
    const byMac = new Map<string, DeviceInfo>();

    // Clients might be under different keys
    const rawClients = json.clients || json.user || json.sta || [];

    for (const c of rawClients) {
      const mac = (c.mac || c._id || '').toLowerCase();
      const ip = c.ip || c.last_ip || c.fixed_ip;
      const networkId = c.network_id || c.usergroup_id;

      const device: DeviceInfo = {
        mac,
        ip,
        name: c.name || c.hostname || c.display_name,
        hostname: c.hostname,
        oui: c.oui,
        networkId,
        networkName: networkId ? networks.get(networkId) : undefined,
        isWired: c.is_wired ?? (c.connection_type === 'wired'),
      };

      if (mac) {
        byMac.set(mac, device);
      }
      if (ip) {
        byIp.set(ip, device);
      }
    }

    logger.debug(`Device lookup loaded: ${byMac.size} devices by MAC, ${byIp.size} by IP`);

    return {
      configId: config.id,
      byIp,
      byMac,
      networks,
      loadedAt: new Date(),
    };
  } catch (error) {
    logger.error('Failed to load device lookup cache:', error);
    return null;
  }
}

/**
 * Gets the device cache, refreshing if stale
 */
async function getCache(): Promise<DeviceLookupCache | null> {
  if (cache) {
    const age = Date.now() - cache.loadedAt.getTime();
    if (age < CACHE_TTL_MS) {
      return cache;
    }
  }
  cache = await loadDeviceCache();
  return cache;
}

/**
 * Clears the device lookup cache (call after config import/sync)
 */
export function clearDeviceLookupCache(): void {
  cache = null;
  logger.debug('Device lookup cache cleared');
}

/**
 * Looks up device info by IP address
 */
export async function lookupByIp(ip: string): Promise<DeviceInfo | null> {
  const c = await getCache();
  if (!c) return null;
  return c.byIp.get(ip) || null;
}

/**
 * Looks up device info by MAC address
 */
export async function lookupByMac(mac: string): Promise<DeviceInfo | null> {
  const c = await getCache();
  if (!c) return null;
  return c.byMac.get(mac.toLowerCase()) || null;
}

/**
 * Looks up device info by either IP or MAC
 */
export async function lookupDevice(ipOrMac: string): Promise<DeviceInfo | null> {
  // Determine if it's an IP or MAC based on format
  if (ipOrMac.includes(':') || ipOrMac.length === 12) {
    // Likely a MAC address
    return lookupByMac(ipOrMac);
  } else if (ipOrMac.includes('.')) {
    // Likely an IP address
    return lookupByIp(ipOrMac);
  }
  // Try both
  return (await lookupByIp(ipOrMac)) || (await lookupByMac(ipOrMac));
}

/**
 * Enriches an array of objects with device names based on IP or MAC fields
 */
export async function enrichWithDeviceNames<T extends Record<string, any>>(
  items: T[],
  ipField: keyof T = 'ipAddress' as keyof T,
  macField?: keyof T
): Promise<(T & { deviceName?: string; deviceHostname?: string })[]> {
  const c = await getCache();
  if (!c) return items;

  return items.map((item) => {
    let device: DeviceInfo | undefined;

    // Try IP first
    const ip = item[ipField];
    if (ip && typeof ip === 'string') {
      device = c.byIp.get(ip);
    }

    // Try MAC if no match
    if (!device && macField) {
      const mac = item[macField];
      if (mac && typeof mac === 'string') {
        device = c.byMac.get(mac.toLowerCase());
      }
    }

    if (device) {
      return {
        ...item,
        deviceName: device.name,
        deviceHostname: device.hostname,
      };
    }

    return item;
  });
}

/**
 * Formats an IP/MAC with device name if available
 * Returns: "DeviceName (192.168.1.100)" or just "192.168.1.100" if no name
 */
export async function formatWithDeviceName(ipOrMac: string): Promise<string> {
  const device = await lookupDevice(ipOrMac);
  if (device?.name) {
    return `${device.name} (${ipOrMac})`;
  }
  return ipOrMac;
}

/**
 * Gets all known devices from the UniFi config
 */
export async function getAllDevices(): Promise<DeviceInfo[]> {
  const c = await getCache();
  if (!c) return [];
  return Array.from(c.byMac.values());
}
