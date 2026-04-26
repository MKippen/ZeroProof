/**
 * Topology Test Generator
 *
 * Generates dynamic network isolation test commands based on:
 * - Intent profile (what should/shouldn't be accessible)
 * - Network configuration (actual subnets and VLANs)
 * - Device location (what network the test device is on)
 */

import prisma from './database';
import { NetworkIntentProfile } from '../types';
import { Command } from './testDefinitions';
import logger from '../utils/logger';
import { createReachabilityPolicyEvaluator, ReachabilityExpected } from './reachabilityPolicyService';

const INTENT_SETTINGS_KEY = 'network_intent_profile';

interface NetworkInfo {
  id: string;
  name: string;
  purpose: string;
  vlan?: number;
  subnet?: string;
  gatewayIp?: string;
}

interface DirectionalExpectation {
  sourceNetworkId: string;
  sourceNetworkName: string;
  sourceCategory: string;
  targetNetworkId: string;
  targetNetworkName: string;
  targetCategory: string;
  expected: ReachabilityExpected;
  intentExpected: ReachabilityExpected;
  effectiveExpected: ReachabilityExpected;
  reason: string;
  intentReason: string;
  effectiveReason: string;
  effectiveExplicit: boolean;
  confidence: number;
  conflict: boolean;
  policySource: string;
}

/**
 * Extract gateway IP from subnet (assumes .1 is gateway)
 */
function getGatewayFromSubnet(subnet: string): string | null {
  if (!subnet) return null;
  // Subnet format: "192.168.1.0/24" or "10.0.50.1/24"
  const match = subnet.match(/^(\d+\.\d+\.\d+)\.\d+\/\d+$/);
  if (match) {
    return `${match[1]}.1`;
  }
  return null;
}

interface DeviceTarget {
  ip: string;
  name: string;
  networkId?: string;
  networkName?: string;
  isEsp32?: boolean;
  isServer?: boolean;
  isNas?: boolean;
  port: number;
}

/**
 * Get actual device IPs from UniFi config
 * Much better than guessing random IPs
 */
function getDeviceTargets(config: any, networks: NetworkInfo[], profile: NetworkIntentProfile): DeviceTarget[] {
  const targets: DeviceTarget[] = [];
  const seenIps = new Set<string>();

  // Build network ID to info map
  const networkMap = new Map<string, NetworkInfo>();
  networks.forEach(n => networkMap.set(n.id, n));

  // Get mapped devices from intent profile (NAS, server, etc.)
  const deviceMappings = profile.deviceMappings || {};

  // Get clients from UniFi config
  const clients = config.clients || config.user || config.sta || [];
  for (const client of clients) {
    const ip = client.ip || client.last_ip || client.fixed_ip;
    if (!ip || seenIps.has(ip)) continue;
    seenIps.add(ip);

    const networkId = client.network_id;
    const networkInfo = networkId ? networkMap.get(networkId) : undefined;

    // Check if this is a mapped device
    const mac = client.mac?.toLowerCase();
    const isNas = deviceMappings.nasDevice?.mac?.toLowerCase() === mac;
    const isServer = deviceMappings.serverDevice?.mac?.toLowerCase() === mac;

    // Determine port to test (common services)
    let port = 80; // Default HTTP
    if (isNas) port = 5000; // Synology web UI
    if (isServer) port = 22; // SSH

    targets.push({
      ip,
      name: client.name || client.hostname || client.display_name || ip,
      networkId,
      networkName: networkInfo?.name,
      isNas,
      isServer,
      port,
    });
  }

  // Also add registered ESP32 devices as targets
  // These will be added dynamically in generateTopologyTestCommands

  return targets;
}

/**
 * Get gateway IP from subnet (fallback if no devices found)
 */
function getGatewayTarget(subnet: string, networkName: string): DeviceTarget | null {
  if (!subnet) return null;
  const match = subnet.match(/^(\d+\.\d+\.\d+)\.\d+\/\d+$/);
  if (!match) return null;

  return {
    ip: `${match[1]}.1`,
    name: `${networkName} Gateway`,
    port: 80,
  };
}

/**
 * Parse networks from UniFi config
 */
function parseNetworks(config: any): NetworkInfo[] {
  const rawNetworks = config.networks || config.networkConf || config.networkconf || [];
  return rawNetworks.map((n: any) => ({
    id: n._id || n.id || n.network_id,
    name: n.name || n.network_name || 'Unknown',
    purpose: n.purpose || n.network_purpose || 'corporate',
    vlan: n.vlan || n.vlan_id,
    subnet: n.subnet || n.ip_subnet,
    gatewayIp: getGatewayFromSubnet(n.subnet || n.ip_subnet),
  }));
}

/**
 * Determine which network a device is on based on its IP
 */
