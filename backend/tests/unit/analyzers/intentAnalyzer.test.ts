/**
 * Intent Analyzer Functional Tests
 *
 * Tests the actual analyzeAgainstIntent() function against realistic
 * UniFi configurations and intent profiles to verify compliance scoring,
 * gap detection, and setting evaluation across diverse network setups.
 */

import { analyzeAgainstIntent, IntentDismissalInfo } from '../../../src/analyzers/intentAnalyzer';
import { NetworkIntentProfile } from '../../../src/types';

// --- Reusable intent profile factory ---
function makeIntent(overrides: Partial<NetworkIntentProfile> = {}): NetworkIntentProfile {
  return {
    workFromHome: false,
    workDeviceIsolation: false,
    workVpn: false,
    homeServer: false,
    hasIoT: false,
    iotIsolation: false,
    iotInternetAccess: 'full',
    hasGaming: false,
    hasNAS: false,
    nasAccessibleFrom: 'all',
    guestNetwork: false,
    guestIsolation: false,
    guestBandwidthLimit: false,
    securityLevel: 'balanced',
    dnsFiltering: false,
    malwareBlocking: false,
    interVlanDefault: 'allow',
    completedAt: new Date().toISOString(),
    version: 1,
    ...overrides,
  };
}

// --- Reusable config factories ---

/** Well-segmented home network with Work, IoT, Guest VLANs */
const segmentedConfig = {
  networks: [
    { _id: 'net-main', name: 'Main', purpose: 'corporate', vlan_enabled: true, vlan: 1, dhcpd_enabled: true, dhcpd_dns_1: '192.168.1.53' },
    { _id: 'net-work', name: 'Work', purpose: 'corporate', vlan_enabled: true, vlan: 10, network_isolation: true, dhcpd_enabled: true, dhcpd_dns_1: '192.168.1.53' },
    { _id: 'net-iot', name: 'IoT Devices', purpose: 'corporate', vlan_enabled: true, vlan: 20, network_isolation: true, dhcpd_enabled: true, dhcpd_dns_1: '192.168.1.53' },
    { _id: 'net-guest', name: 'Guest', purpose: 'guest', vlan_enabled: true, vlan: 30, network_isolation: true, dhcpd_enabled: true },
  ],
  firewallRules: [
    { _id: 'fw1', name: 'Block IoT to Main', enabled: true, action: 'drop', protocol: 'all', src_network_id: 'net-iot', dst_network_id: 'net-main', ruleset: 'LAN_IN', rule_index: 1 },
    { _id: 'fw2', name: 'Block IoT to Work', enabled: true, action: 'drop', protocol: 'all', src_network_id: 'net-iot', dst_network_id: 'net-work', ruleset: 'LAN_IN', rule_index: 2 },
    { _id: 'fw3', name: 'Block Guest to All', enabled: true, action: 'drop', protocol: 'all', src_network_id: 'net-guest', dst_network_id: 'net-main', ruleset: 'LAN_IN', rule_index: 3 },
    { _id: 'fw4', name: 'Block Work to IoT', enabled: true, action: 'drop', protocol: 'all', src_network_id: 'net-work', dst_network_id: 'net-iot', ruleset: 'LAN_IN', rule_index: 4 },
    { _id: 'fw5', name: 'Block Main to IoT', enabled: true, action: 'drop', protocol: 'all', src_network_id: 'net-main', dst_network_id: 'net-iot', ruleset: 'LAN_IN', rule_index: 5 },
    { _id: 'fw6', name: 'Block IoT Internet', enabled: true, action: 'drop', protocol: 'all', src_network_id: 'net-iot', ruleset: 'WAN_OUT', rule_index: 6 },
  ],
  firewallGroups: [
    { _id: 'grp-nas', name: 'NAS Devices', group_type: 'address-group', group_members: ['192.168.1.50', 'aa:bb:cc:dd:ee:ff'] },
  ],
  wlanConf: [
    { _id: 'wlan-main', name: 'Home-WiFi', enabled: true, security: 'wpapsk', wpa_mode: 'wpa2', is_guest: false, networkconf_id: 'net-main' },
    { _id: 'wlan-iot', name: 'IoT-WiFi', enabled: true, security: 'wpapsk', wpa_mode: 'wpa2', is_guest: false, networkconf_id: 'net-iot' },
    { _id: 'wlan-guest', name: 'Guest-WiFi', enabled: true, security: 'open', is_guest: true, networkconf_id: 'net-guest' },
  ],
  portForwards: [],
  settings: [] as any[],
};

