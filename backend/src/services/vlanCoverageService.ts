import prisma from './database';
import logger from '../utils/logger';
import { NetworkIntentProfile, NetworkMappings, DeviceMappings } from '../types';
import { createReachabilityPolicyEvaluator, ReachabilityPolicyEvaluator, ReachabilityExpected } from './reachabilityPolicyService';
import { asJsonObject } from './testRunResultsJson';

const INTENT_SETTINGS_KEY = 'network_intent_profile';
const SERVER_DEVICE_ID = 'server-local';

// Types for VLAN coverage
export interface VLANCoverageResponse {
  vlans: VLANInfo[];
  summary: {
    totalVlans: number;
    coveredVlans: number;
    hostValidatedVlans: number;
  };
}

export interface VLANInfo {
  networkId: string;
  name: string;
  vlanId: number | null;
  subnet: string | null;
  ssids: string[];
  testDevices: TestDeviceInfo[];
  hasCoverage: boolean;
  hasHostValidation: boolean;
  hostValidationDevice: TestDeviceInfo | null;
  intentCategory: string | null;
  validation: VLANValidation | null;
  isCaptivePortal: boolean; // Guest network with captive portal - not testable by ESP32
}

export interface TestDeviceInfo {
  id: string;
  deviceId: string;
  name: string;
  ipAddress: string | null;
  status: string;
}

export interface VLANValidation {
  lastTestRunId: string | null;
  lastTestDate: string | null;
  sourceDeviceId: string | null;
  sourceType: 'esp32' | 'server-local' | 'unknown';
  partialEvidence: boolean;
  internetAccess: boolean | null;
  dnsFiltering: boolean | null;
  vlanReachability: VLANReachabilityResult[];
  deviceReachability: DeviceReachabilityResult[];
}

export interface VLANReachabilityResult {
  targetVlan: string;
  targetVlanName: string;
  expected: 'allow' | 'block' | 'unknown';
  verdict: 'pass' | 'fail' | 'unknown' | 'conflict';
  confidence: number;
  reason: string;
  evidenceCount: number;
  evidenceSource: 'esp32' | 'server-local';
  direction: 'src_to_dst';
  // Deprecated - retained for one release for backward compatibility.
  canReach: boolean;
  // Deprecated - retained for one release for backward compatibility.
  shouldBeBlocked: boolean;
}

export interface DeviceReachabilityResult {
  deviceName: string;
  deviceIp: string;
  canReach: boolean;
}

export interface NetworkInfo {
  id: string;
  name: string;
  vlanId: number | null;
  subnet: string | null;
  purpose: string;
}

// Check if an IP address belongs to a subnet (e.g., "192.168.2.1/24")
export function ipInSubnet(ip: string, subnet: string): boolean {
  if (!subnet || !ip) return false;

  const [subnetIp, cidrStr] = subnet.split('/');
  if (!subnetIp || !cidrStr) return false;

  const cidr = parseInt(cidrStr, 10);
  if (isNaN(cidr)) return false;

  const ipToInt = (ipStr: string): number => {
    const parts = ipStr.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return 0;
    return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
  };

  const mask = cidr === 0 ? 0 : (~0 << (32 - cidr)) >>> 0;
  const ipInt = ipToInt(ip) >>> 0;
  const subnetInt = ipToInt(subnetIp) >>> 0;

  return (ipInt & mask) === (subnetInt & mask);
}

// Map a device's IP to a network
export function mapDeviceToNetwork(
  ipAddress: string | null,
  networks: NetworkInfo[]
): NetworkInfo | null {
  if (!ipAddress || !networks?.length) return null;

  for (const network of networks) {
    if (network.subnet && ipInSubnet(ipAddress, network.subnet)) {
      return network;
    }
  }
  return null;
}

// Get the intent category for a network ID
function getIntentCategory(
  networkId: string,
  mappings: NetworkMappings | undefined
): string | null {
  if (!mappings) return null;

  if (mappings.workNetworkId === networkId) return 'Work';
  if (mappings.iotNetworkId === networkId) return 'IoT';
  if (mappings.guestNetworkId === networkId) return 'Guest';
  if (mappings.trustedNetworkId === networkId) return 'Trusted';
  if (mappings.nasNetworkId === networkId) return 'NAS';
  if (mappings.serverNetworkId === networkId) return 'Server';

  return null;
}


