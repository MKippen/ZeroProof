/**
 * Config Key Normalizer
 *
 * UniFi sync stores config with camelCase keys (networkConf, wlanConf, portForward)
 * but various consumers expect different key names (networks, networkconf, wlans, etc.).
 * These helpers handle all known key variants so consumers never miss data.
 */

/**
 * Extract raw networks array from config regardless of key naming.
 * Handles: networks, networkConf, networkconf
 */
export function getRawNetworks(config: any): any[] {
  return config?.networks || config?.networkConf || config?.networkconf || [];
}

/**
 * Extract raw WLANs array from config regardless of key naming.
 * Handles: wlans, wlanConf, wlanconf
 */
export function getRawWlans(config: any): any[] {
  return config?.wlans || config?.wlanConf || config?.wlanconf || [];
}

/**
 * Extract raw firewall rules array from config regardless of key naming.
 * Handles: firewallRules, firewall_rule
 */
export function getRawFirewallRules(config: any): any[] {
  return config?.firewallRules || config?.firewall_rule || [];
}

/**
 * Extract raw firewall groups array from config regardless of key naming.
 * Handles: firewallGroups, firewall_group, firewallgroup
 */
export function getRawFirewallGroups(config: any): any[] {
  return config?.firewallGroups || config?.firewall_group || config?.firewallgroup || [];
}

/**
 * Extract raw port forwards array from config regardless of key naming.
 * Handles: portForwards, portForward, portforward
 */
export function getRawPortForwards(config: any): any[] {
  return config?.portForwards || config?.portForward || config?.portforward || [];
}

/**
 * Extract raw settings from config regardless of key naming.
 * Handles: settings, setting (returns as array for consistency)
 */
export function getRawSettings(config: any): any[] {
  const raw = config?.settings || config?.setting || {};
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * Extract raw clients array from config regardless of key naming.
 * Handles: clients, user, sta
 */
export function getRawClients(config: any): any[] {
  return config?.clients || config?.user || config?.sta || [];
}

/**
 * Extract raw VPN servers array from config regardless of key naming.
 * Handles: vpnServers, vpn_servers
 */
export function getRawVpnServers(config: any): any[] {
  return config?.vpnServers || config?.vpn_servers || [];
}
