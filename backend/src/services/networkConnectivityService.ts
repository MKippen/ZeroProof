import prisma from './database';
import logger from '../utils/logger';
import { analyzeTopology, NetworkNode } from './topologyAnalyzer';
import { ipInSubnet } from './vlanCoverageService';
import os from 'os';
import config from '../config';

const MQTT_PORT = parseInt(config.MQTT_PORT || '1883', 10);
const API_PORT = parseInt(config.PORT || '3000', 10);
const PORT_HINT = `${MQTT_PORT} (MQTT) and ${API_PORT} (API)`;
const DIRECTIONAL_ACL_HINT = 'In UniFi ACL mode, add two rules: one source → server and one server → source.';

// V2 Zone-based firewall policy structure
interface FirewallPolicy {
  _id: string;
  name: string;
  action: 'ALLOW' | 'BLOCK' | 'REJECT';
  enabled: boolean;
  source: {
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
    client_macs?: string[];
  };
  destination: {
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
  };
}

/**
 * Network connectivity validation service
 * Checks if traffic from a network can reach the server (for MQTT/API connectivity)
 */

export interface ConnectivityValidationResult {
  canReachServer: boolean;
  sourceNetwork: {
    id: string;
    name: string;
    vlanId: number | null;
    subnet: string | null;
  } | null;
  serverNetwork: {
    id: string;
    name: string;
    vlanId: number | null;
    subnet: string | null;
  } | null;
  serverIp: string;
  blockedReason?: 'firewall' | 'isolation' | 'both' | 'no_route' | 'same_network';
  blockDetails?: string;
  firewallRules?: Array<{ name: string; action: string }>;
  recommendation?: string;
  // Device-specific policies that may override network-level blocks
  devicePolicies?: Array<{ name: string; action: string; targetsMac: boolean }>;
  hasDeviceOverride?: boolean;
}

/**
 * Get the server's IP address on the local network
 */
export function getServerIp(): string {
  const configuredHostIp = process.env.HOST_IP?.trim();
  if (configuredHostIp) return configuredHostIp;

  const interfaces = os.networkInterfaces();
  let serverIp = '127.0.0.1';

  // Find the first non-internal IPv4 address
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIp = iface.address;
        break;
      }
    }
    if (serverIp !== '127.0.0.1') break;
  }

  return serverIp;
}

/**
 * Find which network a given IP address belongs to
 */
function findNetworkByIp(ip: string, networks: NetworkNode[]): NetworkNode | null {
  for (const network of networks) {
    if (network.subnet && ipInSubnet(ip, network.subnet)) {
      return network;
    }
  }
  return null;
}

/**
 * Find which network a WLAN connects to
 */
async function findNetworkForWlan(
  ssid: string,
  configJson: Record<string, unknown>
): Promise<{ networkId: string; networkName: string } | null> {
  // Extract WLANs
  const wlans =
    (configJson.wlans as Array<Record<string, unknown>>) ||
    (configJson.wlanConf as Array<Record<string, unknown>>) ||
    (configJson.wlanconf as Array<Record<string, unknown>>) ||
    [];

  // Find the WLAN by SSID
  const wlan = wlans.find(
    (w) => ((w.name as string) || (w.ssid as string)) === ssid
  );

  if (!wlan) return null;

  const networkId = wlan.networkconf_id as string;
  if (!networkId) return null;

  // Get network name
  const networks =
    (configJson.networks as Array<Record<string, unknown>>) ||
    (configJson.networkConf as Array<Record<string, unknown>>) ||
    (configJson.networkconf as Array<Record<string, unknown>>) ||
    [];

  const network = networks.find(
    (n) => ((n._id as string) || (n.id as string)) === networkId
  );

  return {
    networkId,
    networkName: (network?.name as string) || 'Unknown Network',
  };
}

/**
 * Find V2 firewall policies that target specific devices (MACs) and allow internal traffic
 * These policies can override network isolation for specific devices
 */
