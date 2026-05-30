/**
 * Backend shim around `@uguard/unifi-client`.
 *
 * The shim preserves the legacy public API surface so existing callers
 * (scheduler, route handlers, history bootstrap) keep working without churn.
 * All HTTP work, schema validation, pagination, and error wrapping happens
 * inside the lib — this file is a thin compatibility layer.
 *
 * Backend-specific concerns that don't belong in the lib stay here:
 *   - Docker host resolution (loopback → host.docker.internal / HOST_IP).
 *   - Composing `getFullConfig` from a dozen typed resource calls.
 *   - Fingerprint database lookup for client device names.
 */

import { existsSync } from 'fs';
import {
  UnifiClient as LibUnifiClient,
  type FirewallPolicy as LibFirewallPolicy,
} from '@uguard/unifi-client';
import logger from '../utils/logger';

export interface UniFiCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  siteId?: string;
  /** When true, accept self-signed certs. Defaults to true (UniFi default). */
  allowSelfSigned?: boolean;
}

export interface UniFiSite {
  _id: string;
  name: string;
  desc: string;
  role: string;
}

export interface UniFiDevice {
  _id: string;
  mac: string;
  ip: string;
  name: string;
  type: string;
  model: string;
  version: string;
  adopted: boolean;
  state: number;
  connected_at?: number;
  disconnected_at?: number;
  provisioned_at?: number;
  startup_timestamp?: number;
  last_seen?: number;
  uptime?: number;
}

export interface UniFiEvent {
  _id: string;
  key: string;
  msg?: string;
  time: number;
  datetime: string;
  site_id?: string;
  subsystem?: string;
  ap?: string;
  ap_name?: string;
  sw?: string;
  sw_name?: string;
  gw?: string;
  gw_name?: string;
  version_from?: string;
  version_to?: string;
  user?: string;
  hostname?: string;
  ssid?: string;
  admin?: string;
  ip?: string;
  [key: string]: any;
}

export interface UniFiAlarm {
  _id: string;
  key: string;
  msg?: string;
  time: number;
  datetime: string;
  site_id?: string;
  subsystem?: string;
  archived?: boolean;
  handled_admin_id?: string;
  handled_time?: string;
  ap?: string;
  ap_name?: string;
  sw?: string;
  sw_name?: string;
  [key: string]: any;
}

export interface UniFiFirewallRule {
  _id: string;
  name: string;
  enabled: boolean;
  ruleset: string;
  rule_index: number;
  action: 'accept' | 'drop' | 'reject';
  protocol: string;
  src_firewallgroup_ids?: string[];
  dst_firewallgroup_ids?: string[];
  src_address?: string;
  dst_address?: string;
  dst_port?: string;
  logging?: boolean;
}

export interface UniFiNetwork {
  _id: string;
  name: string;
  purpose: string;
  vlan?: number;
  vlan_enabled?: boolean;
  ip_subnet?: string;
  dhcpd_enabled?: boolean;
  is_nat?: boolean;
}

export interface UniFiWlan {
  _id: string;
  name: string;
  enabled: boolean;
  security: string;
  wpa_mode?: string;
  wpa_enc?: string;
  pmf_mode?: string;
  is_guest?: boolean;
  vlan_enabled?: boolean;
  vlan?: number;
  hide_ssid?: boolean;
}

export interface UniFiPortForward {
  _id: string;
  name: string;
  enabled: boolean;
  pfwd_interface: string;
  src: string;
  dst_port: string;
  fwd: string;
  fwd_port: string;
  proto: string;
}

export interface UniFiTrafficRule {
  _id: string;
  name?: string;
  description?: string;
  enabled: boolean;
  action: 'BLOCK' | 'ALLOW';
  matching_target: string;
  target_devices?: { type: string; client_mac?: string; network_id?: string }[];
  network_ids?: string[];
  ip_addresses?: string[];
  app_category_ids?: string[];
  schedule?: any;
}

