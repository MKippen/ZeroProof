import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { legacyList } from '../transport/helpers.js';
import { DeviceSchema, type Device } from '../schemas/device.js';

export type { Device };

/**
 * Devices resource — covers the UniFi-managed device inventory (gateways,
 * switches, APs, doorbells, cameras). Mirrors `/api/s/{site}/stat/device`.
 */
export class DevicesResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** List every adopted UniFi device on the site. */
  async list(): Promise<Device[]> {
    return legacyList(this.config, this.transport, this.session, '/stat/device', DeviceSchema);
  }
}
