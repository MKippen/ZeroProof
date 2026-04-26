import prisma from './database';
import logger from '../utils/logger';
import { NetworkIntentProfile, DeviceMappings } from '../types';

const INTENT_SETTINGS_KEY = 'network_intent_profile';

export interface DeviceAccessRule {
  ruleName: string;
  sourceNetwork: string;
  sourceNetworkId: string;
  targetDevice: string;
  targetIp: string;
  ports: number[];
  action: 'allow' | 'deny';
  ruleId: string;
}

export interface NetworkAccessSummary {
  networkId: string;
  networkName: string;
  accessRules: DeviceAccessRule[];
  internetAccess: 'allowed' | 'blocked' | 'unknown';
  interVlanAccess: Array<{
    targetNetworkId: string;
    targetNetworkName: string;
    access: 'allowed' | 'blocked' | 'unknown';
  }>;
}

interface RawFirewallPolicy {
  _id: string;
  name: string;
  action: 'ALLOW' | 'BLOCK' | 'REJECT';
  enabled: boolean;
  index: number;
  protocol?: string;
  source: {
    zone_id?: string;
    matching_target: string;
    network_ids?: string[];
    ip_addresses?: string[];
    client_macs?: string[];
  };
  destination: {
    zone_id?: string;
    matching_target: string;
    network_ids?: string[];
    ip_addresses?: string[];
    port_ranges?: string[];
  };
}

interface RawFirewallRule {
  _id?: string;
  name?: string;
  enabled?: boolean;
  ruleset?: string;
  action?: string;
  src_network?: string;
  dst_address?: string;
  dst_port?: string;
  protocol?: string;
}

interface RawNetwork {
  _id?: string;
  id?: string;
  name?: string;
  purpose?: string;
}

interface RawClient {
  mac?: string;
  ip?: string;
  fixed_ip?: string;
  name?: string;
  hostname?: string;
}

// Parse port ranges like "5000-5001" or "445" into array of ports
function parsePortRanges(portRanges: string[]): number[] {
  const ports: number[] = [];

  for (const range of portRanges) {
    if (range.includes('-')) {
      const [start, end] = range.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end)) {
        for (let p = start; p <= end && p <= start + 100; p++) {
          ports.push(p);
        }
      }
    } else {
      const port = parseInt(range, 10);
      if (!isNaN(port)) {
        ports.push(port);
      }
    }
  }

  return ports;
}

// Get known device names from intent profile
function getKnownDevices(
  deviceMappings: DeviceMappings | undefined,
  clients: RawClient[]
): Map<string, string> {
  const ipToName = new Map<string, string>();

  // Add devices from intent profile
  if (deviceMappings?.nasDevice?.ip) {
    ipToName.set(
      deviceMappings.nasDevice.ip,
      deviceMappings.nasDevice.name || 'NAS'
    );
  }
  if (deviceMappings?.serverDevice?.ip) {
    ipToName.set(
      deviceMappings.serverDevice.ip,
      deviceMappings.serverDevice.name || 'Server'
    );
  }

  // Add named clients
  for (const client of clients) {
    const ip = client.fixed_ip || client.ip;
    const name = client.name || client.hostname;
    if (ip && name) {
      ipToName.set(ip, name);
    }
  }

  return ipToName;
}