export interface UniFiClient_t {
  _id?: string;
  mac: string;
  ip?: string;
  hostname?: string;
  name?: string;
  fixed_ip?: string;
  network_id?: string;
  oui?: string;
  is_wired?: boolean;
  first_seen?: number;
  last_seen?: number;
  device_name?: string;
  dev_id?: number;
  device_id?: number;
}

export interface UniFiFirewallPolicy {
  _id: string;
  name: string;
  action: 'ALLOW' | 'BLOCK' | 'REJECT';
  enabled: boolean;
  predefined: boolean;
  index: number;
  protocol: string;
  description?: string;
  logging?: boolean;
  source: {
    zone_id: string;
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
    network_ids?: string[];
    ip_addresses?: string[];
    client_macs?: string[];
    port_matching_type?: string;
  };
  destination: {
    zone_id: string;
    matching_target: 'ANY' | 'NETWORK' | 'IP' | 'CLIENT';
    network_ids?: string[];
    ip_addresses?: string[];
    port_ranges?: string[];
    port_matching_type?: string;
  };
}

export interface UniFiVpnServer {
  _id: string;
  name: string;
  enabled: boolean;
  protocol: string;
  port: number;
  encryption?: string;
  auth_type?: string;
  network_id?: string;
  subnet?: string;
  logging_enabled?: boolean;
  [key: string]: any;
}

export interface UniFiTrafficMatchingList {
  _id: string;
  name: string;
  description?: string;
  type: string;
  entries?: any[];
  enabled: boolean;
  [key: string]: any;
}

export interface UniFiSysInfo {
  /** UniFi Network Application version (e.g. "9.x"). NOT the UniFi OS version. */
  version?: string;
  /** UniFi OS / console firmware version (e.g. "5.1.12"). Present on UniFi OS consoles. */
  udm_version?: string;
  build?: string;
  hostname?: string;
  name?: string;
  [key: string]: unknown;
}

export interface UniFiFullConfig {
  sites: UniFiSite[];
  devices: UniFiDevice[];
  firewallRules: UniFiFirewallRule[];
  firewallPolicies: UniFiFirewallPolicy[];
  firewallGroups: any[];
  networks: UniFiNetwork[];
  wlans: UniFiWlan[];
  portForwards: UniFiPortForward[];
  trafficRules: UniFiTrafficRule[];
  routingRules: any[];
  clients: UniFiClient_t[];
  settings: any;
  aclRules: any[];
  rawNetworkConfig: any[];
  vpnServers: UniFiVpnServer[];
  trafficMatchingLists: UniFiTrafficMatchingList[];
  firewallZones: any[];
  sysInfo: UniFiSysInfo | null;
  fetchedAt: Date;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

/**
 * Loopback addresses inside a Docker container point at the container itself,
 * not the host. When running inside Docker, redirect to `HOST_IP` if the user
 * configured one, otherwise fall back to `host.docker.internal`. This is a
 * deployment concern, not a library concern — kept in the backend shim.
 */
export function resolveControllerHost(host: string): string {
  if (!isLoopbackHost(host)) return host;
  if (!existsSync('/.dockerenv')) return host;
  const configuredHostIp = process.env.HOST_IP?.trim();
  if (configuredHostIp && !isLoopbackHost(configuredHostIp)) return configuredHostIp;
  return 'host.docker.internal';
}

/**
 * Backend-facing UniFi client. Public method surface is unchanged from the
 * legacy implementation — every method delegates to `@uguard/unifi-client`
 * (or `client.raw.*` for endpoints not yet modeled as typed resources).
 */
export class UniFiClient {
  private readonly credentials: UniFiCredentials;
  private readonly resolvedHost: string;
  private readonly lib: LibUnifiClient;