function findDeviceSpecificPolicies(
  configJson: Record<string, unknown>
): Array<{ name: string; action: string; targetsMac: boolean; macs: string[] }> {
  const policies =
    (configJson.firewallPolicies as FirewallPolicy[]) ||
    (configJson.firewallpolicy as FirewallPolicy[]) ||
    [];

  const devicePolicies: Array<{ name: string; action: string; targetsMac: boolean; macs: string[] }> = [];

  for (const policy of policies) {
    if (!policy.enabled) continue;

    // Check if this policy targets specific clients (MACs)
    const targetsMac =
      policy.source?.matching_target === 'CLIENT' &&
      Array.isArray(policy.source?.client_macs) &&
      policy.source.client_macs.length > 0;

    // Check if destination is ANY or NETWORK (internal)
    const allowsInternal =
      policy.destination?.matching_target === 'ANY' ||
      policy.destination?.matching_target === 'NETWORK';

    if (targetsMac && allowsInternal && policy.action === 'ALLOW') {
      devicePolicies.push({
        name: policy.name,
        action: policy.action,
        targetsMac: true,
        macs: policy.source.client_macs || [],
      });
    }
  }

  return devicePolicies;
}

/**
 * Validate if a network can reach the server
 */
export async function validateNetworkConnectivity(
  networkIdOrSsid: string,
  isSsid: boolean = false
): Promise<ConnectivityValidationResult> {
  try {
    // Get active configuration
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig || !activeConfig.configJson) {
      return {
        canReachServer: true, // Assume allowed if no config
        sourceNetwork: null,
        serverNetwork: null,
        serverIp: getServerIp(),
        recommendation: 'No UniFi configuration found. Unable to validate connectivity.',
      };
    }

    const configJson = activeConfig.configJson as Record<string, unknown>;

    // Run topology analysis
    const topology = analyzeTopology(configJson, null);

    // Get server IP and find its network
    const serverIp = getServerIp();
    const serverNetwork = findNetworkByIp(serverIp, topology.networks);

    // Find source network
    let sourceNetworkId = networkIdOrSsid;

    if (isSsid) {
      // Find network ID from SSID
      const wlanNetwork = await findNetworkForWlan(networkIdOrSsid, configJson);
      if (wlanNetwork) {
        sourceNetworkId = wlanNetwork.networkId;
      } else {
        return {
          canReachServer: true, // Can't determine, assume allowed
          sourceNetwork: null,
          serverNetwork: serverNetwork
            ? {
                id: serverNetwork.id,
                name: serverNetwork.name,
                vlanId: serverNetwork.vlanId,
                subnet: serverNetwork.subnet,
              }
            : null,
          serverIp,
          recommendation: `Could not find network for SSID "${networkIdOrSsid}". Connectivity cannot be validated.`,
        };
      }
    }

    // Find source network in topology
    const sourceNode = topology.networks.find((n) => n.id === sourceNetworkId);
    if (!sourceNode) {
      const sourceByName = topology.networks.find(
        (n) => n.name.toLowerCase() === sourceNetworkId.toLowerCase()
      );
      if (sourceByName) {
        sourceNetworkId = sourceByName.id;
      }
    }

    const sourceNetwork = topology.networks.find((n) => n.id === sourceNetworkId);

    // If we can't find the source or server network, assume connectivity is possible
    if (!sourceNetwork) {
      return {
        canReachServer: true,
        sourceNetwork: null,
        serverNetwork: serverNetwork
          ? {
              id: serverNetwork.id,
              name: serverNetwork.name,
              vlanId: serverNetwork.vlanId,
              subnet: serverNetwork.subnet,
            }
          : null,
        serverIp,
        recommendation: 'Source network not found in configuration. Connectivity cannot be validated.',
      };
    }

    if (!serverNetwork) {
      return {
        canReachServer: true,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: null,
        serverIp,
        blockedReason: 'no_route',
        recommendation: `Server IP ${serverIp} is not on any configured network. Make sure the server is on a network that devices can reach.`,
      };
    }

    // Check if same network
    if (sourceNetwork.id === serverNetwork.id) {
      return {
        canReachServer: true,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: {
          id: serverNetwork.id,
          name: serverNetwork.name,
          vlanId: serverNetwork.vlanId,
          subnet: serverNetwork.subnet,
        },
        serverIp,
        blockedReason: 'same_network',
        recommendation: 'Device will be on the same network as the server.',
      };
    }

    // Find connection between source and server networks
    const connection = topology.connections.find(
      (c) => c.srcId === sourceNetwork.id && c.dstId === serverNetwork.id
    );

    if (!connection) {
      return {
        canReachServer: false,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: {
          id: serverNetwork.id,
          name: serverNetwork.name,
          vlanId: serverNetwork.vlanId,
          subnet: serverNetwork.subnet,
        },
        serverIp,
        blockedReason: 'no_route',
        blockDetails: `No firewall rule found between ${sourceNetwork.name} and ${serverNetwork.name}.`,
        recommendation: `Create allow ACL/policy rules between "${sourceNetwork.name}" and "${serverNetwork.name}" on ports ${PORT_HINT}. ${DIRECTIONAL_ACL_HINT}`,
      };
    }

    // Check for device-specific policies that might override network isolation
    const devicePolicies = findDeviceSpecificPolicies(configJson);
    const hasDeviceOverride = devicePolicies.length > 0;

    // Check if traffic is allowed
    if (!connection.allowed) {
      const blockedReason = connection.blockReason || 'firewall';
      let blockDetails = '';
      let recommendation = '';

      if (connection.blockedByIsolation) {
        if (hasDeviceOverride) {
          // Network isolation exists but device-specific policies may override it
          blockDetails = `Network isolation is enabled on ${connection.isolationSource || 'one of the networks'}, but device-specific policies exist that may override this.`;
          recommendation = `Your device-specific policy (${devicePolicies.map(p => `"${p.name}"`).join(', ')}) should allow this device to communicate. Make sure the ESP32's MAC address is in the policy's allowed clients list.`;

          // Consider it potentially allowed if device policies exist
          return {
            canReachServer: true, // Optimistic - device policy may override
            sourceNetwork: {
              id: sourceNetwork.id,
              name: sourceNetwork.name,
              vlanId: sourceNetwork.vlanId,
              subnet: sourceNetwork.subnet,
            },
            serverNetwork: {
              id: serverNetwork.id,
              name: serverNetwork.name,
              vlanId: serverNetwork.vlanId,
              subnet: serverNetwork.subnet,
            },
            serverIp,
            blockedReason: 'isolation',
            blockDetails,
            firewallRules: connection.rules.map((r) => ({ name: r.name, action: r.action })),
            devicePolicies: devicePolicies.map((p) => ({ name: p.name, action: p.action, targetsMac: p.targetsMac })),
            hasDeviceOverride: true,
            recommendation,
          };
        } else {
          blockDetails = `Network isolation is enabled on ${connection.isolationSource || 'one of the networks'}.`;
          recommendation = `Disable network isolation on "${connection.isolationSource}" or create a device-specific allow policy targeting the ESP32's MAC address.`;
        }
      } else {
        const blockingRules = connection.rules.filter(
          (r) => r.action === 'drop' || r.action === 'reject'
        );
        if (blockingRules.length > 0) {
          blockDetails = `Blocked by firewall rule: ${blockingRules.map((r) => r.name).join(', ')}`;
        } else {
          blockDetails = `Traffic is blocked between ${sourceNetwork.name} and ${serverNetwork.name}.`;
        }
        recommendation = `Create allow ACL/policy rules between "${sourceNetwork.name}" and "${serverNetwork.name}" on ports ${PORT_HINT}. ${DIRECTIONAL_ACL_HINT}`;
      }

      return {
        canReachServer: false,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: {
          id: serverNetwork.id,
          name: serverNetwork.name,
          vlanId: serverNetwork.vlanId,
          subnet: serverNetwork.subnet,
        },
        serverIp,
        blockedReason,
        blockDetails,
        firewallRules: connection.rules.map((r) => ({ name: r.name, action: r.action })),
        devicePolicies: hasDeviceOverride ? devicePolicies.map((p) => ({ name: p.name, action: p.action, targetsMac: p.targetsMac })) : undefined,
        hasDeviceOverride,
        recommendation,
      };
    }

    // Traffic is allowed
    return {
      canReachServer: true,
      sourceNetwork: {
        id: sourceNetwork.id,
        name: sourceNetwork.name,
        vlanId: sourceNetwork.vlanId,
        subnet: sourceNetwork.subnet,
      },
      serverNetwork: {
        id: serverNetwork.id,
        name: serverNetwork.name,
        vlanId: serverNetwork.vlanId,
        subnet: serverNetwork.subnet,
      },
      serverIp,
      firewallRules: connection.rules.map((r) => ({ name: r.name, action: r.action })),
    };
  } catch (error) {
    logger.error('Error validating network connectivity:', error);
    return {
      canReachServer: true, // Assume allowed on error
      sourceNetwork: null,
      serverNetwork: null,
      serverIp: getServerIp(),
      recommendation: 'Error validating connectivity. Proceeding with setup.',
    };
  }
}

