import axios, { AxiosInstance } from 'axios';
import { existsSync } from 'fs';
import https from 'https';
import logger from '../utils/logger';

export interface UniFiCredentials {
  host: string;
  port: number;
  username: string;
  password: string;
  siteId?: string;
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
  // Timestamps (Unix seconds)
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
  time: number; // Unix milliseconds
  datetime: string;
  site_id?: string;
  subsystem?: string;
  // Device-related fields
  ap?: string;
  ap_name?: string;
  sw?: string;
  sw_name?: string;
  gw?: string;
  gw_name?: string;
  // Firmware upgrade fields
  version_from?: string;
  version_to?: string;
  // Client fields
  user?: string;
  hostname?: string;
  ssid?: string;
  // Admin fields
  admin?: string;
  ip?: string;
  [key: string]: any;
}

export interface UniFiAlarm {
  _id: string;
  key: string;
  msg?: string;
  time: number; // Unix milliseconds
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
  pmf_mode?: string; // 'disabled' | 'optional' | 'required'
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
  first_seen?: number;   // Unix timestamp (seconds)
  last_seen?: number;    // Unix timestamp (seconds)
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

export interface UniFiFullConfig {
  sites: UniFiSite[];
  devices: UniFiDevice[];
  firewallRules: UniFiFirewallRule[];
  firewallPolicies: UniFiFirewallPolicy[]; // V2 zone-based policies
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

function resolveControllerHost(host: string): string {
  if (!isLoopbackHost(host)) {
    return host;
  }

  // In containers, localhost points to the container itself, not the host machine.
  if (!existsSync('/.dockerenv')) {
    return host;
  }

  const configuredHostIp = process.env.HOST_IP?.trim();
  if (configuredHostIp && !isLoopbackHost(configuredHostIp)) {
    return configuredHostIp;
  }

  return 'host.docker.internal';
}

export class UniFiClient {
  private client: AxiosInstance;
  private credentials: UniFiCredentials;
  private resolvedHost: string;
  private cookies: string[] = [];
  private csrfToken: string | null = null;
  private isLoggedIn = false;

  constructor(credentials: UniFiCredentials) {
    this.credentials = credentials;
    this.resolvedHost = resolveControllerHost(credentials.host);

    if (this.resolvedHost !== credentials.host) {
      logger.info(
        `Resolved UniFi host "${credentials.host}" to "${this.resolvedHost}" for container networking`
      );
    }

    // UniFi uses self-signed certs by default
    const httpsAgent = new https.Agent({
      rejectUnauthorized: false,
    });

    this.client = axios.create({
      baseURL: `https://${this.resolvedHost}:${credentials.port}`,
      httpsAgent,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
      // Don't throw on non-2xx status codes - we'll handle them
      validateStatus: (status) => status < 500,
    });

    // Handle cookies and CSRF token
    this.client.interceptors.response.use(
      (response) => {
        const setCookies = response.headers['set-cookie'];
        if (setCookies) {
          this.cookies = setCookies.map((c) => c.split(';')[0]);
        }

        const csrfToken = response.headers['x-csrf-token'];
        if (csrfToken) {
          this.csrfToken = csrfToken;
        }

        // Check if we got HTML instead of JSON
        const contentType = String(response.headers['content-type'] || '');
        if (contentType.includes('text/html') ||
            (typeof response.data === 'string' && response.data.trim().startsWith('<'))) {
          const error = new Error('Controller returned HTML instead of JSON - verify host, port, and credentials are correct');
          (error as any).isHtmlResponse = true;
          throw error;
        }

        return response;
      },
      (error) => {
        const hostLabel =
          this.resolvedHost === credentials.host
            ? `${credentials.host}:${credentials.port}`
            : `${credentials.host}:${credentials.port} (resolved as ${this.resolvedHost}:${credentials.port})`;

        // Handle network errors with better messages
        if (error.code === 'ECONNREFUSED') {
          throw new Error(`Cannot connect to ${hostLabel} - connection refused. Is the controller running?`);
        }
        if (error.code === 'ENOTFOUND') {
          throw new Error(`Cannot resolve hostname: ${hostLabel}`);
        }
        if (
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNRESET' ||
          error.code === 'ECONNABORTED' ||
          error.message?.includes('timeout')
        ) {
          throw new Error(`Connection timed out to ${hostLabel}`);
        }
        if (error.message?.includes('certificate')) {
          throw new Error('SSL certificate error - this is normal for UniFi self-signed certs');
        }
        throw error;
      }
    );

    this.client.interceptors.request.use((config) => {
      if (this.cookies.length > 0) {
        config.headers['Cookie'] = this.cookies.join('; ');
      }
      if (this.csrfToken) {
        config.headers['X-Csrf-Token'] = this.csrfToken;
      }
      return config;
    });
  }

