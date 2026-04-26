import { NetworkIntentProfile } from '../types';
import logger from '../utils/logger';

// Types for topology analysis

export interface NetworkNode {
  id: string;
  name: string;
  vlanId: number | null;
  subnet: string | null;
  purpose: string;
  networkGroup: string;
  networkIsolation?: boolean; // UniFi network_isolation setting
}

export interface ExplicitRoute {
  id: string;
  type: 'port_forward' | 'allow_rule' | 'device_exception' | 'traffic_rule';
  name: string;
  source: string; // "WAN", network name, or IP
  destination: string;
  destinationDevice?: { name: string; ip: string; mac?: string };
  ports?: string;
  protocol?: string;
  enabled: boolean;
}

export interface ConnectivityWarning {
  type: 'redundant_rule' | 'isolation_mismatch' | 'missing_explicit_block' | 'network_isolation_effective';
  severity: 'LOW' | 'MEDIUM';
  message: string;
  details: string;
}

export interface RuleInfo {
  name: string;
  action: string;
  enabled: boolean;
  ruleset?: string;       // e.g., "LAN_IN", "LAN_OUT", "WAN_IN"
  ruleIndex?: number;     // Priority/order
  protocol?: string;      // e.g., "all", "tcp", "udp"
  srcNetwork?: string;    // Source network name
  dstNetwork?: string;    // Destination network name
  dstPort?: string;       // Destination port if specified
  unifiId?: string;       // UniFi rule ID for reference
}

export interface EnhancedConnection {
  srcId: string;
  dstId: string;
  srcName: string;
  dstName: string;
  allowed: boolean;
  bidirectional: boolean;
  rules: RuleInfo[];
  allowedByDefault: boolean;
  violatesIntent: boolean;
  intentReason?: string;
  blockedByIsolation: boolean; // Blocked by network_isolation setting
  blockReason?: 'firewall' | 'isolation' | 'both';
  isolationSource?: string; // Which network has isolation enabled
}

// Device grouping for topology visualization
export interface TopologyDevice {
  id: string;
  name: string;
  ip: string;
  mac: string;
  networkId: string;
  networkName: string;
  category: string;      // e.g., "cameras", "nas", "printers", "smart_home", "computers", "other"
  categoryLabel: string; // Human-readable: "Cameras", "NAS", etc.
  routes: ExplicitRoute[];
  isProminent: boolean;  // Has explicit cross-network policies
  policyCount: number;   // Number of policies referencing this device
}

export interface DeviceGroup {
  id: string;
  category: string;
  label: string;
  networkId: string;
  networkName: string;
  devices: TopologyDevice[];
  icon: string;  // Icon name for the group
}

export interface TopologyAnalysis {
  networks: NetworkNode[];
  connections: EnhancedConnection[];
  explicitRoutes: ExplicitRoute[];
  warnings: ConnectivityWarning[];
  deviceGroups: DeviceGroup[];
}

interface RawNetworkConfig {
  _id?: string;
  id?: string;
  name?: string;
  vlan?: number;
  vlan_id?: number;
  ip_subnet?: string;
  purpose?: string;
  networkgroup?: string;
  network_group?: string;
  network_isolation?: boolean;
  network_isolation_enabled?: boolean; // UniFi API uses this field name
}

interface RawFirewallRule {
  _id?: string;
  id?: string;
  name?: string;
  enabled?: boolean;
  ruleset?: string;
  rule_index?: number;
  action?: string;
  protocol?: string;
  src_network?: string;
  dst_network?: string;
  src_firewallgroup_ids?: string[];
  dst_firewallgroup_ids?: string[];
  src_address?: string;
  dst_address?: string;
  dst_port?: string;
}

interface RawFirewallGroup {
  _id?: string;
  id?: string;
  name?: string;
  group_members?: string[];
  group_type?: string;
}

// V2 Zone-based firewall policy (UniFi Network 7.x+)
interface RawFirewallPolicy {
  _id: string;
  name: string;
  action: 'ALLOW' | 'BLOCK' | 'REJECT';
  enabled: boolean;
  predefined: boolean;
  index: number;
  protocol?: string;
  description?: string;
  logging?: boolean;
  source: {
    zone_id?: string;
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
    network_ids?: string[];
    ip_addresses?: string[];
    client_macs?: string[];
  };
  destination: {
    zone_id?: string;
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
    network_ids?: string[];
    ip_addresses?: string[];
    port_ranges?: string[];
  };
}

interface RawPortForward {
  _id?: string;
  id?: string;
  name?: string;
  enabled?: boolean;
  src?: string;
  dst_port?: string;
  fwd?: string;
  fwd_port?: string;
  proto?: string;
}

interface RawTrafficRule {
  _id?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  action?: 'BLOCK' | 'ALLOW';
  matching_target?: string;
  target_devices?: { type: string; client_mac?: string; network_id?: string }[];
  network_ids?: string[];
  ip_addresses?: string[];
}

interface RawClient {
  _id?: string;
  mac?: string;
  ip?: string;
  name?: string;
  hostname?: string;
  network_id?: string;
  fixed_ip?: string;
}

interface RawDevice {
  _id?: string;
  mac?: string;
  ip?: string;
  name?: string;
  hostname?: string;
  model?: string;
}

// L3 ACL Isolation settings (from UniFi settings[].acl_l3_isolation)
interface L3AclIsolation {
  source_network: string;
  destination_networks: string[];
}

// ACL Rule (custom rules from Settings > Security > ACL Rules)
interface RawAclRule {
  _id: string;
  name: string;
  type: 'IPV4' | 'MAC';
  action: 'ALLOW' | 'BLOCK';
  enabled: boolean;
  acl_index: number;
  traffic_source?: {
    type: string;
    ips_or_subnets?: string[];
    network_ids?: string[];
    specific_mac_addresses?: string[];
  };
  traffic_destination?: {
    type: string;
    ips_or_subnets?: string[];
    network_ids?: string[];
    specific_mac_addresses?: string[];
  };
}

/**
 * Analyze network topology and generate connectivity information
 */
