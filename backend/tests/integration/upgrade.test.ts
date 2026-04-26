import { normalizeConfig } from '../../src/scanners';
import {
  getRawNetworks,
  getRawWlans,
  getRawFirewallRules,
  getRawPortForwards,
} from '../../src/utils/configNormalizer';
import { TEST_CONFIGS } from '../fixtures/unifiConfigs';

/**
 * Upgrade Path & Forward Compatibility Tests
 *
 * Validates that the config normalization layer handles all known
 * key naming variants, ensuring configs from different UniFi versions
 * and import sources work correctly.
 */
describe('Config Format Forward Compatibility', () => {
  const baseNetworks = [
    { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: false },
    { _id: 'net2', name: 'IoT', purpose: 'iot', vlan_enabled: true, vlan: 20 },
  ];
  const baseWlans = [
    { _id: 'wlan1', name: 'Main', enabled: true, security: 'wpapsk' },
  ];
  const baseFirewallRules = [
    { _id: 'fw1', name: 'Allow All', enabled: true, action: 'accept', protocol: 'all', ruleset: 'LAN_IN' },
  ];
  const basePortForwards = [
    { _id: 'pf1', name: 'HTTP', enabled: true, proto: 'tcp', dst_port: '80', fwd: '192.168.1.10', fwd_port: '80' },
  ];

  it('handles camelCase key format (as stored by sync)', () => {
    const config = {
      networkConf: baseNetworks,
      wlanConf: baseWlans,
      firewallRules: baseFirewallRules,
      portForward: basePortForwards,
      settings: {},
    };
    expect(getRawNetworks(config)).toHaveLength(2);
    expect(getRawWlans(config)).toHaveLength(1);
    expect(getRawFirewallRules(config)).toHaveLength(1);
    expect(getRawPortForwards(config)).toHaveLength(1);
  });

  it('handles lowercase key format (as stored by some imports)', () => {
    const config = {
      networkconf: baseNetworks,
      wlanconf: baseWlans,
      firewallRules: baseFirewallRules,
      portforward: basePortForwards,
      settings: {},
    };
    expect(getRawNetworks(config)).toHaveLength(2);
    expect(getRawWlans(config)).toHaveLength(1);
    expect(getRawPortForwards(config)).toHaveLength(1);
  });

  it('handles canonical key format (networks, wlans)', () => {
    const config = {
      networks: baseNetworks,
      wlans: baseWlans,
      firewallRules: baseFirewallRules,
      portForwards: basePortForwards,
      settings: {},
    };
    expect(getRawNetworks(config)).toHaveLength(2);
    expect(getRawWlans(config)).toHaveLength(1);
    expect(getRawFirewallRules(config)).toHaveLength(1);
    expect(getRawPortForwards(config)).toHaveLength(1);
  });

  it('returns empty arrays for missing/undefined keys', () => {
    expect(getRawNetworks({})).toEqual([]);
    expect(getRawWlans({})).toEqual([]);
    expect(getRawFirewallRules({})).toEqual([]);
    expect(getRawPortForwards({})).toEqual([]);
    expect(getRawNetworks(undefined)).toEqual([]);
    expect(getRawNetworks(null)).toEqual([]);
  });

  it('normalizeConfig produces identical output regardless of input key name', () => {
    const configA = normalizeConfig({
      networkConf: baseNetworks,
      wlanConf: baseWlans,
      firewallRules: baseFirewallRules,
      portForward: basePortForwards,
      settings: {},
    });
    const configB = normalizeConfig({
      networks: baseNetworks,
      wlans: baseWlans,
      firewallRules: baseFirewallRules,
      portForwards: basePortForwards,
      settings: {},
    });
    expect(configA.networks).toEqual(configB.networks);
    expect(configA.wlans).toEqual(configB.wlans);
    expect(configA.firewallRules).toEqual(configB.firewallRules);
    expect(configA.portForwards).toEqual(configB.portForwards);
  });

  it('normalizeConfig is idempotent (normalizing twice produces same result)', () => {
    const first = normalizeConfig(TEST_CONFIGS.permissiveFirewall);
    const second = normalizeConfig(first);
    expect(second.networks).toEqual(first.networks);
    expect(second.wlans).toEqual(first.wlans);
    expect(second.firewallRules).toEqual(first.firewallRules);
  });

  it('ignores unknown/future keys without crashing', () => {
    const config = {
      networks: baseNetworks,
      wlans: baseWlans,
      firewallRules: [],
      portForwards: [],
      settings: {},
      futureFeature: { enabled: true },
      zoneBasedPolicies: [{ id: 'z1' }],
      unknownArray: [1, 2, 3],
    };
    const normalized = normalizeConfig(config);
    expect(normalized.networks).toHaveLength(2);
    expect(normalized.wlans).toHaveLength(1);
  });

  it('handles config with mixed key formats in same object', () => {
    // Unlikely but should not crash
    const config = {
      networks: baseNetworks,
      networkConf: [{ _id: 'extra', name: 'Extra' }], // networks takes priority
      wlans: baseWlans,
      firewallRules: baseFirewallRules,
      portForwards: basePortForwards,
      settings: {},
    };
    // getRawNetworks returns first truthy match (networks)
    expect(getRawNetworks(config)).toEqual(baseNetworks);
  });

  it('preserves standard fields within network/wlan objects through normalization', () => {
    const config = {
      networks: [{
        _id: 'net1',
        name: 'Test',
        purpose: 'corporate',
        vlan_enabled: true,
        vlan: 10,
        dhcpd_enabled: true,
        network_isolation: true,
      }],
      wlans: [{
        _id: 'wlan1',
        name: 'Test WiFi',
        enabled: true,
        security: 'wpapsk',
        band_steering_mode: 'prefer_5g',
        fast_roaming_enabled: true,
        pmf_mode: 'required',
      }],
      firewallRules: [],
      portForwards: [],
      settings: {},
    };
    const normalized = normalizeConfig(config);
    expect(normalized.networks[0].name).toBe('Test');
    expect(normalized.networks[0].vlan_enabled).toBe(true);
    expect(normalized.wlans[0].name).toBe('Test WiFi');
    expect(normalized.wlans[0].security).toBe('wpapsk');
  });
});
