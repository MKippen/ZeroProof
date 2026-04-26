/**
 * Security Rule System
 *
 * Embedded security rules with source attribution.
 * Rules are grouped by source to give proper credit to open source projects.
 */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

// Rule source for attribution
export interface RuleSource {
  id: string;
  name: string;
  description: string;
  url?: string;
  license?: string;
}

// Pre-defined rule sources
export const RULE_SOURCES: Record<string, RuleSource> = {
  internal: {
    id: 'internal',
    name: 'ZeroProof',
    description: 'Built-in security checks',
  },
  'industry-standards': {
    id: 'industry-standards',
    name: 'Industry Standards',
    description: 'Security checks based on NIST, CIS Benchmarks, and network security best practices',
    url: 'https://www.cisecurity.org/benchmark',
    license: 'Original implementation based on public security guidelines',
  },
};

// Security rule definition
export interface SecurityRule {
  id: string;
  sourceId: string;
  category: RuleCategory;
  name: string;
  description: string;
  severity: Severity;
  impact: string;
  remediation: string;
  // The check function - returns true if the issue is found
  check: (config: UniFiConfigData) => RuleCheckResult[];
}

// Categories of security rules
export type RuleCategory =
  | 'firewall'
  | 'vlan'
  | 'dns'
  | 'port'
  | 'upnp'
  | 'wireless'
  | 'general'
  | 'ids_ips'
  | 'access_control'
  | 'switch'
  | 'vpn'
  | 'version'
  | 'optimization';

// Result from a rule check
export interface RuleCheckResult {
  found: boolean;
  affectedResource?: string;
  details?: string;
  currentValue?: string;
  expectedValue?: string;
}

// L3 ACL Isolation entry (switch-level inter-VLAN blocking)
export interface L3AclIsolationData {
  source_network: string;
  destination_networks: string[];
}

