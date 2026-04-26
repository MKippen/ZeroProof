import { UniFiConfig, VulnerabilityFinding } from '../types';
import { getRawNetworks } from '../utils/configNormalizer';

export function analyzeVlanConfig(config: UniFiConfig): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const networks = getRawNetworks(config);

  // Check for networks without VLAN isolation
  const vlanNetworks = networks.filter((n) => n.vlan_enabled && n.vlan);

  if (vlanNetworks.length === 0 && networks.length > 1) {
    findings.push({
      type: 'NO_VLAN_SEGMENTATION',
      severity: 'MEDIUM',
      title: 'No VLAN segmentation configured',
      description:
        'Multiple networks exist but none have VLAN tagging enabled. All devices share the same broadcast domain.',
      impact:
        'Without VLAN segmentation, devices cannot be isolated. A compromised device can easily attack others.',
      remediation: `Enable VLAN tagging on your networks to segment traffic.\n\nIn UniFi:\n1. Go to Settings > Networks\n2. Edit each network that should be isolated\n3. Enable "VLAN Only Network" or set a VLAN ID\n4. Ensure your switch ports are configured for the VLANs`,
      affectedResource: 'Network Configuration',
    });
  }

  // Check for VLAN 1 usage (default VLAN - security concern)
  const vlan1Network = networks.find((n) => n.vlan === 1);
  if (vlan1Network) {
    findings.push({
      type: 'VLAN_1_IN_USE',
      severity: 'LOW',
      title: `VLAN 1 is in use for network "${vlan1Network.name}"`,
      description:
        'VLAN 1 is the default VLAN on most switches and should not be used for production traffic.',
      impact: 'Using VLAN 1 can lead to security issues as it is often the native/untagged VLAN.',
      remediation: `Move traffic off VLAN 1 to a dedicated VLAN.\n\nIn UniFi:\n1. Go to Settings > Networks\n2. Edit "${vlan1Network.name}"\n3. Change the VLAN ID to a non-default value (e.g., 10, 20, etc.)`,
      affectedResource: vlan1Network.name,
    });
  }

  // Check for duplicate VLAN IDs
  const vlanIds = vlanNetworks.map((n) => n.vlan).filter((v) => v !== undefined);
  const duplicates = vlanIds.filter((item, index) => vlanIds.indexOf(item) !== index);
  if (duplicates.length > 0) {
    findings.push({
      type: 'DUPLICATE_VLAN_ID',
      severity: 'HIGH',
      title: `Duplicate VLAN IDs detected: ${[...new Set(duplicates)].join(', ')}`,
      description: 'Multiple networks are using the same VLAN ID, which can cause traffic conflicts.',
      impact: 'Traffic from different networks may be merged, breaking isolation.',
      remediation: `Assign unique VLAN IDs to each network.\n\nIn UniFi:\n1. Go to Settings > Networks\n2. Review networks using duplicate VLAN IDs\n3. Assign unique VLAN IDs to each`,
      affectedResource: 'VLAN Configuration',
    });
  }

  // Check for networks without DHCP that might be misconfigured
  for (const network of networks) {
    if (network.purpose === 'corporate' && !network.dhcpd_enabled && !network.vlan_enabled) {
      findings.push({
        type: 'NETWORK_NO_DHCP_NO_VLAN',
        severity: 'INFO',
        title: `Network "${network.name}" has no DHCP and no VLAN`,
        description: `The network "${network.name}" doesn't have DHCP enabled and is not VLAN-tagged. Verify this is intentional.`,
        impact: 'Clients may not get IP addresses, or this network may not be properly isolated.',
        remediation: `Review the configuration of "${network.name}" to ensure it matches your intended design.`,
        affectedResource: network.name,
      });
    }
  }

  // Check for IoT network isolation
  const iotNetwork = networks.find(
    (n) =>
      n.name?.toLowerCase().includes('iot') ||
      n.name?.toLowerCase().includes('smart') ||
      n.name?.toLowerCase().includes('device')
  );

  if (iotNetwork && !iotNetwork.vlan_enabled) {
    findings.push({
      type: 'IOT_NOT_ISOLATED',
      severity: 'HIGH',
      title: `IoT network "${iotNetwork.name}" is not VLAN isolated`,
      description:
        'IoT devices should be isolated on their own VLAN to prevent them from accessing sensitive resources.',
      impact: 'Compromised IoT devices could be used to attack other devices on your network.',
      remediation: `Enable VLAN isolation for the IoT network.\n\nIn UniFi:\n1. Go to Settings > Networks\n2. Edit "${iotNetwork.name}"\n3. Enable VLAN and assign a dedicated VLAN ID\n4. Create firewall rules to restrict IoT access to other networks`,
      affectedResource: iotNetwork.name,
    });
  }

  // Check for guest network isolation
  const guestNetwork = networks.find(
    (n) => n.name?.toLowerCase().includes('guest') || n.purpose === 'guest'
  );

  if (guestNetwork && !guestNetwork.vlan_enabled) {
    findings.push({
      type: 'GUEST_NOT_ISOLATED',
      severity: 'HIGH',
      title: `Guest network "${guestNetwork.name}" is not VLAN isolated`,
      description: 'Guest networks should be isolated to prevent guests from accessing internal resources.',
      impact: 'Guests could access sensitive internal systems and data.',
      remediation: `Enable VLAN isolation for the guest network.\n\nIn UniFi:\n1. Go to Settings > Networks\n2. Edit "${guestNetwork.name}"\n3. Enable VLAN and assign a dedicated VLAN ID\n4. Enable "Guest Network" features for client isolation`,
      affectedResource: guestNetwork.name,
    });
  }

  return findings;
}
