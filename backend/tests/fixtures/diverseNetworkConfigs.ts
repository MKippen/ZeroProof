/**
 * Diverse Network Persona Configs
 *
 * Realistic UniFi configs for different user types, exercising different rule
 * evaluation paths. Each persona documents which rules should/shouldn't fire.
 */

/**
 * PERSONA A: Apartment Dweller
 *
 * Single flat network, no VLANs, one SSID, WPA2, no port forwards.
 * Represents the simplest possible setup — someone who just plugged in their
 * UniFi Dream Router and never segmented anything.
 *
 * Expected findings:
 *   SHOULD fire:
 *     - IS-VLAN-006  (no VLAN segmentation — only 1 network)
 *     - IS-IPS-001   (IDS/IPS not enabled — no settings)
 *     - IS-DNS-001   (using default ISP DNS — no custom DNS set)
 *     - IS-POSTURE-001 (default security posture not set)
 *   SHOULD NOT fire:
 *     - IS-VLAN-001  (no IoT network exists to check isolation)
 *     - IS-VLAN-002  (no security/camera network)
 *     - IS-VLAN-003  (no guest network)
 *     - IS-FW-001    (no firewall rules at all)
 *     - IS-PORT-001  (no port forwards)
 *     - IS-WIFI-001  (using WPA2, not open)
 *     - IS-UPNP-001  (UPnP not enabled)
 */
export const PERSONA_A_APARTMENT = {
  networks: [
    {
      _id: 'net-default',
      name: 'Default',
      purpose: 'corporate',
      vlan_enabled: false,
      ip_subnet: '192.168.1.0/24',
      dhcpd_enabled: true,
      // No custom DNS → should trigger IS-DNS-001
    },
  ],
  firewallRules: [],
  firewallPolicies: [],
  wlans: [
    {
      _id: 'wlan-home',
      name: 'Home WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-default',
      is_guest: false,
    },
  ],
  portForwards: [],
  aclRules: [],
  vpnServers: [],
  settings: [] as any[], // Settings as array (UniFi API format)
};

/**
 * PERSONA E: Edge Case Breaker
 *
 * Non-standard network names that stress-test name matching:
 *   - "Downstairs Devices" — has "device" → should be detected as IoT
 *   - "Visitors" — does NOT contain "guest" → should NOT be detected as guest
 *   - "CCTV" — does NOT contain "camera"/"security"/"nvr"/"surveillance"
 *     → should NOT be detected as security network
 *   - "The Office" — contains "office" → should be detected as work network
 *
 * Also includes:
 *   - WEP WiFi (weakest encryption)
 *   - L2TP VPN (deprecated protocol)
 *   - Disabled firewall rule (should not trigger findings)
 *   - Factory-default network with no VLAN
 *   - Wide port range forward
 *   - Hidden SSID
 *   - Fast roaming without PMF
 *
 * Expected findings:
 *   SHOULD fire:
 *     - IS-WIFI-002  (WEP WiFi — "Legacy CCTV" WLAN)
 *     - IS-WIFI-004  (hidden SSID — "The Office WiFi")
 *     - IS-WIFI-006  (fast roaming without PMF — "Visitors WiFi")
 *     - IS-VLAN-001  (IoT not isolated — "Downstairs Devices" detected as IoT)
 *     - IS-VPN-001   (L2TP VPN in use)
 *     - IS-VPN-002   (VPN without logging)
 *     - IS-PORT-002  (wide port range forward: 1000-2000)
 *     - IS-POSTURE-001 (default security posture = ALLOW_ALL)
 *     - IS-IPS-001   (IDS/IPS not enabled)
 *     - IS-UPNP-001  (UPnP enabled)
 *   SHOULD NOT fire:
 *     - IS-FW-001    (only firewall rule is disabled)
 *     - IS-FW-002    (only firewall rule is disabled)
 *     - IS-VLAN-002  ("CCTV" is NOT matched as security — no keyword match)
 *     - IS-VLAN-003  ("Visitors" is NOT matched as guest — no keyword match)
 *     - IS-PORT-001  (no sensitive port forwards — only wide range)
 *   BOUNDARY CASES:
 *     - IS-VLAN-005  ("The Office" → work network, not isolated)
 *     - IS-ACCESS-003 ("The Office WiFi" → name matches "office", WPA-PSK, no RADIUS)
 */
