/**
 * Security Rule Engine
 *
 * Runs YAML-based security rules against UniFi configuration.
 * Rules are loaded from disk via the rule loader for attribution and updates.
 */

import {
  UniFiConfigData,
  RuleEvaluationResult,
  SecurityAnalysisResult,
  RULE_SOURCES,
  Severity,
  RuleCategory,
  NetworkData,
  FirewallRuleData,
  FirewallGroupData,
  FirewallPolicyData,
  TrafficRuleData,
  WlanData,
  PortForwardData,
  ClientData,
  DeviceData,
  SettingsData,
  RadiusProfileData,
  AclRuleData,
  L3AclIsolationData,
  VpnServerData,
  FirewallZoneData,
} from './types';
import { VulnerabilityFinding } from '../types';
import optimizationRules from './rules/optimization';
import logger from '../utils/logger';
import { ruleLoader } from '../services/ruleLoader';
import { executeAllRules } from '../services/ruleLoader/ruleEngine';
import { SecurityRuleDefinition } from '../services/ruleLoader/types';

// Optimization rules (separate from security)
const allOptimizationRules = [...optimizationRules];

/**
 * Get all registered rules
 */
export function getAllRules(): SecurityRuleDefinition[] {
  return ruleLoader.getSecurityRules();
}

/**
 * Get rules by source
 */
export function getRulesBySource(sourceId: string): SecurityRuleDefinition[] {
  return ruleLoader.getSecurityRulesBySource(sourceId);
}

/**
 * Get rules by category
 */
export function getRulesByCategory(category: RuleCategory): SecurityRuleDefinition[] {
  return ruleLoader.getSecurityRulesByCategory(category);
}

/**
 * Normalize raw UniFi config to our standard format
 */