export function analyzeTopology(
  configJson: any,
  intentProfile?: NetworkIntentProfile | null
): TopologyAnalysis {
  // Debug: log the actual keys and types in configJson
  logger.debug(`analyzeTopology called with configJson type: ${typeof configJson}`);
  if (configJson) {
    const keys = Object.keys(configJson);
    logger.debug(`analyzeTopology configJson keys: ${keys.join(', ')}`);
    // Check specific keys we need
    logger.debug(`portForwards type: ${typeof configJson.portForwards}, isArray: ${Array.isArray(configJson.portForwards)}, length: ${Array.isArray(configJson.portForwards) ? configJson.portForwards.length : 'N/A'}`);
    logger.debug(`firewallRules type: ${typeof configJson.firewallRules}, isArray: ${Array.isArray(configJson.firewallRules)}, length: ${Array.isArray(configJson.firewallRules) ? configJson.firewallRules.length : 'N/A'}`);
    logger.debug(`trafficRules type: ${typeof configJson.trafficRules}, isArray: ${Array.isArray(configJson.trafficRules)}, length: ${Array.isArray(configJson.trafficRules) ? configJson.trafficRules.length : 'N/A'}`);
  }

  // Extract data from config
  const networkconf = extractArray(configJson, 'networkconf') as RawNetworkConfig[];
  const firewallrule = extractArray(configJson, 'firewallrule') as RawFirewallRule[];
  const firewallpolicy = extractArray(configJson, 'firewallpolicy') as RawFirewallPolicy[];
  const firewallgroup = extractArray(configJson, 'firewallgroup') as RawFirewallGroup[];
  const portforward = extractArray(configJson, 'portforward') as RawPortForward[];
  const trafficrule = extractArray(configJson, 'trafficrule') as RawTrafficRule[];
  const clients = extractArray(configJson, 'user') as RawClient[];
  const devices = extractArray(configJson, 'device') as RawDevice[];
  const aclRules = extractArray(configJson, 'aclrule') as RawAclRule[];

  // Extract L3 ACL settings from settings array
  // These control switch-level isolation (before firewall)
  const settings = extractArray(configJson, 'setting') as any[];
  let l3AclIsolation: L3AclIsolation[] = [];
  let aclDeviceIsolation: string[] = [];

  for (const setting of settings) {
    if (setting.acl_l3_isolation && Array.isArray(setting.acl_l3_isolation)) {
      l3AclIsolation = setting.acl_l3_isolation;
    }
    if (setting.acl_device_isolation && Array.isArray(setting.acl_device_isolation)) {
      aclDeviceIsolation = setting.acl_device_isolation;
    }
  }

  logger.info(`Extracted from config: ${networkconf.length} networks, ${portforward.length} port forwards, ${trafficrule.length} traffic rules, ${clients.length} clients, ${devices.length} devices, ${aclRules.length} ACL rules`);
  if (l3AclIsolation.length > 0) {
    logger.info(`L3 ACL Isolation: ${l3AclIsolation.length} source networks with blocked destinations`);
  }
  if (aclDeviceIsolation.length > 0) {
    logger.info(`Device Isolation (ACL) enabled on ${aclDeviceIsolation.length} networks`);
  }

  // Log first port forward if any exist
  if (portforward.length > 0) {
    logger.debug(`First port forward: ${JSON.stringify(portforward[0])}`);
  }

  // Build network nodes
  const networks = buildNetworkNodes(networkconf);

  // Build lookup maps
  const networkMap = new Map(networks.map(n => [n.id, n]));
  const groupMap = buildGroupMap(firewallgroup);
  const clientMap = buildClientMap(clients, devices);

  // Build connections - pass both legacy rules and v2 policies plus L3 ACL
  const { connections, ruleApplications } = buildConnections(
    networks,
    firewallrule,
    firewallpolicy,
    groupMap,
    networkMap,
    intentProfile,
    l3AclIsolation
  );

  // Extract explicit routes (including devices from V2 policies)
  const explicitRoutes = buildExplicitRoutes(
    portforward,
    trafficrule,
    firewallrule,
    firewallpolicy,
    networks,
    clientMap,
    clients
  );

  // Generate warnings
  const warnings = generateWarnings(
    networks,
    connections,
    ruleApplications,
    explicitRoutes
  );

  // Add WAN node
  const wanNode: NetworkNode = {
    id: 'WAN',
    name: 'Internet',
    vlanId: null,
    subnet: null,
    purpose: 'wan',
    networkGroup: 'WAN',
  };

  // Add WAN connections
  const wanConnections = buildWanConnections(networks, firewallrule);

  // Build device groups from explicit routes and all clients
  const deviceGroups = buildDeviceGroups(
    explicitRoutes,
    clients,
    networks,
    firewallpolicy
  );

  return {
    networks: [...networks, wanNode],
    connections: [...connections, ...wanConnections],
    explicitRoutes,
    warnings,
    deviceGroups,
  };
}

function extractArray(config: any, key: string): any[] {
  // Map between UniFi export format (lowercase), API format (camelCase), and sync format variations
  // The connection-based sync uses different keys (portForward, networkConf, wlanConf)
  // vs the legacy sync which uses the API format directly (portForwards, networks, wlans)
  const keyMappings: Record<string, string[]> = {
    'networkconf': ['networkconf', 'networkConf', 'networks'],
    'firewallrule': ['firewallrule', 'firewallRules'],
    'firewallgroup': ['firewallgroup', 'firewallGroups'],
    'firewallpolicy': ['firewallpolicy', 'firewallPolicies'], // V2 zone-based policies
    'portforward': ['portforward', 'portForward', 'portForwards'],
    'trafficrule': ['trafficrule', 'trafficRules'],
    'wlanconf': ['wlanconf', 'wlanConf', 'wlans'],
    'user': ['user', 'clients'],
    'device': ['device', 'devices'],
  };

  const keysToTry = keyMappings[key] || [key];

  for (const k of keysToTry) {
    if (config[k] && Array.isArray(config[k])) {
      logger.debug(`extractArray: found ${key} as ${k} with ${config[k].length} items`);
      return config[k];
    }
    if (config.data?.[k] && Array.isArray(config.data[k])) {
      logger.debug(`extractArray: found ${key} as data.${k} with ${config.data[k].length} items`);
      return config.data[k];
    }
  }

  logger.debug(`extractArray: ${key} not found, tried keys: ${keysToTry.join(', ')}`);
  return [];
}

