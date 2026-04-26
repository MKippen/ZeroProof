/**
 * Optimization Rules Test Suite
 *
 * Tests all 8 optimization rules (OPT-WIFI-001 through OPT-WIFI-004,
 * OPT-NET-001, OPT-NET-002, OPT-NET-003, OPT-NET-005).
 */

import optimizationRules from '../../../src/scanners/rules/optimization';
import { normalizeConfig } from '../../../src/scanners';
import { TEST_CONFIGS } from '../../fixtures/unifiConfigs';

// Helper: get a rule by ID
function getRule(id: string) {
  const rule = optimizationRules.find((r) => r.id === id);
  if (!rule) throw new Error(`Rule ${id} not found`);
  return rule;
}

// Helper: normalize a config and run a rule's check
function checkRule(ruleId: string, rawConfig: any) {
  const rule = getRule(ruleId);
  const config = normalizeConfig(rawConfig);
  return rule.check(config);
}

describe('Optimization Rules', () => {
  // =============================================
  // OPT-WIFI-001: IoT Missing WiFi Optimization
  // =============================================
  describe('OPT-WIFI-001 — IoT Missing WiFi Optimization', () => {
    it('triggers on IoT WLAN without optimize_iot', () => {
      const results = checkRule('OPT-WIFI-001', TEST_CONFIGS.optimizationBaseline);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
      expect(results[0].affectedResource).toContain('IoT WiFi');
    });

    it('does not trigger when optimize_iot is enabled', () => {
      const config = {
        ...TEST_CONFIGS.optimizationBaseline,
        wlans: [
          { _id: 'wlan1', name: 'IoT WiFi', enabled: true, security: 'wpapsk', optimize_iot: true },
        ],
      };
      const results = checkRule('OPT-WIFI-001', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger on non-IoT WLANs without optimize_iot', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home Network', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-001', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger on disabled IoT WLANs', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'IoT Devices', enabled: false, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-001', config);
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // OPT-WIFI-002: Band Steering Disabled
  // =============================================
  describe('OPT-WIFI-002 — Band Steering Disabled', () => {
    it('triggers when band_steering_mode is off', () => {
      const results = checkRule('OPT-WIFI-002', TEST_CONFIGS.optimizationBaseline);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
      expect(results[0].affectedResource).toContain('Main Network');
    });

    it('triggers when band_steering_mode is disabled', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk', band_steering_mode: 'disabled' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-002', config);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
    });

    it('does not trigger when band_steering_mode is prefer_5g', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk', band_steering_mode: 'prefer_5g' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-002', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger when band_steering_mode is undefined (not explicitly off)', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-002', config);
      expect(results).toHaveLength(0);
    });

    it('skips IoT WLANs (band steering should be off for IoT)', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Smart Home', enabled: true, security: 'wpapsk', band_steering_mode: 'off' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-002', config);
      expect(results).toHaveLength(0);
    });

    it('skips guest WLANs', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Guest', enabled: true, security: 'wpapsk', is_guest: true, band_steering_mode: 'off' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-002', config);
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // OPT-WIFI-003: Fast Roaming Not Enabled
  // =============================================
  describe('OPT-WIFI-003 — Fast Roaming (802.11r) Not Enabled', () => {
    it('triggers on multi-AP setup without fast_roaming_enabled', () => {
      const results = checkRule('OPT-WIFI-003', TEST_CONFIGS.optimizationBaseline);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
      expect(results[0].affectedResource).toContain('Main Network');
    });

    it('does not trigger when fast_roaming_enabled is true', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'IoT', purpose: 'corporate' },
          { _id: 'net3', name: 'Guest', purpose: 'guest' },
        ],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk', fast_roaming_enabled: true },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-003', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger on single-AP setup (few networks)', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-003', config);
      expect(results).toHaveLength(0);
    });

    it('skips IoT WLANs', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'Work', purpose: 'corporate' },
          { _id: 'net3', name: 'Guest', purpose: 'guest' },
        ],
        wlans: [
          { _id: 'wlan1', name: 'IoT Devices', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-003', config);
      expect(results).toHaveLength(0);
    });

    it('skips guest WLANs', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'Work', purpose: 'corporate' },
          { _id: 'net3', name: 'Guest', purpose: 'guest' },
        ],
        wlans: [
          { _id: 'wlan1', name: 'Visitor WiFi', enabled: true, security: 'wpapsk', is_guest: true },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-003', config);
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // OPT-WIFI-004: Multicast Enhancement Not Enabled
  // =============================================
  describe('OPT-WIFI-004 — Multicast Enhancement Not Enabled', () => {
    it('triggers when multicast_enhance is explicitly false', () => {
      const results = checkRule('OPT-WIFI-004', TEST_CONFIGS.optimizationBaseline);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
      expect(results[0].affectedResource).toContain('Main Network');
    });

    it('does not trigger when multicast_enhance is true', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk', multicast_enhance: true },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-004', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger when multicast_enhance is undefined', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-004', config);
      expect(results).toHaveLength(0);
    });

    it('skips guest WLANs', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Guest', enabled: true, security: 'wpapsk', is_guest: true, multicast_enhance: false },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-WIFI-004', config);
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // OPT-NET-001: IGMP Snooping Not Enabled
  // =============================================
  describe('OPT-NET-001 — IGMP Snooping Not Enabled', () => {
    it('triggers when igmp_snooping_enabled is false', () => {
      const results = checkRule('OPT-NET-001', TEST_CONFIGS.optimizationBaseline);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
      expect(results[0].affectedResource).toBe('Global Settings');
    });

    it('does not trigger when igmp_snooping_enabled is true', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [],
        firewallRules: [],
        portForwards: [],
        igmp_snooping_enabled: true,
        settings: {},
      };
      const results = checkRule('OPT-NET-001', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger when igmp_snooping_enabled is undefined', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-001', config);
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // OPT-NET-002: mDNS Not Enabled for Smart Home
  // =============================================
  describe('OPT-NET-002 — mDNS Not Enabled for Smart Home', () => {
    it('triggers when mdns_enabled is false with multiple networks', () => {
      const results = checkRule('OPT-NET-002', TEST_CONFIGS.optimizationBaseline);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
      expect(results[0].affectedResource).toBe('Global Settings');
    });

    it('does not trigger when mdns_enabled is true', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'IoT', purpose: 'corporate' },
        ],
        wlans: [],
        firewallRules: [],
        portForwards: [],
        mdns_enabled: true,
        settings: {},
      };
      const results = checkRule('OPT-NET-002', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger with only one network', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [],
        firewallRules: [],
        portForwards: [],
        mdns_enabled: false,
        settings: {},
      };
      const results = checkRule('OPT-NET-002', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger when mdns_enabled is undefined', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'IoT', purpose: 'corporate' },
        ],
        wlans: [],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-002', config);
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // OPT-NET-003: Too Many SSIDs
  // =============================================
  describe('OPT-NET-003 — Too Many SSIDs', () => {
    it('triggers when more than 5 SSIDs are enabled', () => {
      const results = checkRule('OPT-NET-003', TEST_CONFIGS.tooManySsids);
      expect(results).toHaveLength(1);
      expect(results[0].found).toBe(true);
      expect(results[0].details).toContain('6');
      expect(results[0].affectedResource).toBe('WiFi Configuration');
    });

    it('does not trigger with 5 or fewer enabled SSIDs', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'w1', name: 'Home', enabled: true, security: 'wpapsk' },
          { _id: 'w2', name: 'Guest', enabled: true, security: 'wpapsk' },
          { _id: 'w3', name: 'IoT', enabled: true, security: 'wpapsk' },
          { _id: 'w4', name: 'Work', enabled: true, security: 'wpapsk' },
          { _id: 'w5', name: 'Kids', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-003', config);
      expect(results).toHaveLength(0);
    });

    it('excludes disabled WLANs from count', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'w1', name: 'Home', enabled: true, security: 'wpapsk' },
          { _id: 'w2', name: 'Guest', enabled: true, security: 'wpapsk' },
          { _id: 'w3', name: 'IoT', enabled: true, security: 'wpapsk' },
          { _id: 'w4', name: 'Work', enabled: false, security: 'wpapsk' },
          { _id: 'w5', name: 'Kids', enabled: false, security: 'wpapsk' },
          { _id: 'w6', name: 'Media', enabled: false, security: 'wpapsk' },
          { _id: 'w7', name: 'Lab', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-003', config);
      // 4 enabled WLANs - should NOT trigger
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // OPT-NET-005: BSS Transition Not Enabled
  // =============================================
  describe('OPT-NET-005 — BSS Transition (802.11v) Not Enabled', () => {
    it('triggers on multi-AP setup with bss_transition explicitly false', () => {
      const results = checkRule('OPT-NET-005', TEST_CONFIGS.optimizationBaseline);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].found).toBe(true);
      expect(results[0].affectedResource).toContain('Main Network');
    });

    it('does not trigger when bss_transition is true', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'Work', purpose: 'corporate' },
          { _id: 'net3', name: 'Guest', purpose: 'guest' },
        ],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk', bss_transition: true },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-005', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger when bss_transition is undefined (not explicitly false)', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'Work', purpose: 'corporate' },
          { _id: 'net3', name: 'Guest', purpose: 'guest' },
        ],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk' },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-005', config);
      expect(results).toHaveLength(0);
    });

    it('does not trigger on single-AP setup', () => {
      const config = {
        networks: [{ _id: 'net1', name: 'Default', purpose: 'corporate' }],
        wlans: [
          { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk', bss_transition: false },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-005', config);
      expect(results).toHaveLength(0);
    });

    it('skips IoT WLANs', () => {
      const config = {
        networks: [
          { _id: 'net1', name: 'Default', purpose: 'corporate' },
          { _id: 'net2', name: 'Work', purpose: 'corporate' },
          { _id: 'net3', name: 'Guest', purpose: 'guest' },
        ],
        wlans: [
          { _id: 'wlan1', name: 'Smart Devices', enabled: true, security: 'wpapsk', bss_transition: false },
        ],
        firewallRules: [],
        portForwards: [],
        settings: {},
      };
      const results = checkRule('OPT-NET-005', config);
      expect(results).toHaveLength(0);
    });
  });

  // =============================================
  // Integration: All rules fire on baseline config
  // =============================================
  describe('Integration — optimizationBaseline triggers all rules', () => {
    it('every optimization rule fires at least once', () => {
      const config = normalizeConfig(TEST_CONFIGS.optimizationBaseline);
      const ruleIds = optimizationRules.map((r) => r.id);
      const triggered: string[] = [];

      for (const rule of optimizationRules) {
        const results = rule.check(config);
        if (results.some((r) => r.found)) {
          triggered.push(rule.id);
        }
      }

      // OPT-NET-003 won't trigger (only 2 WLANs, need >5)
      const expectedToTrigger = ruleIds.filter((id) => id !== 'OPT-NET-003');
      for (const id of expectedToTrigger) {
        expect(triggered).toContain(id);
      }
    });
  });
});