export const PERSONA_E_EDGE_CASE = {
  networks: [
    {
      _id: 'net-default',
      name: 'Default',
      purpose: 'corporate',
      vlan_enabled: false,
      ip_subnet: '192.168.1.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
    },
    {
      _id: 'net-downstairs',
      name: 'Downstairs Devices',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 10,
      ip_subnet: '192.168.10.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '8.8.8.8',
      network_isolation: false, // "device" in name → IoT → not isolated → IS-VLAN-001
    },
    {
      _id: 'net-visitors',
      name: 'Visitors',
      purpose: 'corporate', // Not purpose=guest, name doesn't contain "guest"
      vlan_enabled: true,
      vlan: 30,
      ip_subnet: '192.168.30.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '9.9.9.9',
      network_isolation: true,
    },
    {
      _id: 'net-cctv',
      name: 'CCTV',
      purpose: 'corporate', // Doesn't match camera/security/nvr/surveillance
      vlan_enabled: true,
      vlan: 40,
      ip_subnet: '192.168.40.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      network_isolation: true,
    },
    {
      _id: 'net-office',
      name: 'The Office',
      purpose: 'corporate', // "office" in name → work network
      vlan_enabled: true,
      vlan: 50,
      ip_subnet: '192.168.50.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      network_isolation: false, // Work network not isolated → IS-VLAN-005
    },
  ],
  firewallRules: [
    {
      _id: 'fw-disabled',
      name: 'Allow All (DISABLED)',
      enabled: false, // Disabled rules should NOT trigger findings
      action: 'accept',
      protocol: 'all',
      ruleset: 'LAN_IN',
      rule_index: 1,
    },
  ],
  firewallPolicies: [],
  wlans: [
    {
      _id: 'wlan-home',
      name: 'Home WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-default',
      is_guest: false,
    },
    {
      _id: 'wlan-cctv',
      name: 'Legacy CCTV',
      enabled: true,
      security: 'wep', // WEP → IS-WIFI-002
      networkconf_id: 'net-cctv',
      is_guest: false,
    },
    {
      _id: 'wlan-visitors',
      name: 'Visitors WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'disabled', // PMF disabled
      fast_roaming_enabled: true, // Fast roaming + no PMF → IS-WIFI-006
      networkconf_id: 'net-visitors',
      is_guest: false, // Not marked guest despite name
    },
    {
      _id: 'wlan-office',
      name: 'The Office WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'required',
      hide_ssid: true, // Hidden SSID → IS-WIFI-004
      networkconf_id: 'net-office',
      is_guest: false,
      // No radius_profile_id → with "office" in name → IS-ACCESS-003
    },
  ],
  portForwards: [
    {
      _id: 'pf-wide-range',
      name: 'Game Server Range',
      enabled: true,
      dst_port: '1000-2000', // Wide range (1000 ports) → IS-PORT-002
      fwd: '192.168.1.50',
      fwd_port: '1000-2000',
      proto: 'udp',
    },
  ],
  aclRules: [],
  vpnServers: [
    {
      _id: 'vpn-l2tp',
      name: 'Remote Access VPN',
      enabled: true,
      protocol: 'l2tp', // Deprecated → IS-VPN-001
      port: 1701,
      // No logging → IS-VPN-002
    },
  ],
  settings: [
    { key: 'super_identity', setting_preference: 'auto' },
    { key: 'ips', ips_enabled: false }, // IDS/IPS not enabled → IS-IPS-001
    { key: 'mgmt', upnp_enabled: true }, // UPnP enabled → IS-UPNP-001 (normalizer reads from key='mgmt')
    {
      key: 'firewall',
      default_security_posture: 'ALLOW_ALL', // → IS-POSTURE-001
    },
  ],
};

/**
 * PERSONA B: Family Home
 *
 * 4-bedroom house with kids, IoT smart home devices, camera system, and guest WiFi.
 * Represents a security-aware homeowner who set up VLANs but missed some details.
 *
 * Networks: Home (default), Kids, IoT, Cameras, Guest
 * Issues: Guest WiFi missing client isolation, cameras have internet access,
 *         no PMF on main network, IoT WLAN missing optimization.
 *
 * Expected findings:
 *   SHOULD fire:
 *     - IS-WIFI-005  (guest WLAN missing client isolation / l2_isolation)
 *     - IS-VLAN-004  (camera network has internet access — not restricted)
 *     - IS-WIFI-003  (PMF not enabled on Kids WiFi — pmf_mode: disabled)
 *     - IS-DNS-002   (shared DNS across isolated VLANs — same DNS on all)
 *   SHOULD NOT fire:
 *     - IS-FW-001    (firewall rules are targeted, not any-to-any)
 *     - IS-WIFI-001  (all WLANs use WPA2/WPA3)
 *     - IS-WIFI-002  (no WEP)
 *     - IS-VLAN-006  (multiple VLANs configured)
 *     - IS-UPNP-001  (UPnP disabled)
 *     - IS-PORT-001  (no dangerous port forwards)
 */