function buildNetworkNodes(networkconf: RawNetworkConfig[]): NetworkNode[] {
  // Filter out WAN-purpose networks (Internet 1, Internet 2, etc.)
  const lanNetworks = networkconf.filter(n => {
    const purpose = (n.purpose || '').toLowerCase();
    return purpose !== 'wan';
  });

  return lanNetworks.map(n => ({
    id: n._id || n.id || '',
    name: n.name || 'Unnamed',
    vlanId: n.vlan ?? n.vlan_id ?? null,
    subnet: n.ip_subnet || null,
    purpose: n.purpose || 'default',
    networkGroup: n.networkgroup || n.network_group || 'LAN',
    // Check both field names - UniFi API uses network_isolation_enabled
    networkIsolation: n.network_isolation_enabled ?? n.network_isolation ?? false,
  }));
}

function buildGroupMap(firewallgroup: RawFirewallGroup[]): Map<string, RawFirewallGroup> {
  const map = new Map<string, RawFirewallGroup>();
  firewallgroup.forEach(g => {
    const id = g._id || g.id;
    if (id) map.set(id, g);
  });
  return map;
}

function buildClientMap(clients: RawClient[], devices: RawDevice[]): Map<string, { name: string; ip: string; mac: string }> {
  const map = new Map<string, { name: string; ip: string; mac: string }>();

  // Add clients
  clients.forEach(c => {
    const ip = c.fixed_ip || c.ip;
    if (ip) {
      map.set(ip, {
        name: c.name || c.hostname || 'Unknown Device',
        ip,
        mac: c.mac || '',
      });
    }
    if (c.mac) {
      map.set(c.mac, {
        name: c.name || c.hostname || 'Unknown Device',
        ip: ip || '',
        mac: c.mac,
      });
    }
  });

  // Add devices (infrastructure)
  devices.forEach(d => {
    if (d.ip) {
      map.set(d.ip, {
        name: d.name || d.hostname || d.model || 'Network Device',
        ip: d.ip,
        mac: d.mac || '',
      });
    }
    if (d.mac) {
      map.set(d.mac, {
        name: d.name || d.hostname || d.model || 'Network Device',
        ip: d.ip || '',
        mac: d.mac,
      });
    }
  });

  return map;
}

interface RuleApplication {
  srcId: string;
  dstId: string;
  rule: RawFirewallRule;
}