  constructor(credentials: UniFiCredentials) {
    this.credentials = credentials;
    this.resolvedHost = resolveControllerHost(credentials.host);

    if (this.resolvedHost !== credentials.host) {
      logger.info(
        `Resolved UniFi host "${credentials.host}" to "${this.resolvedHost}" for container networking`
      );
    }

    this.lib = new LibUnifiClient({
      host: this.resolvedHost,
      port: credentials.port,
      username: credentials.username,
      password: credentials.password,
      siteId: credentials.siteId ?? 'default',
      // UniFi controllers default to self-signed certs. The legacy implementation
      // accepted them unconditionally; preserve that behaviour here so existing
      // deployments don't break. Future: make this opt-in like AdGuardConnection.
      allowSelfSigned: credentials.allowSelfSigned ?? true,
      timeoutMs: 30_000,
      logger: {
        debug: (msg, meta) => logger.debug(msg, meta),
        info: (msg, meta) => logger.info(msg, meta),
        warn: (msg, meta) => logger.warn(msg, meta),
        error: (msg, meta) => logger.error(msg, meta),
      },
    });
  }

  /** Underlying lib client — escape hatch for callers that want the typed surface directly. */
  getLib(): LibUnifiClient {
    return this.lib;
  }

  async login(): Promise<boolean> {
    try {
      await this.lib.login();
      return true;
    } catch (err) {
      logger.error('UniFi login failed', { error: (err as Error).message });
      return false;
    }
  }

  async logout(): Promise<void> {
    await this.lib.logout();
  }

  // -------------------- Reads --------------------

  async getSites(): Promise<UniFiSite[]> {
    return (await this.lib.sites.list()) as unknown as UniFiSite[];
  }

  async getDevices(): Promise<UniFiDevice[]> {
    return (await this.lib.devices.list()) as unknown as UniFiDevice[];
  }

  async getNetworks(): Promise<UniFiNetwork[]> {
    return (await this.lib.networks.list()) as unknown as UniFiNetwork[];
  }

  async getWlans(): Promise<UniFiWlan[]> {
    return (await this.lib.wlans.list()) as unknown as UniFiWlan[];
  }

  async getFirewallRules(): Promise<UniFiFirewallRule[]> {
    return (await this.lib.firewallRules.list()) as unknown as UniFiFirewallRule[];
  }

  async getFirewallGroups(): Promise<any[]> {
    return this.lib.firewallGroups.list();
  }

  async getPortForwards(): Promise<UniFiPortForward[]> {
    return (await this.lib.portForwards.list()) as unknown as UniFiPortForward[];
  }

  async getRoutingRules(): Promise<any[]> {
    return this.lib.routingRules.list();
  }

  async getTrafficRules(): Promise<UniFiTrafficRule[]> {
    return (await this.lib.trafficRules.list()) as unknown as UniFiTrafficRule[];
  }

  async getFirewallPolicies(): Promise<UniFiFirewallPolicy[]> {
    const policies = (await this.lib.firewallPolicies.list()) as LibFirewallPolicy[];
    return policies as unknown as UniFiFirewallPolicy[];
  }

  /**
   * Endpoints below have version- and SKU-dependent availability — `raw.get`
   * gracefully returns an empty array if the controller doesn't expose them
   * (lib throws UnifiNotFoundError, we swallow it).
   */
  async getVpnServers(): Promise<UniFiVpnServer[]> {
    const siteId = this.credentials.siteId || 'default';
    return this.tryRawArray(`/proxy/network/v2/api/site/${siteId}/vpn/servers`, 'VPN servers');
  }

  async getTrafficMatchingLists(): Promise<UniFiTrafficMatchingList[]> {
    const siteId = this.credentials.siteId || 'default';
    return this.tryRawArray(
      `/proxy/network/v2/api/site/${siteId}/traffic-matching-lists`,
      'Traffic matching lists'
    );
  }

  async getFirewallZones(): Promise<any[]> {
    const siteId = this.credentials.siteId || 'default';
    return this.tryRawArray(
      `/proxy/network/v2/api/site/${siteId}/firewall-zones`,
      'Firewall zones'
    );
  }