/**
 * Validate connectivity from a specific device IP to the server
 * This is more accurate than SSID-based validation as it uses actual device network
 */
export async function validateDeviceConnectivity(
  deviceIp: string,
  deviceMac?: string
): Promise<ConnectivityValidationResult> {
  try {
    // Get active configuration
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig || !activeConfig.configJson) {
      return {
        canReachServer: true,
        sourceNetwork: null,
        serverNetwork: null,
        serverIp: getServerIp(),
        recommendation: 'No UniFi configuration found. Unable to validate connectivity.',
      };
    }

    const configJson = activeConfig.configJson as Record<string, unknown>;

    // Run topology analysis
    const topology = analyzeTopology(configJson, null);

    // Get server IP and find its network
    const serverIp = getServerIp();
    const serverNetwork = findNetworkByIp(serverIp, topology.networks);

    // Find source network by device IP
    const sourceNetwork = findNetworkByIp(deviceIp, topology.networks);

    if (!sourceNetwork) {
      return {
        canReachServer: true,
        sourceNetwork: null,
        serverNetwork: serverNetwork
          ? {
              id: serverNetwork.id,
              name: serverNetwork.name,
              vlanId: serverNetwork.vlanId,
              subnet: serverNetwork.subnet,
            }
          : null,
        serverIp,
        recommendation: `Device IP ${deviceIp} is not on any configured network. Connectivity cannot be validated.`,
      };
    }

    if (!serverNetwork) {
      return {
        canReachServer: true,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: null,
        serverIp,
        blockedReason: 'no_route',
        recommendation: `Server IP ${serverIp} is not on any configured network.`,
      };
    }

    // Same network - always allowed
    if (sourceNetwork.id === serverNetwork.id) {
      return {
        canReachServer: true,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: {
          id: serverNetwork.id,
          name: serverNetwork.name,
          vlanId: serverNetwork.vlanId,
          subnet: serverNetwork.subnet,
        },
        serverIp,
        blockedReason: 'same_network',
      };
    }

    // Find connection between networks
    const connection = topology.connections.find(
      (c) => c.srcId === sourceNetwork.id && c.dstId === serverNetwork.id
    );

    // Check for device-specific policies that might allow this device
    const devicePolicies = findDeviceSpecificPolicies(configJson);

    // Check if any device policy includes this device's MAC
    let hasMatchingDevicePolicy = false;
    const matchingPolicies: Array<{ name: string; action: string; targetsMac: boolean }> = [];

    if (deviceMac) {
      const normalizedMac = deviceMac.toLowerCase().replace(/[:-]/g, ':');
      for (const policy of devicePolicies) {
        const policyMacs = policy.macs.map(m => m.toLowerCase().replace(/[:-]/g, ':'));
        if (policyMacs.includes(normalizedMac)) {
          hasMatchingDevicePolicy = true;
          matchingPolicies.push({
            name: policy.name,
            action: policy.action,
            targetsMac: true,
          });
        }
      }
    }

    // If no connection found
    if (!connection) {
      if (hasMatchingDevicePolicy) {
        return {
          canReachServer: true,
          sourceNetwork: {
            id: sourceNetwork.id,
            name: sourceNetwork.name,
            vlanId: sourceNetwork.vlanId,
            subnet: sourceNetwork.subnet,
          },
          serverNetwork: {
            id: serverNetwork.id,
            name: serverNetwork.name,
            vlanId: serverNetwork.vlanId,
            subnet: serverNetwork.subnet,
          },
          serverIp,
          devicePolicies: matchingPolicies,
          hasDeviceOverride: true,
          recommendation: `Device-specific policy "${matchingPolicies[0]?.name}" allows this device to connect.`,
        };
      }

      return {
        canReachServer: false,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: {
          id: serverNetwork.id,
          name: serverNetwork.name,
          vlanId: serverNetwork.vlanId,
          subnet: serverNetwork.subnet,
        },
        serverIp,
        blockedReason: 'no_route',
        blockDetails: `No firewall rule found between ${sourceNetwork.name} and ${serverNetwork.name}.`,
        recommendation: `Create allow ACL/policy rules between "${sourceNetwork.name}" and "${serverNetwork.name}" on ports ${PORT_HINT}. ${DIRECTIONAL_ACL_HINT}`,
      };
    }

    // Check if blocked
    if (!connection.allowed) {
      // If device has a matching policy, it may override network blocks
      if (hasMatchingDevicePolicy) {
        return {
          canReachServer: true,
          sourceNetwork: {
            id: sourceNetwork.id,
            name: sourceNetwork.name,
            vlanId: sourceNetwork.vlanId,
            subnet: sourceNetwork.subnet,
          },
          serverNetwork: {
            id: serverNetwork.id,
            name: serverNetwork.name,
            vlanId: serverNetwork.vlanId,
            subnet: serverNetwork.subnet,
          },
          serverIp,
          blockedReason: connection.blockReason || 'isolation',
          blockDetails: connection.blockedByIsolation
            ? `Network isolation is enabled, but device-specific policy overrides this.`
            : undefined,
          devicePolicies: matchingPolicies,
          hasDeviceOverride: true,
          recommendation: `Device-specific policy "${matchingPolicies[0]?.name}" should allow this device to connect despite network restrictions.`,
        };
      }

      // Check for general device policies (without MAC match)
      if (devicePolicies.length > 0 && !deviceMac) {
        return {
          canReachServer: true,
          sourceNetwork: {
            id: sourceNetwork.id,
            name: sourceNetwork.name,
            vlanId: sourceNetwork.vlanId,
            subnet: sourceNetwork.subnet,
          },
          serverNetwork: {
            id: serverNetwork.id,
            name: serverNetwork.name,
            vlanId: serverNetwork.vlanId,
            subnet: serverNetwork.subnet,
          },
          serverIp,
          blockedReason: connection.blockReason || 'isolation',
          blockDetails: connection.blockedByIsolation
            ? `Network isolation is enabled on ${connection.isolationSource || 'one of the networks'}, but device-specific policies exist.`
            : undefined,
          devicePolicies: devicePolicies.map(p => ({ name: p.name, action: p.action, targetsMac: p.targetsMac })),
          hasDeviceOverride: true,
          recommendation: `Ensure the ESP32's MAC address is in the "${devicePolicies[0]?.name}" policy's allowed clients list.`,
        };
      }

      // Truly blocked
      const blockedReason = connection.blockReason || 'firewall';
      let blockDetails = '';
      let recommendation = '';

      if (connection.blockedByIsolation) {
        blockDetails = `Network isolation is enabled on ${connection.isolationSource || 'one of the networks'}.`;
        recommendation = `Disable network isolation on "${connection.isolationSource}" or create a device-specific allow policy for this ESP32's MAC address.`;
      } else {
        const blockingRules = connection.rules.filter(
          (r) => r.action === 'drop' || r.action === 'reject'
        );
        if (blockingRules.length > 0) {
          blockDetails = `Blocked by firewall rule: ${blockingRules.map((r) => r.name).join(', ')}`;
        } else {
          blockDetails = `Traffic is blocked between ${sourceNetwork.name} and ${serverNetwork.name}.`;
        }
        recommendation = `Create allow ACL/policy rules between this device's network and the server network on ports ${PORT_HINT}. ${DIRECTIONAL_ACL_HINT}`;
      }

      return {
        canReachServer: false,
        sourceNetwork: {
          id: sourceNetwork.id,
          name: sourceNetwork.name,
          vlanId: sourceNetwork.vlanId,
          subnet: sourceNetwork.subnet,
        },
        serverNetwork: {
          id: serverNetwork.id,
          name: serverNetwork.name,
          vlanId: serverNetwork.vlanId,
          subnet: serverNetwork.subnet,
        },
        serverIp,
        blockedReason,
        blockDetails,
        firewallRules: connection.rules.map((r) => ({ name: r.name, action: r.action })),
        recommendation,
      };
    }

    // Allowed
    return {
      canReachServer: true,
      sourceNetwork: {
        id: sourceNetwork.id,
        name: sourceNetwork.name,
        vlanId: sourceNetwork.vlanId,
        subnet: sourceNetwork.subnet,
      },
      serverNetwork: {
        id: serverNetwork.id,
        name: serverNetwork.name,
        vlanId: serverNetwork.vlanId,
        subnet: serverNetwork.subnet,
      },
      serverIp,
      firewallRules: connection.rules.map((r) => ({ name: r.name, action: r.action })),
      devicePolicies: hasMatchingDevicePolicy ? matchingPolicies : undefined,
      hasDeviceOverride: hasMatchingDevicePolicy,
    };
  } catch (error) {
    logger.error('Error validating device connectivity:', error);
    return {
      canReachServer: true,
      sourceNetwork: null,
      serverNetwork: null,
      serverIp: getServerIp(),
      recommendation: 'Error validating connectivity.',
    };
  }
}