function buildConnections(
  networks: NetworkNode[],
  firewallrule: RawFirewallRule[],
  firewallpolicy: RawFirewallPolicy[],
  groupMap: Map<string, RawFirewallGroup>,
  networkMap: Map<string, NetworkNode>,
  intentProfile?: NetworkIntentProfile | null,
  l3AclIsolation?: L3AclIsolation[]
): { connections: EnhancedConnection[]; ruleApplications: RuleApplication[] } {
  const pairRules = new Map<string, {
    forwardAllowed: boolean | null;
    reverseAllowed: boolean | null;
    rules: RuleInfo[];
    blockedByIsolation: boolean;
    isolationSource?: string;
  }>();

  // Create a map from network ID to NetworkNode for quick lookup
  const networkById = new Map(networks.map(n => [n.id, n]));

  // Build L3 ACL isolation lookup: which source networks are blocked from which destinations
  // This is switch-level isolation that blocks BEFORE firewall rules
  const l3AclBlocked = new Map<string, Set<string>>();
  if (l3AclIsolation) {
    for (const isolation of l3AclIsolation) {
      const srcId = isolation.source_network;
      if (!l3AclBlocked.has(srcId)) {
        l3AclBlocked.set(srcId, new Set());
      }
      for (const dstId of isolation.destination_networks) {
        l3AclBlocked.get(srcId)!.add(dstId);
      }
    }
  }

  const ruleApplications: RuleApplication[] = [];
  const getPairKey = (src: string, dst: string) => `${src}:${dst}`;

  // Initialize all pairs - check both network_isolation setting AND L3 ACL isolation
  for (const srcNet of networks) {
    for (const dstNet of networks) {
      if (srcNet.id === dstNet.id) continue;

      const key = getPairKey(srcNet.id, dstNet.id);

      // Check gateway-level network_isolation setting
      const blockedByNetworkIsolation = Boolean(srcNet.networkIsolation || dstNet.networkIsolation);

      // Check switch-level L3 ACL isolation (blocks traffic from srcNet to dstNet at switch)
      const blockedByL3Acl = l3AclBlocked.has(srcNet.id) && l3AclBlocked.get(srcNet.id)!.has(dstNet.id);

      // Either type of isolation blocks traffic
      const blockedByIsolation = blockedByNetworkIsolation || blockedByL3Acl;

      // Track which mechanism has isolation enabled
      let isolationSource: string | undefined;
      if (blockedByL3Acl && blockedByNetworkIsolation) {
        isolationSource = `L3 ACL + ${srcNet.networkIsolation ? srcNet.name : dstNet.name}`;
      } else if (blockedByL3Acl) {
        isolationSource = `L3 ACL (${srcNet.name} → ${dstNet.name})`;
      } else if (srcNet.networkIsolation && dstNet.networkIsolation) {
        isolationSource = `${srcNet.name} & ${dstNet.name}`;
      } else if (srcNet.networkIsolation) {
        isolationSource = srcNet.name;
      } else if (dstNet.networkIsolation) {
        isolationSource = dstNet.name;
      }

      pairRules.set(key, {
        forwardAllowed: null,
        reverseAllowed: null,
        rules: [],
        blockedByIsolation,
        isolationSource,
      });
    }
  }

  // Helper to resolve network IDs from firewall group
  const resolveNetworkFromGroup = (groupId: string): string[] => {
    const group = groupMap.get(groupId);
    if (!group) return [];

    const members = group.group_members || [];
    const networkIds: string[] = [];

    for (const member of members) {
      // Check if member is a network ID
      if (networkMap.has(member)) {
        networkIds.push(member);
      }
      // Check if member matches a network by subnet
      for (const [id, net] of networkMap) {
        if (net.subnet === member || net.name === member) {
          networkIds.push(id);
        }
      }
    }
    return networkIds;
  };

  // Sort rules by rule_index to respect priority
  const sortedRules = [...firewallrule].sort((a, b) =>
    (a.rule_index || 0) - (b.rule_index || 0)
  );

  // Process firewall rules
  for (const rule of sortedRules) {
    if (!rule.enabled) continue;

    const ruleset = rule.ruleset || '';
    // Process LAN rules (inter-VLAN) - be more permissive with matching
    if (!ruleset.toLowerCase().includes('lan')) continue;

    const action = rule.action || 'drop';
    const isAllow = action === 'accept';

    let srcNetworks: string[] = [];
    let dstNetworks: string[] = [];

    // Direct network references
    if (rule.src_network) {
      const net = Array.from(networkMap.values()).find(
        n => n.name === rule.src_network || n.id === rule.src_network
      );
      if (net) srcNetworks.push(net.id);
    }
    if (rule.dst_network) {
      const net = Array.from(networkMap.values()).find(
        n => n.name === rule.dst_network || n.id === rule.dst_network
      );
      if (net) dstNetworks.push(net.id);
    }

    // Firewall group references
    const srcGroupIds = rule.src_firewallgroup_ids || [];
    const dstGroupIds = rule.dst_firewallgroup_ids || [];

    for (const groupId of srcGroupIds) {
      srcNetworks.push(...resolveNetworkFromGroup(groupId));
    }
    for (const groupId of dstGroupIds) {
      dstNetworks.push(...resolveNetworkFromGroup(groupId));
    }

    // Check for RFC1918 or "all private" patterns
    const ruleStr = JSON.stringify(rule).toLowerCase();
    const isRfc1918 = ruleStr.includes('rfc1918') ||
      ruleStr.includes('10.0.0.0') ||
      ruleStr.includes('192.168.') ||
      ruleStr.includes('172.16.');

    if (isRfc1918 && srcNetworks.length === 0) {
      srcNetworks = networks.map(n => n.id);
    }
    if (isRfc1918 && dstNetworks.length === 0) {
      dstNetworks = networks.map(n => n.id);
    }

    // Apply rule to affected pairs
    for (const srcId of srcNetworks) {
      for (const dstId of dstNetworks) {
        if (srcId === dstId) continue;

        const key = getPairKey(srcId, dstId);
        const pair = pairRules.get(key);
        if (pair) {
          // Only apply if no explicit rule yet (first matching rule wins)
          if (pair.forwardAllowed === null) {
            pair.forwardAllowed = isAllow;
          }

          // Get source and destination network names for display
          const srcNet = networkMap.get(srcId);
          const dstNet = networkMap.get(dstId);

          pair.rules.push({
            name: rule.name || 'Unnamed Rule',
            action,
            enabled: rule.enabled ?? true,
            ruleset: rule.ruleset,
            ruleIndex: rule.rule_index,
            protocol: rule.protocol || 'all',
            srcNetwork: rule.src_network || srcNet?.name,
            dstNetwork: rule.dst_network || dstNet?.name,
            dstPort: rule.dst_port,
            unifiId: rule._id || rule.id,
          });

          ruleApplications.push({ srcId, dstId, rule });
        }
      }
    }
  }

  // Process V2 firewall policies (zone-based, UniFi Network 7.x+)
  // Only process policies that explicitly target networks (not IP/CLIENT/ANY without network_ids)
  const sortedPolicies = [...firewallpolicy]
    .filter(p => p.enabled && !p.predefined) // Only process user-defined, enabled policies
    .sort((a, b) => a.index - b.index); // Lower index = higher priority

  for (const policy of sortedPolicies) {
    const action = policy.action?.toLowerCase();
    const isAllow = action === 'allow';

    // Only process policies that explicitly specify networks
    // Skip policies targeting IP addresses, clients, or generic ANY (these don't affect network-to-network connectivity)
    const srcHasNetworks = policy.source.matching_target === 'NETWORK' && policy.source.network_ids?.length;
    const dstHasNetworks = policy.destination.matching_target === 'NETWORK' && policy.destination.network_ids?.length;

    // Skip if neither source nor destination specifies networks
    if (!srcHasNetworks && !dstHasNetworks) {
      continue;
    }

    // Get source networks
    let srcNetworkIds: string[] = [];
    if (srcHasNetworks) {
      srcNetworkIds = policy.source.network_ids!;
    } else if (policy.source.matching_target === 'ANY') {
      // ANY source with specific destination networks = all networks can reach those destinations
      srcNetworkIds = networks.map(n => n.id);
    }

    // Get destination networks
    let dstNetworkIds: string[] = [];
    if (dstHasNetworks) {
      dstNetworkIds = policy.destination.network_ids!;
    } else if (policy.destination.matching_target === 'ANY') {
      // ANY destination with specific source networks = those sources can reach all networks
      dstNetworkIds = networks.map(n => n.id);
    }

    // Skip if we couldn't determine networks
    if (srcNetworkIds.length === 0 || dstNetworkIds.length === 0) {
      continue;
    }

    // Apply policy to affected pairs
    for (const srcId of srcNetworkIds) {
      const srcNet = networkById.get(srcId);
      if (!srcNet) continue;

      for (const dstId of dstNetworkIds) {
        if (srcId === dstId) continue;

        const dstNet = networkById.get(dstId);
        if (!dstNet) continue;

        const key = getPairKey(srcId, dstId);
        const pair = pairRules.get(key);
        if (pair) {
          // V2 policies override - first matching policy wins
          if (pair.forwardAllowed === null) {
            pair.forwardAllowed = isAllow;
          }

          // Add the policy as a rule for display
          pair.rules.push({
            name: policy.name || 'Unnamed Policy',
            action: policy.action,
            enabled: policy.enabled,
            ruleset: 'Policy Engine',
            ruleIndex: policy.index,
            protocol: policy.protocol || 'all',
            srcNetwork: srcNet.name,
            dstNetwork: dstNet.name,
            dstPort: policy.destination.port_ranges?.join(', '),
            unifiId: policy._id,
          });
        }
      }
    }
  }

  // Build final connections list
  const connections: EnhancedConnection[] = [];
  const networkMappings = intentProfile?.networkMappings || {};

  // Helper to check if a network should be isolated based on intent
  const shouldBeIsolated = (srcNetId: string, dstNetId: string): { isolated: boolean; reason: string } => {
    if (!intentProfile) return { isolated: false, reason: '' };

    const iotNetId = networkMappings.iotNetworkId;
    const guestNetId = networkMappings.guestNetworkId;
    const workNetId = networkMappings.workNetworkId;

    // IOT isolation
    if (intentProfile.hasIoT && intentProfile.iotIsolation) {
      if (srcNetId === iotNetId && dstNetId !== iotNetId) {
        return { isolated: true, reason: 'IoT devices should be isolated' };
      }
      if (dstNetId === iotNetId && srcNetId !== iotNetId) {
        return { isolated: true, reason: 'IoT network should not be accessible' };
      }
    }

    // Guest isolation
    if (intentProfile.guestNetwork && intentProfile.guestIsolation) {
      if (srcNetId === guestNetId && dstNetId !== guestNetId) {
        return { isolated: true, reason: 'Guest network should be isolated' };
      }
      if (dstNetId === guestNetId && srcNetId !== guestNetId) {
        return { isolated: true, reason: 'Guest network should not be accessible' };
      }
    }

    // Work isolation from IoT/Guest
    if (intentProfile.workFromHome && intentProfile.workDeviceIsolation) {
      const workMode = intentProfile.workIsolationMode || 'phased';
      if (workMode === 'strict') {
        if (srcNetId === workNetId && dstNetId !== workNetId) {
          return { isolated: true, reason: 'Work strict mode blocks traffic from Work to non-Work networks' };
        }
        if (dstNetId === workNetId && srcNetId !== workNetId) {
          return { isolated: true, reason: 'Work strict mode blocks traffic from non-Work networks to Work' };
        }
      } else {
        if (srcNetId === workNetId && (dstNetId === iotNetId || dstNetId === guestNetId)) {
          return { isolated: true, reason: 'Work devices should be isolated from IoT/Guest' };
        }
        if (dstNetId === workNetId && (srcNetId === iotNetId || srcNetId === guestNetId)) {
          return { isolated: true, reason: 'Work network should not be accessible from IoT/Guest' };
        }
      }
    }

    // Inter-VLAN default deny
    if (intentProfile.interVlanDefault === 'deny') {
      return { isolated: true, reason: 'Inter-VLAN traffic should be denied by default' };
    }

    return { isolated: false, reason: '' };
  };

  for (const srcNet of networks) {
    for (const dstNet of networks) {
      if (srcNet.id === dstNet.id) continue;

      const forwardKey = getPairKey(srcNet.id, dstNet.id);
      const reverseKey = getPairKey(dstNet.id, srcNet.id);

      const forwardPair = pairRules.get(forwardKey);
      const reversePair = pairRules.get(reverseKey);

      // Check isolation status
      const blockedByIsolation = forwardPair?.blockedByIsolation || reversePair?.blockedByIsolation || false;

      // Default to allowed if no explicit rule (unless isolated)
      const forwardAllowedByRule = forwardPair?.forwardAllowed ?? true;
      const reverseAllowedByRule = reversePair?.forwardAllowed ?? true;
      const hasExplicitForwardRule = forwardPair?.forwardAllowed !== null;

      // Final allowed status considers both firewall rules and isolation
      const forwardAllowed = forwardAllowedByRule && !blockedByIsolation;
      const reverseAllowed = reverseAllowedByRule && !blockedByIsolation;

      // Determine block reason
      let blockReason: 'firewall' | 'isolation' | 'both' | undefined;
      if (!forwardAllowed) {
        const blockedByFirewall = !forwardAllowedByRule;
        if (blockedByFirewall && blockedByIsolation) {
          blockReason = 'both';
        } else if (blockedByIsolation) {
          blockReason = 'isolation';
        } else if (blockedByFirewall) {
          blockReason = 'firewall';
        }
      }

      // Check intent-based isolation
      const intentCheck = shouldBeIsolated(srcNet.id, dstNet.id);
      const violatesIntent = intentCheck.isolated && forwardAllowed;

      const directionalRules = [...(forwardPair?.rules || [])];

      // Get isolation source for display
      const isolationSource = forwardPair?.isolationSource || reversePair?.isolationSource;

      connections.push({
        srcId: srcNet.id,
        dstId: dstNet.id,
        srcName: srcNet.name,
        dstName: dstNet.name,
        allowed: forwardAllowed,
        bidirectional: forwardAllowed === reverseAllowed,
        rules: directionalRules,
        allowedByDefault: !hasExplicitForwardRule && !blockedByIsolation && forwardAllowed,
        violatesIntent,
        intentReason: violatesIntent ? intentCheck.reason : undefined,
        blockedByIsolation,
        blockReason,
        isolationSource,
      });
    }
  }

  return { connections, ruleApplications };
}

