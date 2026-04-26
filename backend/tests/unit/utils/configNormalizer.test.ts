import {
  getRawNetworks,
  getRawWlans,
  getRawFirewallRules,
  getRawFirewallGroups,
  getRawPortForwards,
  getRawSettings,
  getRawClients,
  getRawVpnServers,
} from '../../../src/utils/configNormalizer';
import { normalizeConfig } from '../../../src/scanners';

/**
 * Config Key Normalization Tests
 *
 * Validates that config data is accessible regardless of which key name
 * was used when storing it. This is critical because UniFi sync stores
 * configs with camelCase keys (networkConf, wlanConf) but various
 * consumers expect different key names.
 */

const sampleNetworks = [
  { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: false },
  { _id: 'net2', name: 'IoT', purpose: 'iot', vlan_enabled: true, vlan: 20 },
];

const sampleWlans = [
  { _id: 'wlan1', name: 'Home WiFi', enabled: true, security: 'wpapsk' },
  { _id: 'wlan2', name: 'Guest', enabled: true, security: 'wpapsk', is_guest: true },
];

const sampleFirewallRules = [
  { _id: 'fw1', name: 'Block All', enabled: true, action: 'drop', ruleset: 'LAN_IN' },
];

const sampleFirewallGroups = [
  { _id: 'fg1', name: 'LAN Group', group_type: 'address-group', group_members: ['192.168.1.0/24'] },
];

const samplePortForwards = [
  { _id: 'pf1', name: 'Web Server', enabled: true, dst_port: '80', fwd: '192.168.1.100', fwd_port: '80', proto: 'tcp' },
];