function findDeviceNetwork(deviceIp: string, networks: NetworkInfo[]): NetworkInfo | null {
  if (!deviceIp) return null;

  for (const network of networks) {
    if (!network.subnet) continue;

    // Parse subnet to check if device IP is in range
    const match = network.subnet.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)$/);
    if (!match) continue;

    const [, n1, n2, n3, n4, cidr] = match;
    const networkInt = (parseInt(n1) << 24) | (parseInt(n2) << 16) | (parseInt(n3) << 8) | parseInt(n4);
    const mask = ~((1 << (32 - parseInt(cidr))) - 1);

    const ipParts = deviceIp.split('.').map(Number);
    const ipInt = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];

    if ((ipInt & mask) === (networkInt & mask)) {
      return network;
    }
  }

  return null;
}

function buildDirectionalExpectations(
  profile: NetworkIntentProfile,
  config: Record<string, unknown>,
  networks: NetworkInfo[],
  sourceNetworkFilterId?: string
): DirectionalExpectation[] {
  const evaluator = createReachabilityPolicyEvaluator({
    configJson: config,
    intentProfile: profile,
    networks: networks.map((network) => ({
      id: network.id,
      name: network.name,
      purpose: network.purpose,
    })),
  });

  const expectations: DirectionalExpectation[] = [];
  for (const source of networks) {
    if (source.purpose.toLowerCase() === 'wan') continue;
    if (sourceNetworkFilterId && source.id !== sourceNetworkFilterId) continue;

    for (const target of networks) {
      if (target.id === source.id || target.purpose.toLowerCase() === 'wan') continue;
      const decision = evaluator.evaluate(source.id, target.id);
      expectations.push({
        sourceNetworkId: source.id,
        sourceNetworkName: source.name,
        sourceCategory: decision.sourceCategory,
        targetNetworkId: target.id,
        targetNetworkName: target.name,
        targetCategory: decision.targetCategory,
        expected: decision.expected,
        intentExpected: decision.intentExpected,
        effectiveExpected: decision.effectiveExpected,
        reason: decision.reason,
        intentReason: decision.intentReason,
        effectiveReason: decision.effectiveReason,
        effectiveExplicit: decision.effectiveExplicit,
        confidence: decision.confidence,
        conflict: decision.conflict,
        policySource: decision.policySource,
      });
    }
  }

  return expectations;
}

/**
 * Generate topology validation test commands for a specific device
 */