function buildWanConnections(
  networks: NetworkNode[],
  firewallrule: RawFirewallRule[]
): EnhancedConnection[] {
  const connections: EnhancedConnection[] = [];

  for (const net of networks) {
    const hasWanBlock = firewallrule.some(r =>
      r.enabled &&
      (r.action === 'drop' || r.action === 'reject') &&
      r.ruleset?.toLowerCase().includes('wan') &&
      (r.src_network === net.name || r.src_network === net.id)
    );

    connections.push({
      srcId: net.id,
      dstId: 'WAN',
      srcName: net.name,
      dstName: 'Internet',
      allowed: !hasWanBlock,
      bidirectional: false,
      rules: [],
      allowedByDefault: !hasWanBlock,
      violatesIntent: false,
      blockedByIsolation: false,
    });
  }

  return connections;
}

function buildExplicitRoutes(
  portforward: RawPortForward[],
  trafficrule: RawTrafficRule[],
  firewallrule: RawFirewallRule[],
  firewallpolicy: RawFirewallPolicy[],
  networks: NetworkNode[],
  clientMap: Map<string, { name: string; ip: string; mac: string }>,
  clients: RawClient[]
): ExplicitRoute[] {
  const routes: ExplicitRoute[] = [];

  // Build a MAC-to-client lookup for V2 policies
  const macToClient = new Map<string, RawClient>();
  const ipToClient = new Map<string, RawClient>();
  clients.forEach(c => {
    if (c.mac) macToClient.set(c.mac.toLowerCase(), c);
    if (c.ip) ipToClient.set(c.ip, c);
    if (c.fixed_ip) ipToClient.set(c.fixed_ip, c);
  });

  logger.debug(`Building explicit routes: ${portforward.length} port forwards, ${trafficrule.length} traffic rules, ${firewallrule.length} firewall rules, ${firewallpolicy.length} V2 policies`);
  logger.debug(`ClientMap has ${clientMap.size} entries, macToClient has ${macToClient.size} entries`);

  for (const pf of portforward) {
    const fwdIp = pf.fwd || '';
    const device = clientMap.get(fwdIp);

    // For port forwards, always create a destinationDevice so it shows in the diagram
    // Use client info if available, otherwise use the port forward name/IP
    const deviceName = device?.name || pf.name || fwdIp;
    const destinationDevice = fwdIp ? {
      name: deviceName,
      ip: fwdIp,
      mac: device?.mac || '',
    } : undefined;

    logger.debug(`Port forward: ${pf.name} -> ${fwdIp}, device found: ${!!device}, destinationDevice: ${JSON.stringify(destinationDevice)}`);

    routes.push({
      id: pf._id || pf.id || `pf-${routes.length}`,
      type: 'port_forward',
      name: pf.name || 'Unnamed Port Forward',
      source: 'WAN',
      destination: deviceName,
      destinationDevice,
      ports: `${pf.dst_port || ''} → ${pf.fwd_port || pf.dst_port || ''}`,
      protocol: (pf.proto || 'tcp').toUpperCase(),
      enabled: pf.enabled ?? true,
    });
  }

  // Traffic rules (allow rules)
  for (const tr of trafficrule) {
    if (tr.action !== 'ALLOW') continue;

    // Get target devices/networks
    const targetDevices = tr.target_devices || [];
    const networkIds = tr.network_ids || [];

    for (const target of targetDevices) {
      if (target.client_mac) {
        const device = clientMap.get(target.client_mac);
        routes.push({
          id: tr._id || `tr-${routes.length}`,
          type: 'traffic_rule',
          name: tr.name || tr.description || 'Traffic Allow Rule',
          source: networkIds.map(id => {
            const net = networks.find(n => n.id === id);
            return net?.name || id;
          }).join(', ') || 'Any',
          destination: device?.name || target.client_mac,
          destinationDevice: device ? { name: device.name, ip: device.ip, mac: device.mac } : undefined,
          enabled: tr.enabled ?? true,
        });
      }
    }

    // Network-to-network allow rules
    if (networkIds.length > 0 && targetDevices.length === 0) {
      routes.push({
        id: tr._id || `tr-${routes.length}`,
        type: 'traffic_rule',
        name: tr.name || tr.description || 'Traffic Allow Rule',
        source: 'Multiple Networks',
        destination: networkIds.map(id => {
          const net = networks.find(n => n.id === id);
          return net?.name || id;
        }).join(', '),
        enabled: tr.enabled ?? true,
      });
    }
  }

  // Firewall allow rules with specific destinations
  for (const rule of firewallrule) {
    if (!rule.enabled || rule.action !== 'accept') continue;

    // Only include rules with specific IP destinations
    if (rule.dst_address) {
      const device = clientMap.get(rule.dst_address);
      const srcNetwork = networks.find(n => n.name === rule.src_network || n.id === rule.src_network);

      routes.push({
        id: rule._id || rule.id || `fw-${routes.length}`,
        type: 'allow_rule',
        name: rule.name || 'Firewall Allow Rule',
        source: srcNetwork?.name || rule.src_network || 'Any',
        destination: device?.name || rule.dst_address,
        destinationDevice: device ? { name: device.name, ip: device.ip, mac: device.mac } : undefined,
        ports: rule.dst_port || undefined,
        protocol: rule.protocol?.toUpperCase() || undefined,
        enabled: true,
      });
    }
  }

  // V2 Firewall Policies - extract devices referenced by MAC or IP
  // Track devices we've already added to avoid duplicates
  const addedDevices = new Set<string>();

  for (const policy of firewallpolicy) {
    if (!policy.enabled) continue;

    // Helper to get network name from zone_id (zones often map to networks)
    const getZoneName = (zoneId: string | undefined): string => {
      if (!zoneId) return 'Any';
      const net = networks.find(n => n.id === zoneId);
      return net?.name || 'Zone';
    };

    // Extract devices from source.client_macs
    const srcMacs = (policy.source as any)?.client_macs || [];
    for (const mac of srcMacs) {
      const client = macToClient.get(mac.toLowerCase());
      if (client && !addedDevices.has(mac.toLowerCase())) {
        addedDevices.add(mac.toLowerCase());
        const deviceName = client.name || client.hostname || mac;
        const deviceIp = client.fixed_ip || client.ip || '';

        routes.push({
          id: `policy-src-${policy._id}-${mac}`,
          type: 'device_exception',
          name: policy.name || 'Policy Device',
          source: deviceName,
          destination: getZoneName(policy.destination?.zone_id),
          destinationDevice: {
            name: deviceName,
            ip: deviceIp,
            mac: client.mac || mac,
          },
          protocol: policy.protocol?.toUpperCase() || 'ALL',
          enabled: true,
        });
      }
    }

    // Extract devices from destination.client_macs
    const dstMacs = (policy.destination as any)?.client_macs || [];
    for (const mac of dstMacs) {
      const client = macToClient.get(mac.toLowerCase());
      if (client && !addedDevices.has(mac.toLowerCase())) {
        addedDevices.add(mac.toLowerCase());
        const deviceName = client.name || client.hostname || mac;
        const deviceIp = client.fixed_ip || client.ip || '';

        routes.push({
          id: `policy-dst-${policy._id}-${mac}`,
          type: 'device_exception',
          name: policy.name || 'Policy Device',
          source: getZoneName(policy.source?.zone_id),
          destination: deviceName,
          destinationDevice: {
            name: deviceName,
            ip: deviceIp,
            mac: client.mac || mac,
          },
          protocol: policy.protocol?.toUpperCase() || 'ALL',
          enabled: true,
        });
      }
    }

    // Extract devices from source.ips
    const srcIps = (policy.source as any)?.ips || [];
    for (const ip of srcIps) {
      const client = ipToClient.get(ip);
      if (client && !addedDevices.has(ip)) {
        addedDevices.add(ip);
        const deviceName = client.name || client.hostname || ip;

        routes.push({
          id: `policy-srcip-${policy._id}-${ip}`,
          type: 'device_exception',
          name: policy.name || 'Policy Device',
          source: deviceName,
          destination: getZoneName(policy.destination?.zone_id),
          destinationDevice: {
            name: deviceName,
            ip: client.fixed_ip || client.ip || ip,
            mac: client.mac || '',
          },
          protocol: policy.protocol?.toUpperCase() || 'ALL',
          enabled: true,
        });
      }
    }

    // Extract devices from destination.ips
    const dstIps = (policy.destination as any)?.ips || [];
    for (const ip of dstIps) {
      const client = ipToClient.get(ip);
      if (client && !addedDevices.has(ip)) {
        addedDevices.add(ip);
        const deviceName = client.name || client.hostname || ip;

        routes.push({
          id: `policy-dstip-${policy._id}-${ip}`,
          type: 'device_exception',
          name: policy.name || 'Policy Device',
          source: getZoneName(policy.source?.zone_id),
          destination: deviceName,
          destinationDevice: {
            name: deviceName,
            ip: client.fixed_ip || client.ip || ip,
            mac: client.mac || '',
          },
          protocol: policy.protocol?.toUpperCase() || 'ALL',
          enabled: true,
        });
      }
    }
  }

  logger.info(`Built ${routes.length} explicit routes (including ${addedDevices.size} devices from V2 policies)`);

  return routes;
}

