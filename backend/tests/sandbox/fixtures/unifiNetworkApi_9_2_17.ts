export const UNIFI_NETWORK_FIXTURE_VERSION = '9.2.17';

// Dataset modeled after UniFi Network API shapes used by UniFiClient.
// Sources:
// - https://developer.ui.com/network-api/gettingstarted
// - https://help.ui.com/hc/en-us/articles/31228198640023-Accessing-UniFi-Local-API-Documentation
export const UNIFI_NETWORK_FIXTURE = {
  auth: {
    username: 'sandbox-admin',
    password: 'sandbox-pass',
  },
  sites: [
    {
      _id: 'default',
      name: 'default',
      desc: 'Sandbox Site',
      role: 'admin',
    },
  ],
  settings: {
    controller_version: '9.2.17',
    country: 'US',
    timezone: 'America/Los_Angeles',
  },
  devices: [
    {
      _id: 'dev-gateway',
      mac: 'AA:BB:CC:00:00:01',
      ip: '192.168.1.1',
      name: 'UGW-Max',
      type: 'ugw',
      model: 'UGW',
      version: '9.2.17',
      adopted: true,
      state: 1,
      last_seen: 1739999000,
    },
    {
      _id: 'dev-ap',
      mac: 'AA:BB:CC:00:00:02',
      ip: '192.168.1.2',
      name: 'U7-Pro',
      type: 'uap',
      model: 'U7PRO',
      version: '9.2.17',
      adopted: true,
      state: 1,
      last_seen: 1739999000,
    },
  ],
  networks: [
    {
      _id: 'net-main',
      name: 'Main',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 1,
      ip_subnet: '192.168.1.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
    },
    {
      _id: 'net-iot',
      name: 'IoT',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 20,
      ip_subnet: '192.168.20.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      network_isolation: false,
    },
    {
      _id: 'net-guest',
      name: 'Guest',
      purpose: 'guest',
      vlan_enabled: true,
      vlan: 30,
      ip_subnet: '192.168.30.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '9.9.9.9',
      network_isolation: true,
    },
  ],
  wlans: [
    {
      _id: 'wlan-main',
      name: 'Main-WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-main',
      is_guest: false,
    },
    {
      _id: 'wlan-iot',
      name: 'IoT-WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'disabled',
      networkconf_id: 'net-iot',
      is_guest: false,
    },
    {
      _id: 'wlan-guest',
      name: 'Guest-WiFi',
      enabled: true,
      security: 'open',
      networkconf_id: 'net-guest',
      is_guest: true,
    },
  ],
  firewallRules: [
    {
      _id: 'fw-any-any',
      name: 'Allow LAN Any Any',
      enabled: true,
      ruleset: 'LAN_IN',
      rule_index: 10,
      action: 'accept',
      protocol: 'all',
    },
  ],
  firewallGroups: [
    {
      _id: 'group-iot',
      name: 'IoT Subnets',
      group_type: 'address-group',
      group_members: ['192.168.20.0/24'],
    },
  ],
  firewallPolicies: [
    {
      _id: 'policy-iot-main',
      name: 'Block IoT to Main',
      action: 'BLOCK',
      enabled: true,
      predefined: false,
      index: 5,
      protocol: 'ALL',
      source: {
        zone_id: 'zone-iot',
        matching_target: 'NETWORK',
        network_ids: ['net-iot'],
      },
      destination: {
        zone_id: 'zone-main',
        matching_target: 'NETWORK',
        network_ids: ['net-main'],
      },
    },
  ],
  trafficRules: [],
  routingRules: [],
  portForwards: [
    {
      _id: 'pf-rdp',
      name: 'RDP Test Forward',
      enabled: true,
      pfwd_interface: 'wan',
      src: 'any',
      dst_port: '3389',
      fwd: '192.168.1.150',
      fwd_port: '3389',
      proto: 'tcp',
    },
  ],
  clients: [
    {
      _id: 'client-nas',
      mac: 'AA:BB:CC:DD:EE:01',
      ip: '192.168.1.10',
      hostname: 'nas01',
      network_id: 'net-main',
      oui: 'Synology',
      is_wired: true,
      first_seen: 1739900000,
      last_seen: 1739999000,
    },
    {
      _id: 'client-iot',
      mac: 'AA:BB:CC:DD:EE:20',
      ip: '192.168.20.55',
      hostname: 'camera-iot',
      network_id: 'net-iot',
      oui: 'Espressif',
      is_wired: false,
      first_seen: 1739900000,
      last_seen: 1739999000,
    },
  ],
  aclRules: [
    {
      _id: 'acl-block-iot-main',
      name: 'Block IoT -> Main',
      type: 'IPV4',
      action: 'BLOCK',
      enabled: true,
      acl_index: 15,
      traffic_source: { network_ids: ['net-iot'] },
      traffic_destination: { network_ids: ['net-main'] },
    },
  ],
  vpnServers: [],
  trafficMatchingLists: [],
  firewallZones: [
    { _id: 'zone-main', name: 'Main', network_ids: ['net-main'] },
    { _id: 'zone-iot', name: 'IoT', network_ids: ['net-iot'] },
  ],
  fingerprintDevices: [
    { id: 1, name: 'Camera' },
    { id: 2, name: 'NAS' },
  ],
};

export const SANDBOX_IMPORT_CONFIGS = [
  {
    name: 'clean-segmented-baseline',
    data: {
      version: '9.2.17',
      site: { name: 'Sandbox Clean Site' },
      networks: [
        { _id: 'net-main', name: 'Main', purpose: 'corporate', vlan_enabled: true, vlan: 1, network_isolation: false },
        { _id: 'net-iot', name: 'IoT', purpose: 'corporate', vlan_enabled: true, vlan: 20, network_isolation: true },
      ],
      firewallRules: [
        {
          _id: 'fw-block-iot',
          name: 'Block IoT to Main',
          enabled: true,
          action: 'drop',
          protocol: 'all',
          src_network_id: 'net-iot',
          dst_network_id: 'net-main',
          ruleset: 'LAN_IN',
          rule_index: 1,
        },
      ],
      wlans: [
        { _id: 'wlan-main', name: 'Main-WiFi', enabled: true, security: 'wpapsk', wpa_mode: 'wpa2', networkconf_id: 'net-main' },
        { _id: 'wlan-iot', name: 'IoT-WiFi', enabled: true, security: 'wpapsk', wpa_mode: 'wpa2', networkconf_id: 'net-iot' },
      ],
      portForwards: [],
      settings: { upnp_enabled: false },
    },
  },
  {
    name: 'insecure-open-guest-and-port-forward',
    data: {
      version: '9.2.17',
      site: { name: 'Sandbox Insecure Site' },
      networks: [
        { _id: 'net-main', name: 'Main', purpose: 'corporate', vlan_enabled: false },
      ],
      firewallRules: [
        { _id: 'fw-any-any', name: 'Allow Any', enabled: true, action: 'accept', protocol: 'all', ruleset: 'LAN_IN', rule_index: 1 },
      ],
      wlans: [
        { _id: 'wlan-guest', name: 'Guest-WiFi', enabled: true, security: 'open', is_guest: false },
      ],
      portForwards: [
        { _id: 'pf-ssh', name: 'SSH Forward', enabled: true, dst_port: '22', fwd: '192.168.1.100', fwd_port: '22', proto: 'tcp' },
      ],
      settings: { upnp_enabled: true },
    },
  },
];