export function normalizeConfig(rawConfig: any): UniFiConfigData {
  // Networks - handle different field names: networks, networkConf, networkconf
  const rawNetworks = rawConfig.networks || rawConfig.networkConf || rawConfig.networkconf || [];
  const networks: NetworkData[] = rawNetworks.map((n: any) => ({
    _id: n._id || n.id || n.network_id || '',
    name: n.name || n.network_name || 'Unknown',
    purpose: n.purpose || n.network_purpose || 'corporate',
    vlan: n.vlan || n.vlan_id,
    vlan_enabled: n.vlan_enabled ?? (n.vlan ? true : false),
    subnet: n.subnet || n.ip_subnet,
    dhcpd_enabled: n.dhcpd_enabled,
    dhcpd_dns_1: n.dhcpd_dns_1,
    dhcpd_dns_2: n.dhcpd_dns_2,
    network_isolation: n.network_isolation_enabled || n.network_isolation || n.isolation,
    internet_access_enabled: n.internet_access_enabled ?? true,
  }));

  // Firewall rules
  const rawFirewallRules = rawConfig.firewallRules || rawConfig.firewall_rule || [];
  const firewallRules: FirewallRuleData[] = rawFirewallRules.map((r: any) => ({
    _id: r._id || r.id || '',
    name: r.name || 'Unnamed Rule',
    enabled: r.enabled ?? true,
    ruleset: r.ruleset || 'LAN_IN',
    rule_index: r.rule_index || 0,
    action: r.action || 'drop',
    protocol: r.protocol || 'all',
    protocol_match_excepted: r.protocol_match_excepted,
    src_firewallgroup_ids: r.src_firewallgroup_ids,
    dst_firewallgroup_ids: r.dst_firewallgroup_ids,
    src_address: r.src_address,
    dst_address: r.dst_address,
    src_network_id: r.src_network_id,
    dst_network_id: r.dst_network_id,
    src_port: r.src_port,
    dst_port: r.dst_port,
    predefined: r.predefined,
  }));

  // Firewall groups
  const rawFirewallGroups = rawConfig.firewallGroups || rawConfig.firewall_group || [];
  const firewallGroups: FirewallGroupData[] = rawFirewallGroups.map((g: any) => ({
    _id: g._id || g.id || '',
    name: g.name || 'Unknown',
    group_type: g.group_type || 'address-group',
    group_members: g.group_members,
    network_ids: g.network_ids,
  }));

  // WLANs - handle different field names: wlans, wlanConf, wlanconf
  const rawWlans = rawConfig.wlans || rawConfig.wlanConf || rawConfig.wlanconf || [];
  const wlans: WlanData[] = rawWlans.map((w: any) => ({
    _id: w._id || w.id || '',
    name: w.name || 'Unknown',
    enabled: w.enabled ?? true,
    security: w.security || 'open',
    is_guest: w.is_guest,
    networkconf_id: w.networkconf_id,
    vlan: w.vlan,
    hide_ssid: w.hide_ssid,
    wpa_mode: w.wpa_mode,
    pmf_mode: w.pmf_mode,
    // Extended security fields
    wpa3_support: w.wpa3_support,
    wpa3_transition: w.wpa3_transition,
    fast_roaming_enabled: w.fast_roaming_enabled ?? w.ft_enabled,
    ap_isolation: w.ap_isolation ?? w.client_isolation,
    l2_isolation: w.l2_isolation,
    radius_profile_id: w.radius_profile_id ?? w.radiusprofile_id,
    mac_filter_enabled: w.mac_filter_enabled,
    mac_filter_policy: w.mac_filter_policy,
    minimum_rssi: w.minimum_rssi ?? w.minrssi,
    minimum_rssi_enabled: w.minimum_rssi_enabled ?? w.minrssi_enabled,
    bss_transition: w.bss_transition,
    group_rekey: w.group_rekey,
    // Optimization fields
    optimize_iot: w.optimize_iot ?? w.enhanced_iot ?? w.iot_optimize,
    band_steering_mode: w.band_steering_mode ?? w.bandsteering_mode,
    channel_width_2g: w.channel_width_2g ?? w.wlan_band_2g_channel_width,
    channel_width_5g: w.channel_width_5g ?? w.wlan_band_5g_channel_width,
    channel_width_6g: w.channel_width_6g ?? w.wlan_band_6g_channel_width,
    multicast_enhance: w.multicast_enhance ?? w.mcastenhance,
    proxy_arp: w.proxy_arp,
    dtim_ng: w.dtim_ng ?? w.dtim_mode_ng,
    dtim_na: w.dtim_na ?? w.dtim_mode_na,
  }));

  // Firewall policies (zone-based, UniFi Network 10.x+)
  const rawPolicies = rawConfig.firewallPolicies || rawConfig.firewall_policies || [];
  const firewallPolicies: FirewallPolicyData[] = rawPolicies.map((p: any) => ({
    _id: p._id || p.id || '',
    name: p.name || 'Unnamed Policy',
    enabled: p.enabled ?? true,
    action: p.action || 'BLOCK',
    predefined: p.predefined ?? false,
    index: p.index ?? 0,
    protocol: p.protocol || 'all',
    description: p.description,
    logging: p.logging,
    source: {
      zone_id: p.source?.zone_id || '',
      matching_target: p.source?.matching_target || 'ANY',
      network_ids: p.source?.network_ids,
      ip_addresses: p.source?.ip_addresses,
      client_macs: p.source?.client_macs,
    },
    destination: {
      zone_id: p.destination?.zone_id || '',
      matching_target: p.destination?.matching_target || 'ANY',
      network_ids: p.destination?.network_ids,
      ip_addresses: p.destination?.ip_addresses,
      port_ranges: p.destination?.port_ranges,
    },
    state_new: p.state_new,
    state_established: p.state_established,
    state_related: p.state_related,
    state_invalid: p.state_invalid,
  }));

  // Traffic rules (application-aware)
  const rawTrafficRules = rawConfig.trafficRules || rawConfig.traffic_rules || [];
  const trafficRules: TrafficRuleData[] = rawTrafficRules.map((t: any) => ({
    _id: t._id || t.id || '',
    name: t.name,
    description: t.description,
    enabled: t.enabled ?? true,
    action: t.action || 'BLOCK',
    matching_target: t.matching_target || '',
    target_devices: t.target_devices,
    network_ids: t.network_ids,
    ip_addresses: t.ip_addresses,
    app_category_ids: t.app_category_ids,
    schedule: t.schedule,
  }));

  // RADIUS profiles
  const rawRadiusProfiles = rawConfig.radiusProfiles || rawConfig.radius_profiles || [];
  const radiusProfiles: RadiusProfileData[] = rawRadiusProfiles.map((r: any) => ({
    _id: r._id || r.id || '',
    name: r.name || 'Default',
    enabled: r.enabled ?? true,
    auth_server_ip: r.auth_server_ip ?? r.auth_ip,
    auth_server_port: r.auth_server_port ?? r.auth_port,
    acct_enabled: r.acct_enabled,
    use_tls: r.use_tls ?? r.radsec_enabled,
  }));

  // Port forwards - handle different field names: portForwards, portForward, portforward
  const rawPortForwards = rawConfig.portForwards || rawConfig.portForward || rawConfig.portforward || [];
  const portForwards: PortForwardData[] = rawPortForwards.map((p: any) => ({
    _id: p._id || p.id || '',
    name: p.name || 'Unnamed',
    enabled: p.enabled ?? true,
    dst_port: p.dst_port || '',
    fwd: p.fwd || '',
    fwd_port: p.fwd_port || '',
    proto: p.proto || 'tcp',
  }));

  // Clients
  const rawClients = rawConfig.clients || rawConfig.user || rawConfig.sta || [];
  const clients: ClientData[] = rawClients.map((c: any) => ({
    mac: c.mac || c._id || '',
    ip: c.ip || c.last_ip || c.fixed_ip,
    name: c.name || c.hostname || c.display_name,
    hostname: c.hostname,
    network_id: c.network_id || c.usergroup_id,
    oui: c.oui,
    is_wired: c.is_wired ?? (c.connection_type === 'wired'),
    fingerprint: c.fingerprint,
  }));

  // Devices
  const rawDevices = rawConfig.devices || rawConfig.device || [];
  const devices: DeviceData[] = rawDevices.map((d: any) => ({
    mac: d.mac || d._id || '',
    name: d.name,
    model: d.model,
    type: d.type || 'unknown',
    ip: d.ip,
    network_id: d.network_id,
  }));

  // Settings
  const rawSettings = rawConfig.settings || rawConfig.setting || {};
  const settingsArray = Array.isArray(rawSettings) ? rawSettings : [rawSettings];
  const mgmtSettings = settingsArray.find((s: any) => s.key === 'mgmt') || {};

  // Find security/IPS settings if available - prefer 'ips' over 'dpi'
  const ipsSettings = settingsArray.find((s: any) => s.key === 'ips') ||
                      settingsArray.find((s: any) => s.key === 'dpi') || {};

  // Find network/global settings for default_security_posture
  const networkSettings = settingsArray.find((s: any) => s.default_security_posture) || {};

  // Extract L3 ACL isolation from settings (UniFi 8.1+)
  // These are switch-level ACL rules that block before traffic reaches the firewall
  let l3AclIsolation: L3AclIsolationData[] = [];
  let deviceIsolationNetworks: string[] = [];

  for (const setting of settingsArray) {
    if (setting.acl_l3_isolation && Array.isArray(setting.acl_l3_isolation)) {
      l3AclIsolation = setting.acl_l3_isolation.map((entry: any) => ({
        source_network: entry.source_network,
        destination_networks: entry.destination_networks || [],
      }));
    }
    if (setting.acl_device_isolation && Array.isArray(setting.acl_device_isolation)) {
      deviceIsolationNetworks = setting.acl_device_isolation;
    }
  }

  // Custom ACL rules (Settings > Security > ACL Rules)
  const rawAclRules = rawConfig.aclRules || rawConfig.aclrule || [];
  const aclRules: AclRuleData[] = rawAclRules.map((r: any) => ({
    _id: r._id || r.id || '',
    name: r.name || 'Unnamed ACL Rule',
    type: r.type || 'IPV4',
    action: r.action || 'BLOCK',
    enabled: r.enabled ?? true,
    acl_index: r.acl_index ?? 0,
    traffic_source: r.traffic_source,
    traffic_destination: r.traffic_destination,
  }));

  // VPN servers
  const rawVpnServers = rawConfig.vpnServers || rawConfig.vpn_servers || [];
  const vpnServers: VpnServerData[] = rawVpnServers.map((v: any) => ({
    _id: v._id || v.id || '',
    name: v.name || 'Unnamed VPN',
    enabled: v.enabled ?? true,
    protocol: v.protocol || 'unknown',
    port: v.port || 0,
    encryption: v.encryption,
    auth_type: v.auth_type,
    network_id: v.network_id,
    subnet: v.subnet,
    logging_enabled: v.logging_enabled,
  }));

  // Firewall zones (UniFi Network 10.x+)
  const rawFirewallZones = rawConfig.firewallZones || rawConfig.firewall_zones || [];
  const firewallZones: FirewallZoneData[] = rawFirewallZones.map((z: any) => ({
    _id: z._id || z.id || '',
    name: z.name || 'Unknown Zone',
    zone_type: z.zone_type || z.type || 'unknown',
    networks: z.networks,
  }));

  if (l3AclIsolation.length > 0 || deviceIsolationNetworks.length > 0 || aclRules.length > 0) {
    logger.info(`ACL data found: ${l3AclIsolation.length} L3 isolation entries, ${deviceIsolationNetworks.length} networks with device isolation, ${aclRules.length} custom ACL rules`);
  }

  const settings: SettingsData = {
    upnp_enabled: rawConfig.upnp_enabled ?? mgmtSettings.upnp_enabled,
    upnp_nat_pmp_enabled: rawConfig.upnp_nat_pmp_enabled ?? mgmtSettings.upnp_nat_pmp_enabled,
    mgmt_network_id: mgmtSettings.mgmt_network_id,
    // Default security posture
    default_security_posture: networkSettings.default_security_posture,
    // Security settings
    ssh_enabled: mgmtSettings.ssh_enabled ?? rawConfig.ssh_enabled,
    ssh_password_auth_enabled: mgmtSettings.ssh_password_auth_enabled,
    remote_access_enabled: mgmtSettings.remote_access_enabled ?? rawConfig.cloud_enabled,
    discoverable: mgmtSettings.discoverable,
    // IDS/IPS - derive ips_enabled from ips_mode if not explicitly set
    ips_mode: ipsSettings.ips_mode ?? rawConfig.ips_mode,
    ips_enabled: ipsSettings.ips_enabled ?? rawConfig.ips_enabled ??
      (ipsSettings.ips_mode === 'ids' || ipsSettings.ips_mode === 'ips'),
    ips_sensitivity: ipsSettings.ips_sensitivity ?? rawConfig.threat_management_sensitivity,
    honeypot_enabled: ipsSettings.honeypot_enabled ?? rawConfig.honeypot_enabled,
    // DNS
    doh_enabled: rawConfig.doh_enabled,
    dns_filtering_enabled: rawConfig.dns_filtering_enabled,
    // Switch/infrastructure
    dhcp_guarding_enabled: rawConfig.dhcp_guarding_enabled,
    stp_enabled: rawConfig.stp_enabled,
    igmp_snooping_enabled: rawConfig.igmp_snooping_enabled,
    storm_control_enabled: rawConfig.storm_control_enabled,
    // mDNS
    mdns_enabled: rawConfig.mdns_enabled,
    mdns_mode: rawConfig.mdns_mode,
  };

  return {
    networks,
    firewallRules,
    firewallGroups,
    firewallPolicies,
    trafficRules,
    wlans,
    portForwards,
    clients,
    devices,
    settings,
    radiusProfiles,
    aclRules,
    l3AclIsolation,
    deviceIsolationNetworks,
    vpnServers,
    firewallZones,
  };
}