  async getAclRules(): Promise<any[]> {
    const siteId = this.credentials.siteId || 'default';
    const v2 = await this.tryRawArray(
      `/proxy/network/v2/api/site/${siteId}/acl-rules`,
      'ACL rules (v2)'
    );
    if (v2.length > 0) return v2;
    // V1 fallback
    try {
      const result = await this.lib.raw.get<{ data?: any[] }>(`/api/s/${siteId}/rest/aclrule`);
      return Array.isArray(result) ? result : result.data ?? [];
    } catch {
      return [];
    }
  }

  /** Fingerprint dev_id → friendly name mapping. Multi-path discovery. */
  async getFingerprintDevices(source = 0): Promise<any[]> {
    const siteId = this.credentials.siteId || 'default';
    const candidates = [
      `/proxy/network/v2/api/site/${siteId}/fingerprint-devices/${source}`,
      `/proxy/network/v2/api/fingerprint_devices/${source}`,
      `/proxy/network/api/s/${siteId}/stat/fingerprint-devices/${source}`,
    ];
    for (const url of candidates) {
      try {
        const result = await this.lib.raw.get<unknown>(url);
        const data = Array.isArray(result)
          ? result
          : (result as { data?: unknown[] })?.data ?? [];
        if (Array.isArray(data) && data.length > 0) {
          logger.debug(`Fetched ${data.length} fingerprint device entries`, { url });
          return data;
        }
      } catch {
        continue;
      }
    }
    logger.debug('Fingerprint devices endpoint not available on any path');
    return [];
  }

  async getSettings(): Promise<any> {
    return this.lib.settings.list();
  }

  async getControllerVersion(): Promise<string | null> {
    try {
      return await this.lib.system.getControllerVersion();
    } catch {
      return null;
    }
  }

  /**
   * Full sysinfo payload from `/stat/sysinfo`. Carries both the Network
   * Application version (`version`) and the UniFi OS / console firmware
   * version (`udm_version`) — the latter is what security advisories such as
   * SAB-064 are versioned against. Returns null if unavailable.
   */
  async getSysInfo(): Promise<UniFiSysInfo | null> {
    try {
      return (await this.lib.system.get()) as UniFiSysInfo | null;
    } catch {
      return null;
    }
  }

  async getClients(): Promise<any[]> {
    return this.lib.clients.listActive();
  }

  async getAllUsers(limit = 5000): Promise<UniFiClient_t[]> {
    return (await this.lib.clients.listAll({ limit })) as unknown as UniFiClient_t[];
  }

  async getEvents(limit = 3000): Promise<UniFiEvent[]> {
    return (await this.lib.events.list({ limit })) as unknown as UniFiEvent[];
  }

  async getAlarms(limit = 3000): Promise<UniFiAlarm[]> {
    return (await this.lib.alarms.list({ limit })) as unknown as UniFiAlarm[];
  }

  async getRawNetworkConfig(): Promise<any[]> {
    return this.lib.networks.list();
  }

  // -------------------- Writes --------------------

  async createFirewallRule(rule: Partial<UniFiFirewallRule>): Promise<any> {
    logger.info(`Creating firewall rule: ${rule.name}`);
    return this.lib.firewallRules.create(rule as never);
  }

  async updateFirewallRule(ruleId: string, updates: Partial<UniFiFirewallRule>): Promise<any> {
    logger.info(`Updating firewall rule: ${ruleId}`);
    return this.lib.firewallRules.update(ruleId, updates as never);
  }

  async deleteFirewallRule(ruleId: string): Promise<any> {
    logger.info(`Deleting firewall rule: ${ruleId}`);
    await this.lib.firewallRules.delete(ruleId);
    return { ok: true };
  }

  async createFirewallGroup(group: {
    name: string;
    group_type: string;
    group_members: string[];
  }): Promise<any> {
    logger.info(`Creating firewall group: ${group.name}`);
    return this.lib.firewallGroups.create(group);
  }