export const PERSONA_B_FAMILY_HOME = {
  networks: [
    {
      _id: 'net-home',
      name: 'Home',
      purpose: 'corporate',
      vlan_enabled: false,
      ip_subnet: '192.168.1.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      dhcpd_dns_2: '1.0.0.1',
    },
    {
      _id: 'net-kids',
      name: 'Kids Network',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 10,
      ip_subnet: '192.168.10.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.3', // Cloudflare family filter
      dhcpd_dns_2: '1.0.0.3',
    },
    {
      _id: 'net-iot',
      name: 'IoT Devices',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 20,
      ip_subnet: '192.168.20.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      network_isolation: true,
    },
    {
      _id: 'net-cameras',
      name: 'Security Cameras',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 30,
      ip_subnet: '192.168.30.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      network_isolation: true,
      internet_access_enabled: true, // Camera VLAN with internet → IS-VLAN-004
    },
    {
      _id: 'net-guest',
      name: 'Guest Network',
      purpose: 'guest',
      vlan_enabled: true,
      vlan: 40,
      ip_subnet: '192.168.40.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
    },
  ],
  firewallRules: [
    {
      _id: 'fw-block-iot-lan',
      name: 'Block IoT to LAN',
      enabled: true,
      action: 'drop',
      protocol: 'all',
      ruleset: 'LAN_IN',
      rule_index: 1,
      src_network_id: 'net-iot',
      dst_network_id: 'net-home',
    },
    {
      _id: 'fw-block-cameras-lan',
      name: 'Block Cameras to LAN',
      enabled: true,
      action: 'drop',
      protocol: 'all',
      ruleset: 'LAN_IN',
      rule_index: 2,
      src_network_id: 'net-cameras',
      dst_network_id: 'net-home',
    },
  ],
  firewallPolicies: [],
  wlans: [
    {
      _id: 'wlan-home',
      name: 'FamilyNet',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-home',
      is_guest: false,
    },
    {
      _id: 'wlan-kids',
      name: 'Kids WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'disabled', // PMF disabled → IS-WIFI-003
      networkconf_id: 'net-kids',
      is_guest: false,
    },
    {
      _id: 'wlan-iot',
      name: 'Smart Home',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-iot',
      is_guest: false,
    },
    {
      _id: 'wlan-guest',
      name: 'Guest WiFi',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-guest',
      is_guest: true,
      // Missing l2_isolation → IS-WIFI-005
    },
  ],
  portForwards: [],
  aclRules: [],
  vpnServers: [],
  settings: [
    { key: 'ips', ips_enabled: true, ips_mode: 'ips', ips_sensitivity: 3 },
    { key: 'mgmt', upnp_enabled: false },
  ],
};

/**
 * PERSONA C: Power User / Home Lab Enthusiast
 *
 * Home office + smart home + self-hosted services. Heavily segmented.
 * Has 6 VLANs, 6+ SSIDs, VPN server, port forwards for self-hosted apps,
 * IPS enabled, full ACL rules. Mostly well-configured but triggers
 * optimization rules due to SSID count and some missing tuning.
 *
 * Networks: Management, Work, IoT, Cameras, Guest, Lab
 *
 * Expected findings:
 *   SHOULD fire:
 *     - OPT-NET-003  (6 active SSIDs — too many)
 *     - IS-VPN-003   (VPN server active — informational)
 *     - IS-ACCESS-002 (remote access enabled — informational)
 *   SHOULD NOT fire:
 *     - IS-FW-001    (targeted rules, not any-to-any)
 *     - IS-WIFI-001  (no open networks)
 *     - IS-WIFI-002  (no WEP)
 *     - IS-VLAN-006  (many VLANs)
 *     - IS-UPNP-001  (UPnP disabled)
 *     - IS-IPS-001   (IPS enabled with high sensitivity)
 *     - IS-PORT-001  (only non-sensitive ports forwarded)
 *     - IS-VLAN-001  (IoT isolated)
 *     - IS-VLAN-002  (cameras isolated)
 *     - IS-VLAN-003  (guest isolated)
 */
