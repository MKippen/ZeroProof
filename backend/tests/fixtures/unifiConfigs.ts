export const TEST_CONFIGS = {
  // Config with permissive firewall - should trigger firewall rules
  permissiveFirewall: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: false },
      { _id: 'net2', name: 'IoT', purpose: 'iot', vlan_enabled: true, vlan: 20 },
    ],
    firewallRules: [
      {
        _id: 'fw1',
        name: 'Allow All',
        enabled: true,
        action: 'accept',
        protocol: 'all',
        ruleset: 'LAN_IN',
        rule_index: 1,
        // No src/dst restrictions = any-to-any
      },
    ],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // Config with IoT network not isolated - should trigger VLAN rules
  iotNotIsolated: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: false },
      {
        _id: 'net2',
        name: 'IoT Devices',
        purpose: 'iot',
        vlan_enabled: true,
        vlan: 20,
        network_isolation: false, // Not isolated
      },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'IoT-Network',
        enabled: true,
        security: 'wpapsk',
        networkconf_id: 'net2',
      },
    ],
    portForwards: [],
    settings: {},
  },

  // Config with open WiFi - should trigger wireless rules
  openWifi: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Main-Network',
        enabled: true,
        security: 'open', // Open network
        is_guest: false,
      },
      {
        _id: 'wlan2',
        name: 'Guest-Network',
        enabled: true,
        security: 'open', // Open but guest (OK for captive portal)
        is_guest: true,
      },
    ],
    portForwards: [],
    settings: {},
  },

  // Config with weak WiFi security
  weakWifi: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Main-Network',
        enabled: true,
        security: 'wep', // WEP is weak
        is_guest: false,
      },
    ],
    portForwards: [],
    settings: {},
  },

  // Config with dangerous port forwards
  dangerousPorts: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [
      {
        _id: 'pf1',
        name: 'SSH Access',
        enabled: true,
        dst_port: '22',
        fwd: '192.168.1.100',
        fwd_port: '22',
        proto: 'tcp',
      },
      {
        _id: 'pf2',
        name: 'RDP Access',
        enabled: true,
        dst_port: '3389',
        fwd: '192.168.1.100',
        fwd_port: '3389',
        proto: 'tcp',
      },
    ],
    settings: {},
  },

  // Config with UPnP enabled
  // Note: upnp_enabled must be at top level for normalizeConfig to pick it up
  upnpEnabled: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    upnp_enabled: true,
    upnp_nat_pmp_enabled: true,
    settings: {},
  },

  // Secure configuration - should have minimal findings
  secure: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      {
        _id: 'net2',
        name: 'IoT',
        purpose: 'iot',
        vlan_enabled: true,
        vlan: 20,
        network_isolation: true,
        dhcpd_dns_1: '1.1.1.1',
      },
      {
        _id: 'net3',
        name: 'Guest',
        purpose: 'guest',
        vlan_enabled: true,
        vlan: 30,
        network_isolation: true,
      },
    ],
    firewallRules: [
      {
        _id: 'fw1',
        name: 'Block IoT to LAN',
        enabled: true,
        action: 'drop',
        protocol: 'all',
        src_network_id: 'net2',
        dst_network_id: 'net1',
        ruleset: 'LAN_IN',
        rule_index: 1,
      },
    ],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Main-Network',
        enabled: true,
        security: 'wpapsk',
        wpa_mode: 'wpa2',
        pmf_mode: 'optional',
        is_guest: false,
      },
    ],
    portForwards: [],
    vpnServers: [],
    settings: [
      { key: 'mgmt', upnp_enabled: false },
      { key: 'ips', ips_enabled: true, ips_mode: 'ips' },
      { default_security_posture: 'BLOCK_ALL' },
    ],
  },

  // Config with corporate DNS shared by isolated network
  sharedDns: {
    networks: [
      {
        _id: 'net1',
        name: 'Default',
        purpose: 'corporate',
        dhcpd_enabled: true,
        dhcpd_dns_1: '1.1.1.1',
      },
      {
        _id: 'net2',
        name: 'IoT',
        purpose: 'iot',
        dhcpd_enabled: true,
        dhcpd_dns_1: '1.1.1.1', // Same as corporate
        network_isolation: true,
      },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // ACL / L3 isolation config
  aclConfig: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: false },
      { _id: 'net2', name: 'IoT', purpose: 'iot', vlan_enabled: true, vlan: 20 },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    aclRules: [
      {
        _id: 'acl1',
        name: 'Block IoT to Default',
        type: 'IPV4',
        action: 'BLOCK',
        enabled: true,
        acl_index: 10,
        traffic_source: { network_ids: ['net2'] },
        traffic_destination: { network_ids: ['net1'] },
      },
    ],
    settings: {
      acl_l3_isolation: [
        {
          source_network: 'net2',
          destination_networks: ['net1'],
        },
      ],
      acl_device_isolation: ['net2'],
    },
  },

  // Config with security posture set to ALLOW_ALL — should trigger IS-POSTURE-001
  allowAllPosture: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: [
      { key: 'firewall', default_security_posture: 'ALLOW_ALL' },
    ],
  },

  // Config with security/camera network not isolated — should trigger IS-VLAN-002
  cameraNotIsolated: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      {
        _id: 'net2',
        name: 'Security Cameras',
        purpose: 'corporate',
        vlan_enabled: true,
        vlan: 40,
        network_isolation: false, // Camera network not isolated
      },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // Config with guest network not isolated — should trigger IS-VLAN-003
  guestNotIsolated: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      {
        _id: 'net2',
        name: 'Guest',
        purpose: 'guest',
        vlan_enabled: true,
        vlan: 30,
        network_isolation: false, // Guest network not isolated
      },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // Config with broad allow firewall rule — should trigger IS-FW-002
  broadAllowRule: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [
      {
        _id: 'fw1',
        name: 'Allow Outbound',
        enabled: true,
        action: 'accept',
        protocol: 'tcp',
        predefined: false,
        ruleset: 'LAN_OUT',
        rule_index: 1,
        // Has protocol restriction but no src/dst/port specifics → broad
      },
    ],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // Config with IDS/IPS not enabled — should trigger IS-IPS-001
  noIps: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: [
      { key: 'ips', ips_enabled: false },
    ],
  },

  // Config with L2TP VPN — should trigger IS-VPN-001
  l2tpVpn: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    vpnServers: [
      {
        _id: 'vpn1',
        name: 'L2TP VPN',
        enabled: true,
        protocol: 'l2tp',
        port: 1701,
      },
    ],
    settings: {},
  },

  // ============================================
  // NEW FIXTURES FOR UNTESTED RULES
  // ============================================

  // IS-VLAN-004: Security/camera network with unrestricted internet access
  securityNetInternet: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      {
        _id: 'net2',
        name: 'Security Cameras',
        purpose: 'corporate',
        vlan_enabled: true,
        vlan: 40,
        network_isolation: true,
        internet_access_enabled: true, // Cameras should NOT have internet
      },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // IS-VLAN-004 pass: Security network with internet disabled
  securityNetNoInternet: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      {
        _id: 'net2',
        name: 'Security Cameras',
        purpose: 'corporate',
        vlan_enabled: true,
        vlan: 40,
        network_isolation: true,
        internet_access_enabled: false,
      },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // IS-WIFI-003: WLANs with PMF disabled
  pmfDisabled: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Home WiFi',
        enabled: true,
        security: 'wpapsk',
        is_guest: false,
        pmf_mode: 'disabled',
      },
    ],
    portForwards: [],
    settings: {},
  },

  // IS-WIFI-003 pass: PMF enabled
  pmfEnabled: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Home WiFi',
        enabled: true,
        security: 'wpapsk',
        is_guest: false,
        pmf_mode: 'required',
      },
    ],
    portForwards: [],
    settings: {},
  },

  // IS-WIFI-005: Guest WLAN without client isolation
  noClientIsolation: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
      { _id: 'net2', name: 'Guest', purpose: 'guest', vlan_enabled: true, vlan: 30 },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Guest WiFi',
        enabled: true,
        security: 'wpapsk',
        is_guest: true,
        ap_isolation: false,
        l2_isolation: false,
      },
    ],
    portForwards: [],
    settings: {},
  },

  // IS-WIFI-005 pass: Guest WLAN with client isolation
  clientIsolationEnabled: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Guest WiFi',
        enabled: true,
        security: 'wpapsk',
        is_guest: true,
        l2_isolation: true,
      },
    ],
    portForwards: [],
    settings: {},
  },

  // IS-WIFI-007: Corporate WLAN on WPA2 only (no WPA3)
  noWpa3: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Office WiFi',
        enabled: true,
        security: 'wpapsk',
        is_guest: false,
        wpa_mode: 'wpa2',
        wpa3_support: false,
        wpa3_transition: false,
      },
    ],
    portForwards: [],
    settings: {},
  },

  // IS-WIFI-007 pass: WLAN with WPA3 transition mode
  wpa3Enabled: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Office WiFi',
        enabled: true,
        security: 'wpapsk',
        is_guest: false,
        wpa_mode: 'wpa2',
        wpa3_support: true,
        wpa3_transition: true,
      },
    ],
    portForwards: [],
    settings: {},
  },

  // IS-IPS-002: IPS enabled but sensitivity too low
  ipsLowSensitivity: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: [
      { key: 'ips', ips_enabled: true, ips_mode: 'ips', ips_sensitivity: 'low' },
    ],
  },

  // IS-ACCESS-001: SSH enabled globally
  sshEnabled: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: [
      { key: 'mgmt', ssh_enabled: true },
    ],
  },

  // IS-ACCESS-002: Remote access enabled
  remoteAccess: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: [
      { key: 'mgmt', remote_access_enabled: true },
    ],
  },

  // IS-ACCESS-003: Corporate WLAN without RADIUS
  noRadius: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Corporate Office',
        enabled: true,
        security: 'wpapsk',
        is_guest: false,
        // No radius_profile_id
      },
    ],
    portForwards: [],
    settings: {},
  },

  // IS-SWITCH-001: DHCP guarding not enabled
  // dhcp_guarding_enabled is read from top-level rawConfig by normalizeConfig
  noDhcpGuard: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    dhcp_guarding_enabled: false,
    settings: {},
  },

  // IS-SWITCH-002: Storm control not enabled
  // storm_control_enabled is read from top-level rawConfig by normalizeConfig
  noStormControl: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    storm_control_enabled: false,
    settings: {},
  },

  // IS-GEN-002: mDNS reflector enabled across all VLANs
  mdnsAcrossVlans: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      { _id: 'net2', name: 'IoT', purpose: 'iot', vlan_enabled: true, vlan: 20 },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    mdns_enabled: true,
    mdns_mode: 'all',
    settings: {},
  },

  // IS-GEN-001: Multiple networks but no management network
  noManagementNetwork: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      { _id: 'net2', name: 'IoT', purpose: 'iot', vlan_enabled: true, vlan: 20 },
      { _id: 'net3', name: 'Guest', purpose: 'guest', vlan_enabled: true, vlan: 30 },
    ],
    firewallRules: [],
    wlans: [],
    portForwards: [],
    settings: {},
  },

  // OPT-NET-003: Too many SSIDs
  tooManySsids: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate' },
    ],
    firewallRules: [],
    wlans: [
      { _id: 'wlan1', name: 'Home', enabled: true, security: 'wpapsk' },
      { _id: 'wlan2', name: 'Guest', enabled: true, security: 'wpapsk', is_guest: true },
      { _id: 'wlan3', name: 'IoT', enabled: true, security: 'wpapsk' },
      { _id: 'wlan4', name: 'Work', enabled: true, security: 'wpapsk' },
      { _id: 'wlan5', name: 'Kids', enabled: true, security: 'wpapsk' },
      { _id: 'wlan6', name: 'Media', enabled: true, security: 'wpapsk' },
    ],
    portForwards: [],
    settings: {},
  },

  // Optimization baseline config (all OPT-* rules should trigger)
  // Note: Some rules check === false or === 'off', NOT undefined, so explicit values needed
  optimizationBaseline: {
    networks: [
      { _id: 'net1', name: 'Default', purpose: 'corporate', vlan_enabled: true, vlan: 1 },
      { _id: 'net2', name: 'IoT Devices', purpose: 'iot', vlan_enabled: true, vlan: 20 },
      { _id: 'net3', name: 'Smart Home', purpose: 'corporate', vlan_enabled: true, vlan: 30 },
    ],
    firewallRules: [],
    wlans: [
      {
        _id: 'wlan1',
        name: 'Main Network',
        enabled: true,
        security: 'wpapsk',
        band_steering_mode: 'off',       // triggers OPT-WIFI-002
        // fast_roaming_enabled unset → triggers OPT-WIFI-003 (checks !value)
        multicast_enhance: false,         // triggers OPT-WIFI-004 (checks === false)
        bss_transition: false,            // triggers OPT-NET-005 (checks === false)
      },
      {
        _id: 'wlan2',
        name: 'IoT WiFi',
        enabled: true,
        security: 'wpapsk',
        // optimize_iot not set → triggers OPT-WIFI-001
      },
    ],
    portForwards: [],
    igmp_snooping_enabled: false,  // top-level, triggers OPT-NET-001
    mdns_enabled: false,           // top-level, triggers OPT-NET-002
    settings: {},
  },
};