/**
 * Dismissal info for applying to findings
 */
export interface DismissalInfo {
  id: string;
  findingId: string;
  affectedResource: string | null;
  reason: string;
}

/**
 * Run all security rules against a config
 * @param rawConfig - The UniFi configuration to analyze
 * @param dismissals - Optional array of active dismissals to apply
 */
export function runSecurityAnalysis(
  rawConfig: any,
  dismissals: DismissalInfo[] = []
): SecurityAnalysisResult {
  const startTime = Date.now();
  const config = normalizeConfig(rawConfig);
  const results: RuleEvaluationResult[] = [];
  const rules = ruleLoader.getSecurityRules();

  if (rules.length === 0) {
    logger.warn('No YAML security rules loaded; returning empty analysis');
  }

  const ruleById = new Map(rules.map((rule) => [rule.id, rule]));

  // Build dismissal lookup map: ruleId -> Map<affectedResource|'__all__', dismissal>
  const dismissalMap = new Map<string, Map<string, DismissalInfo>>();
  for (const d of dismissals) {
    if (!dismissalMap.has(d.findingId)) {
      dismissalMap.set(d.findingId, new Map());
    }
    const key = d.affectedResource || '__all__';
    dismissalMap.get(d.findingId)!.set(key, d);
  }

  // Helper to find dismissal for a finding
  const findDismissal = (ruleId: string, affectedResource?: string): DismissalInfo | undefined => {
    const ruleMap = dismissalMap.get(ruleId);
    if (!ruleMap) return undefined;

    // Check specific resource first, then check for "all" dismissal
    if (affectedResource) {
      const specific = ruleMap.get(affectedResource);
      if (specific) return specific;
    }
    return ruleMap.get('__all__');
  };

  // Initialize counters
  const bySeverity: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };

  const bySource: Record<string, number> = {};
  const byCategory: Record<RuleCategory, number> = {
    firewall: 0,
    vlan: 0,
    dns: 0,
    port: 0,
    upnp: 0,
    wireless: 0,
    general: 0,
    ids_ips: 0,
    access_control: 0,
    switch: 0,
    vpn: 0,
    version: 0,
    optimization: 0,
  };

  let passed = 0;
  let failed = 0;
  let dismissed = 0;

  const executionResults = executeAllRules(rules, config);

  for (const execResult of executionResults) {
    const rule = ruleById.get(execResult.ruleId);
    if (!rule) {
      logger.warn(`Rule definition missing for ${execResult.ruleId}`);
      continue;
    }
    try {
      const rawFindings = execResult.findings.filter((r) => r.found);

      // Apply dismissals to findings
      const findings = rawFindings.map((f) => {
        const dismissal = findDismissal(rule.id, f.affectedResource);
        return {
          title: rule.name,
          description: rule.description,
          impact: rule.impact,
          remediation: rule.remediation,
          affectedResource: f.affectedResource,
          details: f.details,
          currentValue: f.currentValue,
          expectedValue: f.expectedValue,
          isDismissed: !!dismissal,
          dismissalId: dismissal?.id,
          dismissalReason: dismissal?.reason,
        };
      });

      // Count non-dismissed findings for pass/fail
      const activeFindings = findings.filter((f) => !f.isDismissed);
      const dismissedFindings = findings.filter((f) => f.isDismissed);
      const rulePassed = activeFindings.length === 0;

      if (rulePassed) {
        passed++;
      } else {
        failed++;
        bySeverity[rule.severity] += activeFindings.length;
        const sourceId = rule.sourceId || 'unknown';
        bySource[sourceId] = (bySource[sourceId] || 0) + activeFindings.length;
        byCategory[rule.category] += activeFindings.length;
      }

      dismissed += dismissedFindings.length;

      const sourceId = rule.sourceId || 'unknown';
      const source = ruleLoader.getSource(sourceId);

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleDescription: rule.description,
        sourceId,
        sourceName: source?.name || sourceId,
        category: rule.category,
        severity: rule.severity,
        passed: rulePassed,
        findings,
      });
    } catch (error) {
      logger.error(`Error running rule ${rule.id}:`, error);
    }
  }

  const duration = Date.now() - startTime;

  return {
    analyzedAt: new Date().toISOString(),
    duration,
    summary: {
      totalRules: rules.length,
      passed,
      failed,
      dismissed,
      bySeverity,
      bySource,
      byCategory,
    },
    results,
  };
}

