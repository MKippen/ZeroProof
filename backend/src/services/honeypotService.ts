/**
 * Honeypot Service - Extracts and manages honeypot configuration from UniFi
 */

import prisma from './database';
import logger from '../utils/logger';

export interface Honeypot {
  id: string;
  enabled: boolean;
  ipAddress: string;
  port: number;
  protocol: 'tcp' | 'udp';
  serviceType: string;
  networkId?: string;
  networkName?: string;
}

/**
 * Extract honeypots from UniFi configuration
 * UniFi stores honeypots in the 'setting' array with key 'ips'
 * Structure: setting[].key='ips' -> honeypot[] array with ip_address, network_id
 */
export function extractHoneypots(configJson: object): Honeypot[] {
  const config = configJson as any;
  const honeypots: Honeypot[] = [];

  // Check in 'setting' array for IPS config (this is the main location)
  const settings = config.setting || [];
  for (const setting of settings) {
    if (setting.key === 'ips') {
      const ipsConfig = setting;

      // Check if honeypots are enabled
      if (!ipsConfig.honeypot_enabled) {
        logger.debug('Honeypots exist in config but honeypot_enabled is false');
        continue;
      }

      // Extract honeypot entries from the honeypot array
      // UniFi format: { version: 'v4', ip_address: '192.168.x.x', network_id: '...' }
      const hpEntries = ipsConfig.honeypot || [];
      logger.debug(`Found ${hpEntries.length} honeypot entries in IPS config`);

      // Common honeypot ports that UniFi's internal honeypot listens on
      const honeypotPorts = [21, 22, 23, 25, 80, 443, 445, 3389, 5900, 8080];

      for (const hp of hpEntries) {
        const ipAddress = hp.ip_address || hp.ipAddress || hp.ip;
        if (!ipAddress) continue;

        // UniFi honeypots listen on multiple ports - create entries for common ones
        // The main honeypot responds on various ports to detect attackers
        honeypots.push({
          id: `honeypot-${ipAddress}`,
          enabled: true,
          ipAddress,
          port: 0, // 0 means all common honeypot ports
          protocol: 'tcp',
          serviceType: 'internal-honeypot',
          networkId: hp.network_id,
        });

        // Also add specific port entries for more granular control
        for (const port of honeypotPorts) {
          honeypots.push({
            id: `honeypot-${ipAddress}-${port}`,
            enabled: true,
            ipAddress,
            port,
            protocol: 'tcp',
            serviceType: getServiceTypeForPort(port),
            networkId: hp.network_id,
          });
        }
      }
    }
  }

  // Also check direct honeypot array (alternative config location)
  const directHoneypots = config.honeypot || config.honeypots || [];
  for (const hp of directHoneypots) {
    const ipAddress = hp.ip_address || hp.ipAddress || hp.ip;
    if (ipAddress) {
      honeypots.push({
        id: hp._id || `hp-${ipAddress}-${hp.port || 0}`,
        enabled: hp.enabled !== false,
        ipAddress,
        port: hp.port || 0,
        protocol: hp.protocol || 'tcp',
        serviceType: hp.service_type || hp.serviceType || hp.type || 'honeypot',
        networkId: hp.network_id || hp.networkId,
      });
    }
  }

  logger.info(`Extracted ${honeypots.length} honeypot entries from config`);
  return honeypots;
}

/**
 * Get service type name for common ports
 */
function getServiceTypeForPort(port: number): string {
  const portServices: Record<number, string> = {
    21: 'ftp',
    22: 'ssh',
    23: 'telnet',
    25: 'smtp',
    80: 'http',
    443: 'https',
    445: 'smb',
    3306: 'mysql',
    3389: 'rdp',
    5432: 'postgresql',
    5900: 'vnc',
    8080: 'http-alt',
  };
  return portServices[port] || 'generic';
}

/**
 * Get honeypots from active configuration
 * Returns unique honeypot IPs (deduplicated from port-specific entries)
 */
export async function getHoneypots(): Promise<Honeypot[]> {
  try {
    const config = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!config || !config.configJson) {
      return [];
    }

    const allHoneypots = extractHoneypots(config.configJson as object);

    // Deduplicate by IP - return only the "all ports" entry (port: 0) for display
    const uniqueByIp = new Map<string, Honeypot>();
    for (const hp of allHoneypots) {
      // Prefer the entry with port: 0 (represents all ports)
      const existing = uniqueByIp.get(hp.ipAddress);
      if (!existing || hp.port === 0) {
        uniqueByIp.set(hp.ipAddress, hp);
      }
    }

    const honeypots = Array.from(uniqueByIp.values());

    // Try to resolve network names
    const configJson = config.configJson as any;
    const networks = configJson.networks || configJson.networkConf || configJson.networkconf || [];

    return honeypots.map(hp => {
      if (hp.networkId) {
        const network = networks.find((n: any) => n._id === hp.networkId || n.id === hp.networkId);
        if (network) {
          hp.networkName = network.name;
        }
      }
      return hp;
    });
  } catch (error) {
    logger.error('Error getting honeypots:', error);
    return [];
  }
}

/**
 * Check if an IP:port combination is a honeypot
 */
export async function isHoneypot(ip: string, port: number): Promise<boolean> {
  const config = await prisma.configuration.findFirst({
    where: { isActive: true },
  });
  if (!config) return false;

  const allHoneypots = extractHoneypots(config.configJson as object);
  return allHoneypots.some(hp =>
    hp.enabled &&
    hp.ipAddress === ip &&
    (hp.port === port || hp.port === 0)
  );
}

/**
 * Get list of honeypot IP:port combinations to exclude from scans
 * Returns all port-specific entries for comprehensive exclusion
 */
export async function getHoneypotExclusions(): Promise<Array<{ ip: string; port: number }>> {
  const config = await prisma.configuration.findFirst({
    where: { isActive: true },
  });
  if (!config) return [];

  const allHoneypots = extractHoneypots(config.configJson as object);

  // Return all entries including port-specific ones
  // Also include port: 0 entries which mean "all ports for this IP"
  return allHoneypots
    .filter(hp => hp.enabled && hp.ipAddress)
    .map(hp => ({ ip: hp.ipAddress, port: hp.port }));
}

/**
 * Generate test commands for honeypot validation
 * Tests a single port per honeypot IP to verify it's responding
 */
export async function generateHoneypotValidationCommands(honeypotIds?: string[]): Promise<Array<{ op: string; host: string; port: number; timeout: number; isHoneypot: boolean }>> {
  const honeypots = await getHoneypots(); // This returns unique IPs

  // Filter to specific honeypots if IDs provided
  const targetHoneypots = honeypotIds && honeypotIds.length > 0
    ? honeypots.filter(hp => honeypotIds.includes(hp.id))
    : honeypots.filter(hp => hp.enabled);

  // Test port 22 (SSH) for each honeypot since it's commonly enabled
  // Could also test multiple ports if needed
  const testPorts = [22, 80, 23];

  const commands: Array<{ op: string; host: string; port: number; timeout: number; isHoneypot: boolean }> = [];

  for (const hp of targetHoneypots) {
    if (!hp.ipAddress) continue;

    // Test first available port for each honeypot
    for (const port of testPorts) {
      commands.push({
        op: 'tcp_connect',
        host: hp.ipAddress,
        port,
        timeout: 2000,
        isHoneypot: true,
      });
    }
  }

  logger.info(`Generated ${commands.length} honeypot validation commands for ${targetHoneypots.length} honeypots`);
  return commands;
}