// Custom ACL Rule (Settings > Security > ACL Rules)
export interface AclRuleData {
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

// VPN server configuration
export interface VpnServerData {
  _id: string;
  name: string;
  enabled: boolean;
  protocol: string;
  port: number;
  encryption?: string;
  auth_type?: string;
  network_id?: string;
  subnet?: string;
  logging_enabled?: boolean;
}

// Firewall zone definition (UniFi Network 10.x+)
export interface FirewallZoneData {
  _id: string;
  name: string;
  zone_type: string;
  networks?: string[];
}

// Simplified UniFi config data for rule checks
export interface UniFiConfigData {
  networks: NetworkData[];
  firewallRules: FirewallRuleData[];
  firewallGroups: FirewallGroupData[];
  firewallPolicies: FirewallPolicyData[];
  trafficRules: TrafficRuleData[];
  wlans: WlanData[];
  portForwards: PortForwardData[];
  clients: ClientData[];
  devices: DeviceData[];
  settings: SettingsData;
  radiusProfiles: RadiusProfileData[];
  aclRules: AclRuleData[];
  l3AclIsolation: L3AclIsolationData[];
  deviceIsolationNetworks: string[];
  vpnServers: VpnServerData[];
  firewallZones: FirewallZoneData[];
}

export interface NetworkData {
  _id: string;
  name: string;
  purpose: string;
  vlan?: number;
  vlan_enabled?: boolean;
  subnet?: string;
  dhcpd_enabled?: boolean;
  dhcpd_dns_1?: string;
  dhcpd_dns_2?: string;
  network_isolation?: boolean;
  internet_access_enabled?: boolean;
}

export interface FirewallRuleData {
  _id: string;
  name: string;
  enabled: boolean;
  ruleset: string;
  rule_index: number;
  action: 'accept' | 'drop' | 'reject';
  protocol: string;
  protocol_match_excepted?: boolean;
  src_firewallgroup_ids?: string[];
  dst_firewallgroup_ids?: string[];
  src_address?: string;
  dst_address?: string;
  src_network_id?: string;
  dst_network_id?: string;
  src_port?: string;
  dst_port?: string;
  predefined?: boolean;
}

export interface FirewallGroupData {
  _id: string;
  name: string;
  group_type: string;
  group_members?: string[];
  network_ids?: string[];
}

export interface WlanData {
  _id: string;
  name: string;
  enabled: boolean;
  security: string;
  is_guest?: boolean;
  networkconf_id?: string;
  vlan?: number;
  hide_ssid?: boolean;
  wpa_mode?: string;
  pmf_mode?: string;
  // Additional security-relevant fields
  wpa3_support?: boolean;
  wpa3_transition?: boolean;
  fast_roaming_enabled?: boolean;  // 802.11r
  ap_isolation?: boolean;          // Client isolation
  l2_isolation?: boolean;          // Layer 2 isolation
  minrate_ng_enabled?: boolean;
  minrate_ng_data_rate_kbps?: number;
  radius_profile_id?: string;
  mac_filter_enabled?: boolean;
  mac_filter_policy?: 'allow' | 'deny';
  minimum_rssi?: number;
  minimum_rssi_enabled?: boolean;
  bss_transition?: boolean;        // 802.11v
  uapsd_enabled?: boolean;
  dtim_mode?: string;
  group_rekey?: number;
  // Optimization fields
  optimize_iot?: boolean;          // IoT WiFi optimization
  band_steering_mode?: string;     // 'off' | 'prefer_5g' | 'balanced'
  channel_width_2g?: number;       // 20, 40
  channel_width_5g?: number;       // 40, 80, 160
  channel_width_6g?: number;       // 80, 160, 320
  multicast_enhance?: boolean;     // Multicast enhancement (IGMPv3)
  proxy_arp?: boolean;             // Proxy ARP
  dtim_ng?: number;                // DTIM interval 2.4GHz
  dtim_na?: number;                // DTIM interval 5GHz
}

export interface PortForwardData {
  _id: string;
  name: string;
  enabled: boolean;
  dst_port: string;
  fwd: string;
  fwd_port: string;
  proto: string;
}

export interface ClientData {
  mac: string;
  ip?: string;
  name?: string;
  hostname?: string;
  network_id?: string;
  oui?: string;
  is_wired?: boolean;
  fingerprint?: string;
}

export interface DeviceData {
  mac: string;
  name?: string;
  model?: string;
  type: string;
  ip?: string;
  network_id?: string;
}

export interface SettingsData {
  upnp_enabled?: boolean;
  upnp_nat_pmp_enabled?: boolean;
  mgmt_network_id?: string;
  // Default security posture
  default_security_posture?: 'ALLOW_ALL' | 'BLOCK_ALL';
  // Security settings
  ssh_enabled?: boolean;
  ssh_password_auth_enabled?: boolean;
  remote_access_enabled?: boolean;
  discoverable?: boolean;
  // IDS/IPS settings
  ips_enabled?: boolean;
  ips_mode?: 'disabled' | 'ids' | 'ips';
  ips_sensitivity?: 'low' | 'medium' | 'high' | 'max';
  honeypot_enabled?: boolean;
  // DNS settings
  doh_enabled?: boolean;
  dns_filtering_enabled?: boolean;
  // Switch settings
  dhcp_guarding_enabled?: boolean;
  stp_enabled?: boolean;
  igmp_snooping_enabled?: boolean;
  storm_control_enabled?: boolean;
  // mDNS settings
  mdns_enabled?: boolean;
  mdns_mode?: 'all' | 'auto' | 'custom' | 'disabled';
}

// Zone-based firewall policy (UniFi Network 10.x+)
export interface FirewallPolicyData {
  _id: string;
  name: string;
  enabled: boolean;
  action: 'ALLOW' | 'BLOCK' | 'REJECT';
  predefined: boolean;
  index: number;
  protocol: string;
  description?: string;
  logging?: boolean;
  source: {
    zone_id: string;
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
    network_ids?: string[];
    ip_addresses?: string[];
    client_macs?: string[];
  };
  destination: {
    zone_id: string;
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
    network_ids?: string[];
    ip_addresses?: string[];
    port_ranges?: string[];
  };
  // State matching
  state_new?: boolean;
  state_established?: boolean;
  state_related?: boolean;
  state_invalid?: boolean;
}

// Traffic rules (application-aware)
export interface TrafficRuleData {
  _id: string;
  name?: string;
  description?: string;
  enabled: boolean;
  action: 'BLOCK' | 'ALLOW';
  matching_target: string;
  target_devices?: { type: string; client_mac?: string; network_id?: string }[];
  network_ids?: string[];
  ip_addresses?: string[];
  app_category_ids?: string[];
  schedule?: any;
}

// RADIUS profile for 802.1X
export interface RadiusProfileData {
  _id: string;
  name: string;
  enabled: boolean;
  auth_server_ip?: string;
  auth_server_port?: number;
  acct_enabled?: boolean;
  use_tls?: boolean;
}

// Rule evaluation result (for reporting)
export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  ruleDescription: string;
  sourceId: string;
  sourceName: string;
  category: RuleCategory;
  severity: Severity;
  passed: boolean;
  findings: RuleFinding[];
}

export interface RuleFinding {
  title: string;
  description: string;
  impact: string;
  remediation: string;
  affectedResource?: string;
  details?: string;
  currentValue?: string;
  expectedValue?: string;
  // Dismissal fields
  isDismissed?: boolean;
  dismissalId?: string;
  dismissalReason?: string;
}

// Aggregate analysis result
export interface SecurityAnalysisResult {
  analyzedAt: string;
  duration: number;
  summary: {
    totalRules: number;
    passed: number;
    failed: number;
    dismissed?: number;
    bySeverity: Record<Severity, number>;
    bySource: Record<string, number>;
    byCategory: Record<RuleCategory, number>;
  };
  results: RuleEvaluationResult[];
}