export async function generateTopologyTestCommands(
  deviceIp?: string
): Promise<{ commands: Command[]; metadata: any }> {
  // Get intent profile
  const intentSetting = await prisma.setting.findUnique({
    where: { key: INTENT_SETTINGS_KEY },
  });

  if (!intentSetting?.value) {
    logger.warn('No intent profile configured for topology validation');
    return {
      commands: [{ op: 'get_network_info' }],
      metadata: { error: 'No intent profile configured' },
    };
  }

  // Get active configuration
  const activeConfig = await prisma.configuration.findFirst({
    where: { isActive: true },
  });

  if (!activeConfig) {
    logger.warn('No active configuration for topology validation');
    return {
      commands: [{ op: 'get_network_info' }],
      metadata: { error: 'No network configuration available' },
    };
  }

  const profile = intentSetting.value as unknown as NetworkIntentProfile;
  const config = activeConfig.configJson as any;
  const networks = parseNetworks(config);

  logger.info(`Topology validation: Found ${networks.length} networks`);

  // Find which network the device is on (if we know its IP)
  let deviceNetwork: NetworkInfo | null = null;
  let sourceDeviceMeta: { deviceId: string; name: string } | null = null;
  if (deviceIp) {
    deviceNetwork = findDeviceNetwork(deviceIp, networks);
    logger.info(`Device ${deviceIp} is on network: ${deviceNetwork?.name || 'unknown'}`);
    sourceDeviceMeta = await prisma.device.findFirst({
      where: { ipAddress: deviceIp },
      select: { deviceId: true, name: true },
    });
  }

  const directionalExpectations = buildDirectionalExpectations(
    profile,
    config as Record<string, unknown>,
    networks,
    deviceNetwork?.id
  );
  logger.info(`Topology validation: Generated ${directionalExpectations.length} directional policy expectations`);

  // Get actual devices from config for more meaningful tests
  const deviceTargets = getDeviceTargets(config, networks, profile);
  logger.info(`Topology validation: Found ${deviceTargets.length} devices to test against`);

  // Also get registered ESP32 test devices
  const testDevices = await prisma.device.findMany({
    where: { status: { in: ['ONLINE', 'TESTING'] } },
  });

  // Add ESP32 devices as targets (so we can test device-to-device)
  for (const td of testDevices) {
    if (td.ipAddress && !deviceTargets.find(d => d.ip === td.ipAddress)) {
      const network = findDeviceNetwork(td.ipAddress, networks);
      deviceTargets.push({
        ip: td.ipAddress,
        name: td.name,
        networkName: network?.name,
        networkId: network?.id,
        isEsp32: true,
        port: 80, // ESP32 devices typically have web server
      });
    }
  }

  // Generate test commands
  const commands: Command[] = [
    { op: 'get_network_info' }, // Always start with this to get device's actual IP
  ];

  // Create test targets based on isolation rules
  const testedTargets = new Set<string>();
  const testTargets: Array<{
    sourceNetwork: string;
    sourceNetworkId: string;
    targetNetworkId: string;
    network: string;
    deviceName: string;
    ip: string;
    port: number;
    expected: ReachabilityExpected;
    intentExpected: ReachabilityExpected;
    effectiveExpected: ReachabilityExpected;
    verdict: 'unknown' | 'conflict';
    confidence: number;
    direction: 'src_to_dst';
    shouldBeBlocked: boolean;
    rule: string;
    intentReason: string;
    effectiveReason: string;
    effectiveExplicit: boolean;
    sourceCategory: string;
    targetCategory: string;
    policySource: string;
  }> = [];

  for (const expectation of directionalExpectations) {
    // Find actual devices on the target network
    const targetDevices = deviceTargets.filter((d) => d.networkId === expectation.targetNetworkId);

    if (targetDevices.length > 0) {
      // Use actual devices as test targets
      for (const device of targetDevices.slice(0, 5)) { // Limit to 5 devices per network
        const key = `${device.ip}:${device.port}`;
        if (testedTargets.has(key)) continue;
        testedTargets.add(key);

        testTargets.push({
          sourceNetwork: expectation.sourceNetworkName,
          sourceNetworkId: expectation.sourceNetworkId,
          targetNetworkId: expectation.targetNetworkId,
          network: expectation.targetNetworkName,
          deviceName: device.name,
          ip: device.ip,
          port: device.port,
          expected: expectation.expected,
          intentExpected: expectation.intentExpected,
          effectiveExpected: expectation.effectiveExpected,
          verdict: expectation.conflict ? 'conflict' : 'unknown',
          confidence: expectation.confidence,
          direction: 'src_to_dst',
          shouldBeBlocked: expectation.expected === 'block',
          rule: expectation.reason,
          intentReason: expectation.intentReason,
          effectiveReason: expectation.effectiveReason,
          effectiveExplicit: expectation.effectiveExplicit,
          sourceCategory: expectation.sourceCategory,
          targetCategory: expectation.targetCategory,
          policySource: expectation.policySource,
        });
      }
    } else {
      // Fall back to gateway if no devices found
      const targetNet = networks.find((n) => n.id === expectation.targetNetworkId);
      if (targetNet?.subnet) {
        const gwTarget = getGatewayTarget(targetNet.subnet, expectation.targetNetworkName);
        if (gwTarget) {
          const key = `${gwTarget.ip}:${gwTarget.port}`;
          if (!testedTargets.has(key)) {
            testedTargets.add(key);
            testTargets.push({
              sourceNetwork: expectation.sourceNetworkName,
              sourceNetworkId: expectation.sourceNetworkId,
              targetNetworkId: expectation.targetNetworkId,
              network: expectation.targetNetworkName,
              deviceName: gwTarget.name,
              ip: gwTarget.ip,
              port: gwTarget.port,
              expected: expectation.expected,
              intentExpected: expectation.intentExpected,
              effectiveExpected: expectation.effectiveExpected,
              verdict: expectation.conflict ? 'conflict' : 'unknown',
              confidence: expectation.confidence,
              direction: 'src_to_dst',
              shouldBeBlocked: expectation.expected === 'block',
              rule: expectation.reason,
              intentReason: expectation.intentReason,
              effectiveReason: expectation.effectiveReason,
              effectiveExplicit: expectation.effectiveExplicit,
              sourceCategory: expectation.sourceCategory,
              targetCategory: expectation.targetCategory,
              policySource: expectation.policySource,
            });
          }
        }
      }
    }
  }

  // Add tcp_connect commands for each target
  for (const target of testTargets) {
    commands.push({
      op: 'tcp_connect',
      host: target.ip,
      port: target.port,
      timeout: 2000,
    });
  }

  // Also try to discover hosts on other subnets (if isolation is expected, this should fail)
  // We'll do a limited ping sweep of gateways
  const gatewayTargets = directionalExpectations
    .map((expectation) => {
      const targetNetwork = networks.find((n) => n.id === expectation.targetNetworkId);
      return {
        sourceNetwork: expectation.sourceNetworkName,
        sourceNetworkId: expectation.sourceNetworkId,
        targetNetworkId: expectation.targetNetworkId,
        network: expectation.targetNetworkName,
        ip: targetNetwork?.gatewayIp,
        expected: expectation.expected,
        intentExpected: expectation.intentExpected,
        effectiveExpected: expectation.effectiveExpected,
        confidence: expectation.confidence,
        conflict: expectation.conflict,
        reason: expectation.reason,
        intentReason: expectation.intentReason,
        effectiveReason: expectation.effectiveReason,
        effectiveExplicit: expectation.effectiveExplicit,
        sourceCategory: expectation.sourceCategory,
        targetCategory: expectation.targetCategory,
        policySource: expectation.policySource,
      };
    })
    .filter((target): target is {
      sourceNetwork: string;
      sourceNetworkId: string;
      targetNetworkId: string;
      network: string;
      ip: string;
      expected: ReachabilityExpected;
      intentExpected: ReachabilityExpected;
      effectiveExpected: ReachabilityExpected;
      confidence: number;
      conflict: boolean;
      reason: string;
      intentReason: string;
      effectiveReason: string;
      effectiveExplicit: boolean;
      sourceCategory: string;
      targetCategory: string;
      policySource: string;
    } => Boolean(target.ip));

  for (const gw of gatewayTargets) {
    const key = `ping:${gw.ip}`;
    if (!testedTargets.has(key)) {
      testedTargets.add(key);
      commands.push({
        op: 'ping',
        host: gw.ip,
        timeout: 2000,
      });

      testTargets.push({
        sourceNetwork: gw.sourceNetwork,
        sourceNetworkId: gw.sourceNetworkId,
        targetNetworkId: gw.targetNetworkId,
        network: gw.network,
        deviceName: `${gw.network} Gateway`,
        ip: gw.ip,
        port: 0,
        expected: gw.expected,
        intentExpected: gw.intentExpected,
        effectiveExpected: gw.effectiveExpected,
        verdict: gw.conflict ? 'conflict' : 'unknown',
        confidence: gw.confidence,
        direction: 'src_to_dst',
        shouldBeBlocked: gw.expected === 'block',
        rule: gw.reason,
        intentReason: gw.intentReason,
        effectiveReason: gw.effectiveReason,
        effectiveExplicit: gw.effectiveExplicit,
        sourceCategory: gw.sourceCategory,
        targetCategory: gw.targetCategory,
        policySource: gw.policySource,
      });
    }
  }

  logger.info(`Topology validation: Generated ${commands.length} test commands`);

  return {
    commands,
    metadata: {
      deviceNetwork: deviceNetwork?.name,
      deviceNetworkId: deviceNetwork?.id,
      sourceDeviceIp: deviceIp || null,
      sourceDeviceId: sourceDeviceMeta?.deviceId || null,
      sourceDeviceName: sourceDeviceMeta?.name || null,
      networks: networks.map(n => ({ name: n.name, subnet: n.subnet, vlan: n.vlan })),
      policyExpectations: directionalExpectations.map((expectation) => ({
        sourceNetwork: expectation.sourceNetworkName,
        sourceNetworkId: expectation.sourceNetworkId,
        sourceCategory: expectation.sourceCategory,
        targetNetwork: expectation.targetNetworkName,
        targetNetworkId: expectation.targetNetworkId,
        targetCategory: expectation.targetCategory,
        expected: expectation.expected,
        intentExpected: expectation.intentExpected,
        effectiveExpected: expectation.effectiveExpected,
        reason: expectation.reason,
        intentReason: expectation.intentReason,
        effectiveReason: expectation.effectiveReason,
        effectiveExplicit: expectation.effectiveExplicit,
        confidence: expectation.confidence,
        conflict: expectation.conflict,
        policySource: expectation.policySource,
      })),
      testTargets: testTargets.map(t => ({
        sourceNetwork: t.sourceNetwork,
        sourceNetworkId: t.sourceNetworkId,
        targetNetworkId: t.targetNetworkId,
        network: t.network,
        deviceName: t.deviceName,
        ip: t.ip,
        port: t.port,
        expected: t.expected,
        intentExpected: t.intentExpected,
        effectiveExpected: t.effectiveExpected,
        verdict: t.verdict,
        confidence: t.confidence,
        direction: t.direction,
        policySource: t.policySource,
        reason: t.rule,
        intentReason: t.intentReason,
        effectiveReason: t.effectiveReason,
        effectiveExplicit: t.effectiveExplicit,
        sourceCategory: t.sourceCategory,
        targetCategory: t.targetCategory,
        shouldBeBlocked: t.shouldBeBlocked,
      })),
    },
  };
}

