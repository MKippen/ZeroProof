import { z } from 'zod';
import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { apiRequest, parseOrThrow } from './request.js';
import { LegacyEnvelope, PaginatedV2Envelope } from '../schemas/envelope.js';

/**
 * GET /api/s/{site}/<path> — returns the `data` array from the legacy
 * `{ meta: {rc}, data: [...] }` envelope.
 */
export async function legacyList<T>(
  config: ResolvedConfig,
  transport: HttpTransport,
  session: Session,
  pathSuffix: string,
  itemSchema: z.ZodType<T>
): Promise<T[]> {
  const path = `/api/s/${config.siteId}${pathSuffix}`;
  const raw = await apiRequest(config, transport, session, { method: 'GET', path });
  const parsed = parseOrThrow(path, LegacyEnvelope(itemSchema), raw);
  return parsed.data as T[];
}

/**
 * GET /v2/api/site/{site}/<path> — returns the response body verbatim. Some
 * v2 endpoints return a bare array (not wrapped). Schema is responsible for
 * accepting either.
 */
export async function v2Raw<T>(
  config: ResolvedConfig,
  transport: HttpTransport,
  session: Session,
  pathSuffix: string,
  schema: z.ZodType<T>
): Promise<T> {
  const path = `/v2/api/site/${config.siteId}${pathSuffix}`;
  const raw = await apiRequest(config, transport, session, { method: 'GET', path });
  return parseOrThrow(path, schema, raw);
}

/**
 * POST /v2/api/site/{site}/<path> with paginated envelope.
 */
export async function v2PaginatedPost<T>(
  config: ResolvedConfig,
  transport: HttpTransport,
  session: Session,
  pathSuffix: string,
  body: Record<string, unknown>,
  itemSchema: z.ZodType<T>
): Promise<{
  data: T[];
  pageNumber: number;
  totalElementCount: number;
  totalPageCount: number;
  hasNext: boolean;
}> {
  const path = `/v2/api/site/${config.siteId}${pathSuffix}`;
  const raw = await apiRequest(config, transport, session, { method: 'POST', path, body });
  const parsed = parseOrThrow(path, PaginatedV2Envelope(itemSchema), raw);
  const totalPages = parsed.total_page_count ?? 0;
  const pageNumber = parsed.page_number ?? 0;
  return {
    data: parsed.data as T[],
    pageNumber,
    totalElementCount: parsed.total_element_count ?? 0,
    totalPageCount: totalPages,
    hasNext: parsed.has_next ?? pageNumber < totalPages - 1,
  };
}