/**
 * Run optimization analysis (best practices, not security)
 */
export function runOptimizationAnalysis(rawConfig: any): SecurityAnalysisResult {
  const startTime = Date.now();
  const config = normalizeConfig(rawConfig);
  const results: RuleEvaluationResult[] = [];

  // Initialize counters
  const bySeverity: Record<Severity, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0,
  };

  const bySource: Record<string, number> = {};
  const byCategory: Record<RuleCategory, number> = {
    firewall: 0,
    vlan: 0,
    dns: 0,
    port: 0,
    upnp: 0,
    wireless: 0,
    general: 0,
    ids_ips: 0,
    access_control: 0,
    switch: 0,
    vpn: 0,
    version: 0,
    optimization: 0,
  };

  let passed = 0;
  let failed = 0;

  for (const rule of allOptimizationRules) {
    try {
      const checkResults = rule.check(config);
      const findings = checkResults
        .filter((r) => r.found)
        .map((f) => ({
          title: rule.name,
          description: rule.description,
          impact: rule.impact,
          remediation: rule.remediation,
          affectedResource: f.affectedResource,
          details: f.details,
          currentValue: f.currentValue,
          expectedValue: f.expectedValue,
        }));

      const rulePassed = findings.length === 0;

      if (rulePassed) {
        passed++;
      } else {
        failed++;
        bySeverity[rule.severity] += findings.length;
        bySource[rule.sourceId] = (bySource[rule.sourceId] || 0) + findings.length;
        byCategory[rule.category] += findings.length;
      }

      const source = RULE_SOURCES[rule.sourceId];

      results.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleDescription: rule.description,
        sourceId: rule.sourceId,
        sourceName: source?.name || rule.sourceId,
        category: rule.category,
        severity: rule.severity,
        passed: rulePassed,
        findings,
      });
    } catch (error) {
      logger.error(`Error running optimization rule ${rule.id}:`, error);
    }
  }

  const duration = Date.now() - startTime;

  return {
    analyzedAt: new Date().toISOString(),
    duration,
    summary: {
      totalRules: allOptimizationRules.length,
      passed,
      failed,
      bySeverity,
      bySource,
      byCategory,
    },
    results,
  };
}

/**
 * Convert security analysis to VulnerabilityFinding array
 * for integration with existing vulnerability system
 */
export function toVulnerabilityFindings(
  analysisResult: SecurityAnalysisResult
): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];

  for (const result of analysisResult.results) {
    if (result.passed) continue;

    for (const finding of result.findings) {
      let source: VulnerabilityFinding['source'] = 'internal';
      if (result.sourceId === 'community') {
        source = 'custom';
      }
      findings.push({
        type: result.ruleId.toLowerCase().replace(/-/g, '_'),
        severity: result.severity,
        title: finding.title,
        description: `${finding.description}${finding.details ? `. ${finding.details}` : ''}`,
        impact: finding.impact,
        remediation: finding.remediation,
        affectedResource: finding.affectedResource,
        source,
        externalId: result.ruleId,
        externalCategory: result.category,
      });
    }
  }

  return findings;
}

/**
 * Get rule sources with attribution info
 */
export function getRuleSources() {
  return ruleLoader.getSources();
}

export * from './types';