function generateWarnings(
  networks: NetworkNode[],
  connections: EnhancedConnection[],
  _ruleApplications: RuleApplication[],
  _explicitRoutes: ExplicitRoute[]
): ConnectivityWarning[] {
  const warnings: ConnectivityWarning[] = [];

  // Check for networks with isolation enabled
  const isolatedNetworks = networks.filter(n => n.networkIsolation);
  if (isolatedNetworks.length > 0) {
    warnings.push({
      type: 'network_isolation_effective',
      severity: 'LOW',
      message: `${isolatedNetworks.length} network(s) have isolation enabled`,
      details: `Networks with network_isolation: ${isolatedNetworks.map(n => n.name).join(', ')}. These networks are automatically blocked from inter-VLAN communication.`,
    });
  }

  // Check for isolation mismatches (firewall blocks but isolation not enabled)
  for (const conn of connections) {
    if (!conn.allowed && !conn.blockedByIsolation && conn.rules.length > 0) {
      // Blocked by firewall but not by isolation - this is fine but worth noting
      const srcNet = networks.find(n => n.id === conn.srcId);
      const dstNet = networks.find(n => n.id === conn.dstId);

      if (srcNet && dstNet && !srcNet.networkIsolation && !dstNet.networkIsolation) {
        // Could enable isolation for more robust blocking
        // Only warn if there's a clear pattern
      }
    }
  }

  // Check for connections that are allowed but shouldn't be (intent violations)
  const intentViolations = connections.filter(c => c.violatesIntent);
  if (intentViolations.length > 0) {
    warnings.push({
      type: 'isolation_mismatch',
      severity: 'MEDIUM',
      message: `${intentViolations.length} connection(s) violate intended isolation`,
      details: intentViolations.map(c => `${c.srcName} ↔ ${c.dstName}: ${c.intentReason}`).join('; '),
    });
  }

  return warnings;
}

