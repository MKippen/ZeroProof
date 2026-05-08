import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { apiRequest, parseOrThrow } from '../transport/request.js';
import { LegacyEnvelope } from '../schemas/envelope.js';
import { SiteSchema, type Site } from '../schemas/site.js';

export type { Site };

const SitesEnvelope = LegacyEnvelope(SiteSchema);

/**
 * Sites resource — covers `GET /api/self/sites`, the entry point for
 * discovering which sites the authenticated user can access on the
 * controller. Multi-site setups (UniFi cloud, larger MSPs) return more than
 * one entry; single-site UDMs return exactly one called "default".
 */
export class SitesResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** List every site the authenticated user has access to on this controller. */
  async list(): Promise<Site[]> {
    const path = '/api/self/sites';
    const raw = await apiRequest(this.config, this.transport, this.session, {
      method: 'GET',
      path,
    });
    const parsed = parseOrThrow(path, SitesEnvelope, raw);
    return parsed.data;
  }
}