// Extract device access rules from UniFi config
export async function extractDeviceAccessRules(): Promise<DeviceAccessRule[]> {
  try {
    // Get active configuration
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig || !activeConfig.configJson) {
      return [];
    }

    // Get intent profile for device mappings
    const intentSetting = await prisma.setting.findUnique({
      where: { key: INTENT_SETTINGS_KEY },
    });
    const intentProfile = intentSetting?.value as unknown as NetworkIntentProfile | null;
    const deviceMappings = intentProfile?.deviceMappings;

    const config = activeConfig.configJson as Record<string, unknown>;

    // Extract data (handle various key formats)
    const networks = (config.networks ||
      config.networkConf ||
      config.networkconf ||
      []) as RawNetwork[];
    const firewallPolicies = (config.firewallpolicy ||
      config.firewallPolicies ||
      []) as RawFirewallPolicy[];
    const firewallRules = (config.firewallrule ||
      config.firewallRules ||
      []) as RawFirewallRule[];
    const clients = (config.user || config.clients || []) as RawClient[];

    // Build lookup maps
    const networkMap = new Map<string, string>();
    for (const n of networks) {
      const id = n._id || n.id;
      if (id) {
        networkMap.set(id, n.name || 'Unknown');
      }
    }

    const knownDevices = getKnownDevices(deviceMappings, clients);
    const rules: DeviceAccessRule[] = [];

    // Process V2 firewall policies (zone-based)
    for (const policy of firewallPolicies) {
      if (!policy.enabled) continue;

      // Look for policies targeting specific IPs
      const targetIps = policy.destination?.ip_addresses || [];
      if (targetIps.length === 0) continue;

      // Get source networks
      const sourceNetworkIds = policy.source?.network_ids || [];
      if (sourceNetworkIds.length === 0) continue;

      // Get ports
      const ports = parsePortRanges(policy.destination?.port_ranges || []);

      for (const targetIp of targetIps) {
        const deviceName = knownDevices.get(targetIp) || targetIp;

        for (const srcNetId of sourceNetworkIds) {
          const srcNetName = networkMap.get(srcNetId) || srcNetId;

          rules.push({
            ruleName: policy.name || 'Unnamed Policy',
            sourceNetwork: srcNetName,
            sourceNetworkId: srcNetId,
            targetDevice: deviceName,
            targetIp,
            ports,
            action: policy.action === 'ALLOW' ? 'allow' : 'deny',
            ruleId: policy._id,
          });
        }
      }
    }

    // Process legacy firewall rules
    for (const rule of firewallRules) {
      if (!rule.enabled) continue;
      if (!rule.dst_address) continue;

      const targetIp = rule.dst_address;
      const deviceName = knownDevices.get(targetIp) || targetIp;

      // Get source network
      let sourceNetworkId = '';
      let sourceNetworkName = 'Any';

      if (rule.src_network) {
        // Find network by name
        for (const [id, name] of networkMap) {
          if (name === rule.src_network) {
            sourceNetworkId = id;
            sourceNetworkName = name;
            break;
          }
        }
      }

      // Parse ports
      const ports: number[] = [];
      if (rule.dst_port) {
        const portParts = rule.dst_port.split(',');
        for (const part of portParts) {
          const port = parseInt(part.trim(), 10);
          if (!isNaN(port)) {
            ports.push(port);
          }
        }
      }

      rules.push({
        ruleName: rule.name || 'Unnamed Rule',
        sourceNetwork: sourceNetworkName,
        sourceNetworkId,
        targetDevice: deviceName,
        targetIp,
        ports,
        action: rule.action === 'accept' ? 'allow' : 'deny',
        ruleId: rule._id || '',
      });
    }

    // Deduplicate rules (same source network + target device + action)
    const uniqueRules = new Map<string, DeviceAccessRule>();
    for (const rule of rules) {
      const key = `${rule.sourceNetworkId}:${rule.targetIp}:${rule.action}`;
      const existing = uniqueRules.get(key);
      if (existing) {
        // Merge ports
        existing.ports = [...new Set([...existing.ports, ...rule.ports])];
      } else {
        uniqueRules.set(key, rule);
      }
    }

    return Array.from(uniqueRules.values());
  } catch (error) {
    logger.error('Error extracting device access rules:', error);
    return [];
  }
}

// Get access rules for a specific network
export async function getNetworkAccessRules(
  networkId: string
): Promise<DeviceAccessRule[]> {
  const allRules = await extractDeviceAccessRules();
  return allRules.filter((r) => r.sourceNetworkId === networkId);
}

// Get a summary of network access for a specific network
export async function getNetworkAccessSummary(
  networkId: string
): Promise<NetworkAccessSummary | null> {
  try {
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig) return null;

    const config = activeConfig.configJson as Record<string, unknown>;
    const networks = (config.networks ||
      config.networkConf ||
      config.networkconf ||
      []) as RawNetwork[];

    const network = networks.find(
      (n) => (n._id || n.id) === networkId
    );
    if (!network) return null;

    const accessRules = await getNetworkAccessRules(networkId);

    // Determine internet access (simplified - would need to check WAN rules)
    const internetAccess: 'allowed' | 'blocked' | 'unknown' = 'unknown';

    // Get inter-VLAN access
    const interVlanAccess: NetworkAccessSummary['interVlanAccess'] = [];
    for (const n of networks) {
      const id = n._id || n.id;
      if (!id || id === networkId) continue;
      if ((n.purpose || '').toLowerCase() === 'wan') continue;

      interVlanAccess.push({
        targetNetworkId: id,
        targetNetworkName: n.name || 'Unknown',
        access: 'unknown',
      });
    }

    return {
      networkId,
      networkName: network.name || 'Unknown',
      accessRules,
      internetAccess,
      interVlanAccess,
    };
  } catch (error) {
    logger.error('Error getting network access summary:', error);
    return null;
  }
}