// Device category patterns for grouping
const deviceCategories: {
  category: string;
  label: string;
  icon: string;
  patterns: RegExp[];
  modelPatterns?: RegExp[];
}[] = [
  {
    category: 'cameras',
    label: 'Cameras',
    icon: 'Camera',
    patterns: [/camera/i, /cam\d/i, /nvr/i, /surveillance/i, /protect/i, /doorbell/i, /g[345]-/i, /uvc-/i],
    modelPatterns: [/^UVC/i, /^G[345]/i, /^AI/i],
  },
  {
    category: 'nas',
    label: 'NAS & Storage',
    icon: 'HardDrive',
    patterns: [/nas/i, /storage/i, /synology/i, /qnap/i, /truenas/i, /unraid/i, /freenas/i, /backup/i, /plex/i, /media.?server/i],
  },
  {
    category: 'smart_home',
    label: 'Smart Home',
    icon: 'Home',
    patterns: [/home.?assistant/i, /hass/i, /homekit/i, /smart/i, /hub/i, /alexa/i, /echo/i, /google.?home/i, /nest/i, /hue/i, /zigbee/i, /z-wave/i, /mqtt/i, /thermostat/i, /sensor/i],
  },
  {
    category: 'printers',
    label: 'Printers',
    icon: 'Printer',
    patterns: [/printer/i, /print/i, /epson/i, /canon/i, /hp.?laser/i, /brother/i, /xerox/i, /scanner/i],
  },
  {
    category: 'networking',
    label: 'Network Devices',
    icon: 'Wifi',
    patterns: [/router/i, /switch/i, /access.?point/i, /ap/i, /gateway/i, /firewall/i, /dream.?machine/i, /udm/i, /usg/i, /usw/i, /unifi/i],
    modelPatterns: [/^U[A-Z]{2}/i, /^UDM/i, /^USG/i, /^USW/i, /^UAP/i],
  },
  {
    category: 'servers',
    label: 'Servers',
    icon: 'Server',
    patterns: [/server/i, /docker/i, /proxmox/i, /esxi/i, /vm/i, /kubernetes/i, /k8s/i, /pi-?hole/i, /dns/i, /web/i, /api/i],
  },
  {
    category: 'entertainment',
    label: 'Entertainment',
    icon: 'Tv',
    patterns: [/tv/i, /television/i, /apple.?tv/i, /roku/i, /firestick/i, /chromecast/i, /xbox/i, /playstation/i, /ps[45]/i, /nintendo/i, /gaming/i, /sonos/i, /speaker/i, /receiver/i, /shield/i],
  },
  {
    category: 'computers',
    label: 'Computers',
    icon: 'Monitor',
    patterns: [/laptop/i, /desktop/i, /macbook/i, /imac/i, /workstation/i, /pc/i, /-pc$/i, /computer/i],
  },
  {
    category: 'mobile',
    label: 'Mobile Devices',
    icon: 'Smartphone',
    patterns: [/iphone/i, /ipad/i, /android/i, /phone/i, /tablet/i, /mobile/i],
  },
];