export const PERSONA_C_POWER_USER = {
  networks: [
    {
      _id: 'net-mgmt',
      name: 'Management',
      purpose: 'management',
      vlan_enabled: true,
      vlan: 1,
      ip_subnet: '192.168.1.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '9.9.9.9',
      dhcpd_dns_2: '149.112.112.112',
    },
    {
      _id: 'net-work',
      name: 'Work Office',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 10,
      ip_subnet: '10.10.10.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '9.9.9.9',
      network_isolation: false,
    },
    {
      _id: 'net-iot',
      name: 'IoT Devices',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 20,
      ip_subnet: '10.10.20.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '9.9.9.9',
      network_isolation: true,
    },
    {
      _id: 'net-cameras',
      name: 'Surveillance Cameras',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 30,
      ip_subnet: '10.10.30.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '9.9.9.9',
      network_isolation: true,
      internet_access_enabled: false, // Cameras properly locked down
    },
    {
      _id: 'net-guest',
      name: 'Guest Network',
      purpose: 'guest',
      vlan_enabled: true,
      vlan: 40,
      ip_subnet: '10.10.40.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      network_isolation: true,
    },
    {
      _id: 'net-lab',
      name: 'Home Lab',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 50,
      ip_subnet: '10.10.50.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '10.10.50.1', // Local DNS server
    },
  ],
  firewallRules: [
    {
      _id: 'fw-block-iot-all',
      name: 'Block IoT to all LAN',
      enabled: true,
      action: 'drop',
      protocol: 'all',
      ruleset: 'LAN_IN',
      rule_index: 1,
      src_network_id: 'net-iot',
    },
    {
      _id: 'fw-block-cameras-all',
      name: 'Block Cameras to all LAN',
      enabled: true,
      action: 'drop',
      protocol: 'all',
      ruleset: 'LAN_IN',
      rule_index: 2,
      src_network_id: 'net-cameras',
    },
    {
      _id: 'fw-block-guest-all',
      name: 'Block Guest to all LAN',
      enabled: true,
      action: 'drop',
      protocol: 'all',
      ruleset: 'LAN_IN',
      rule_index: 3,
      src_network_id: 'net-guest',
    },
  ],
  firewallPolicies: [],
  wlans: [
    {
      _id: 'wlan-work',
      name: 'WorkNet',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'required',
      networkconf_id: 'net-work',
      is_guest: false,
      fast_roaming_enabled: true,
      bss_transition: true,
      band_steering_mode: 'prefer_5g',
    },
    {
      _id: 'wlan-iot',
      name: 'Smart Devices',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-iot',
      is_guest: false,
      optimize_iot: true,
    },
    {
      _id: 'wlan-cameras',
      name: 'CamNet',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'required',
      networkconf_id: 'net-cameras',
      is_guest: false,
    },
    {
      _id: 'wlan-guest',
      name: 'Guest',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-guest',
      is_guest: true,
      l2_isolation: true,
    },
    {
      _id: 'wlan-lab',
      name: 'LabNet',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'required',
      networkconf_id: 'net-lab',
      is_guest: false,
    },
    {
      _id: 'wlan-media',
      name: 'MediaNet',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-work',
      is_guest: false,
    },
  ],
  portForwards: [
    {
      _id: 'pf-nextcloud',
      name: 'Nextcloud',
      enabled: true,
      dst_port: '443',
      fwd: '10.10.50.10',
      fwd_port: '443',
      proto: 'tcp',
    },
    {
      _id: 'pf-wireguard',
      name: 'WireGuard VPN',
      enabled: true,
      dst_port: '51820',
      fwd: '10.10.50.1',
      fwd_port: '51820',
      proto: 'udp',
    },
  ],
  aclRules: [],
  vpnServers: [
    {
      _id: 'vpn-wg',
      name: 'WireGuard Server',
      enabled: true,
      protocol: 'wireguard',
      port: 51820,
    },
  ],
  settings: [
    { key: 'ips', ips_enabled: true, ips_mode: 'ips', ips_sensitivity: 4 },
    { key: 'mgmt', upnp_enabled: false, remote_access_enabled: true }, // → IS-ACCESS-002 (informational)
  ],
};

