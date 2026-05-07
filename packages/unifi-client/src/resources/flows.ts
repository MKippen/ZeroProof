import { z } from 'zod';
import type { ResolvedConfig } from '../config.js';
import type { Session } from '../auth/session.js';
import type { HttpTransport } from '../transport/http.js';
import { apiRequest, parseOrThrow } from '../transport/request.js';
import { PaginatedV2Envelope } from '../schemas/envelope.js';
import { FlowSchema, type FlowEvent } from '../schemas/flow.js';

export type { FlowEvent };

export interface FlowListParams {
  /** Inclusive lower bound (epoch ms). */
  beginTime?: number;
  /** Inclusive upper bound (epoch ms). */
  endTime?: number;
  /** Page size — defaults to 50 (controller default). */
  limit?: number;
  /** Zero-indexed page number. */
  page?: number;
  /** Optional filter — note: as of UniFi 10.x the controller still returns only blocked flows regardless. */
  actions?: ReadonlyArray<'allowed' | 'blocked'>;
}

export interface FlowPage {
  data: FlowEvent[];
  hasNext: boolean;
  pageNumber: number;
  totalElementCount: number;
  totalPageCount: number;
}

const PageSchema = PaginatedV2Envelope(FlowSchema);

export class FlowsResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** Fetch a single page of flow events. */
  async list(params: FlowListParams = {}): Promise<FlowPage> {
    const path = `/v2/api/site/${this.config.siteId}/traffic-flows`;
    const body: Record<string, unknown> = {};
    if (params.beginTime !== undefined) body.beginTime = params.beginTime;
    if (params.endTime !== undefined) body.endTime = params.endTime;
    if (params.limit !== undefined) body.limit = params.limit;
    if (params.page !== undefined) body.page = params.page;
    if (params.actions !== undefined) body.actions = params.actions;

    const raw = await apiRequest(this.config, this.transport, this.session, {
      method: 'POST',
      path,
      body,
    });
    const parsed = parseOrThrow(path, PageSchema as unknown as z.ZodType<{
      data: FlowEvent[];
      page_number: number;
      total_element_count: number;
      total_page_count: number;
      has_next?: boolean;
    }>, raw);

    return {
      data: parsed.data,
      hasNext: parsed.has_next ?? parsed.page_number < parsed.total_page_count - 1,
      pageNumber: parsed.page_number,
      totalElementCount: parsed.total_element_count,
      totalPageCount: parsed.total_page_count,
    };
  }

  /**
   * Iterate every flow within the given window across pages. Yields events
   * one at a time — callers can `break` early without paying for unused pages.
   *
   * UniFi 10.x's `/traffic-flows` does NOT honour the `page` parameter
   * reliably — it tends to return the most recent N rows on every call,
   * regardless of `page`. We detect that and stop once a page yields no
   * unseen ids, so the iterator always terminates.
   */
  async *iterate(params: Omit<FlowListParams, 'page'> = {}): AsyncGenerator<FlowEvent, void, unknown> {
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
      if (!result.hasNext || result.data.length < pageSize) return;
      page += 1;
    }
  }
}