function categorizeDevice(name: string, model?: string): { category: string; label: string; icon: string } {
  for (const cat of deviceCategories) {
    // Check name patterns
    for (const pattern of cat.patterns) {
      if (pattern.test(name)) {
        return { category: cat.category, label: cat.label, icon: cat.icon };
      }
    }
    // Check model patterns if available
    if (model && cat.modelPatterns) {
      for (const pattern of cat.modelPatterns) {
        if (pattern.test(model)) {
          return { category: cat.category, label: cat.label, icon: cat.icon };
        }
      }
    }
  }

  return { category: 'other', label: 'Other Devices', icon: 'Box' };
}

function buildDeviceGroups(
  explicitRoutes: ExplicitRoute[],
  clients: RawClient[],
  networks: NetworkNode[],
  policies: RawFirewallPolicy[]
): DeviceGroup[] {
  // Create a network lookup map
  const networkMap = new Map(networks.map(n => [n.id, n]));

  // Track all devices by MAC for deduplication
  const devicesByMac = new Map<string, TopologyDevice>();

  // Count policies per device (by MAC)
  const policyCountByMac = new Map<string, number>();
  const policySourcesByMac = new Map<string, Set<string>>();

  for (const policy of policies) {
    if (!policy.enabled) continue;

    const srcMacs = (policy.source as any)?.client_macs || [];
    const dstMacs = (policy.destination as any)?.client_macs || [];

    for (const mac of [...srcMacs, ...dstMacs]) {
      const macLower = mac.toLowerCase();
      policyCountByMac.set(macLower, (policyCountByMac.get(macLower) || 0) + 1);

      // Track source networks for this device
      if (!policySourcesByMac.has(macLower)) {
        policySourcesByMac.set(macLower, new Set());
      }
      // If this device is in destination, the source networks can reach it
      if (dstMacs.includes(mac) && policy.source?.network_ids) {
        for (const netId of policy.source.network_ids) {
          const net = networkMap.get(netId);
          if (net) policySourcesByMac.get(macLower)!.add(net.name);
        }
      }
    }
  }

  // Process all clients and categorize them
  logger.info(`buildDeviceGroups: processing ${clients.length} clients`);
  if (clients.length > 0) {
    logger.debug(`First client sample: ${JSON.stringify(clients[0])}`);
  }

  for (const client of clients) {
    if (!client.mac) continue;

    const macLower = client.mac.toLowerCase();
    const name = client.name || client.hostname || client.mac;
    const ip = client.fixed_ip || client.ip || '';
    const networkId = client.network_id || '';
    const network = networkMap.get(networkId);
    const networkName = network?.name || 'Unknown';

    // Find routes for this device
    const deviceRoutes = explicitRoutes.filter(r =>
      r.destinationDevice?.mac?.toLowerCase() === macLower ||
      r.destinationDevice?.ip === ip
    );

    // Categorize the device
    const { category, label: categoryLabel } = categorizeDevice(name);

    // Check if device has cross-network policies (making it prominent)
    const policyCount = policyCountByMac.get(macLower) || 0;
    const sourceNetworks = policySourcesByMac.get(macLower) || new Set();
    // Device is prominent if it has policies from other networks
    const isProminent = policyCount > 0 && sourceNetworks.size > 0;

    const device: TopologyDevice = {
      id: macLower,
      name,
      ip,
      mac: client.mac,
      networkId,
      networkName,
      category,
      categoryLabel,
      routes: deviceRoutes,
      isProminent,
      policyCount,
    };

    devicesByMac.set(macLower, device);
  }

  // Group devices by network and category
  const groupMap = new Map<string, DeviceGroup>();

  for (const device of devicesByMac.values()) {
    const groupKey = `${device.networkId}:${device.category}`;

    if (!groupMap.has(groupKey)) {
      const { icon } = categorizeDevice(device.name);
      groupMap.set(groupKey, {
        id: groupKey,
        category: device.category,
        label: device.categoryLabel,
        networkId: device.networkId,
        networkName: device.networkName,
        devices: [],
        icon,
      });
    }

    groupMap.get(groupKey)!.devices.push(device);
  }

  // Sort devices within each group by prominence (prominent first), then by name
  for (const group of groupMap.values()) {
    group.devices.sort((a, b) => {
      if (a.isProminent !== b.isProminent) {
        return a.isProminent ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }

  // Convert to array and sort groups by device count (largest first)
  const groups = Array.from(groupMap.values());
  groups.sort((a, b) => b.devices.length - a.devices.length);

  logger.info(`Built ${groups.length} device groups with ${devicesByMac.size} total devices`);

  return groups;
}
