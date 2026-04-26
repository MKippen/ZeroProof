import {
  UniFiConfig,
  UniFiNetwork,
  UniFiFirewallRule,
  UniFiWlan,
  NetworkIntentProfile,
  IntentGap,
  IntentAnalysisResult,
  IntentSettingEvaluation,
  DeviceMapping,
} from '../types';
import { getRawNetworks, getRawWlans, getRawFirewallRules, getRawFirewallGroups, getRawSettings } from '../utils/configNormalizer';

// L3 ACL isolation data structure (switch-level inter-VLAN blocking)
interface L3AclIsolationData {
  source_network: string;
  destination_networks: string[];
}

/**
 * Dismissal info for intent gaps
 */
export interface IntentDismissalInfo {
  id: string;
  findingId: string; // Setting ID (e.g., "work_vlan", "iot_vlan")
  affectedResource: string | null;
  reason: string;
}

/**
 * Analyzes the UniFi configuration against the user's stated network intent.
 * Returns detailed evaluation of each setting and gaps between intent and reality.
 * @param configJson - The UniFi configuration to analyze
 * @param intent - The user's intent profile
 * @param dismissals - Optional array of active intent gap dismissals
 */
export function analyzeAgainstIntent(
  configJson: object,
  intent: NetworkIntentProfile,
  dismissals: IntentDismissalInfo[] = []
): IntentAnalysisResult {
  const config = configJson as UniFiConfig;
  const gaps: IntentGap[] = [];
  const settings: IntentSettingEvaluation[] = [];

  // Normalize networks - UniFi config may use different keys depending on version
  const rawNetworks = getRawNetworks(config);
  const networks: UniFiNetwork[] = rawNetworks.map((n: any) => ({
    _id: n._id || n.id || n.network_id,
    name: n.name || n.network_name || 'Unknown',
    purpose: n.purpose || n.network_purpose || 'corporate',
    vlan: n.vlan || n.vlan_id,
    vlan_enabled: n.vlan_enabled ?? (n.vlan ? true : false),
    subnet: n.subnet || n.ip_subnet,
    // Network isolation setting (blocks inter-VLAN communication)
    network_isolation: n.network_isolation_enabled || n.network_isolation || n.isolation || false,
  }));

  // Normalize firewall rules and groups
  const firewallRules: UniFiFirewallRule[] = getRawFirewallRules(config);
  const firewallGroups: any[] = getRawFirewallGroups(config);
  const wlans: UniFiWlan[] = getRawWlans(config);
  const mappings = intent.networkMappings || {};
  const deviceMappings = intent.deviceMappings || {};

  // Extract L3 ACL isolation data from settings (UniFi 8.1+)
  // L3 ACL provides switch-level inter-VLAN blocking that operates BEFORE traffic reaches the gateway
  const settingsArray = getRawSettings(config);
  let l3AclIsolation: L3AclIsolationData[] = [];

  for (const setting of settingsArray) {
    if (setting.acl_l3_isolation && Array.isArray(setting.acl_l3_isolation)) {
      l3AclIsolation = setting.acl_l3_isolation.map((entry: any) => ({
        source_network: entry.source_network,
        destination_networks: entry.destination_networks || [],
      }));
      break;
    }
  }

  // Build L3 ACL lookup map: source_network_id -> Set of blocked destination network IDs
  const l3AclBlocks = new Map<string, Set<string>>();
  for (const isolation of l3AclIsolation) {
    if (!l3AclBlocks.has(isolation.source_network)) {
      l3AclBlocks.set(isolation.source_network, new Set());
    }
    for (const dest of isolation.destination_networks) {
      l3AclBlocks.get(isolation.source_network)!.add(dest);
    }
  }


  // Helper to check if a firewall group contains a device's IP or MAC
  const hasFirewallGroupForDevice = (device: DeviceMapping | undefined): { found: boolean; groupName?: string } => {
    if (!device) return { found: false };

    for (const group of firewallGroups) {
      const members = group.group_members || group.groupMembers || [];
      for (const member of members) {
        const memberLower = String(member).toLowerCase();
        // Check IP match
        if (device.ip && memberLower === device.ip.toLowerCase()) {
          return { found: true, groupName: group.name };
        }
        // Check MAC match (with or without colons)
        if (device.mac) {
          const macLower = device.mac.toLowerCase();
          const macNoColons = macLower.replace(/:/g, '');
          if (memberLower === macLower || memberLower === macNoColons) {
            return { found: true, groupName: group.name };
          }
        }
      }
    }
    return { found: false };
  };

  // Helper to check if firewall rules target a specific device (by IP or MAC)
  const hasFirewallRulesForDevice = (device: DeviceMapping | undefined): boolean => {
    if (!device) return false;
    return firewallRules.some((rule: any) => {
      const ruleStr = JSON.stringify(rule).toLowerCase();
      // Check if rule references the device's IP or MAC
      if (device.ip && ruleStr.includes(device.ip.toLowerCase())) return true;
      if (device.mac && ruleStr.includes(device.mac.toLowerCase().replace(/:/g, ''))) return true;
      if (device.mac && ruleStr.includes(device.mac.toLowerCase())) return true;
      return false;
    });
  };

  // Helper to get device info for evaluation
  const getDeviceInfo = (device: DeviceMapping | undefined) => {
    if (!device) return undefined;
    return {
      mac: device.mac,
      ip: device.ip,
      name: device.name,
    };
  };

  // Helper to find network by ID or by name patterns
  const findNetwork = (networkId?: string, namePatterns?: string[]): UniFiNetwork | undefined => {
    if (networkId) {
      return networks.find((n) => n._id === networkId);
    }
    if (namePatterns) {
      return networks.find((n) =>
        namePatterns.some((pattern) => n.name?.toLowerCase().includes(pattern.toLowerCase()))
      );
    }
    return undefined;
  };

  // Helper to check if a network has proper VLAN isolation
  const isNetworkIsolated = (network?: UniFiNetwork): boolean => {
    return !!(network && network.vlan_enabled && network.vlan && network.vlan > 1);
  };

  // Helper to create network info for evaluation
  const getNetworkInfo = (network?: UniFiNetwork) => {
    if (!network) return undefined;
    return {
      id: network._id || '',
      name: network.name,
      vlan: network.vlan,
      hasVlan: isNetworkIsolated(network),
    };
  };

  // --- WORK SETTINGS ---
  if (intent.workFromHome) {
    if (intent.workDeviceIsolation) {
      const workNetwork = findNetwork(mappings.workNetworkId, ['work', 'office', 'business']);
      const isConfigured = isNetworkIsolated(workNetwork);

      settings.push({
        id: 'work_vlan',
        category: 'work',
        name: 'Work Network VLAN',
        description: 'Dedicated VLAN for work devices isolated from personal network',
        required: true,
        status: workNetwork
          ? (isConfigured ? 'configured' : 'partial')
          : 'not_configured',
        severity: 'HIGH',
        currentValue: workNetwork
          ? (isConfigured
              ? `${workNetwork.name} (VLAN ${workNetwork.vlan})`
              : `${workNetwork.name} - no VLAN isolation`)
          : 'Not mapped',
        expectedValue: 'Dedicated VLAN (e.g., VLAN 20)',
        mappedNetwork: getNetworkInfo(workNetwork),
        remediation: workNetwork
          ? 'Enable VLAN tagging on the Work network and assign a unique VLAN ID'
          : 'Create a dedicated Work network with VLAN isolation, or map an existing network',
      });

      if (!isConfigured) {
        gaps.push({
          intent: 'Work devices should be isolated from personal devices',
          reality: workNetwork ? 'Work network exists but lacks VLAN isolation' : 'No dedicated Work VLAN found',
          severity: 'HIGH',
          remediation: workNetwork
            ? 'Enable VLAN on your Work network in UniFi Settings > Networks'
            : 'Create a dedicated Work network with VLAN isolation',
        });
      }
    }

    // Work VPN setting (informational)
    settings.push({
      id: 'work_vpn',
      category: 'work',
      name: 'Work VPN',
      description: 'VPN connection to employer network',
      required: false,
      status: intent.workVpn ? 'configured' : 'not_applicable',
      severity: 'INFO',
      currentValue: intent.workVpn ? 'Enabled' : 'Not needed',
    });
  }

  // Home Server
  if (intent.homeServer) {
    const serverNetwork = findNetwork(mappings.serverNetworkId, ['server', 'dmz', 'services']);
    const isConfigured = isNetworkIsolated(serverNetwork);

    settings.push({
      id: 'server_vlan',
      category: 'work',
      name: 'Server/DMZ Network',
      description: 'Isolated network for home servers with external access',
      required: true,
      status: serverNetwork
        ? (isConfigured ? 'configured' : 'partial')
        : 'not_configured',
      severity: 'MEDIUM',
      currentValue: serverNetwork
        ? (isConfigured ? `VLAN ${serverNetwork.vlan}` : 'No VLAN isolation')
        : 'Not mapped',
      expectedValue: 'Dedicated VLAN for servers',
      mappedNetwork: getNetworkInfo(serverNetwork),
      remediation: 'Create a dedicated Server/DMZ network to isolate externally-accessible services',
    });
  }

  // --- IOT SETTINGS ---
  if (intent.hasIoT) {
    const iotNetwork = findNetwork(mappings.iotNetworkId, ['iot', 'smart', 'devices', 'things']);
    const isIotIsolated = isNetworkIsolated(iotNetwork);

    // Check if IoT network has L3 ACL isolation from trusted networks
    const iotNetworkId = iotNetwork?._id || '';
    const iotL3AclBlocks = l3AclBlocks.get(iotNetworkId);
    const hasIotL3AclIsolation = iotL3AclBlocks && iotL3AclBlocks.size > 0;

    if (intent.iotIsolation) {
      let currentValueIot: string;
      if (!iotNetwork) {
        currentValueIot = 'Not mapped';
      } else if (isIotIsolated && hasIotL3AclIsolation) {
        currentValueIot = `VLAN ${iotNetwork.vlan} + L3 ACL (blocks ${iotL3AclBlocks!.size} network(s))`;
      } else if (isIotIsolated) {
        currentValueIot = `VLAN ${iotNetwork.vlan}`;
      } else {
        currentValueIot = 'No VLAN isolation';
      }

      settings.push({
        id: 'iot_vlan',
        category: 'devices',
        name: 'IoT Network VLAN',
        description: 'Dedicated isolated VLAN for smart home devices',
        required: true,
        status: iotNetwork
          ? (isIotIsolated ? 'configured' : 'partial')
          : 'not_configured',
        severity: 'HIGH',
        currentValue: currentValueIot,
        expectedValue: 'Dedicated VLAN (e.g., VLAN 30)',
        mappedNetwork: getNetworkInfo(iotNetwork),
        remediation: iotNetwork
          ? 'Enable VLAN tagging on the IoT network'
          : 'Create a dedicated IoT network with VLAN isolation',
      });

      if (!isIotIsolated) {
        gaps.push({
          intent: 'IoT devices should be isolated from the main network',
          reality: iotNetwork ? 'IoT network exists but lacks VLAN isolation' : 'No dedicated IoT VLAN found',
          severity: 'HIGH',
          remediation: 'Create or configure an IoT network with VLAN isolation, then add L3 ACL rules to block access to trusted networks',
        });
      }
    }

    // IoT Internet Access
    if (intent.iotInternetAccess !== 'full') {
      const hasIotFirewallRule = firewallRules.some(
        (rule) =>
          rule.enabled &&
          (rule.action === 'drop' || rule.action === 'reject') &&
          (rule.name?.toLowerCase().includes('iot') || rule.src_address?.includes('iot'))
      );

      const expectedAccess = intent.iotInternetAccess === 'none' ? 'No internet access' : 'Limited internet access';

      settings.push({
        id: 'iot_internet',
        category: 'devices',
        name: 'IoT Internet Access',
        description: `Control IoT device internet access (${expectedAccess})`,
        required: true,
        status: hasIotFirewallRule ? 'configured' : 'not_configured',
        severity: intent.iotInternetAccess === 'none' ? 'MEDIUM' : 'LOW',
        currentValue: hasIotFirewallRule ? 'Firewall rules configured' : 'No restrictions',
        expectedValue: expectedAccess,
        remediation: `Create firewall rules to ${intent.iotInternetAccess === 'none' ? 'block' : 'limit'} IoT network internet access`,
      });

      if (!hasIotFirewallRule) {
        gaps.push({
          intent: `IoT devices should have ${expectedAccess.toLowerCase()}`,
          reality: 'No firewall rules restricting IoT internet access',
          severity: 'MEDIUM',
          remediation: 'Create firewall rules in UniFi to control IoT network WAN access',
        });
      }
    }
  }

  // --- NAS SETTINGS ---
  if (intent.hasNAS) {
    const nasDevice = deviceMappings.nasDevice;
    const nasNetwork = findNetwork(mappings.nasNetworkId, ['nas', 'storage', 'media']);

    if (intent.nasAccessibleFrom !== 'all') {
      // If no NAS device is mapped, we can't verify rules properly
      if (!nasDevice) {
        settings.push({
          id: 'nas_access',
          category: 'devices',
          name: 'NAS Access Control',
          description: `Restrict NAS access to ${intent.nasAccessibleFrom === 'trusted' ? 'trusted networks' : 'specific VLANs'}`,
          required: true,
          status: 'not_configured',
          severity: 'MEDIUM',
          currentValue: 'No NAS device selected',
          expectedValue: `Access from ${intent.nasAccessibleFrom} only`,
          mappedNetwork: getNetworkInfo(nasNetwork),
          requiresDeviceMapping: true,
          remediation: 'Select your NAS device to verify firewall rules are protecting it',
        });

        gaps.push({
          intent: `NAS should only be accessible from ${intent.nasAccessibleFrom === 'trusted' ? 'trusted networks' : 'specific VLANs'}`,
          reality: 'No NAS device selected - cannot verify firewall rules',
          severity: 'MEDIUM',
          remediation: 'Select your NAS device in the Intent Analysis, then create firewall rules targeting its IP',
        });
      } else {
        // NAS device is mapped, check for firewall rules or groups targeting it
        // Check: 1) Firewall group containing device IP/MAC, 2) Rules referencing device, 3) Rule names
        const firewallGroupResult = hasFirewallGroupForDevice(nasDevice);
        const hasDirectRules = hasFirewallRulesForDevice(nasDevice);
        const nasKeywords = ['nas', 'storage', 'synology', 'qnap', 'truenas', 'unraid', 'freenas'];
        const hasNamedRules = firewallRules.some(
          (rule: any) => {
            const ruleName = rule.name?.toLowerCase() || '';
            return nasKeywords.some(keyword => ruleName.includes(keyword));
          }
        );

        const hasNasFirewallConfig = firewallGroupResult.found || hasDirectRules || hasNamedRules;
        const deviceLabel = nasDevice.name || nasDevice.ip || nasDevice.mac;

        // Build current value description
        let currentValue: string;
        if (firewallGroupResult.found) {
          currentValue = `In firewall group "${firewallGroupResult.groupName}"`;
        } else if (hasDirectRules) {
          currentValue = `Rules protect ${deviceLabel}`;
        } else if (hasNamedRules) {
          currentValue = `NAS-related rules found`;
        } else {
          currentValue = `No firewall config for ${deviceLabel}`;
        }

        settings.push({
          id: 'nas_access',
          category: 'devices',
          name: 'NAS Access Control',
          description: `Restrict NAS access to ${intent.nasAccessibleFrom === 'trusted' ? 'trusted networks' : 'specific VLANs'}`,
          required: true,
          status: hasNasFirewallConfig ? 'configured' : 'not_configured',
          severity: 'MEDIUM',
          currentValue,
          expectedValue: `Access from ${intent.nasAccessibleFrom} only`,
          mappedNetwork: getNetworkInfo(nasNetwork),
          mappedDevice: getDeviceInfo(nasDevice),
          requiresDeviceMapping: true,
          remediation: hasNasFirewallConfig
            ? undefined
            : `Create firewall rules to control which networks can access ${deviceLabel} (${nasDevice.ip || nasDevice.mac})`,
        });

        if (!hasNasFirewallConfig) {
          gaps.push({
            intent: `NAS (${deviceLabel}) should only be accessible from ${intent.nasAccessibleFrom === 'trusted' ? 'trusted networks' : 'specific VLANs'}`,
            reality: `No firewall configuration found for ${deviceLabel}`,
            severity: 'MEDIUM',
            remediation: `Create firewall rules in UniFi targeting IP ${nasDevice.ip || 'N/A'} to restrict access`,
          });
        }
      }
    }
  }

  // --- GUEST SETTINGS ---
  if (intent.guestNetwork) {
    const guestNetwork = findNetwork(mappings.guestNetworkId, ['guest', 'visitor']);
    const guestWlan = wlans.find(
      (w) => w.is_guest || w.name?.toLowerCase().includes('guest')
    );
    const hasGuest = guestNetwork || guestWlan;
    const isGuestIsolated = isNetworkIsolated(guestNetwork);

    settings.push({
      id: 'guest_network',
      category: 'guest',
      name: 'Guest WiFi Network',
      description: 'Dedicated WiFi network for visitors',
      required: true,
      status: hasGuest ? 'configured' : 'not_configured',
      severity: 'MEDIUM',
      currentValue: hasGuest
        ? (guestWlan ? `SSID: ${guestWlan.name}` : guestNetwork?.name)
        : 'Not configured',
      expectedValue: 'Guest WiFi with separate SSID',
      mappedNetwork: getNetworkInfo(guestNetwork),
      remediation: 'Create a guest WiFi network in UniFi',
    });

    if (!hasGuest) {
      gaps.push({
        intent: 'A guest WiFi network should be available',
        reality: 'No guest network or WiFi found',
        severity: 'MEDIUM',
        remediation: 'Create a dedicated guest network with its own SSID',
      });
    }

    if (intent.guestIsolation) {
      settings.push({
        id: 'guest_isolation',
        category: 'guest',
        name: 'Guest Network Isolation',
        description: 'Guests cannot access your internal devices',
        required: true,
        status: hasGuest
          ? (isGuestIsolated ? 'configured' : 'partial')
          : 'not_configured',
        severity: 'HIGH',
        currentValue: isGuestIsolated
          ? `VLAN ${guestNetwork?.vlan}`
          : (hasGuest ? 'No VLAN isolation' : 'Not configured'),
        expectedValue: 'VLAN isolated with firewall rules',
        mappedNetwork: getNetworkInfo(guestNetwork),
        remediation: 'Enable VLAN isolation and create firewall rules blocking guest to internal access',
      });

      // Check for guest block firewall rule OR network isolation setting
      const hasGuestBlockRule = firewallRules.some(
        (rule) =>
          rule.enabled &&
          (rule.action === 'drop' || rule.action === 'reject') &&
          rule.name?.toLowerCase().includes('guest')
      );

      // Check if guest network has "Isolate Network" enabled (blocks inter-VLAN traffic)
      // This can be set on the network config OR on the WLAN config
      const networkHasIsolation = !!guestNetwork?.network_isolation;

      // Check if network purpose is 'guest' (UniFi treats these as isolated by default)
      const networkIsGuestPurpose = guestNetwork?.purpose === 'guest';

      // Also check the WLAN for isolation settings (UniFi may set this on WLAN instead)
      // is_guest means the WLAN uses captive portal / guest isolation
      const wlanHasIsolation = guestWlan && (
        (guestWlan as any).network_isolation ||
        (guestWlan as any).network_isolation_enabled ||
        (guestWlan as any).isolation ||
        (guestWlan as any).is_guest
      );

      // Also check the raw network data for isolation settings
      // (in case the normalized data missed some field variations)
      const rawGuestNetwork = rawNetworks.find(
        (n: any) => (n._id || n.id || n.network_id) === guestNetwork?._id
      );
      const rawNetworkHasIsolation = rawGuestNetwork && (
        rawGuestNetwork.network_isolation_enabled ||
        rawGuestNetwork.network_isolation ||
        rawGuestNetwork.isolation
      );

      // Check L3 ACL isolation - guest network blocked from trusted networks at switch level
      const guestNetworkId = guestNetwork?._id || '';
      const guestL3AclBlocks = l3AclBlocks.get(guestNetworkId);
      const hasGuestL3AclIsolation = guestL3AclBlocks && guestL3AclBlocks.size > 0;

      const guestHasNetworkIsolation =
        networkHasIsolation ||
        networkIsGuestPurpose ||
        !!wlanHasIsolation ||
        !!rawNetworkHasIsolation ||
        !!hasGuestL3AclIsolation;

      // Either explicit firewall rules OR network isolation OR L3 ACL achieves the same goal
      const hasGuestIsolation = hasGuestBlockRule || guestHasNetworkIsolation;

      // Build current value description
      let guestFirewallCurrentValue: string;
      if (hasGuestL3AclIsolation) {
        guestFirewallCurrentValue = `L3 ACL isolation (blocks ${guestL3AclBlocks!.size} network(s))`;
      } else if (hasGuestBlockRule && guestHasNetworkIsolation) {
        guestFirewallCurrentValue = 'Firewall rules + Network isolation enabled';
      } else if (networkHasIsolation || rawNetworkHasIsolation) {
        guestFirewallCurrentValue = 'Network isolation enabled';
      } else if (networkIsGuestPurpose) {
        guestFirewallCurrentValue = 'Guest network (isolated by default)';
      } else if (wlanHasIsolation) {
        guestFirewallCurrentValue = 'Guest WiFi isolation enabled';
      } else if (hasGuestBlockRule) {
        guestFirewallCurrentValue = 'Firewall rules configured';
      } else {
        guestFirewallCurrentValue = 'No blocking rules or isolation';
      }

      settings.push({
        id: 'guest_firewall',
        category: 'guest',
        name: 'Guest Firewall Rules',
        description: 'Block guest network from accessing internal resources',
        required: true,
        status: hasGuestIsolation ? 'configured' : 'not_configured',
        severity: 'HIGH',
        currentValue: guestFirewallCurrentValue,
        expectedValue: 'Block guest to internal VLANs',
        remediation: 'Configure L3 ACL isolation (Settings > Security > ACL), enable "Isolate Network", or create firewall rule: Block Guest VLAN → All Internal VLANs',
      });

      if (!isGuestIsolated || !hasGuestIsolation) {
        gaps.push({
          intent: 'Guest network should be completely isolated from internal devices',
          reality: !isGuestIsolated && !hasGuestIsolation
            ? 'Guest network lacks VLAN isolation and firewall rules'
            : (!isGuestIsolated ? 'Guest network lacks VLAN isolation' : 'No firewall rules or network isolation'),
          severity: 'HIGH',
          remediation: 'Enable VLAN on guest network and enable "Isolate Network" or create firewall rules to block internal access',
        });
      }
    }

    if (intent.guestBandwidthLimit) {
      // Check for bandwidth limiting on guest network
      const guestHasBandwidthLimit = guestWlan && (guestWlan as any).usergroup_id;

      settings.push({
        id: 'guest_bandwidth',
        category: 'guest',
        name: 'Guest Bandwidth Limits',
        description: 'Limit bandwidth for guest users',
        required: false,
        status: guestHasBandwidthLimit ? 'configured' : 'not_configured',
        severity: 'LOW',
        currentValue: guestHasBandwidthLimit ? 'Limits configured' : 'No limits',
        expectedValue: 'Bandwidth limiting enabled',
        remediation: 'Configure bandwidth limits in UniFi WiFi settings or create a user group with limits',
      });
    }
  }

  // --- SECURITY SETTINGS ---

  // Inter-VLAN default policy
  if (intent.interVlanDefault === 'deny') {
    // Check for a global inter-VLAN deny rule
    const hasDefaultDeny = firewallRules.some(
      (rule) =>
        rule.enabled &&
        (rule.action === 'drop' || rule.action === 'reject') &&
        (rule.name?.toLowerCase().includes('block') || rule.name?.toLowerCase().includes('deny')) &&
        (rule.name?.toLowerCase().includes('inter-vlan') ||
          rule.name?.toLowerCase().includes('intervlan') ||
          rule.name?.toLowerCase().includes('all vlan'))
    );

    // Get non-WAN networks for VLAN pair analysis
    const lanNetworks = networks.filter(
      (n) => n.purpose !== 'wan' && !n.name?.toLowerCase().includes('internet')
    );

    // Helper to check if there's a block rule between two networks (firewall rule OR L3 ACL)
    const hasBlockRule = (srcNetworkId: string, dstNetworkId: string): boolean => {
      // First check L3 ACL (switch-level blocking) - this is more efficient than firewall
      const srcL3Blocks = l3AclBlocks.get(srcNetworkId);
      if (srcL3Blocks?.has(dstNetworkId)) {
        return true;
      }

      // Then check firewall rules
      return firewallRules.some((rule: any) => {
        if (!rule.enabled) return false;
        if (rule.action !== 'drop' && rule.action !== 'reject') return false;

        // Check if rule applies to this source/destination pair
        const srcMatches =
          rule.src_network_id === srcNetworkId ||
          (rule.src_firewallgroup_ids || []).some((gid: string) => {
            const group = firewallGroups.find((g: any) => g._id === gid || g.id === gid);
            return group?.group_members?.includes(srcNetworkId);
          });

        const dstMatches =
          rule.dst_network_id === dstNetworkId ||
          (rule.dst_firewallgroup_ids || []).some((gid: string) => {
            const group = firewallGroups.find((g: any) => g._id === gid || g.id === gid);
            return group?.group_members?.includes(dstNetworkId);
          });

        return srcMatches && dstMatches;
      });
    };

    // Find VLAN pairs that can communicate (no block rule and no L3 ACL)
    const openPairs: string[] = [];
    for (let i = 0; i < lanNetworks.length; i++) {
      for (let j = i + 1; j < lanNetworks.length; j++) {
        const srcNet = lanNetworks[i];
        const dstNet = lanNetworks[j];
        const srcId = srcNet._id || '';
        const dstId = dstNet._id || '';

        // Check both directions (firewall rules and L3 ACL)
        const blockedAtoB = hasBlockRule(srcId, dstId);
        const blockedBtoA = hasBlockRule(dstId, srcId);

        if (!blockedAtoB || !blockedBtoA) {
          openPairs.push(`${srcNet.name} ↔ ${dstNet.name}`);
        }
      }
    }

    // Build current value string
    const hasL3AclConfig = l3AclIsolation.length > 0;
    let currentValue: string;
    if (hasDefaultDeny) {
      currentValue = 'Default deny rule configured';
    } else if (openPairs.length === 0 && hasL3AclConfig) {
      currentValue = 'All VLAN pairs blocked (L3 ACL + firewall rules)';
    } else if (openPairs.length === 0) {
      currentValue = 'All VLAN pairs have block rules';
    } else if (openPairs.length <= 5) {
      currentValue = `Open pairs: ${openPairs.join(', ')}`;
    } else {
      currentValue = `${openPairs.length} VLAN pairs can communicate: ${openPairs.slice(0, 3).join(', ')}...`;
    }

    const isConfigured = hasDefaultDeny || openPairs.length === 0;

    settings.push({
      id: 'intervlan_deny',
      category: 'security',
      name: 'Inter-VLAN Default Deny',
      description: 'Block all VLAN-to-VLAN traffic by default',
      required: true,
      status: isConfigured ? 'configured' : 'not_configured',
      severity: 'HIGH',
      currentValue,
      expectedValue: 'Block all inter-VLAN traffic by default',
      remediation:
        openPairs.length > 0
          ? `Create firewall rules to block: ${openPairs.slice(0, 5).join(', ')}${openPairs.length > 5 ? ` (and ${openPairs.length - 5} more)` : ''}`
          : 'Create a low-priority firewall rule blocking all inter-VLAN traffic, then add specific allow rules',
    });

    if (!isConfigured) {
      gaps.push({
        intent: 'VLANs should not be able to communicate by default',
        reality:
          openPairs.length > 0
            ? `${openPairs.length} VLAN pair(s) can communicate: ${openPairs.slice(0, 3).join(', ')}${openPairs.length > 3 ? '...' : ''}`
            : 'No default deny inter-VLAN firewall rule found',
        severity: 'HIGH',
        remediation: 'Create firewall rule: Block All RFC1918 → All RFC1918 (place at bottom of rules)',
      });
    }
  }

  // DNS Filtering - check per-network (only specified networks if provided)
  if (intent.dnsFiltering) {
    // Known filtering DNS servers (common public filtering DNS)
    const knownFilteringDns = [
      '1.1.1.3', '1.0.0.3', // Cloudflare for Families
      '9.9.9.9', '149.112.112.112', // Quad9
      '208.67.222.123', '208.67.220.123', // OpenDNS Family Shield
      '185.228.168.168', '185.228.169.168', // CleanBrowsing
    ];

    // User-specified DNS filtering server IP (e.g., AdGuard at 192.168.2.250)
    const userDnsServerIp = intent.dnsFilteringServerIp?.trim();

    // Get the networks to check (user-specified or all non-WAN networks)
    const specifiedNetworkIds = intent.dnsFilteringNetworks || [];
    const hasSpecifiedNetworks = specifiedNetworkIds.length > 0;

    // Check each network for custom DNS
    // IMPORTANT: Use rawNetworks here since the normalized 'networks' array doesn't include DHCP/DNS fields
    const networkDnsStatus: { id: string; name: string; dns: string | null; hasFiltering: boolean; vlan?: number; shouldHaveFiltering: boolean; matchesUserDns: boolean }[] = [];
    let detectedDnsServer: string | null = userDnsServerIp || null;

    for (const rawN of rawNetworks) {
      const networkId = rawN._id || rawN.id || rawN.network_id || '';
      const networkName = rawN.name || rawN.network_name || 'Unknown';
      const purpose = rawN.purpose || rawN.network_purpose || 'corporate';
      const vlan = rawN.vlan || rawN.vlan_id;

      // Skip WAN/Internet networks
      if (purpose === 'wan' || networkName.toLowerCase().includes('internet')) {
        continue;
      }

      // Determine if this network should have filtering (based on user selection)
      const shouldHaveFiltering = hasSpecifiedNetworks
        ? specifiedNetworkIds.includes(networkId)
        : true; // If no specific networks selected, check all

      const dns1 = rawN.dhcpd_dns_1;
      const hasDhcp = rawN.dhcpd_enabled !== false;

      if (hasDhcp && dns1 && dns1.trim() !== '') {
        // Has custom DNS configured
        const isKnownFiltering = knownFilteringDns.includes(dns1);
        const isLocalDns = dns1.startsWith('192.168.') || dns1.startsWith('10.') || dns1.startsWith('172.');

        // Check if DNS matches user-specified filtering server
        const matchesUserDns = userDnsServerIp ? dns1 === userDnsServerIp : false;

        // Consider it filtering DNS if:
        // 1. It matches the user-specified filtering server IP, OR
        // 2. It's a known public filtering DNS, OR
        // 3. It's a local IP (likely AdGuard/Pi-hole) when no user IP is specified
        const hasFiltering = matchesUserDns || isKnownFiltering || (!userDnsServerIp && isLocalDns);

        networkDnsStatus.push({
          id: networkId,
          name: networkName,
          dns: dns1,
          hasFiltering,
          vlan,
          shouldHaveFiltering,
          matchesUserDns,
        });

        if (!detectedDnsServer && (isKnownFiltering || isLocalDns)) {
          detectedDnsServer = dns1;
        }
      } else if (hasDhcp) {
        // No custom DNS, using router/default
        networkDnsStatus.push({
          id: networkId,
          name: networkName,
          dns: null,
          hasFiltering: false,
          vlan,
          shouldHaveFiltering,
          matchesUserDns: false,
        });
      }
    }

    // Filter to only networks that should have filtering
    const networksToCheck = networkDnsStatus.filter(n => n.shouldHaveFiltering);
    const networksWithFiltering = networksToCheck.filter(n => n.hasFiltering);
    const networksMissingFiltering = networksToCheck.filter(n => !n.hasFiltering);

    // Also track networks not selected but have filtering (for informational purposes)
    const otherNetworksWithFiltering = networkDnsStatus.filter(n => !n.shouldHaveFiltering && n.hasFiltering);

    // Build current value description
    let currentValue: string;

    // Count networks using the user-specified DNS server
    const networksUsingUserDns = networksToCheck.filter(n => n.matchesUserDns);

    if (userDnsServerIp) {
      // User specified their DNS filtering server IP
      if (networksUsingUserDns.length === networksToCheck.length && networksToCheck.length > 0) {
        currentValue = `All networks using ${userDnsServerIp}`;
      } else if (networksUsingUserDns.length === 0) {
        // Show what DNS each network is using
        const dnsDetails = networksToCheck.map(n => `${n.name}: ${n.dns || 'default'}`).join(', ');
        currentValue = `No networks using ${userDnsServerIp}. Current: ${dnsDetails}`;
      } else {
        const usingNames = networksUsingUserDns.map(n => n.name).join(', ');
        const notUsingNames = networksMissingFiltering.map(n => `${n.name} (${n.dns || 'default'})`).join(', ');
        currentValue = `Using ${userDnsServerIp}: ${usingNames} | Not using: ${notUsingNames}`;
      }
    } else if (hasSpecifiedNetworks) {
      // User specified which networks should have filtering (but no specific server IP)
      if (networksMissingFiltering.length === 0 && networksWithFiltering.length > 0) {
        currentValue = `All selected: ${networksWithFiltering.map(n => n.name).join(', ')}`;
      } else if (networksWithFiltering.length === 0) {
        currentValue = `Missing: ${networksMissingFiltering.map(n => n.name).join(', ')}`;
      } else {
        const withNames = networksWithFiltering.map(n => n.name).join(', ');
        const missingNames = networksMissingFiltering.map(n => n.name).join(', ');
        currentValue = `Enabled: ${withNames} | Missing: ${missingNames}`;
      }
      // Add info about other networks if any
      if (otherNetworksWithFiltering.length > 0) {
        currentValue += ` | Also enabled: ${otherNetworksWithFiltering.map(n => n.name).join(', ')}`;
      }
    } else {
      // No specific networks selected, show all status
      if (networksWithFiltering.length === 0) {
        currentValue = 'No networks using filtering DNS';
      } else if (networksMissingFiltering.length === 0) {
        currentValue = `All networks using ${detectedDnsServer || 'custom DNS'}`;
      } else {
        const withNames = networksWithFiltering.map(n => n.name).join(', ');
        const missingNames = networksMissingFiltering.map(n => n.name).join(', ');
        currentValue = `Enabled: ${withNames} | Default DNS: ${missingNames}`;
      }
    }

    // Determine status based on networks that SHOULD have filtering
    let status: 'configured' | 'partial' | 'not_configured';
    if (networksToCheck.length === 0) {
      // No networks specified to check
      status = 'not_configured';
    } else if (networksMissingFiltering.length === 0) {
      status = 'configured';
    } else if (networksWithFiltering.length > 0) {
      status = 'partial';
    } else {
      status = 'not_configured';
    }

    // Build expected value description
    let expectedDesc: string;
    if (userDnsServerIp) {
      expectedDesc = `Networks should use DNS server ${userDnsServerIp}`;
    } else if (hasSpecifiedNetworks) {
      expectedDesc = `Selected networks: ${specifiedNetworkIds.length > 3 ? specifiedNetworkIds.length + ' networks' : networksToCheck.map(n => n.name).join(', ')}`;
    } else {
      expectedDesc = 'Filtering DNS (AdGuard, Pi-hole, NextDNS)';
    }

    // Build remediation message
    let remediation: string | undefined;
    if (networksMissingFiltering.length > 0) {
      const networkNames = networksMissingFiltering.map(n => n.name).join(', ');
      if (userDnsServerIp) {
        remediation = `Set DNS server to ${userDnsServerIp} for: ${networkNames}`;
      } else {
        remediation = `Configure DNS filtering for: ${networkNames}`;
      }
    }

    settings.push({
      id: 'dns_filtering',
      category: 'security',
      name: 'DNS Filtering',
      description: userDnsServerIp
        ? `Networks should use DNS filtering server at ${userDnsServerIp}`
        : (hasSpecifiedNetworks
          ? `Block ads and trackers via custom DNS (${networksToCheck.length} selected networks)`
          : 'Block ads and trackers via custom DNS (per-network)'),
      required: hasSpecifiedNetworks || !!userDnsServerIp, // Required if user specified networks or DNS server
      status,
      severity: 'LOW',
      currentValue,
      expectedValue: expectedDesc,
      remediation,
    });

    if (status === 'not_configured' || (hasSpecifiedNetworks && networksMissingFiltering.length > 0) || (userDnsServerIp && networksUsingUserDns.length < networksToCheck.length)) {
      const networkNames = networksMissingFiltering.map(n => n.name).join(', ');
      gaps.push({
        intent: userDnsServerIp
          ? `Networks should use DNS filtering server at ${userDnsServerIp}`
          : (hasSpecifiedNetworks
            ? `DNS filtering should be enabled on: ${networksToCheck.map(n => n.name).join(', ')}`
            : 'DNS filtering should be enabled on networks'),
        reality: networksMissingFiltering.length > 0
          ? `Missing DNS filtering on: ${networkNames}`
          : 'No networks have custom DNS configured',
        severity: 'LOW',
        remediation: userDnsServerIp
          ? `In UniFi Network settings, set the DHCP Name Server for each network to ${userDnsServerIp}`
          : 'Set up AdGuard Home, Pi-hole, or NextDNS and configure the selected networks to use it',
      });
    }
  }

  // Malware blocking
  if (intent.malwareBlocking) {
    settings.push({
      id: 'malware_blocking',
      category: 'security',
      name: 'Malware Blocking',
      description: 'Block known malicious websites and threats',
      required: true,
      status: 'partial', // Can't fully detect from config
      severity: 'MEDIUM',
      currentValue: 'Requires manual verification',
      expectedValue: 'Threat management or DNS blocking enabled',
      remediation: 'Enable UniFi Threat Management or use a security-focused DNS like Quad9 or Cloudflare for Families',
    });
  }

  // WLAN Security (for maximum security)
  if (intent.securityLevel === 'maximum') {
    const weakWlans = wlans.filter(
      (w) =>
        w.enabled &&
        !w.is_guest && // Skip guest networks - they use captive portal authentication
        (w.security === 'open' ||
          w.security === 'wep' ||
          (w.security === 'wpapsk' && w.wpa_mode === 'wpa1'))
    );

    settings.push({
      id: 'wlan_security',
      category: 'security',
      name: 'WiFi Encryption',
      description: 'All WiFi networks use WPA2 or WPA3',
      required: true,
      status: weakWlans.length === 0 ? 'configured' : 'not_configured',
      severity: 'CRITICAL',
      currentValue: weakWlans.length === 0
        ? 'All networks use strong encryption'
        : `${weakWlans.length} network(s) with weak encryption`,
      expectedValue: 'WPA2 or WPA3 on all networks',
      remediation: 'Upgrade all WiFi networks to WPA2-AES or WPA3',
    });

    if (weakWlans.length > 0) {
      gaps.push({
        intent: 'Maximum security requires strong WiFi encryption',
        reality: `${weakWlans.length} WiFi network(s) with weak or no encryption: ${weakWlans.map(w => w.name).join(', ')}`,
        severity: 'CRITICAL',
        remediation: 'Change security mode to WPA2 or WPA3 in UniFi WiFi settings',
      });
    }

    // Network segmentation check
    const vlanNetworks = networks.filter((n) => n.vlan_enabled && n.vlan && n.vlan > 1);

    settings.push({
      id: 'network_segmentation',
      category: 'security',
      name: 'Network Segmentation',
      description: 'Multiple VLANs for proper network isolation',
      required: true,
      status: vlanNetworks.length >= 3 ? 'configured' : (vlanNetworks.length >= 1 ? 'partial' : 'not_configured'),
      severity: 'HIGH',
      currentValue: `${vlanNetworks.length} VLAN(s) configured`,
      expectedValue: 'At least 3 VLANs (Trusted, IoT, Guest)',
      remediation: 'Create separate VLANs for different device categories',
    });

    if (vlanNetworks.length < 3) {
      gaps.push({
        intent: 'Maximum security requires proper network segmentation',
        reality: `Only ${vlanNetworks.length} VLAN(s) configured`,
        severity: 'HIGH',
        remediation: 'Create at least: Main/Trusted VLAN, IoT VLAN, Guest VLAN',
      });
    }
  }

  // Trusted Network (always recommended)
  const trustedNetwork = findNetwork(mappings.trustedNetworkId, ['main', 'trusted', 'home', 'lan']);
  settings.push({
    id: 'trusted_network',
    category: 'security',
    name: 'Trusted Network',
    description: 'Primary network for trusted personal devices',
    required: false,
    status: trustedNetwork ? 'configured' : 'partial',
    severity: 'INFO',
    currentValue: trustedNetwork ? trustedNetwork.name : 'Using default LAN',
    expectedValue: 'Identified trusted network',
    mappedNetwork: getNetworkInfo(trustedNetwork),
  });

  // Build dismissal lookup map: settingId -> dismissal
  const dismissalMap = new Map<string, IntentDismissalInfo>();
  for (const d of dismissals) {
    // For intent gaps, we use the setting ID as the findingId
    dismissalMap.set(d.findingId, d);
  }

  // Apply dismissals to settings
  for (const setting of settings) {
    const dismissal = dismissalMap.get(setting.id);
    if (dismissal) {
      setting.isDismissed = true;
      setting.dismissalId = dismissal.id;
      setting.dismissalReason = dismissal.reason;
    }
  }

  // Apply dismissals to gaps and add settingId for linking
  // Note: We need to track which gap corresponds to which setting
  // This is done by pattern matching common gaps to settings
  const settingIdForGap = (gap: IntentGap): string | undefined => {
    const intent = gap.intent.toLowerCase();
    if (intent.includes('work') && intent.includes('isolat')) return 'work_vlan';
    if (intent.includes('iot') && intent.includes('isolat')) return 'iot_vlan';
    if (intent.includes('iot') && intent.includes('internet')) return 'iot_internet';
    if (intent.includes('nas') && intent.includes('access')) return 'nas_access';
    if (intent.includes('guest') && intent.includes('wifi')) return 'guest_network';
    if (intent.includes('guest') && intent.includes('isolat')) return 'guest_isolation';
    if (intent.includes('vlan') && intent.includes('default')) return 'intervlan_deny';
    if (intent.includes('dns') && intent.includes('filter')) return 'dns_filtering';
    if (intent.includes('wifi') && intent.includes('encrypt')) return 'wlan_security';
    if (intent.includes('network') && intent.includes('segment')) return 'network_segmentation';
    return undefined;
  };

  for (const gap of gaps) {
    const settingId = settingIdForGap(gap);
    if (settingId) {
      gap.settingId = settingId;
      const dismissal = dismissalMap.get(settingId);
      if (dismissal) {
        gap.isDismissed = true;
        gap.dismissalId = dismissal.id;
        gap.dismissalReason = dismissal.reason;
      }
    }
  }

  // Count dismissed items
  const dismissedSettings = settings.filter((s) => s.isDismissed).length;

  // Calculate summary and score (exclude dismissed items from counts)
  const activeSettings = settings.filter((s) => !s.isDismissed);
  const summary = {
    total: settings.length,
    configured: activeSettings.filter((s) => s.status === 'configured').length,
    notConfigured: activeSettings.filter((s) => s.status === 'not_configured').length,
    partial: activeSettings.filter((s) => s.status === 'partial').length,
    notApplicable: activeSettings.filter((s) => s.status === 'not_applicable').length,
    dismissed: dismissedSettings,
  };

  // Calculate score based on required settings (exclude dismissed)
  const requiredSettings = activeSettings.filter((s) => s.required);
  const configuredRequired = requiredSettings.filter((s) => s.status === 'configured').length;
  const partialRequired = requiredSettings.filter((s) => s.status === 'partial').length;
  const score = requiredSettings.length > 0
    ? Math.round(((configuredRequired + partialRequired * 0.5) / requiredSettings.length) * 100)
    : 100;

  // For compliance, only check non-dismissed gaps
  const activeGaps = gaps.filter((g) => !g.isDismissed);

  // Build configRequirements: surface unmapped required settings as action items
  const configRequirements: import('../types').ConfigRequirement[] = [];
  const unmappedRequired = activeSettings.filter(
    (s) => s.required && s.status === 'not_configured' && !s.mappedNetwork && !s.mappedDevice
  );
  for (const setting of unmappedRequired) {
    configRequirements.push({
      id: `mapping_${setting.id}`,
      type: setting.requiresDeviceMapping ? 'device_mapping' : 'network_mapping',
      message: `"${setting.name}" requires a network mapping to evaluate`,
      severity: setting.severity === 'CRITICAL' ? 'HIGH' : setting.severity === 'HIGH' ? 'HIGH' : 'MEDIUM',
      action: 'Map network',
      actionPath: '/intent',
    });
  }

  return {
    compliant: activeGaps.length === 0,
    score,
    gaps,
    settings,
    summary,
    configRequirements: configRequirements.length > 0 ? configRequirements : undefined,
  };
}