const sampleClients = [
  { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', name: 'My Laptop' },
];

const sampleVpnServers = [
  { _id: 'vpn1', name: 'WireGuard', enabled: true, protocol: 'wireguard' },
];

describe('Config Key Normalizer - getRawNetworks', () => {
  it('returns networks from "networks" key', () => {
    const config = { networks: sampleNetworks };
    expect(getRawNetworks(config)).toEqual(sampleNetworks);
  });

  it('returns networks from "networkConf" key (as stored by sync)', () => {
    const config = { networkConf: sampleNetworks };
    expect(getRawNetworks(config)).toEqual(sampleNetworks);
  });

  it('returns networks from "networkconf" key (lowercase)', () => {
    const config = { networkconf: sampleNetworks };
    expect(getRawNetworks(config)).toEqual(sampleNetworks);
  });

  it('prefers "networks" over "networkConf"', () => {
    const other = [{ _id: 'x', name: 'Other' }];
    const config = { networks: sampleNetworks, networkConf: other };
    expect(getRawNetworks(config)).toEqual(sampleNetworks);
  });

  it('returns empty array when no network keys exist', () => {
    expect(getRawNetworks({})).toEqual([]);
  });

  it('returns empty array for null/undefined config', () => {
    expect(getRawNetworks(null)).toEqual([]);
    expect(getRawNetworks(undefined)).toEqual([]);
  });
});

describe('Config Key Normalizer - getRawWlans', () => {
  it('returns WLANs from "wlans" key', () => {
    const config = { wlans: sampleWlans };
    expect(getRawWlans(config)).toEqual(sampleWlans);
  });

  it('returns WLANs from "wlanConf" key (as stored by sync)', () => {
    const config = { wlanConf: sampleWlans };
    expect(getRawWlans(config)).toEqual(sampleWlans);
  });

  it('returns WLANs from "wlanconf" key (lowercase)', () => {
    const config = { wlanconf: sampleWlans };
    expect(getRawWlans(config)).toEqual(sampleWlans);
  });

  it('returns empty array when no WLAN keys exist', () => {
    expect(getRawWlans({})).toEqual([]);
  });
});

describe('Config Key Normalizer - getRawFirewallRules', () => {
  it('returns rules from "firewallRules" key', () => {
    expect(getRawFirewallRules({ firewallRules: sampleFirewallRules })).toEqual(sampleFirewallRules);
  });

  it('returns rules from "firewall_rule" key', () => {
    expect(getRawFirewallRules({ firewall_rule: sampleFirewallRules })).toEqual(sampleFirewallRules);
  });

  it('returns empty array for missing keys', () => {
    expect(getRawFirewallRules({})).toEqual([]);
  });
});

describe('Config Key Normalizer - getRawFirewallGroups', () => {
  it('returns groups from "firewallGroups" key', () => {
    expect(getRawFirewallGroups({ firewallGroups: sampleFirewallGroups })).toEqual(sampleFirewallGroups);
  });

  it('returns groups from "firewall_group" key', () => {
    expect(getRawFirewallGroups({ firewall_group: sampleFirewallGroups })).toEqual(sampleFirewallGroups);
  });

  it('returns groups from "firewallgroup" key', () => {
    expect(getRawFirewallGroups({ firewallgroup: sampleFirewallGroups })).toEqual(sampleFirewallGroups);
  });
});

describe('Config Key Normalizer - getRawPortForwards', () => {
  it('returns from "portForwards" key', () => {
    expect(getRawPortForwards({ portForwards: samplePortForwards })).toEqual(samplePortForwards);
  });

  it('returns from "portForward" key (as stored by sync)', () => {
    expect(getRawPortForwards({ portForward: samplePortForwards })).toEqual(samplePortForwards);
  });

  it('returns from "portforward" key (lowercase)', () => {
    expect(getRawPortForwards({ portforward: samplePortForwards })).toEqual(samplePortForwards);
  });
});

describe('Config Key Normalizer - getRawSettings', () => {
  it('returns settings array from "settings" key when already array', () => {
    const settings = [{ key: 'mgmt', ssh_enabled: true }];
    expect(getRawSettings({ settings })).toEqual(settings);
  });

  it('wraps settings object in array from "settings" key', () => {
    const settings = { key: 'mgmt', ssh_enabled: true };
    expect(getRawSettings({ settings })).toEqual([settings]);
  });

  it('returns from "setting" key', () => {
    const setting = { key: 'mgmt' };
    expect(getRawSettings({ setting })).toEqual([setting]);
  });

  it('returns wrapped empty object for missing keys', () => {
    expect(getRawSettings({})).toEqual([{}]);
  });
});

describe('Config Key Normalizer - getRawClients', () => {
  it('returns from "clients" key', () => {
    expect(getRawClients({ clients: sampleClients })).toEqual(sampleClients);
  });

  it('returns from "user" key (UniFi legacy)', () => {
    expect(getRawClients({ user: sampleClients })).toEqual(sampleClients);
  });

  it('returns from "sta" key (UniFi station)', () => {
    expect(getRawClients({ sta: sampleClients })).toEqual(sampleClients);
  });
});

describe('Config Key Normalizer - getRawVpnServers', () => {
  it('returns from "vpnServers" key', () => {
    expect(getRawVpnServers({ vpnServers: sampleVpnServers })).toEqual(sampleVpnServers);
  });

  it('returns from "vpn_servers" key', () => {
    expect(getRawVpnServers({ vpn_servers: sampleVpnServers })).toEqual(sampleVpnServers);
  });
});

describe('normalizeConfig - key variant handling', () => {
  const baseConfig = {
    networkConf: sampleNetworks,
    wlanConf: sampleWlans,
    portForward: samplePortForwards,
    settings: {},
  };

  it('normalizes config with camelCase keys (as stored by sync)', () => {
    const result = normalizeConfig(baseConfig);
    expect(result.networks).toHaveLength(2);
    expect(result.networks[0].name).toBe('Default');
    expect(result.networks[1].name).toBe('IoT');
    expect(result.wlans).toHaveLength(2);
    expect(result.portForwards).toHaveLength(1);
  });

  it('normalizes config with standard keys (as stored by import)', () => {
    const result = normalizeConfig({
      networks: sampleNetworks,
      wlans: sampleWlans,
      portForwards: samplePortForwards,
      settings: {},
    });
    expect(result.networks).toHaveLength(2);
    expect(result.wlans).toHaveLength(2);
  });

  it('normalizes config with lowercase keys', () => {
    const result = normalizeConfig({
      networkconf: sampleNetworks,
      wlanconf: sampleWlans,
      portforward: samplePortForwards,
      settings: {},
    });
    expect(result.networks).toHaveLength(2);
    expect(result.wlans).toHaveLength(2);
    expect(result.portForwards).toHaveLength(1);
  });

  it('produces identical output regardless of key naming', () => {
    const fromSync = normalizeConfig({
      networkConf: sampleNetworks,
      wlanConf: sampleWlans,
      portForward: samplePortForwards,
      settings: {},
    });
    const fromImport = normalizeConfig({
      networks: sampleNetworks,
      wlans: sampleWlans,
      portForwards: samplePortForwards,
      settings: {},
    });
    expect(fromSync.networks).toEqual(fromImport.networks);
    expect(fromSync.wlans).toEqual(fromImport.wlans);
    expect(fromSync.portForwards).toEqual(fromImport.portForwards);
  });

  it('is idempotent (normalizing twice produces same result)', () => {
    const first = normalizeConfig(baseConfig);
    const second = normalizeConfig(first);
    expect(second.networks).toEqual(first.networks);
    expect(second.wlans).toEqual(first.wlans);
  });

  it('returns empty arrays for missing keys', () => {
    const result = normalizeConfig({});
    expect(result.networks).toEqual([]);
    expect(result.wlans).toEqual([]);
    expect(result.firewallRules).toEqual([]);
    expect(result.portForwards).toEqual([]);
    expect(result.clients).toEqual([]);
    expect(result.vpnServers).toEqual([]);
  });
});