  // -------------------- Convenience --------------------

  async testConnection(): Promise<{ success: boolean; message: string; sites?: UniFiSite[] }> {
    const result = await this.lib.testConnection();
    return {
      success: result.success,
      message: result.message,
      sites: result.sites as unknown as UniFiSite[] | undefined,
    };
  }

  async getFullConfig(): Promise<UniFiFullConfig> {
    if (!this.lib.isLoggedIn()) {
      throw new Error('Not logged in to UniFi Controller');
    }

    logger.info('Fetching full UniFi configuration...');

    const [
      sites,
      devices,
      firewallRules,
      firewallPolicies,
      firewallGroups,
      networks,
      wlans,
      portForwards,
      trafficRules,
      routingRules,
      clients,
      settings,
      aclRules,
      rawNetworkConfig,
      vpnServers,
      trafficMatchingLists,
      firewallZones,
      fingerprintDevices,
      sysInfo,
    ] = await Promise.all([
      this.getSites(),
      this.getDevices(),
      this.getFirewallRules(),
      this.getFirewallPolicies(),
      this.getFirewallGroups(),
      this.getNetworks(),
      this.getWlans(),
      this.getPortForwards(),
      this.getTrafficRules(),
      this.getRoutingRules(),
      this.getClients(),
      this.getSettings(),
      this.getAclRules(),
      this.getRawNetworkConfig(),
      this.getVpnServers(),
      this.getTrafficMatchingLists(),
      this.getFirewallZones(),
      this.getFingerprintDevices(),
      this.getSysInfo(),
    ]);

    // Fingerprint DB → friendly client device names.
    if (fingerprintDevices.length > 0) {
      const fpMap = new Map<string, string>();
      for (const fp of fingerprintDevices) {
        const fingerprintId = fp.id ?? fp.dev_id;
        const fingerprintName = fp.name ?? fp.device_name;
        if (fingerprintId !== undefined && fingerprintId !== null && fingerprintName) {
          fpMap.set(String(fingerprintId), fingerprintName);
        }
      }
      let resolved = 0;
      for (const c of clients as UniFiClient_t[]) {
        const devId = c.dev_id ?? c.device_id;
        if (!c.device_name && devId !== undefined && devId !== null) {
          const fingerprintName = fpMap.get(String(devId));
          if (!fingerprintName) continue;
          c.device_name = fingerprintName;
          resolved++;
        }
      }
      if (resolved > 0) {
        logger.info(`Resolved ${resolved} device names from fingerprint database`);
      }
    }

    logger.info(
      `Fetched config: ${devices.length} devices, ${firewallRules.length} legacy firewall rules, ${firewallPolicies.length} firewall policies, ${networks.length} networks, ${wlans.length} WLANs, ${portForwards.length} port forwards, ${clients.length} clients, ${trafficRules.length} traffic rules, ${aclRules.length} ACL rules, ${vpnServers.length} VPN servers, ${firewallZones.length} firewall zones`
    );

    return {
      sites,
      devices,
      firewallRules,
      firewallPolicies,
      firewallGroups,
      networks,
      wlans,
      portForwards,
      trafficRules,
      routingRules,
      clients: clients as UniFiClient_t[],
      settings,
      aclRules,
      rawNetworkConfig,
      vpnServers,
      trafficMatchingLists,
      firewallZones,
      sysInfo,
      fetchedAt: new Date(),
    };
  }

  /** Helper: try a raw GET, swallow not-found / endpoint-missing as []. */
  private async tryRawArray<T>(path: string, label: string): Promise<T[]> {
    try {
      const result = await this.lib.raw.get<unknown>(path);
      if (Array.isArray(result)) return result as T[];
      const wrapped = result as { data?: unknown };
      if (Array.isArray(wrapped.data)) return wrapped.data as T[];
      return [];
    } catch {
      logger.debug(`${label} endpoint not available`);
      return [];
    }
  }
}
