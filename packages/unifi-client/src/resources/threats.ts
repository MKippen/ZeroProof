import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { v2PaginatedPost } from '../transport/helpers.js';
import { ThreatAlertSchema, type ThreatAlert } from '../schemas/threat.js';

export type { ThreatAlert };

/** Threat categories the controller recognizes today. */
export type ThreatType = 'HONEYPOT' | 'THREAT';

export interface ThreatListParams {
  /** Inclusive lower bound (epoch ms). */
  beginTime?: number;
  /** Inclusive upper bound (epoch ms). */
  endTime?: number;
  /** Categories to include. Default: HONEYPOT + THREAT. */
  threatTypes?: ReadonlyArray<ThreatType>;
  /** Page size. Default: server's default (50). */
  limit?: number;
  /** Zero-indexed page number. */
  page?: number;
}

export interface ThreatPage {
  data: ThreatAlert[];
  hasNext: boolean;
  pageNumber: number;
  totalElementCount: number;
  totalPageCount: number;
}

const DEFAULT_TYPES: ReadonlyArray<ThreatType> = ['HONEYPOT', 'THREAT'];

/**
 * Threats resource — IPS / honeypot detections from the System Log threat-alert
 * stream. These are distinct from policy-driven firewall blocks (which surface
 * as `flows` rows) — when an IPS signature fires inline, you'll see one entry
 * here and one entry in `flows` with `policies[].type === 'INTRUSION_PREVENTION'`.
 */
export class ThreatsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** Fetch a single page of threat alerts. */
  async list(params: ThreatListParams = {}): Promise<ThreatPage> {
    const body: Record<string, unknown> = {
      threatTypes: params.threatTypes ?? DEFAULT_TYPES,
    };
    if (params.beginTime !== undefined) body.beginTime = params.beginTime;
    if (params.endTime !== undefined) body.endTime = params.endTime;
    if (params.limit !== undefined) body.limit = params.limit;
    if (params.page !== undefined) body.page = params.page;

    const result = await v2PaginatedPost(
      this.config,
      this.transport,
      this.session,
      '/system-log/threat-alert',
      body,
      ThreatAlertSchema
    );
    return result;
  }

  /**
   * Auto-paginating async iterator over every threat alert in the window.
   *
   * Like `traffic-flows`, the threat-alert endpoint may not honour `page`
   * reliably across UniFi versions. We dedupe by `id` and terminate when
   * a page returns no unseen rows, so the iterator always converges.
   */
  async *iterate(params: Omit<ThreatListParams, 'page'> = {}): AsyncGenerator<ThreatAlert, void, unknown> {
    let page = 0;
    const pageSize = params.limit ?? 200;
    const seen = new Set<string>();
    while (true) {
      const result = await this.list({ ...params, page, limit: pageSize });
      let newCount = 0;
      for (const event of result.data) {
        if (seen.has(event.id)) continue;
        seen.add(event.id);
        newCount += 1;
        yield event;
      }
      if (newCount === 0) return;
      if (!result.hasNext) return;
      page += 1;
    }
  }
}