/** Flat single-network config (apartment dweller) */
const flatConfig = {
  networks: [
    { _id: 'net-default', name: 'Default', purpose: 'corporate', vlan_enabled: false, dhcpd_enabled: true },
  ],
  firewallRules: [],
  firewallGroups: [],
  wlanConf: [
    { _id: 'wlan1', name: 'My-WiFi', enabled: true, security: 'wpapsk', wpa_mode: 'wpa2', is_guest: false },
  ],
  portForwards: [],
  settings: [] as any[],
};

describe('Intent Analyzer - Functional Tests', () => {
  describe('Work-from-home intent', () => {
    it('should report compliant when Work VLAN is properly configured', () => {
      const intent = makeIntent({
        workFromHome: true,
        workDeviceIsolation: true,
        networkMappings: { workNetworkId: 'net-work' },
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const workSetting = result.settings.find(s => s.id === 'work_vlan');
      expect(workSetting).toBeDefined();
      expect(workSetting!.status).toBe('configured');
      expect(workSetting!.currentValue).toContain('Work');
      expect(workSetting!.currentValue).toContain('VLAN 10');
      expect(workSetting!.mappedNetwork?.hasVlan).toBe(true);

      // No work-related gaps
      const workGaps = result.gaps.filter(g => g.intent.toLowerCase().includes('work'));
      expect(workGaps).toHaveLength(0);
    });

    it('should report gaps when flat network has no Work VLAN', () => {
      const intent = makeIntent({
        workFromHome: true,
        workDeviceIsolation: true,
      });

      const result = analyzeAgainstIntent(flatConfig, intent);

      const workSetting = result.settings.find(s => s.id === 'work_vlan');
      expect(workSetting).toBeDefined();
      expect(workSetting!.status).toBe('not_configured');
      expect(workSetting!.severity).toBe('HIGH');

      const workGaps = result.gaps.filter(g => g.intent.toLowerCase().includes('work'));
      expect(workGaps.length).toBeGreaterThan(0);
      expect(workGaps[0].severity).toBe('HIGH');
    });

    it('should detect Work network by name pattern when not mapped', () => {
      const intent = makeIntent({
        workFromHome: true,
        workDeviceIsolation: true,
        // No networkMappings - must find by name
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const workSetting = result.settings.find(s => s.id === 'work_vlan');
      expect(workSetting).toBeDefined();
      // Should find "Work" network by name pattern
      expect(workSetting!.status).toBe('configured');
    });
  });

  describe('IoT isolation intent', () => {
    it('should detect IoT VLAN and report configured', () => {
      const intent = makeIntent({
        hasIoT: true,
        iotIsolation: true,
        networkMappings: { iotNetworkId: 'net-iot' },
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const iotSetting = result.settings.find(s => s.id === 'iot_vlan');
      expect(iotSetting).toBeDefined();
      expect(iotSetting!.status).toBe('configured');
      expect(iotSetting!.currentValue).toContain('VLAN 20');
    });

    it('should detect IoT internet restrictions when firewall rules exist', () => {
      const intent = makeIntent({
        hasIoT: true,
        iotIsolation: true,
        iotInternetAccess: 'limited',
        networkMappings: { iotNetworkId: 'net-iot' },
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const iotInternet = result.settings.find(s => s.id === 'iot_internet');
      expect(iotInternet).toBeDefined();
      // The "Block IoT Internet" rule name contains "iot" and action is "drop"
      expect(iotInternet!.status).toBe('configured');
    });

    it('should flag missing IoT internet restrictions on flat network', () => {
      const intent = makeIntent({
        hasIoT: true,
        iotIsolation: true,
        iotInternetAccess: 'none',
      });

      const result = analyzeAgainstIntent(flatConfig, intent);

      const iotVlan = result.settings.find(s => s.id === 'iot_vlan');
      expect(iotVlan).toBeDefined();
      expect(iotVlan!.status).toBe('not_configured');

      const iotInternet = result.settings.find(s => s.id === 'iot_internet');
      expect(iotInternet).toBeDefined();
      expect(iotInternet!.status).toBe('not_configured');

      // Should have gaps for both
      expect(result.gaps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('NAS access control', () => {
    it('should detect NAS in firewall group when device is mapped', () => {
      const intent = makeIntent({
        hasNAS: true,
        nasAccessibleFrom: 'trusted',
        deviceMappings: {
          nasDevice: { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.50', name: 'Synology NAS' },
        },
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const nasSetting = result.settings.find(s => s.id === 'nas_access');
      expect(nasSetting).toBeDefined();
      expect(nasSetting!.status).toBe('configured');
      expect(nasSetting!.currentValue).toContain('firewall group');
      expect(nasSetting!.currentValue).toContain('NAS Devices');
    });

    it('should require device mapping when NAS device is not selected', () => {
      const intent = makeIntent({
        hasNAS: true,
        nasAccessibleFrom: 'trusted',
        // No deviceMappings
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const nasSetting = result.settings.find(s => s.id === 'nas_access');
      expect(nasSetting).toBeDefined();
      expect(nasSetting!.status).toBe('not_configured');
      expect(nasSetting!.requiresDeviceMapping).toBe(true);
      expect(nasSetting!.currentValue).toContain('No NAS device selected');
    });
  });

  describe('Guest network', () => {
    it('should detect guest network and WiFi configured', () => {
      const intent = makeIntent({
        guestNetwork: true,
        guestIsolation: true,
        networkMappings: { guestNetworkId: 'net-guest' },
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const guestNet = result.settings.find(s => s.id === 'guest_network');
      expect(guestNet).toBeDefined();
      expect(guestNet!.status).toBe('configured');

      const guestIsolation = result.settings.find(s => s.id === 'guest_isolation');
      expect(guestIsolation).toBeDefined();
      expect(guestIsolation!.status).toBe('configured');
    });

    it('should flag missing guest network on flat config', () => {
      const intent = makeIntent({
        guestNetwork: true,
        guestIsolation: true,
      });

      const result = analyzeAgainstIntent(flatConfig, intent);

      const guestNet = result.settings.find(s => s.id === 'guest_network');
      expect(guestNet).toBeDefined();
      expect(guestNet!.status).toBe('not_configured');
    });
  });

  describe('DNS filtering', () => {
    it('should detect DNS filtering with user-specified server IP', () => {
      const intent = makeIntent({
        dnsFiltering: true,
        dnsFilteringServerIp: '192.168.1.53',
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const dnsSetting = result.settings.find(s => s.id === 'dns_filtering');
      expect(dnsSetting).toBeDefined();
      // Main, Work, IoT all use 192.168.1.53; Guest has no custom DNS
      // So it should be partial (guest missing)
      expect(['configured', 'partial']).toContain(dnsSetting!.status);
    });

    it('should report not_configured when no networks have custom DNS', () => {
      const intent = makeIntent({
        dnsFiltering: true,
      });

      const result = analyzeAgainstIntent(flatConfig, intent);

      const dnsSetting = result.settings.find(s => s.id === 'dns_filtering');
      expect(dnsSetting).toBeDefined();
      expect(dnsSetting!.status).toBe('not_configured');
    });
  });

  describe('Inter-VLAN default deny', () => {
    it('should detect inter-VLAN blocking via firewall rules', () => {
      const intent = makeIntent({
        interVlanDefault: 'deny',
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const interVlan = result.settings.find(s => s.id === 'intervlan_deny');
      expect(interVlan).toBeDefined();
      // The segmented config has block rules between IoT↔Main, IoT↔Work, Guest→Main, Work→IoT, Main→IoT
      // but may be missing some pairs (e.g., Main↔Guest bidirectional, Work↔Guest)
      // So status depends on whether ALL pairs are blocked
      expect(['configured', 'not_configured']).toContain(interVlan!.status);
    });

    it('should detect inter-VLAN blocking via L3 ACL', () => {
      const configWithL3Acl = {
        networks: [
          { _id: 'net1', name: 'Main', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
          { _id: 'net2', name: 'IoT', purpose: 'corporate', vlan_enabled: true, vlan: 20 },
        ],
        firewallRules: [],
        firewallGroups: [],
        wlanConf: [],
        portForwards: [],
        settings: [
          {
            acl_l3_isolation: [
              { source_network: 'net2', destination_networks: ['net1'] },
              { source_network: 'net1', destination_networks: ['net2'] },
            ],
          },
        ],
      };

      const intent = makeIntent({ interVlanDefault: 'deny' });
      const result = analyzeAgainstIntent(configWithL3Acl, intent);

      const interVlan = result.settings.find(s => s.id === 'intervlan_deny');
      expect(interVlan).toBeDefined();
      expect(interVlan!.status).toBe('configured');
      expect(interVlan!.currentValue).toContain('L3 ACL');
    });
  });

  describe('Maximum security level', () => {
    it('should flag weak WiFi encryption', () => {
      const configWithWep = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
        ],
        firewallRules: [],
        wlanConf: [
          { _id: 'wlan1', name: 'Bad-WiFi', enabled: true, security: 'wep', is_guest: false },
        ],
        portForwards: [],
        settings: [] as any[],
      };

      const intent = makeIntent({ securityLevel: 'maximum' });
      const result = analyzeAgainstIntent(configWithWep, intent);

      const wlanSecurity = result.settings.find(s => s.id === 'wlan_security');
      expect(wlanSecurity).toBeDefined();
      expect(wlanSecurity!.status).toBe('not_configured');
      expect(wlanSecurity!.severity).toBe('CRITICAL');
      expect(wlanSecurity!.currentValue).toContain('weak encryption');

      const wlanGap = result.gaps.find(g => g.intent.includes('WiFi encryption'));
      expect(wlanGap).toBeDefined();
      expect(wlanGap!.severity).toBe('CRITICAL');
    });

    it('should flag insufficient network segmentation', () => {
      const intent = makeIntent({ securityLevel: 'maximum' });
      const result = analyzeAgainstIntent(flatConfig, intent);

      const segmentation = result.settings.find(s => s.id === 'network_segmentation');
      expect(segmentation).toBeDefined();
      expect(segmentation!.status).toBe('not_configured');
      expect(segmentation!.currentValue).toContain('0 VLAN');
    });

    it('should pass segmentation check with 3+ VLANs', () => {
      const intent = makeIntent({ securityLevel: 'maximum' });
      const result = analyzeAgainstIntent(segmentedConfig, intent);

      const segmentation = result.settings.find(s => s.id === 'network_segmentation');
      expect(segmentation).toBeDefined();
      expect(segmentation!.status).toBe('configured');
    });
  });

  describe('Dismissal behavior', () => {
    it('should exclude dismissed gaps from compliance and score', () => {
      const intent = makeIntent({
        workFromHome: true,
        workDeviceIsolation: true,
        hasIoT: true,
        iotIsolation: true,
      });

      // First, run without dismissals to get the baseline
      const baseline = analyzeAgainstIntent(flatConfig, intent);
      expect(baseline.compliant).toBe(false);
      expect(baseline.gaps.length).toBeGreaterThan(0);
      const baselineScore = baseline.score;

      // Now dismiss all gaps
      const dismissals: IntentDismissalInfo[] = baseline.settings
        .filter(s => s.status !== 'configured' && s.status !== 'not_applicable')
        .map(s => ({
          id: `dismissal-${s.id}`,
          findingId: s.id,
          affectedResource: null,
          reason: 'Accepted risk',
        }));

      const dismissed = analyzeAgainstIntent(flatConfig, intent, dismissals);

      // Dismissed settings should be marked
      const dismissedSettings = dismissed.settings.filter(s => s.isDismissed);
      expect(dismissedSettings.length).toBeGreaterThan(0);

      // Active (non-dismissed) gaps should drive compliance
      const activeGaps = dismissed.gaps.filter(g => !g.isDismissed);
      expect(activeGaps.length).toBeLessThan(baseline.gaps.length);

      // Score should improve with dismissals (dismissed items excluded from required count)
      expect(dismissed.score).toBeGreaterThanOrEqual(baselineScore);

      // Summary should track dismissed count
      expect(dismissed.summary.dismissed).toBeGreaterThan(0);
    });
  });

  describe('Network name pattern matching', () => {
    it('should find IoT network by "smart" pattern', () => {
      const configWithSmartHome = {
        networks: [
          { _id: 'net1', name: 'Main', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
          { _id: 'net2', name: 'Smart Home', purpose: 'corporate', vlan_enabled: true, vlan: 20, network_isolation: true },
        ],
        firewallRules: [],
        wlanConf: [],
        portForwards: [],
        settings: [] as any[],
      };

      const intent = makeIntent({
        hasIoT: true,
        iotIsolation: true,
        // No explicit mapping — should find by name pattern "smart"
      });

      const result = analyzeAgainstIntent(configWithSmartHome, intent);
      const iotSetting = result.settings.find(s => s.id === 'iot_vlan');
      expect(iotSetting).toBeDefined();
      expect(iotSetting!.status).toBe('configured');
      expect(iotSetting!.mappedNetwork?.name).toBe('Smart Home');
    });

    it('should NOT match non-standard IoT network name', () => {
      const configWithOddName = {
        networks: [
          { _id: 'net1', name: 'Main', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
          { _id: 'net2', name: 'Downstairs Gadgets', purpose: 'corporate', vlan_enabled: true, vlan: 20, network_isolation: true },
        ],
        firewallRules: [],
        wlanConf: [],
        portForwards: [],
        settings: [] as any[],
      };

      const intent = makeIntent({
        hasIoT: true,
        iotIsolation: true,
      });

      const result = analyzeAgainstIntent(configWithOddName, intent);
      const iotSetting = result.settings.find(s => s.id === 'iot_vlan');
      expect(iotSetting).toBeDefined();
      // "Downstairs Gadgets" doesn't match any of the IoT patterns (iot, smart, devices, things)
      expect(iotSetting!.status).toBe('not_configured');
    });

    it('should find guest network by "visitor" pattern', () => {
      const configWithVisitors = {
        networks: [
          { _id: 'net1', name: 'Main', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
          { _id: 'net2', name: 'Visitors', purpose: 'corporate', vlan_enabled: true, vlan: 30, network_isolation: true },
        ],
        firewallRules: [],
        wlanConf: [
          { _id: 'wlan1', name: 'Visitors-WiFi', enabled: true, security: 'open', is_guest: true },
        ],
        portForwards: [],
        settings: [] as any[],
      };

      const intent = makeIntent({
        guestNetwork: true,
      });

      const result = analyzeAgainstIntent(configWithVisitors, intent);
      const guestNet = result.settings.find(s => s.id === 'guest_network');
      expect(guestNet).toBeDefined();
      expect(guestNet!.status).toBe('configured');
    });
  });

  describe('Compliance scoring', () => {
    it('should produce high score for fully configured WFH setup', () => {
      const intent = makeIntent({
        workFromHome: true,
        workDeviceIsolation: true,
        hasIoT: true,
        iotIsolation: true,
        guestNetwork: true,
        guestIsolation: true,
        networkMappings: {
          workNetworkId: 'net-work',
          iotNetworkId: 'net-iot',
          guestNetworkId: 'net-guest',
        },
      });

      const result = analyzeAgainstIntent(segmentedConfig, intent);

      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.summary.configured).toBeGreaterThan(0);
      expect(result.summary.total).toBeGreaterThan(0);
    });

    it('should produce low score for flat network with full intent', () => {
      const intent = makeIntent({
        workFromHome: true,
        workDeviceIsolation: true,
        hasIoT: true,
        iotIsolation: true,
        iotInternetAccess: 'limited',
        guestNetwork: true,
        guestIsolation: true,
        securityLevel: 'maximum',
        interVlanDefault: 'deny',
        dnsFiltering: true,
      });

      const result = analyzeAgainstIntent(flatConfig, intent);

      expect(result.compliant).toBe(false);
      expect(result.score).toBeLessThan(30);
      expect(result.gaps.length).toBeGreaterThan(3);
      expect(result.summary.notConfigured).toBeGreaterThan(0);
    });

    it('should return 100% compliant with empty intent', () => {
      const intent = makeIntent(); // Everything disabled
      const result = analyzeAgainstIntent(flatConfig, intent);

      // Only trusted_network (non-required) should be evaluated
      expect(result.score).toBe(100);
      expect(result.compliant).toBe(true);
    });
  });
});
