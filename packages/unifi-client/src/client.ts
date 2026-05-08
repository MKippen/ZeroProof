import { resolveConfig, type UnifiClientConfig, type ResolvedConfig } from './config.js';
import { Session } from './auth/session.js';
import { performLogin, performLogout } from './auth/login.js';
import { createNodeHttpTransport } from './transport/fetch.js';
import type { HttpTransport } from './transport/http.js';
import { FlowsResource } from './resources/flows.js';
import { SitesResource } from './resources/sites.js';
import { ThreatsResource } from './resources/threats.js';
import { TriggersResource } from './resources/triggers.js';
import { DevicesResource } from './resources/devices.js';
import { NetworksResource, WlansResource } from './resources/networks.js';
import { ClientsResource } from './resources/clients.js';
import {
  FirewallRulesResource,
  FirewallGroupsResource,
  FirewallPoliciesResource,
} from './resources/firewall.js';
import {
  TrafficRulesResource,
  TrafficRoutesResource,
  PortForwardsResource,
  RoutingRulesResource,
} from './resources/traffic.js';
import {
  EventsResource,
  AlarmsResource,
  SystemInfoResource,
  SettingsResource,
} from './resources/system.js';
import { RawResource } from './resources/raw.js';

export interface UnifiClientOptions extends UnifiClientConfig {
  /** Inject a custom HTTP transport (useful for tests). */
  transport?: HttpTransport;
}

/**
 * Top-level UniFi client. One instance = one authenticated session against
 * one controller. Resources are exposed as namespaced sub-objects (e.g.
 * `client.flows.iterate(...)`).
 *
 * Resources covered:
 *   - flows       — POST /v2/api/site/{site}/traffic-flows
 *   - threats     — POST /v2/api/site/{site}/system-log/threat-alert
 *   - triggers    — POST /v2/api/site/{site}/system-log/triggers
 *   - sites       — GET  /api/self/sites
 *   - devices     — GET  /api/s/{site}/stat/device
 *   - networks    — GET  /api/s/{site}/rest/networkconf
 *   - wlans       — GET  /api/s/{site}/rest/wlanconf
 *   - clients     — GET  /api/s/{site}/stat/sta + /stat/alluser
 *   - firewall    — rules / groups / policies (legacy + v2)
 *   - traffic     — rules / routes / port-forwards / routing rules
 *   - events      — GET  /api/s/{site}/stat/event
 *   - alarms      — GET  /api/s/{site}/stat/alarm
 *   - system      — sysinfo / version
 *   - settings    — GET  /api/s/{site}/get/setting
 */
export class UnifiClient {
  private readonly config: ResolvedConfig;
  private readonly transport: HttpTransport;
  private readonly session: Session;

  readonly flows: FlowsResource;
  readonly sites: SitesResource;
  readonly threats: ThreatsResource;
  readonly triggers: TriggersResource;
  readonly devices: DevicesResource;
  readonly networks: NetworksResource;
  readonly wlans: WlansResource;
  readonly clients: ClientsResource;
  readonly firewallRules: FirewallRulesResource;
  readonly firewallGroups: FirewallGroupsResource;
  readonly firewallPolicies: FirewallPoliciesResource;
  readonly trafficRules: TrafficRulesResource;
  readonly trafficRoutes: TrafficRoutesResource;
  readonly portForwards: PortForwardsResource;
  readonly routingRules: RoutingRulesResource;
  readonly events: EventsResource;
  readonly alarms: AlarmsResource;
  readonly system: SystemInfoResource;
  readonly settings: SettingsResource;
  /** Escape hatch for endpoints not modeled as typed resources. */
  readonly raw: RawResource;

  constructor(options: UnifiClientOptions) {
    this.config = resolveConfig(options);
    this.session = new Session();
    this.transport =
      options.transport ??
      createNodeHttpTransport({
        baseURL: `https://${this.config.host}:${this.config.port}`,
        timeoutMs: this.config.timeoutMs,
        allowSelfSigned: this.config.allowSelfSigned,
      });

    this.flows = new FlowsResource(this.config, this.transport, this.session);
    this.sites = new SitesResource(this.config, this.transport, this.session);
    this.threats = new ThreatsResource(this.config, this.transport, this.session);
    this.triggers = new TriggersResource(this.config, this.transport, this.session);
    this.devices = new DevicesResource(this.config, this.transport, this.session);
    this.networks = new NetworksResource(this.config, this.transport, this.session);
    this.wlans = new WlansResource(this.config, this.transport, this.session);
    this.clients = new ClientsResource(this.config, this.transport, this.session);
    this.firewallRules = new FirewallRulesResource(this.config, this.transport, this.session);
    this.firewallGroups = new FirewallGroupsResource(this.config, this.transport, this.session);
    this.firewallPolicies = new FirewallPoliciesResource(
      this.config,
      this.transport,
      this.session
    );
    this.trafficRules = new TrafficRulesResource(this.config, this.transport, this.session);
    this.trafficRoutes = new TrafficRoutesResource(this.config, this.transport, this.session);
    this.portForwards = new PortForwardsResource(this.config, this.transport, this.session);
    this.routingRules = new RoutingRulesResource(this.config, this.transport, this.session);
    this.events = new EventsResource(this.config, this.transport, this.session);
    this.alarms = new AlarmsResource(this.config, this.transport, this.session);
    this.system = new SystemInfoResource(this.config, this.transport, this.session);
    this.settings = new SettingsResource(this.config, this.transport, this.session);
    this.raw = new RawResource(this.config, this.transport, this.session);
  }

  /** Establish an authenticated session. */
  async login(): Promise<void> {
    await performLogin(this.config, this.transport, this.session);
  }

  /** Tear down the session. Idempotent. */
  async logout(): Promise<void> {
    await performLogout(this.config, this.transport, this.session);
  }

  /**
   * Convenience: log in, list sites, log out. Mirrors the legacy
   * `testConnection()` semantics on `backend/src/services/unifiClient.ts`.
   */
  async testConnection(): Promise<{ success: boolean; message: string; sites?: import('./resources/sites.js').Site[] }> {
    try {
      await this.login();
      const sites = await this.sites.list();
      await this.logout();
      return { success: true, message: `Connected. ${sites.length} site(s) accessible.`, sites };
    } catch (err) {
      // Library code paths always wrap failures into typed errors with a
      // `.message`, but defend against unexpected throws just in case.
      /* c8 ignore next */
      const message = (err as { message?: string }).message ?? 'Connection failed';
      return { success: false, message };
    }
  }

  isLoggedIn(): boolean {
    return this.session.isLoggedIn();
  }
}