/**
 * Analyze topology test results to find isolation violations
 * Results come back indexed, so we match them with testTargets from metadata
 */
export function analyzeTopologyResults(
  results: any[],
  metadata: any
): Array<{
  type: 'isolation_breach' | 'isolation_verified' | 'connectivity_mismatch' | 'policy_conflict' | 'insufficient_evidence';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  impact?: string;
  remediation?: string;
  affectedResource?: string;
}> {
  const findings: Array<{
    type: 'isolation_breach' | 'isolation_verified' | 'connectivity_mismatch' | 'policy_conflict' | 'insufficient_evidence';
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
    title: string;
    description: string;
    impact?: string;
    remediation?: string;
    affectedResource?: string;
  }> = [];

  // Build a lookup from IP:port to expected behavior
  const testTargets = metadata.testTargets || [];
  const sourceNetworkFallback = metadata.deviceNetwork || 'Unknown Source';
  const sourceDeviceLabel = metadata.sourceDeviceName || metadata.sourceDeviceId || metadata.sourceDeviceIp || 'Probe device';

  const targetLookup = new Map<string, {
    sourceNetwork: string;
    sourceNetworkId?: string;
    targetNetworkId?: string;
    network: string;
    deviceName?: string;
    expected: ReachabilityExpected;
    intentExpected?: ReachabilityExpected;
    effectiveExpected?: ReachabilityExpected;
    shouldBeBlocked: boolean;
    reason?: string;
    intentReason?: string;
    effectiveReason?: string;
    effectiveExplicit?: boolean;
    sourceCategory?: string;
    targetCategory?: string;
    conflict?: boolean;
    policySource?: string;
  }>();
  for (const target of testTargets) {
    targetLookup.set(`${target.ip}:${target.port}`, {
      sourceNetwork: target.sourceNetwork || sourceNetworkFallback,
      sourceNetworkId: target.sourceNetworkId,
      targetNetworkId: target.targetNetworkId,
      network: target.network,
      deviceName: target.deviceName,
      expected: (target.expected as ReachabilityExpected) || (target.shouldBeBlocked ? 'block' : 'allow'),
      intentExpected: (target.intentExpected as ReachabilityExpected) || undefined,
      effectiveExpected: (target.effectiveExpected as ReachabilityExpected) || undefined,
      shouldBeBlocked: Boolean(target.shouldBeBlocked),
      reason: target.reason,
      intentReason: target.intentReason,
      effectiveReason: target.effectiveReason,
      effectiveExplicit: Boolean(target.effectiveExplicit),
      sourceCategory: target.sourceCategory,
      targetCategory: target.targetCategory,
      conflict: Boolean(target.verdict === 'conflict' || target.conflict),
      policySource: target.policySource,
    });
  }

  for (const result of results) {
    if (result.op !== 'tcp_connect' && result.op !== 'ping') continue;

    const host = result.data?.host || result.host;
    const port = result.data?.port || result.port || 0;
    const isReachable = result.success && (result.data?.open === true || result.data?.reachable === true);

    // Look up the target info
    const targetInfo = targetLookup.get(`${host}:${port}`);

    if (!targetInfo) continue;

    const destinationNode = targetInfo.deviceName
      ? `${targetInfo.deviceName} (${targetInfo.network})`
      : targetInfo.network;
    const path = `${targetInfo.sourceNetwork} -> ${destinationNode}`;
    const networkPath = `${targetInfo.sourceNetwork} -> ${targetInfo.network}`;
    const destination = `${targetInfo.network} (${host}${port ? ':' + port : ''})`;
    const destinationWithName = targetInfo.deviceName
      ? `${targetInfo.deviceName} on ${destination}`
      : destination;
    const intentExpected = targetInfo.intentExpected || targetInfo.expected;
    const effectiveExpected = targetInfo.effectiveExpected || 'unknown';
    const intentDetail = `Intent ${intentExpected}: ${targetInfo.intentReason || targetInfo.reason || 'no additional detail'}`;
    const effectiveDetail = `Effective ${effectiveExpected}: ${targetInfo.effectiveReason || 'no inferred UniFi evidence'}`;
    const policyDetail = `${targetInfo.policySource || 'hybrid'} policy. ${intentDetail}. ${effectiveDetail}.`;
    const validationLabel = result.op === 'ping'
      ? 'PING'
      : `TCP${port ? `:${port}` : ''}`;
    const evidenceDetail = result.op === 'tcp_connect'
      ? `Evidence: tcp_connect to ${host}:${port} returned open=${Boolean(result.data?.open)} (success=${Boolean(result.success)}).`
      : `Evidence: ping to ${host} returned reachable=${Boolean(result.data?.reachable)} (success=${Boolean(result.success)}).`;

    if (targetInfo.conflict) {
      const intendedException = isReachable &&
        intentExpected === 'block' &&
        effectiveExpected === 'allow' &&
        Boolean(targetInfo.effectiveExplicit);

      if (intendedException) {
        findings.push({
          type: 'isolation_breach',
          severity: 'LOW',
          title: `Potential Firewall Opening: ${path} [${validationLabel}]`,
          description: `Source ${sourceDeviceLabel} on ${targetInfo.sourceNetwork} reached ${destinationWithName}. Intent expects this path blocked, but UniFi effective policy explicitly allows it. ${policyDetail} ${evidenceDetail}`,
          impact: 'This path is likely intentional, but policy intent and effective enforcement are out of sync.',
          remediation: `In UniFi, confirm this directional allow path (${networkPath}) is intentional and documented. If intentional, add/update an intent override so this appears as expected. If not intentional, remove or narrow the allow rule and retest.`,
          affectedResource: `${path} (${host}${port ? ':' + port : ''})`,
        });
        continue;
      }

      findings.push({
        type: 'policy_conflict',
        severity: 'MEDIUM',
        title: `Policy Conflict: ${path} [${validationLabel}]`,
        description: `Source ${sourceDeviceLabel} on ${targetInfo.sourceNetwork} tested ${destinationWithName}. Intent and inferred effective policy disagree. ${policyDetail} ${evidenceDetail}`,
        affectedResource: `${path} (${host}${port ? ':' + port : ''})`,
      });
      continue;
    }

    if (targetInfo.expected === 'unknown') {
      findings.push({
        type: 'insufficient_evidence',
        severity: 'LOW',
        title: `Unknown Expectation: ${path} [${validationLabel}]`,
        description: `Source ${sourceDeviceLabel} on ${targetInfo.sourceNetwork} tested ${destinationWithName}. No clear allow/block expectation exists for this directional path. ${policyDetail} ${evidenceDetail}`,
        affectedResource: `${path} (${host}${port ? ':' + port : ''})`,
      });
      continue;
    }

    if (targetInfo.expected === 'block' && isReachable) {
      findings.push({
        type: 'isolation_breach',
        severity: 'CRITICAL',
        title: `Network Isolation Breach: ${path} [${validationLabel}]`,
        description: `Source ${sourceDeviceLabel} on ${targetInfo.sourceNetwork} was able to reach ${destinationWithName}. This directional path is currently expected to be blocked. ${policyDetail} ${evidenceDetail}`,
        impact: 'Devices on isolated networks can communicate, potentially allowing lateral movement, data exfiltration, or compromise of sensitive systems.',
        remediation: `In UniFi, add/verify an inter-VLAN drop rule for ${networkPath} (source ${targetInfo.sourceNetwork} -> destination ${targetInfo.network}) above broader allow rules. Then retest this path.`,
        affectedResource: `${path} (${host}${port ? ':' + port : ''})`,
      });
      continue;
    }

    if (targetInfo.expected === 'block' && !isReachable) {
      findings.push({
        type: 'isolation_verified',
        severity: 'INFO',
        title: `Isolation Verified: ${path} [${validationLabel}]`,
        description: `Source ${sourceDeviceLabel} on ${targetInfo.sourceNetwork} could not reach ${destinationWithName}, which matches expected blocked policy. ${evidenceDetail}`,
        affectedResource: path,
      });
      continue;
    }

    if (targetInfo.expected === 'allow' && !isReachable) {
      findings.push({
        type: 'connectivity_mismatch',
        severity: 'MEDIUM',
        title: `Expected Reachability Failed: ${path} [${validationLabel}]`,
        description: `Source ${sourceDeviceLabel} on ${targetInfo.sourceNetwork} could not reach ${destinationWithName}, even though this directional path is expected to be allowed. ${policyDetail} ${evidenceDetail}`,
        remediation: `Validate directional allow rules for ${path} and confirm destination service/port availability on ${host}${port ? ':' + port : ''}.`,
        affectedResource: `${path} (${host}${port ? ':' + port : ''})`,
      });
      continue;
    }

    if (targetInfo.expected === 'allow' && isReachable) {
      findings.push({
        type: 'isolation_verified',
        severity: 'INFO',
        title: `Reachability Verified: ${path} [${validationLabel}]`,
        description: `Source ${sourceDeviceLabel} on ${targetInfo.sourceNetwork} successfully reached ${destinationWithName}, matching expected allowed policy. ${evidenceDetail}`,
        affectedResource: path,
      });
    }
  }

  return findings;
}