// Known internet test IPs
const INTERNET_TEST_IPS = ['8.8.8.8', '1.1.1.1', '8.8.4.4'];

// Build a map of IP addresses to device names from config and intent profile
async function buildDeviceNameMap(): Promise<Map<string, string>> {
  const ipToName = new Map<string, string>();

  try {
    // Get intent profile for device mappings
    const intentSetting = await prisma.setting.findUnique({
      where: { key: INTENT_SETTINGS_KEY },
    });
    const intentProfile = intentSetting?.value as unknown as NetworkIntentProfile | null;
    const deviceMappings = intentProfile?.deviceMappings as DeviceMappings | undefined;

    // Add devices from intent profile
    if (deviceMappings?.nasDevice?.ip) {
      ipToName.set(deviceMappings.nasDevice.ip, deviceMappings.nasDevice.name || 'NAS');
    }
    if (deviceMappings?.serverDevice?.ip) {
      ipToName.set(deviceMappings.serverDevice.ip, deviceMappings.serverDevice.name || 'Server');
    }

    // Get active config for UniFi client data
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (activeConfig?.configJson) {
      const config = activeConfig.configJson as Record<string, unknown>;

      // Extract clients/users from UniFi config
      const clients = (config.user || config.clients || []) as Array<Record<string, unknown>>;
      for (const client of clients) {
        const ip = (client.fixed_ip as string) || (client.ip as string);
        const name = (client.name as string) || (client.hostname as string);
        if (ip && name && !ipToName.has(ip)) {
          ipToName.set(ip, name);
        }
      }

      // Also check devices array
      const devices = (config.devices || []) as Array<Record<string, unknown>>;
      for (const device of devices) {
        const ip = device.ip as string;
        const name = (device.name as string) || (device.model as string);
        if (ip && name && !ipToName.has(ip)) {
          ipToName.set(ip, name);
        }
      }
    }
  } catch (error) {
    logger.error('Error building device name map:', error);
  }

  return ipToName;
}

