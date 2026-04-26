/**
 * Network Optimization Rules
 *
 * Best practice recommendations for UniFi network configuration.
 * These are non-security suggestions to improve network performance and reliability.
 */

import { SecurityRule, UniFiConfigData, RuleCheckResult } from '../types';

// Helper to check if a network is likely an IoT network
const isIoTNetwork = (name: string): boolean => {
  const lower = (name || '').toLowerCase();
  return lower.includes('iot') || lower.includes('smart') || lower.includes('device');
};

// Helper to check if network likely has multiple APs (based on having multiple networks/vlans)
const likelyHasMultipleAPs = (config: UniFiConfigData): boolean => {
  // If there are multiple networks/VLANs, likely a larger setup with multiple APs
  return config.networks.length > 2 || config.wlans.length > 2;
};

const optimizationRules: SecurityRule[] = [
  // ============================================
  // WIFI OPTIMIZATION RULES
  // ============================================
  {
    id: 'OPT-WIFI-001',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'IoT Network Missing WiFi Optimization',
    description: 'Checks if IoT networks have the "Optimize IoT WiFi Connectivity" setting enabled',
    severity: 'INFO',
    impact: 'IoT devices may experience connectivity issues. The IoT optimization setting disables band steering and adjusts DTIM for better IoT device compatibility.',
    remediation: 'Enable "Optimize IoT WiFi Connectivity" in WiFi settings for IoT networks. This improves reliability for 2.4GHz-only smart home devices by disabling band steering and optimizing DTIM intervals.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      for (const wlan of config.wlans) {
        if (!wlan.enabled) continue;

        if (isIoTNetwork(wlan.name) && !wlan.optimize_iot) {
          results.push({
            found: true,
            affectedResource: `WiFi: ${wlan.name}`,
            details: `IoT network "${wlan.name}" does not have WiFi optimization enabled`,
            currentValue: 'Optimize IoT: Disabled',
            expectedValue: 'Optimize IoT: Enabled',
          });
        }
      }

      return results;
    },
  },

  {
    id: 'OPT-WIFI-002',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'Band Steering Disabled on Main Network',
    description: 'Checks if band steering is enabled on non-IoT networks to push capable devices to 5GHz',
    severity: 'INFO',
    impact: 'Dual-band devices may stay on congested 2.4GHz instead of using faster 5GHz. Band steering helps move capable devices to the less congested 5GHz band.',
    remediation: 'Enable Band Steering on your main/work networks. This automatically moves 5GHz-capable devices to the faster band, reducing 2.4GHz congestion. Note: Keep band steering disabled on IoT networks.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      for (const wlan of config.wlans) {
        if (!wlan.enabled) continue;
        // Skip IoT networks - they should NOT have band steering
        if (isIoTNetwork(wlan.name)) continue;
        // Skip guest networks - compatibility matters more
        if (wlan.is_guest) continue;

        // Check if band steering is disabled
        if (wlan.band_steering_mode === 'off' || wlan.band_steering_mode === 'disabled') {
          results.push({
            found: true,
            affectedResource: `WiFi: ${wlan.name}`,
            details: `Network "${wlan.name}" has band steering disabled`,
            currentValue: 'Band Steering: Disabled',
            expectedValue: 'Band Steering: Prefer 5GHz or Balanced',
          });
        }
      }

      return results;
    },
  },

  {
    id: 'OPT-WIFI-003',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'Fast Roaming (802.11r) Not Enabled',
    description: 'Checks if 802.11r fast BSS transition is enabled for networks with likely multiple APs',
    severity: 'INFO',
    impact: 'Devices may experience brief disconnections when moving between access points. Fast roaming (802.11r) enables seamless handoff between APs.',
    remediation: 'Enable Fast BSS Transition (802.11r) for networks used for VoIP, video calls, or when moving around with devices. Note: Some older devices may not support 802.11r.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      // Only check if there are likely multiple APs
      if (!likelyHasMultipleAPs(config)) {
        return results;
      }

      for (const wlan of config.wlans) {
        if (!wlan.enabled) continue;
        // Skip IoT/guest networks - less critical for roaming
        if (isIoTNetwork(wlan.name) || wlan.is_guest) continue;

        if (!wlan.fast_roaming_enabled) {
          results.push({
            found: true,
            affectedResource: `WiFi: ${wlan.name}`,
            details: `Network "${wlan.name}" does not have fast roaming enabled`,
            currentValue: '802.11r: Disabled',
            expectedValue: '802.11r: Enabled',
          });
        }
      }

      return results;
    },
  },

  {
    id: 'OPT-WIFI-004',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'Multicast Enhancement Not Enabled',
    description: 'Checks if multicast enhancement (IGMPv3) is enabled for better streaming performance',
    severity: 'INFO',
    impact: 'Multicast traffic (streaming, AirPlay, Chromecast) may be inefficient. Multicast enhancement converts multicast to unicast for better reliability.',
    remediation: 'Enable Multicast Enhancement for networks with streaming devices. This can improve performance for smart speakers, streaming devices, and AirPlay/Chromecast.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      for (const wlan of config.wlans) {
        if (!wlan.enabled) continue;
        // Skip guest networks
        if (wlan.is_guest) continue;

        // Only flag main/trusted networks where streaming is likely
        const isMainNetwork = !isIoTNetwork(wlan.name) && !wlan.is_guest;

        if (isMainNetwork && wlan.multicast_enhance === false) {
          results.push({
            found: true,
            affectedResource: `WiFi: ${wlan.name}`,
            details: `Network "${wlan.name}" does not have multicast enhancement enabled`,
            currentValue: 'Multicast Enhancement: Disabled',
            expectedValue: 'Multicast Enhancement: Enabled',
          });
        }
      }

      return results;
    },
  },

  // ============================================
  // NETWORK OPTIMIZATION RULES
  // ============================================
  {
    id: 'OPT-NET-001',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'IGMP Snooping Not Enabled',
    description: 'Checks if IGMP snooping is enabled to optimize multicast traffic',
    severity: 'INFO',
    impact: 'Multicast traffic may flood all switch ports instead of only ports with interested receivers. This wastes bandwidth and can cause congestion.',
    remediation: 'Enable IGMP Snooping in switch settings. This ensures multicast traffic only goes to devices that requested it, improving network efficiency.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      if (config.settings.igmp_snooping_enabled === false) {
        results.push({
          found: true,
          affectedResource: 'Global Settings',
          details: 'IGMP Snooping is disabled',
          currentValue: 'IGMP Snooping: Disabled',
          expectedValue: 'IGMP Snooping: Enabled',
        });
      }

      return results;
    },
  },

  {
    id: 'OPT-NET-002',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'mDNS Not Enabled for Smart Home',
    description: 'Checks if mDNS (multicast DNS) is enabled for device discovery',
    severity: 'INFO',
    impact: 'Smart home devices, AirPlay, Chromecast, and other discovery-based services may not work across VLANs. mDNS reflection enables cross-VLAN device discovery.',
    remediation: 'Enable mDNS in Services settings if you have smart home devices or use AirPlay/Chromecast across VLANs. Note: Only enable where needed for security.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      // Only flag if there are multiple networks (VLANs) where mDNS might be needed
      if (config.networks.length > 1 && config.settings.mdns_enabled === false) {
        results.push({
          found: true,
          affectedResource: 'Global Settings',
          details: 'mDNS is disabled but multiple networks exist',
          currentValue: 'mDNS: Disabled',
          expectedValue: 'mDNS: Enabled (if using smart home/AirPlay)',
        });
      }

      return results;
    },
  },

  {
    id: 'OPT-NET-003',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'Too Many SSIDs',
    description: 'Checks if there are too many SSIDs which can impact performance',
    severity: 'INFO',
    impact: 'Each SSID adds management overhead and beacon traffic. More than 4-5 SSIDs per AP can noticeably impact performance and airtime.',
    remediation: 'Consider consolidating SSIDs where possible. Use VLANs with a single SSID and dynamic VLAN assignment, or reduce the number of separate networks.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      const enabledSSIDs = config.wlans.filter(w => w.enabled).length;

      if (enabledSSIDs > 5) {
        results.push({
          found: true,
          affectedResource: 'WiFi Configuration',
          details: `${enabledSSIDs} SSIDs are enabled, which may impact WiFi performance`,
          currentValue: `SSIDs: ${enabledSSIDs}`,
          expectedValue: 'SSIDs: 4-5 or fewer recommended',
        });
      }

      return results;
    },
  },

  {
    id: 'OPT-NET-005',
    sourceId: 'industry-standards',
    category: 'optimization',
    name: 'BSS Transition (802.11v) Not Enabled',
    description: 'Checks if 802.11v BSS transition is enabled for assisted roaming',
    severity: 'INFO',
    impact: 'APs cannot suggest better APs to clients. 802.11v allows APs to inform clients of better connection options, improving roaming.',
    remediation: 'Enable BSS Transition (802.11v) for smoother client roaming between access points. Works well in combination with 802.11r fast roaming.',
    check: (config: UniFiConfigData): RuleCheckResult[] => {
      const results: RuleCheckResult[] = [];

      // Only check if likely multiple APs
      if (!likelyHasMultipleAPs(config)) {
        return results;
      }

      for (const wlan of config.wlans) {
        if (!wlan.enabled) continue;
        // Skip IoT/guest
        if (isIoTNetwork(wlan.name) || wlan.is_guest) continue;

        if (wlan.bss_transition === false) {
          results.push({
            found: true,
            affectedResource: `WiFi: ${wlan.name}`,
            details: `Network "${wlan.name}" does not have BSS transition enabled`,
            currentValue: '802.11v: Disabled',
            expectedValue: '802.11v: Enabled',
          });
        }
      }

      return results;
    },
  },
];

export default optimizationRules;