/**
 * Generate device-to-device test commands
 * Tests connectivity from source device to all other ESP32 devices
 */
export async function generateDeviceToDeviceCommands(sourceDeviceId: string): Promise<{
  commands: Command[];
  metadata: {
    sourceDevice: { id: string; name: string; ip: string; network?: string };
    targetDevices: Array<{ id: string; name: string; ip: string; network?: string }>;
    error?: string;
  };
}> {
  const commands: Command[] = [{ op: 'get_network_info' }];

  // Get all ESP32 devices except the source device and server
  const devices = await prisma.device.findMany({
    where: {
      status: 'ONLINE',
      deviceId: {
        not: sourceDeviceId,
        notIn: ['server-local'],
      },
    },
    select: {
      deviceId: true,
      name: true,
      ipAddress: true,
    },
  });

  // Get source device info
  const sourceDevice = await prisma.device.findUnique({
    where: { deviceId: sourceDeviceId },
    select: { deviceId: true, name: true, ipAddress: true },
  });

  if (!sourceDevice) {
    return {
      commands,
      metadata: {
        sourceDevice: { id: sourceDeviceId, name: 'Unknown', ip: '' },
        targetDevices: [],
        error: 'Source device not found',
      },
    };
  }

  if (devices.length === 0) {
    return {
      commands,
      metadata: {
        sourceDevice: { id: sourceDevice.deviceId, name: sourceDevice.name, ip: sourceDevice.ipAddress || '' },
        targetDevices: [],
        error: 'No other online ESP32 devices found to test connectivity with',
      },
    };
  }

  // Get network info for context
  const config = await prisma.configuration.findFirst({ where: { isActive: true } });
  const networks = config?.configJson ? extractNetworks(config.configJson) : [];

  const getNetworkName = (ip: string): string | undefined => {
    for (const network of networks) {
      if (network.subnet && ipInSubnet(ip, network.subnet)) {
        return network.name;
      }
    }
    return undefined;
  };

  const targetDevices = devices
    .filter((d) => d.ipAddress)
    .map((d) => ({
      id: d.deviceId,
      name: d.name,
      ip: d.ipAddress!,
      network: d.ipAddress ? getNetworkName(d.ipAddress) : undefined,
    }));

  // Add test commands for each target device
  // Test on port 9999 (ZeroProof test port) and common ports
  for (const target of targetDevices) {
    // Test ZeroProof test port (9999)
    commands.push({
      op: 'tcp_connect',
      host: target.ip,
      port: 9999,
      timeout: 3000,
      label: `ZeroProof Test Port - ${target.name}`,
    });

    // Also test ping for basic connectivity
    commands.push({
      op: 'ping',
      host: target.ip,
      timeout: 2000,
      label: `Ping - ${target.name}`,
    });
  }

  return {
    commands,
    metadata: {
      sourceDevice: {
        id: sourceDevice.deviceId,
        name: sourceDevice.name,
        ip: sourceDevice.ipAddress || '',
        network: sourceDevice.ipAddress ? getNetworkName(sourceDevice.ipAddress) : undefined,
      },
      targetDevices,
    },
  };
}

