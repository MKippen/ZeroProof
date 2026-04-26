import { UniFiConfig, UniFiNetwork, VulnerabilityFinding } from '../types';
import { getRawNetworks, getRawWlans } from '../utils/configNormalizer';

export function analyzeWlanConfig(config: UniFiConfig): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const wlans = getRawWlans(config);
  const networks = getRawNetworks(config);

  // Helper to check if a WLAN is on a VLAN (either directly or via linked network)
  const isOnVlan = (wlan: typeof wlans[0]): boolean => {
    // Check if WLAN has direct VLAN setting
    if (wlan.vlan_enabled) return true;

    // Check if linked network has VLAN enabled
    if (wlan.networkconf_id) {
      const linkedNetwork = networks.find((n: UniFiNetwork) => n._id === wlan.networkconf_id);
      if (linkedNetwork?.vlan_enabled || linkedNetwork?.vlan) return true;
    }

    return false;
  };

  for (const wlan of wlans) {
    if (!wlan.enabled) continue;

    // Check for weak security
    if (wlan.security === 'open') {
      findings.push({
        type: 'OPEN_WIFI_NETWORK',
        severity: 'HIGH',
        title: `WiFi network "${wlan.name}" has no password`,
        description: 'This wireless network has no security enabled. Anyone can connect.',
        impact: 'Unauthorized users can access your network, consume bandwidth, and potentially attack internal resources.',
        remediation: `Enable WPA3 or WPA2 security on this network.\n\nIn UniFi:\n1. Go to Settings > WiFi\n2. Edit "${wlan.name}"\n3. Set Security Protocol to WPA2 or WPA3\n4. Set a strong password`,
        affectedResource: wlan.name,
      });
    }

    // Check for WEP (obsolete)
    if (wlan.security === 'wep') {
      findings.push({
        type: 'WEP_SECURITY',
        severity: 'CRITICAL',
        title: `WiFi network "${wlan.name}" uses WEP encryption`,
        description: 'WEP encryption can be cracked in minutes. It provides almost no security.',
        impact: 'Attackers can easily crack WEP and gain full access to your network.',
        remediation: `Upgrade to WPA3 or WPA2 immediately.\n\nIn UniFi:\n1. Go to Settings > WiFi\n2. Edit "${wlan.name}"\n3. Change Security Protocol to WPA2 or WPA3`,
        affectedResource: wlan.name,
      });
    }

    // Check for WPA (without WPA2)
    if (wlan.security === 'wpa' || (wlan.wpa_mode === 'wpa1' && !wlan.wpa_mode?.includes('wpa2'))) {
      findings.push({
        type: 'WPA1_ONLY',
        severity: 'HIGH',
        title: `WiFi network "${wlan.name}" uses WPA1`,
        description: 'WPA1 has known vulnerabilities and should be upgraded to WPA2 or WPA3.',
        impact: 'WPA1 can be attacked using various techniques including TKIP weaknesses.',
        remediation: `Upgrade to WPA2 or WPA3.\n\nIn UniFi:\n1. Go to Settings > WiFi\n2. Edit "${wlan.name}"\n3. Change Security Protocol to WPA2 or WPA3`,
        affectedResource: wlan.name,
      });
    }

    // Check for TKIP encryption (weaker than CCMP/AES)
    if (wlan.wpa_enc === 'tkip' || wlan.wpa_enc === 'both') {
      findings.push({
        type: 'TKIP_ENCRYPTION',
        severity: 'MEDIUM',
        title: `WiFi network "${wlan.name}" allows TKIP encryption`,
        description: 'TKIP encryption has known weaknesses. Use CCMP (AES) only for better security.',
        impact: 'TKIP is vulnerable to certain attacks and should not be used.',
        remediation: `Set encryption to CCMP/AES only.\n\nIn UniFi:\n1. Go to Settings > WiFi\n2. Edit "${wlan.name}"\n3. Ensure WPA Mode uses AES/CCMP only`,
        affectedResource: wlan.name,
      });
    }

    // Check for guest network without client isolation
    // l2_isolation is the actual UniFi setting for client device isolation on the WLAN
    // Also check if the linked network has network_isolation enabled (provides network-level isolation)
    if (wlan.is_guest && !wlan.l2_isolation) {
      // Check if linked network has isolation enabled
      let linkedNetworkHasIsolation = false;
      if (wlan.networkconf_id) {
        const linkedNetwork = networks.find((n: UniFiNetwork) => n._id === wlan.networkconf_id);
        if (linkedNetwork?.network_isolation) {
          linkedNetworkHasIsolation = true;
        }
      }

      // Only flag if neither WLAN nor linked network has isolation
      if (!linkedNetworkHasIsolation) {
        findings.push({
          type: 'GUEST_NO_ISOLATION',
          severity: 'MEDIUM',
          title: `Guest network "${wlan.name}" may not have client isolation`,
          description: 'Guest networks should have client isolation enabled to prevent guests from seeing each other.',
          impact: 'Guests can potentially attack each other or sniff traffic.',
          remediation: `Enable client isolation on the guest network.\n\nIn UniFi:\n1. Go to Settings > WiFi\n2. Edit "${wlan.name}"\n3. Enable "Guest Policies" and "Client Device Isolation"\n\nOr enable "Isolate Network" on the linked network in Settings > Networks.`,
          affectedResource: wlan.name,
        });
      }
    }

    // Check for hidden SSID (security theater)
    if (wlan.hide_ssid) {
      findings.push({
        type: 'HIDDEN_SSID',
        severity: 'INFO',
        title: `WiFi network "${wlan.name}" has hidden SSID`,
        description: 'Hiding the SSID provides no real security benefit and can cause connectivity issues.',
        impact: 'Hidden SSIDs are easily discovered by wireless scanners. This may cause devices to constantly probe for the network.',
        remediation: 'Consider showing the SSID and relying on proper encryption for security instead.',
        affectedResource: wlan.name,
      });
    }

    // Check for PMF (Protected Management Frames)
    if (!wlan.pmf_mode || wlan.pmf_mode === 'disabled') {
      findings.push({
        type: 'PMF_DISABLED',
        severity: 'LOW',
        title: `WiFi network "${wlan.name}" has PMF disabled`,
        description: 'Protected Management Frames (802.11w) helps prevent deauthentication attacks.',
        impact: 'Without PMF, attackers can disconnect clients from your network using deauth attacks.',
        remediation: `Enable PMF (802.11w).\n\nIn UniFi:\n1. Go to Settings > WiFi\n2. Edit "${wlan.name}"\n3. Enable "BSS Transition" or set PMF mode to Optional/Required`,
        affectedResource: wlan.name,
      });
    }

    // Check for non-VLAN tagged guest networks
    // Check both direct VLAN setting and linked network's VLAN
    if (wlan.is_guest && !isOnVlan(wlan)) {
      findings.push({
        type: 'GUEST_WIFI_NO_VLAN',
        severity: 'HIGH',
        title: `Guest WiFi "${wlan.name}" is not on a separate VLAN`,
        description: 'Guest WiFi networks should be placed on a dedicated VLAN to isolate guest traffic.',
        impact: 'Guest traffic may be able to reach internal resources.',
        remediation: `Assign the guest network to a dedicated VLAN.\n\nIn UniFi:\n1. Create a dedicated Guest network in Settings > Networks\n2. Go to Settings > WiFi\n3. Edit "${wlan.name}"\n4. Assign it to the Guest network`,
        affectedResource: wlan.name,
      });
    }
  }

  // Check for too many open/guest networks
  const openNetworks = wlans.filter((w) => w.enabled && (w.security === 'open' || w.is_guest));
  if (openNetworks.length > 2) {
    findings.push({
      type: 'TOO_MANY_OPEN_NETWORKS',
      severity: 'LOW',
      title: `${openNetworks.length} open or guest WiFi networks detected`,
      description: 'Having many open or guest networks increases management complexity and attack surface.',
      impact: 'Each open network is a potential entry point and consumes radio resources.',
      remediation: 'Review if all open/guest networks are necessary. Consolidate where possible.',
      affectedResource: 'WiFi Configuration',
    });
  }

  return findings;
}