  async login(): Promise<boolean> {
    try {
      const hostLabel =
        this.resolvedHost === this.credentials.host
          ? `${this.credentials.host}:${this.credentials.port}`
          : `${this.credentials.host}:${this.credentials.port} (resolved as ${this.resolvedHost}:${this.credentials.port})`;
      logger.info(`Connecting to UniFi Controller at ${hostLabel}`);

      // Try UniFi OS (UDM/UDM-Pro) login first
      try {
        const response = await this.client.post('/api/auth/login', {
          username: this.credentials.username,
          password: this.credentials.password,
          remember: true,
        });

        // Check if we got HTML instead of JSON (indicates wrong endpoint or auth failure)
        if (typeof response.data === 'string' && response.data.includes('<html')) {
          throw new Error('Received HTML instead of JSON - check host/port');
        }

        if (response.status === 200) {
          this.isLoggedIn = true;
          logger.info('Logged in to UniFi OS controller');
          return true;
        }
      } catch (e: any) {
        // Check for HTML response error
        if (e.response?.data && typeof e.response.data === 'string' && e.response.data.includes('<html')) {
          throw new Error('Controller returned HTML page - verify host, port, and that this is a UniFi Controller');
        }
        // Check for specific auth errors
        if (e.response?.status === 401) {
          throw new Error('Invalid username or password');
        }
        if (e.response?.status === 403) {
          throw new Error('Access forbidden - check credentials');
        }
        // Not UniFi OS, try legacy controller
        logger.debug('UniFi OS login failed, trying legacy endpoint');
      }

      // Try legacy controller login
      const response = await this.client.post('/api/login', {
        username: this.credentials.username,
        password: this.credentials.password,
      });

      // Check if we got HTML instead of JSON
      if (typeof response.data === 'string' && response.data.includes('<html')) {
        throw new Error('Controller returned HTML page - verify host, port, and credentials');
      }

      if (response.data?.meta?.rc === 'ok') {
        this.isLoggedIn = true;
        logger.info('Logged in to legacy UniFi controller');
        return true;
      }

      // Check for error message in response
      if (response.data?.meta?.msg) {
        throw new Error(`Login failed: ${response.data.meta.msg}`);
      }

      throw new Error('Invalid username or password');
    } catch (error: any) {
      const hostLabel =
        this.resolvedHost === this.credentials.host
          ? `${this.credentials.host}:${this.credentials.port}`
          : `${this.credentials.host}:${this.credentials.port} (resolved as ${this.resolvedHost}:${this.credentials.port})`;

      // Provide more specific error messages
      if (error.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to ${hostLabel} - connection refused`);
      }
      if (error.code === 'ENOTFOUND') {
        throw new Error(`Cannot resolve hostname: ${hostLabel}`);
      }
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET') {
        throw new Error(`Connection timed out to ${hostLabel}`);
      }
      if (error.message?.includes('certificate')) {
        throw new Error('SSL certificate error - controller may use self-signed certificate');
      }
      // Re-throw with original message if it's already a good error
      if (error.message && !error.message.includes('JSON')) {
        throw error;
      }
      logger.error('UniFi login error:', error.message);
      throw new Error(`Connection failed: ${error.message || 'Unknown error'}`);
    }
  }

  async logout(): Promise<void> {
    if (!this.isLoggedIn) return;

    try {
      await this.client.post('/api/logout');
    } catch (e) {
      // Ignore logout errors
    }

    this.isLoggedIn = false;
    this.cookies = [];
    this.csrfToken = null;
  }

  async getSites(): Promise<UniFiSite[]> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    try {
      // Try UniFi OS endpoint first
      try {
        const response = await this.client.get('/proxy/network/api/self/sites');
        if (response.data?.data) {
          return response.data.data;
        }
      } catch (e) {
        // Not UniFi OS
      }

      // Legacy endpoint
      const response = await this.client.get('/api/self/sites');
      return response.data?.data || [];
    } catch (error: any) {
      logger.error('Failed to get sites:', error.message);
      return [];
    }
  }

  private async apiGet(endpoint: string): Promise<any> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';

    // Try UniFi OS first, then legacy
    const endpoints = [
      `/proxy/network/api/s/${siteId}${endpoint}`,
      `/api/s/${siteId}${endpoint}`,
    ];

    for (const url of endpoints) {
      try {
        const response = await this.client.get(url);
        if (response.data?.data !== undefined) {
          return response.data.data;
        }
        if (response.data?.meta?.rc === 'ok') {
          return response.data.data || [];
        }
      } catch (e) {
        continue;
      }
    }

    return [];
  }

  private async apiPost(endpoint: string, data: any): Promise<any> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';

    const endpoints = [
      `/proxy/network/api/s/${siteId}${endpoint}`,
      `/api/s/${siteId}${endpoint}`,
    ];

    for (const url of endpoints) {
      try {
        const response = await this.client.post(url, data);
        return response.data;
      } catch (e) {
        continue;
      }
    }

    throw new Error('API request failed');
  }

  async getDevices(): Promise<UniFiDevice[]> {
    return this.apiGet('/stat/device');
  }

  async getNetworks(): Promise<UniFiNetwork[]> {
    return this.apiGet('/rest/networkconf');
  }

  async getWlans(): Promise<UniFiWlan[]> {
    return this.apiGet('/rest/wlanconf');
  }

  async getFirewallRules(): Promise<UniFiFirewallRule[]> {
    return this.apiGet('/rest/firewallrule');
  }

  async getFirewallGroups(): Promise<any[]> {
    return this.apiGet('/rest/firewallgroup');
  }

  async getPortForwards(): Promise<UniFiPortForward[]> {
    return this.apiGet('/rest/portforward');
  }

  async getRoutingRules(): Promise<any[]> {
    return this.apiGet('/rest/routing');
  }

  async getTrafficRules(): Promise<UniFiTrafficRule[]> {
    return this.apiGet('/rest/trafficrule');
  }

  async getFirewallPolicies(): Promise<UniFiFirewallPolicy[]> {
    // V2 API for zone-based firewall policies (UniFi Network 10.x+)
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';
    const url = `/proxy/network/v2/api/site/${siteId}/firewall-policies`;

    try {
      const response = await this.client.get(url);
      // V2 API returns array directly, not wrapped in data
      return response.data || [];
    } catch (e) {
      logger.debug('V2 firewall policies not available, falling back to empty array');
      return [];
    }
  }

  async getVpnServers(): Promise<UniFiVpnServer[]> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';
    const url = `/proxy/network/v2/api/site/${siteId}/vpn/servers`;

    try {
      const response = await this.client.get(url);
      return response.data || [];
    } catch (e) {
      logger.debug('VPN servers endpoint not available');
      return [];
    }
  }

  async getTrafficMatchingLists(): Promise<UniFiTrafficMatchingList[]> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';
    const url = `/proxy/network/v2/api/site/${siteId}/traffic-matching-lists`;

    try {
      const response = await this.client.get(url);
      return response.data || [];
    } catch (e) {
      logger.debug('Traffic matching lists endpoint not available');
      return [];
    }
  }

  async getFirewallZones(): Promise<any[]> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';
    const url = `/proxy/network/v2/api/site/${siteId}/firewall-zones`;

    try {
      const response = await this.client.get(url);
      return response.data || [];
    } catch (e) {
      logger.debug('Firewall zones endpoint not available');
      return [];
    }
  }

  async getSettings(): Promise<any> {
    return this.apiGet('/rest/setting');
  }

  async getControllerVersion(): Promise<string | null> {
    try {
      const sysinfo = await this.apiGet('/stat/sysinfo');
      const entry = Array.isArray(sysinfo) ? sysinfo[0] : sysinfo;
      return entry?.version ?? null;
    } catch (e) {
      logger.debug('sysinfo endpoint not available');
      return null;
    }
  }

  async getClients(): Promise<any[]> {
    return this.apiGet('/stat/sta');
  }

  async getAllUsers(limit = 5000): Promise<UniFiClient_t[]> {
    return this.apiGet(`/stat/alluser?_limit=${limit}`);
  }

  async getEvents(limit = 3000): Promise<UniFiEvent[]> {
    return this.apiGet(`/stat/event?_limit=${limit}`);
  }

  async getAlarms(limit = 3000): Promise<UniFiAlarm[]> {
    return this.apiGet(`/stat/alarm?_limit=${limit}`);
  }

  // Fetch ACL rules (Settings > Security > ACL Rules)
  async getAclRules(): Promise<any[]> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';

    // V2 API path (UniFi Network 10.x+)
    try {
      const url = `/proxy/network/v2/api/site/${siteId}/acl-rules`;
      const response = await this.client.get(url);
      if (response.data) {
        return response.data?.data || response.data || [];
      }
    } catch (e) {
      // V2 not available, try V1 fallback
    }

    // V1 REST fallback
    try {
      const rules = await this.apiGet('/rest/aclrule');
      if (Array.isArray(rules) && rules.length > 0) {
        return rules;
      }
    } catch (e) {
      // Not available
    }

    logger.debug('No ACL rules found');
    return [];
  }

  // Fetch the fingerprint device database that maps dev_id → device name
  async getFingerprintDevices(source = 0): Promise<any[]> {
    if (!this.isLoggedIn) throw new Error('Not logged in');

    const siteId = this.credentials.siteId || 'default';
    const urls = [
      `/proxy/network/v2/api/site/${siteId}/fingerprint-devices/${source}`,
      `/proxy/network/v2/api/fingerprint_devices/${source}`,
      `/proxy/network/api/s/${siteId}/stat/fingerprint-devices/${source}`,
      `/api/s/${siteId}/stat/fingerprint-devices/${source}`,
      `/v2/api/fingerprint_devices/${source}`,
    ];

    for (const url of urls) {
      try {
        const response = await this.client.get(url);
        const data = response.data?.data || response.data || [];
        if (Array.isArray(data) && data.length > 0) {
          logger.info(`Fetched ${data.length} fingerprint device entries from ${url}`);
          return data;
        }
      } catch (e: any) {
        logger.debug(`Fingerprint endpoint ${url}: ${e.response?.status || e.code || 'failed'}`);
        continue;
      }
    }

    logger.debug('Fingerprint devices endpoint not available on any path');
    return [];
  }

  // Fetch raw network config to see all available fields
  async getRawNetworkConfig(): Promise<any[]> {
    return this.apiGet('/rest/networkconf');
  }

  async getFullConfig(): Promise<UniFiFullConfig> {
    if (!this.isLoggedIn) {
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
    ]);

    // Resolve missing device_name from fingerprint database
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
      for (const client of clients) {
        const devId = client.dev_id ?? client.device_id;
        if (!client.device_name && devId !== undefined && devId !== null) {
          const fingerprintName = fpMap.get(String(devId));
          if (!fingerprintName) continue;
          client.device_name = fingerprintName;
          resolved++;
        }
      }
      if (resolved > 0) {
        logger.info(`Resolved ${resolved} device names from fingerprint database`);
      }
    }

    // Log all fields from raw network config for debugging ACL/isolation settings
    if (rawNetworkConfig.length > 0) {
      const sampleNetwork = rawNetworkConfig[0];
      const isolationFields = Object.keys(sampleNetwork).filter(k =>
        k.includes('isolation') || k.includes('acl') || k.includes('l3') || k.includes('device')
      );
      if (isolationFields.length > 0) {
        logger.info(`Network isolation-related fields found: ${isolationFields.join(', ')}`);
      }
      // Log all keys for the first network to help discover undocumented fields
      logger.debug(`All network config keys: ${Object.keys(sampleNetwork).join(', ')}`);
    }

    logger.info(`Fetched config: ${devices.length} devices, ${firewallRules.length} legacy firewall rules, ${firewallPolicies.length} firewall policies, ${networks.length} networks, ${wlans.length} WLANs, ${portForwards.length} port forwards, ${clients.length} clients, ${trafficRules.length} traffic rules, ${aclRules.length} ACL rules, ${vpnServers.length} VPN servers, ${firewallZones.length} firewall zones`);

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
      clients,
      settings,
      aclRules,
      rawNetworkConfig,
      vpnServers,
      trafficMatchingLists,
      firewallZones,
      fetchedAt: new Date(),
    };
  }

  // === Write Operations (for remediation) ===

  async createFirewallRule(rule: Partial<UniFiFirewallRule>): Promise<any> {
    logger.info(`Creating firewall rule: ${rule.name}`);
    return this.apiPost('/rest/firewallrule', rule);
  }

  async updateFirewallRule(ruleId: string, updates: Partial<UniFiFirewallRule>): Promise<any> {
    logger.info(`Updating firewall rule: ${ruleId}`);
    const siteId = this.credentials.siteId || 'default';

    const endpoints = [
      `/proxy/network/api/s/${siteId}/rest/firewallrule/${ruleId}`,
      `/api/s/${siteId}/rest/firewallrule/${ruleId}`,
    ];

    for (const url of endpoints) {
      try {
        const response = await this.client.put(url, updates);
        return response.data;
      } catch (e) {
        continue;
      }
    }

    throw new Error('Failed to update firewall rule');
  }

  async deleteFirewallRule(ruleId: string): Promise<any> {
    logger.info(`Deleting firewall rule: ${ruleId}`);
    const siteId = this.credentials.siteId || 'default';

    const endpoints = [
      `/proxy/network/api/s/${siteId}/rest/firewallrule/${ruleId}`,
      `/api/s/${siteId}/rest/firewallrule/${ruleId}`,
    ];

    for (const url of endpoints) {
      try {
        const response = await this.client.delete(url);
        return response.data;
      } catch (e) {
        continue;
      }
    }

    throw new Error('Failed to delete firewall rule');
  }

  async createFirewallGroup(group: { name: string; group_type: string; group_members: string[] }): Promise<any> {
    logger.info(`Creating firewall group: ${group.name}`);
    return this.apiPost('/rest/firewallgroup', group);
  }

  // Test connection without fetching full config
  async testConnection(): Promise<{ success: boolean; message: string; sites?: UniFiSite[] }> {
    try {
      const loggedIn = await this.login();
      if (!loggedIn) {
        return { success: false, message: 'Invalid credentials' };
      }

      const sites = await this.getSites();
      await this.logout();

      return {
        success: true,
        message: `Connected successfully. Found ${sites.length} site(s).`,
        sites,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Connection failed',
      };
    }
  }
}

// Singleton manager for active connections
class UniFiConnectionManager {
  private connections: Map<string, UniFiClient> = new Map();

  async getConnection(connectionId: string, credentials: UniFiCredentials): Promise<UniFiClient> {
    let client = this.connections.get(connectionId);

    if (!client) {
      client = new UniFiClient(credentials);
      await client.login();
      this.connections.set(connectionId, client);
    }

    return client;
  }

  async closeConnection(connectionId: string): Promise<void> {
    const client = this.connections.get(connectionId);
    if (client) {
      await client.logout();
      this.connections.delete(connectionId);
    }
  }

  async closeAll(): Promise<void> {
    for (const client of this.connections.values()) {
      await client.logout();
    }
    this.connections.clear();
  }
}

export const unifiManager = new UniFiConnectionManager();