/**
 * Helper to check if IP is in subnet
 */
function ipInSubnet(ip: string, subnet: string): boolean {
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

/**
 * Extract networks from UniFi config
 */
function extractNetworks(configJson: any): NetworkInfo[] {
  const rawNetworks = configJson?.networks || configJson?.networkConf || configJson?.networkconf || [];
  return rawNetworks.map((n: any) => ({
    id: n._id || n.id,
    name: n.name || 'Unknown',
    purpose: n.purpose || 'corporate',
    vlan: n.vlan || n.vlan_id,
    subnet: n.ip_subnet || n.subnet,
  }));
}

/**
 * Generate mesh test data - commands for each device to test all other devices
 */
export async function generateMeshTestData(deviceIds?: string[]): Promise<{
  devices: Array<{
    deviceId: string;
    dbId: string;
    name: string;
    ip: string;
    network?: string;
    commands: Command[];
    targets: Array<{ deviceId: string; name: string; ip: string; network?: string }>;
  }>;
  networks: NetworkInfo[];
  error?: string;
}> {
  // Get network info for context
  const config = await prisma.configuration.findFirst({ where: { isActive: true } });
  const networks = config?.configJson ? extractNetworks(config.configJson) : [];

  const getNetworkName = (ip: string): string | undefined => {
    for (const network of networks) {
      if (network.subnet && ipInSubnet(ip, network.subnet)) {
        return network.name;
      }
    }
    return undefined;
  };

  // Get all ESP32 devices (excluding server-local)
  const allDevices = await prisma.device.findMany({
    where: {
      status: 'ONLINE',
      deviceId: { not: 'server-local' },
    },
    select: {
      id: true,
      deviceId: true,
      name: true,
      ipAddress: true,
    },
  });

  // Filter to selected devices if specified
  const devices = deviceIds && deviceIds.length > 0
    ? allDevices.filter(d => deviceIds.includes(d.deviceId))
    : allDevices;

  if (devices.length < 2) {
    return {
      devices: [],
      networks,
      error: 'Need at least 2 online ESP32 devices for mesh testing',
    };
  }

  // Build test data for each device
  const meshDevices = devices
    .filter(d => d.ipAddress)
    .map(device => {
      const otherDevices = devices.filter(d => d.deviceId !== device.deviceId && d.ipAddress);

      const commands: Command[] = [{ op: 'get_network_info' }];
      const targets: Array<{ deviceId: string; name: string; ip: string; network?: string }> = [];

      for (const target of otherDevices) {
        if (!target.ipAddress) continue;

        targets.push({
          deviceId: target.deviceId,
          name: target.name,
          ip: target.ipAddress,
          network: getNetworkName(target.ipAddress),
        });

        // Add ping test
        commands.push({
          op: 'ping',
          host: target.ipAddress,
          timeout: 2000,
          label: `Ping ${target.name}`,
        });

        // Add TCP test on port 80 (ESP32 web server)
        commands.push({
          op: 'tcp_connect',
          host: target.ipAddress,
          port: 80,
          timeout: 3000,
          label: `TCP:80 ${target.name}`,
        });
      }

      return {
        deviceId: device.deviceId,
        dbId: device.id,
        name: device.name,
        ip: device.ipAddress!,
        network: getNetworkName(device.ipAddress!),
        commands,
        targets,
      };
    });

  return {
    devices: meshDevices,
    networks,
  };
}

/**
 * Analyze mesh test results and build connectivity matrix
 */
export function analyzeMeshResults(
  meshData: Array<{
    sourceDevice: { deviceId: string; name: string; ip: string; network?: string };
    targets: Array<{ deviceId: string; name: string; ip: string; network?: string }>;
    results: any[];
    error?: string;
  }>
): {
  matrix: Array<{
    source: { deviceId: string; name: string; network?: string };
    target: { deviceId: string; name: string; network?: string };
    pingSuccess: boolean;
    pingLatency?: number;
    tcpSuccess: boolean;
    error?: string;
  }>;
  summary: {
    totalPaths: number;
    successfulPaths: number;
    failedPaths: number;
    crossNetworkPaths: number;
    crossNetworkSuccesses: number;
  };
} {
  const matrix: Array<{
    source: { deviceId: string; name: string; network?: string };
    target: { deviceId: string; name: string; network?: string };
    pingSuccess: boolean;
    pingLatency?: number;
    tcpSuccess: boolean;
    error?: string;
  }> = [];

  let totalPaths = 0;
  let successfulPaths = 0;
  let crossNetworkPaths = 0;
  let crossNetworkSuccesses = 0;

  for (const deviceData of meshData) {
    if (deviceData.error) {
      // Device failed to run tests
      for (const target of deviceData.targets) {
        matrix.push({
          source: {
            deviceId: deviceData.sourceDevice.deviceId,
            name: deviceData.sourceDevice.name,
            network: deviceData.sourceDevice.network,
          },
          target: {
            deviceId: target.deviceId,
            name: target.name,
            network: target.network,
          },
          pingSuccess: false,
          tcpSuccess: false,
          error: deviceData.error,
        });
        totalPaths++;
        if (deviceData.sourceDevice.network !== target.network) {
          crossNetworkPaths++;
        }
      }
      continue;
    }

    const results = deviceData.results || [];

    for (const target of deviceData.targets) {
      // Find ping result for this target
      const pingResult = results.find(
        (r: any) => r.op === 'ping' && (r.data?.host === target.ip || r.host === target.ip)
      );

      // Find TCP result for this target
      const tcpResult = results.find(
        (r: any) => r.op === 'tcp_connect' && (r.data?.host === target.ip || r.host === target.ip)
      );

      const pingSuccess = pingResult?.success && pingResult?.data?.reachable === true;
      const tcpSuccess = tcpResult?.success && tcpResult?.data?.open === true;

      const pathSuccess = pingSuccess || tcpSuccess;
      const isCrossNetwork = deviceData.sourceDevice.network !== target.network;

      matrix.push({
        source: {
          deviceId: deviceData.sourceDevice.deviceId,
          name: deviceData.sourceDevice.name,
          network: deviceData.sourceDevice.network,
        },
        target: {
          deviceId: target.deviceId,
          name: target.name,
          network: target.network,
        },
        pingSuccess,
        pingLatency: pingResult?.data?.latency,
        tcpSuccess,
      });

      totalPaths++;
      if (pathSuccess) successfulPaths++;
      if (isCrossNetwork) {
        crossNetworkPaths++;
        if (pathSuccess) crossNetworkSuccesses++;
      }
    }
  }

  return {
    matrix,
    summary: {
      totalPaths,
      successfulPaths,
      failedPaths: totalPaths - successfulPaths,
      crossNetworkPaths,
      crossNetworkSuccesses,
    },
  };
}
