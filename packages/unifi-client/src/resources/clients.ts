import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { legacyList } from '../transport/helpers.js';
import { ClientSchema, type NetworkClient } from '../schemas/client.js';

export type { NetworkClient };

/**
 * Clients resource — network stations (phones, laptops, IoT devices). NOT to
 * be confused with UniFi-managed devices. Two distinct sources:
 *   - `/stat/sta` — currently online (active) clients
 *   - `/stat/alluser` — historical clients within a lookback window
 */
export class ClientsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** List currently-online clients. */
  async listActive(): Promise<NetworkClient[]> {
    return legacyList(this.config, this.transport, this.session, '/stat/sta', ClientSchema);
  }

  /**
   * List historical clients within the last `withinHours` hours (default 24).
   * `limit` caps row count server-side.
   */
  async listAll(options: { withinHours?: number; limit?: number } = {}): Promise<NetworkClient[]> {
    const params = new URLSearchParams();
    if (options.withinHours !== undefined) params.set('within', String(options.withinHours));
    if (options.limit !== undefined) params.set('limit', String(options.limit));
    const qs = params.toString();
    const path = qs ? `/stat/alluser?${qs}` : '/stat/alluser';
    return legacyList(this.config, this.transport, this.session, path, ClientSchema);
  }
}