/**
 * PERSONA D: Small Business Office
 *
 * Small office (10-20 employees) with compliance-focused setup.
 * Corporate WLAN uses RADIUS, guest/employee networks separated,
 * managed switches with DHCP guarding, SSH disabled, remote access off.
 *
 * Networks: Corporate, Employee WiFi, Guest, Server VLAN
 *
 * Expected findings:
 *   SHOULD fire:
 *     - IS-GEN-002   (mDNS enabled across VLANs — for printer discovery)
 *     - IS-VLAN-001  (no dedicated IoT network, but has printers on corporate)
 *   SHOULD NOT fire:
 *     - IS-ACCESS-001 (SSH disabled)
 *     - IS-ACCESS-002 (remote access disabled)
 *     - IS-ACCESS-003 (corporate WLAN has RADIUS)
 *     - IS-SWITCH-001 (DHCP guarding enabled)
 *     - IS-SWITCH-002 (storm control enabled)
 *     - IS-FW-001    (targeted firewall rules)
 *     - IS-WIFI-001  (no open WiFi)
 *     - IS-UPNP-001  (UPnP disabled)
 *     - IS-IPS-001   (IPS enabled)
 */
export const PERSONA_D_SMALL_BUSINESS = {
  networks: [
    {
      _id: 'net-corporate',
      name: 'Corporate',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 10,
      ip_subnet: '10.0.10.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '10.0.10.1',
      dhcpd_dns_2: '9.9.9.9',
    },
    {
      _id: 'net-employee-wifi',
      name: 'Employee WiFi',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 20,
      ip_subnet: '10.0.20.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '10.0.10.1',
    },
    {
      _id: 'net-guest',
      name: 'Guest',
      purpose: 'guest',
      vlan_enabled: true,
      vlan: 30,
      ip_subnet: '10.0.30.0/24',
      dhcpd_enabled: true,
      dhcpd_dns_1: '1.1.1.1',
      network_isolation: true,
    },
    {
      _id: 'net-servers',
      name: 'Server VLAN',
      purpose: 'corporate',
      vlan_enabled: true,
      vlan: 100,
      ip_subnet: '10.0.100.0/24',
      dhcpd_enabled: false,
      network_isolation: true,
    },
  ],
  firewallRules: [
    {
      _id: 'fw-block-guest',
      name: 'Block Guest to Internal',
      enabled: true,
      action: 'drop',
      protocol: 'all',
      ruleset: 'LAN_IN',
      rule_index: 1,
      src_network_id: 'net-guest',
    },
    {
      _id: 'fw-allow-corp-servers',
      name: 'Allow Corporate to Servers',
      enabled: true,
      action: 'accept',
      protocol: 'tcp',
      ruleset: 'LAN_IN',
      rule_index: 2,
      src_network_id: 'net-corporate',
      dst_network_id: 'net-servers',
    },
  ],
  firewallPolicies: [],
  wlans: [
    {
      _id: 'wlan-corp',
      name: 'OfficeNet',
      enabled: true,
      security: 'wpa-eap', // Enterprise / RADIUS
      wpa_mode: 'wpa2',
      pmf_mode: 'required',
      networkconf_id: 'net-employee-wifi',
      is_guest: false,
      radius_profile_id: 'radius-corp', // Has RADIUS → IS-ACCESS-003 should NOT fire
      fast_roaming_enabled: true,
      bss_transition: true,
    },
    {
      _id: 'wlan-guest',
      name: 'Office Guest',
      enabled: true,
      security: 'wpapsk',
      wpa_mode: 'wpa2',
      pmf_mode: 'optional',
      networkconf_id: 'net-guest',
      is_guest: true,
      l2_isolation: true,
    },
  ],
  portForwards: [],
  aclRules: [],
  vpnServers: [],
  // Top-level settings for normalizeConfig
  ssh_enabled: false,
  remote_access_enabled: false,
  dhcp_guarding_enabled: true,  // → IS-SWITCH-001 should NOT fire
  storm_control_enabled: true,  // → IS-SWITCH-002 should NOT fire
  mdns_enabled: true,           // mDNS across VLANs → IS-GEN-002
  settings: [
    { key: 'ips', ips_enabled: true, ips_mode: 'ips', ips_sensitivity: 4 },
    { key: 'mgmt', upnp_enabled: false, ssh_enabled: false, remote_access_enabled: false },
  ],
};
