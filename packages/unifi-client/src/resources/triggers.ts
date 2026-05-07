import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { v2PaginatedPost } from '../transport/helpers.js';
import { TriggerSchema, type Trigger, type TriggerType } from '../schemas/trigger.js';

export type { Trigger, TriggerType };

const DEFAULT_TYPES: ReadonlyArray<TriggerType> = ['TRAFFIC_RULE', 'TRAFFIC_ROUTE', 'FIREWALL_RULE'];

export interface TriggerListParams {
  beginTime?: number;
  endTime?: number;
  triggerTypes?: ReadonlyArray<TriggerType>;
  limit?: number;
  page?: number;
}

export interface TriggerPage {
  data: Trigger[];
  hasNext: boolean;
  pageNumber: number;
  totalElementCount: number;
  totalPageCount: number;
}

/**
 * Triggers resource — System Log entries for triggered traffic rules,
 * traffic routes, and firewall rules. This is what populates UniFi's
 * "Top Triggered Policies" panel.
 */
export class TriggersResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** Fetch a single page of trigger events. */
  async list(params: TriggerListParams = {}): Promise<TriggerPage> {
    const body: Record<string, unknown> = {
      triggerTypes: params.triggerTypes ?? DEFAULT_TYPES,
    };
    if (params.beginTime !== undefined) body.beginTime = params.beginTime;
    if (params.endTime !== undefined) body.endTime = params.endTime;
    if (params.limit !== undefined) body.limit = params.limit;
    if (params.page !== undefined) body.page = params.page;

    return v2PaginatedPost(
      this.config,
      this.transport,
      this.session,
      '/system-log/triggers',
      body,
      TriggerSchema
    );
  }

  /** Auto-paginating iterator over every triggered policy hit in the window. */
  async *iterate(params: Omit<TriggerListParams, 'page'> = {}): AsyncGenerator<Trigger, void, unknown> {
    let page = 0;
    const pageSize = params.limit ?? 200;
    while (true) {
      const result = await this.list({ ...params, page, limit: pageSize });
      for (const event of result.data) yield event;
      if (!result.hasNext) return;
      page += 1;
    }
  }
}
