import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { legacyList } from '../transport/helpers.js';
import { NetworkSchema, type Network, WlanSchema, type Wlan } from '../schemas/network.js';

export type { Network, Wlan };

/**
 * Networks resource — covers VLAN/LAN configuration entries from
 * `/api/s/{site}/rest/networkconf`. The UniFi data model uses one
 * "networkconf" per LAN purpose; security analysis often joins these to
 * client/device counts and DHCP DNS overrides.
 */
export class NetworksResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<Network[]> {
    return legacyList(
      this.config,
      this.transport,
      this.session,
      '/rest/networkconf',
      NetworkSchema
    );
  }
}

/**
 * WLANs resource — wireless network configuration from
 * `/api/s/{site}/rest/wlanconf`. Does not include the SSID password (encrypted
 * server-side); use UniFi's UI for that.
 */
export class WlansResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  async list(): Promise<Wlan[]> {
    return legacyList(this.config, this.transport, this.session, '/rest/wlanconf', WlanSchema);
  }
}