function getCommandResults(resultsJson: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = (resultsJson.commandResults || resultsJson.results) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

function getExpectedFromTarget(target: Record<string, unknown>): ReachabilityExpected {
  const expected = target.expected;
  if (expected === 'allow' || expected === 'block' || expected === 'unknown') {
    return expected;
  }
  if (target.shouldBeBlocked === true) return 'block';
  if (target.shouldBeBlocked === false) return 'allow';
  return 'unknown';
}

// Extract VLAN validation from test results
async function getLatestVlanValidation(
  networkId: string,
  networks: NetworkInfo[],
  policyEvaluator: ReachabilityPolicyEvaluator
): Promise<VLANValidation | null> {
  try {
    // Find devices on this network to get their test results.
    // Prefer ESP32 probes; fall back to server-local for host-based directional evidence.
    const devices = await prisma.device.findMany({
      where: {
        status: { in: ['ONLINE', 'OFFLINE'] },
        ipAddress: { not: null },
      },
    });

    // Find the network
    const network = networks.find((n) => n.id === networkId);
    if (!network?.subnet) return null;

    // Find devices on this network
    const allDevicesOnNetwork = devices.filter(
      (d) => d.ipAddress && ipInSubnet(d.ipAddress, network.subnet!)
    );
    const esp32DevicesOnNetwork = allDevicesOnNetwork.filter((d) => d.deviceId !== SERVER_DEVICE_ID);
    const serverDeviceOnNetwork =
      allDevicesOnNetwork.find((d) => d.deviceId === SERVER_DEVICE_ID) || null;
    const selectedSourceDevices =
      esp32DevicesOnNetwork.length > 0
        ? esp32DevicesOnNetwork
        : serverDeviceOnNetwork
          ? [serverDeviceOnNetwork]
          : [];
    const sourceType: VLANValidation['sourceType'] =
      esp32DevicesOnNetwork.length > 0
        ? 'esp32'
        : serverDeviceOnNetwork
          ? 'server-local'
          : 'unknown';

    if (selectedSourceDevices.length === 0) return null;

    const sourceDeviceDbIds = selectedSourceDevices.map((d) => d.id);

    // Connectivity tests are used for internet and DNS checks.
    const latestConnectivityTest = await prisma.testRun.findFirst({
      where: {
        deviceId: { in: sourceDeviceDbIds },
        testType: { in: ['topology_validation', 'connectivity'] },
        status: 'COMPLETED',
        resultsJson: { not: { equals: undefined } },
      },
      orderBy: { completedAt: 'desc' },
    });

    // Topology validation tests are the only source used for inter-VLAN reachability verdicts.
    // Prefer the most recent run with usable command evidence to avoid regressing to all-unknown
    // when the latest run was transport-truncated.
    const topologyCandidates = await prisma.testRun.findMany({
      where: {
        deviceId: { in: sourceDeviceDbIds },
        testType: 'topology_validation',
        status: 'COMPLETED',
        resultsJson: { not: { equals: undefined } },
      },
      orderBy: { completedAt: 'desc' },
      take: 8,
    });

    const summarizeTopologyCandidate = (candidate: (typeof topologyCandidates)[number]) => {
      const json = asJsonObject(candidate.resultsJson);
      const commandResults = getCommandResults(json);
      const transport = asJsonObject(json.transport);
      const weakEvidence = transport.truncated === true || transport.incomplete === true;
      return { candidate, commandResults, weakEvidence };
    };

    const summarizedTopologyCandidates = topologyCandidates.map(summarizeTopologyCandidate);
    const latestTopologyTest =
      summarizedTopologyCandidates.find((entry) => entry.commandResults.length > 0 && !entry.weakEvidence)?.candidate ||
      summarizedTopologyCandidates.find((entry) => entry.commandResults.length > 0)?.candidate ||
      topologyCandidates[0] ||
      null;

    const latestTest = latestTopologyTest || latestConnectivityTest;
    if (!latestTest?.resultsJson) return null;

    const connectivityJson = latestConnectivityTest?.resultsJson
      ? asJsonObject(latestConnectivityTest.resultsJson)
      : asJsonObject(latestTest.resultsJson);
    const connectivityResults = getCommandResults(connectivityJson);

    // Parse validation results - handle the actual results format
    const validation: VLANValidation = {
      lastTestRunId: latestTest.id,
      lastTestDate: latestTest.completedAt?.toISOString() || null,
      sourceDeviceId: selectedSourceDevices[0]?.deviceId || null,
      sourceType,
      partialEvidence: sourceType === 'server-local',
      internetAccess: null,
      dnsFiltering: null,
      vlanReachability: [],
      deviceReachability: [],
    };

    // Check for internet access (ping to known internet IPs)
    const internetPings = connectivityResults.filter(
      (r) =>
        r.op === 'ping' &&
        r.data &&
        INTERNET_TEST_IPS.includes((r.data as Record<string, unknown>).host as string)
    );
    if (internetPings.length > 0) {
      validation.internetAccess = internetPings.some(
        (r) => (r.data as Record<string, unknown>).reachable === true
      );
    } else {
      // If no internet IPs tested, check if gateway is reachable as proxy
      const gatewayPing = connectivityResults.find(
        (r) =>
          r.op === 'ping' &&
          r.data &&
          ((r.data as Record<string, unknown>).host as string)?.endsWith('.1')
      );
      if (gatewayPing) {
        validation.internetAccess = (gatewayPing.data as Record<string, unknown>).reachable === true;
      }
    }

    // Check for DNS filtering (look for dns_resolve or dns_lookup operations)
    const dnsResults = connectivityResults.filter((r) => r.op === 'dns_resolve' || r.op === 'dns_lookup');
    if (dnsResults.length > 0) {
      // If we have DNS results, check if filtering is active
      validation.dnsFiltering = dnsResults.some((r) => r.success === true);
    }

    const topologyJson = latestTopologyTest?.resultsJson
      ? asJsonObject(latestTopologyTest.resultsJson)
      : null;
    const topologyResults = topologyJson ? getCommandResults(topologyJson) : [];
    const topologyMetadata = topologyJson
      ? asJsonObject(
          asJsonObject(topologyJson.metadata).topologyMetadata || topologyJson.topologyMetadata
        )
      : {};
    const topologyTargets = Array.isArray(topologyMetadata.testTargets)
      ? topologyMetadata.testTargets.filter(
          (target): target is Record<string, unknown> => Boolean(target) && typeof target === 'object'
        )
      : [];
    const transportInfo = topologyJson ? asJsonObject(topologyJson.transport) : {};
    const weakEvidence = transportInfo.truncated === true || transportInfo.incomplete === true;

    const targetLookup = new Map<string, { targetNetworkId: string; targetNetworkName: string; expected: ReachabilityExpected }>();
    for (const target of topologyTargets) {
      const targetNetworkId = (target.targetNetworkId as string) || '';
      const targetNetworkName = (target.network as string) || 'Unknown';
      const expected = getExpectedFromTarget(target);
      const key = `${String(target.ip || '')}:${Number(target.port || 0)}`;
      if (targetNetworkId || targetNetworkName) {
        targetLookup.set(key, { targetNetworkId, targetNetworkName, expected });
      }
    }

    const evidenceByTarget = new Map<string, { evidenceCount: number; reachableCount: number; blockedCount: number }>();
    const upsertEvidence = (targetId: string, reachable: boolean): void => {
      if (!targetId) return;
      const current = evidenceByTarget.get(targetId) || {
        evidenceCount: 0,
        reachableCount: 0,
        blockedCount: 0,
      };
      current.evidenceCount += 1;
      if (reachable) current.reachableCount += 1;
      else current.blockedCount += 1;
      evidenceByTarget.set(targetId, current);
    };

    for (const result of topologyResults) {
      if ((result.op !== 'tcp_connect' && result.op !== 'ping') || !result.data) continue;
      const data = result.data as Record<string, unknown>;
      const host = String(data.host || data.ip || '');
      const port = Number(data.port || 0);
      const reachable = Boolean(data.open === true || data.reachable === true);

      const target = targetLookup.get(`${host}:${port}`) || targetLookup.get(`${host}:0`);
      if (target?.targetNetworkId) {
        upsertEvidence(target.targetNetworkId, reachable);
        continue;
      }

      const inferredTarget = networks.find(
        (candidate) => candidate.subnet && ipInSubnet(host, candidate.subnet)
      );
      if (inferredTarget?.id) {
        upsertEvidence(inferredTarget.id, reachable);
      }
    }

    for (const targetNetwork of networks) {
      if (targetNetwork.id === network.id) continue;

      const decision = policyEvaluator.evaluate(network.id, targetNetwork.id);
      const evidence = evidenceByTarget.get(targetNetwork.id) || {
        evidenceCount: 0,
        reachableCount: 0,
        blockedCount: 0,
      };
      const canReach = evidence.reachableCount > 0;
      let verdict: 'pass' | 'fail' | 'unknown' | 'conflict' = 'unknown';
      let reason = decision.reason;

      if (decision.conflict) {
        verdict = 'conflict';
      } else if (decision.expected === 'unknown') {
        verdict = 'unknown';
      } else if (evidence.evidenceCount === 0) {
        verdict = 'unknown';
        reason = `${decision.reason} No topology evidence available for this directional path.`;
      } else if (weakEvidence) {
        verdict = 'unknown';
        reason = `${decision.reason} Test transport was truncated or incomplete, so evidence is weak.`;
      } else if (decision.expected === 'allow') {
        verdict = canReach ? 'pass' : 'fail';
      } else if (decision.expected === 'block') {
        verdict = canReach ? 'fail' : 'pass';
      }

      if (sourceType === 'server-local') {
        reason = `${reason} Host-based evidence from server-local on this VLAN (directional, partial coverage).`;
      }

      const evidenceConfidence = Math.min(0.98, 0.55 + evidence.evidenceCount * 0.08);
      let confidence = verdict === 'unknown'
        ? Math.min(decision.confidence, 0.35)
        : Math.max(decision.confidence, evidenceConfidence);
      if (weakEvidence) {
        confidence = Math.min(confidence, 0.45);
      }
      if (sourceType === 'server-local') {
        confidence = verdict === 'unknown'
          ? Math.min(confidence, 0.3)
          : Math.min(confidence, 0.72);
      }

      validation.vlanReachability.push({
        targetVlan: targetNetwork.id,
        targetVlanName: targetNetwork.name,
        expected: decision.expected,
        verdict,
        confidence: Number(confidence.toFixed(2)),
        reason,
        evidenceCount: evidence.evidenceCount,
        evidenceSource: sourceType === 'server-local' ? 'server-local' : 'esp32',
        direction: 'src_to_dst',
        canReach,
        shouldBeBlocked: decision.expected === 'block',
      });
    }

    // Build device name lookup map
    const deviceNameMap = await buildDeviceNameMap();

    // Build device reachability from tcp_connect results
    const tcpResults = topologyResults.filter((r) => r.op === 'tcp_connect' && r.data);
    for (const result of tcpResults) {
      const data = result.data as Record<string, unknown>;
      const host = data.host as string;
      const port = data.port as number;
      const open = data.open === true;

      // Look up device name, fall back to IP:port
      const knownName = deviceNameMap.get(host);
      const displayName = knownName || `${host}:${port}`;

      validation.deviceReachability.push({
        deviceName: displayName,
        deviceIp: host,
        canReach: open,
      });
    }

    return validation;
  } catch (error) {
    logger.error('Error getting VLAN validation:', error);
    return null;
  }
}

// Main function to get VLAN coverage
export async function getVlanCoverage(): Promise<VLANCoverageResponse> {
  try {
    // Get intent profile with network mappings
    const intentSetting = await prisma.setting.findUnique({
      where: { key: INTENT_SETTINGS_KEY },
    });

    const intentProfile = intentSetting?.value as unknown as NetworkIntentProfile | null;
    const networkMappings = intentProfile?.networkMappings;

    // Get active configuration
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig || !activeConfig.configJson) {
      return {
        vlans: [],
        summary: { totalVlans: 0, coveredVlans: 0, hostValidatedVlans: 0 },
      };
    }

    const config = activeConfig.configJson as Record<string, unknown>;

    // Extract networks (handle various key formats)
    const rawNetworks =
      (config.networks as Array<Record<string, unknown>>) ||
      (config.networkConf as Array<Record<string, unknown>>) ||
      (config.networkconf as Array<Record<string, unknown>>) ||
      [];

    const networks: NetworkInfo[] = rawNetworks
      .filter((n) => {
        const purpose = ((n.purpose as string) || '').toLowerCase();
        return purpose !== 'wan';
      })
      .map((n) => ({
        id: (n._id as string) || (n.id as string) || '',
        name: (n.name as string) || 'Unknown',
        vlanId: (n.vlan as number) ?? (n.vlan_id as number) ?? null,
        subnet: (n.ip_subnet as string) || (n.subnet as string) || null,
        purpose: (n.purpose as string) || 'default',
      }));

    // Get only networks that are mapped to intent categories
    const mappedNetworkIds = new Set<string>();
    if (networkMappings) {
      Object.values(networkMappings).forEach((id) => {
        if (id) mappedNetworkIds.add(id);
      });
    }

    // Filter to only mapped networks
    const filteredNetworks = networks.filter((n) => mappedNetworkIds.has(n.id));
    const policyEvaluator = createReachabilityPolicyEvaluator({
      configJson: config,
      intentProfile,
      networks: filteredNetworks.map((network) => ({
        id: network.id,
        name: network.name,
        purpose: network.purpose,
      })),
    });

    // Extract WLANs (handle various key formats)
    const rawWlans =
      (config.wlans as Array<Record<string, unknown>>) ||
      (config.wlanConf as Array<Record<string, unknown>>) ||
      (config.wlanconf as Array<Record<string, unknown>>) ||
      [];

    // Build network to SSIDs mapping and track captive portal networks
    const networkSsids = new Map<string, string[]>();
    const networkHasCaptivePortal = new Map<string, boolean>();
    for (const wlan of rawWlans) {
      if (wlan.enabled === false) continue;
      const networkId = wlan.networkconf_id as string;
      const ssid = (wlan.name as string) || (wlan.ssid as string) || '';

      // Check if this is a captive portal guest network
      // UniFi uses is_guest=true or guest_policy='allow' for captive portal networks
      const isGuestNetwork = Boolean(wlan.is_guest) || wlan.guest_policy === 'allow';

      if (networkId && ssid) {
        const existing = networkSsids.get(networkId) || [];
        existing.push(ssid);
        networkSsids.set(networkId, existing);

        // If any SSID on this network has captive portal, mark it
        if (isGuestNetwork) {
          networkHasCaptivePortal.set(networkId, true);
        }
      }
    }

    // Get all ESP32 devices
    const devices = await prisma.device.findMany({
      where: {
        ipAddress: { not: null },
      },
      select: {
        id: true,
        deviceId: true,
        name: true,
        ipAddress: true,
        status: true,
      },
    });

    // Build VLAN info with coverage
    const vlans: VLANInfo[] = [];

    for (const network of filteredNetworks) {
      // Find devices on this network
      const devicesOnNetwork = devices.filter(
        (d) =>
          d.deviceId !== SERVER_DEVICE_ID &&
          Boolean(d.ipAddress) &&
          Boolean(network.subnet) &&
          ipInSubnet(d.ipAddress as string, network.subnet as string)
      );

      const testDevices: TestDeviceInfo[] = devicesOnNetwork.map((d) => ({
        id: d.id,
        deviceId: d.deviceId,
        name: d.name,
        ipAddress: d.ipAddress,
        status: d.status,
      }));
      const serverDeviceOnNetwork =
        devices.find(
          (d) =>
            d.deviceId === SERVER_DEVICE_ID &&
            Boolean(d.ipAddress) &&
            Boolean(network.subnet) &&
            ipInSubnet(d.ipAddress as string, network.subnet as string)
        ) || null;
      const hostValidationDevice: TestDeviceInfo | null = serverDeviceOnNetwork
        ? {
            id: serverDeviceOnNetwork.id,
            deviceId: serverDeviceOnNetwork.deviceId,
            name: serverDeviceOnNetwork.name,
            ipAddress: serverDeviceOnNetwork.ipAddress,
            status: serverDeviceOnNetwork.status,
          }
        : null;

      // Get validation results
      const validation = await getLatestVlanValidation(network.id, networks, policyEvaluator);

      vlans.push({
        networkId: network.id,
        name: network.name,
        vlanId: network.vlanId,
        subnet: network.subnet,
        ssids: networkSsids.get(network.id) || [],
        testDevices,
        hasCoverage: testDevices.length > 0,
        hasHostValidation: Boolean(hostValidationDevice),
        hostValidationDevice,
        intentCategory: getIntentCategory(network.id, networkMappings),
        validation,
        isCaptivePortal: networkHasCaptivePortal.get(network.id) || false,
      });
    }

    // Sort VLANs: uncovered first (excluding captive portal), then captive portal, then covered
    vlans.sort((a, b) => {
      // Captive portal networks go last
      if (a.isCaptivePortal !== b.isCaptivePortal) {
        return a.isCaptivePortal ? 1 : -1;
      }
      // Then sort by coverage (uncovered first for non-captive-portal networks)
      if (!a.isCaptivePortal && !b.isCaptivePortal && a.hasCoverage !== b.hasCoverage) {
        return a.hasCoverage ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    });

    // Exclude captive portal networks from coverage stats (they can't be tested)
    const testableVlans = vlans.filter((v) => !v.isCaptivePortal);
    const coveredVlans = testableVlans.filter((v) => v.hasCoverage).length;
    const hostValidatedVlans = testableVlans.filter((v) => !v.hasCoverage && v.hasHostValidation).length;

    return {
      vlans,
      summary: {
        totalVlans: testableVlans.length,
        coveredVlans,
        hostValidatedVlans,
      },
    };
  } catch (error) {
    logger.error('Error getting VLAN coverage:', error);
    throw error;
  }
}

// Get devices on other VLANs (for cross-VLAN testing)
export async function getDevicesOnOtherVlans(
  excludeNetworkId: string
): Promise<Array<{ deviceId: string; ipAddress: string; networkId: string }>> {
  try {
    const coverage = await getVlanCoverage();

    const result: Array<{ deviceId: string; ipAddress: string; networkId: string }> = [];

    for (const vlan of coverage.vlans) {
      if (vlan.networkId === excludeNetworkId) continue;

      for (const device of vlan.testDevices) {
        if (device.status === 'ONLINE' && device.ipAddress) {
          result.push({
            deviceId: device.deviceId,
            ipAddress: device.ipAddress,
            networkId: vlan.networkId,
          });
        }
      }
    }

    return result;
  } catch (error) {
    logger.error('Error getting devices on other VLANs:', error);
    return [];
  }
}

// Check if a specific VLAN needs validation
export async function shouldRunValidation(vlanNetworkId: string): Promise<boolean> {
  try {
    const coverage = await getVlanCoverage();
    const vlan = coverage.vlans.find((v) => v.networkId === vlanNetworkId);

    if (!vlan || (!vlan.hasCoverage && !vlan.hasHostValidation)) return false;

    // No previous validation - should run
    if (!vlan.validation?.lastTestDate) return true;

    // Check if last test was more than 4 hours ago
    const lastTestDate = new Date(vlan.validation.lastTestDate);
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    return lastTestDate < fourHoursAgo;
  } catch (error) {
    logger.error('Error checking if validation needed:', error);
    return false;
  }
}
