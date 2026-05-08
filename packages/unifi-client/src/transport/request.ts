import type { ResolvedConfig } from '../config.js';
import type { Session } from '../auth/session.js';
import type { HttpTransport, HttpResponse } from './http.js';
import {
  UnifiAuthError,
  UnifiNotFoundError,
  UnifiResponseError,
  UnifiTransportError,
} from '../errors.js';

export interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Path relative to the controller, e.g. `/api/self/sites` or `/v2/api/site/{site}/...` */
  path: string;
  body?: unknown;
  /** When true, skip the basePath prefix (caller already provided full path). */
  raw?: boolean;
}

/**
 * Detect "controller returned the SPA index.html instead of JSON" — UniFi
 * routes unknown paths to the web UI rather than 404-ing, so we have to sniff.
 */
function isHtmlResponse(response: HttpResponse<unknown>): boolean {
  const ct = String(response.headers['content-type'] ?? '').toLowerCase();
  if (ct.includes('text/html')) return true;
  if (typeof response.data === 'string' && response.data.trimStart().startsWith('<')) return true;
  return false;
}

/**
 * Performs an authenticated request, ingesting cookies/CSRF on the way back.
 *
 * Tries the configured basePath first (default `/proxy/network` for UniFi OS).
 * If that returns HTML or 404, retries against the legacy unprefixed path.
 */
export async function apiRequest<T = unknown>(
  config: ResolvedConfig,
  transport: HttpTransport,
  session: Session,
  options: ApiRequestOptions
): Promise<T> {
  const candidatePrefixes = options.raw ? [''] : [config.basePath, ''];

  let lastError: unknown;
  let lastStatus: number | undefined;

  for (const prefix of candidatePrefixes) {
    const url = `${prefix}${options.path}`;
    let response: HttpResponse<T>;
    try {
      response = await transport.request<T>({
        method: options.method,
        url,
        body: options.body,
        headers: session.authHeaders(),
      });
    } catch (err) {
      lastError = err;
      continue;
    }

    session.ingestResponseHeaders(response.headers);

    if (response.status === 401 || response.status === 403) {
      throw new UnifiAuthError(`Unauthorized: ${url}`, {
        statusCode: response.status,
      });
    }

    if (response.status === 404) {
      lastStatus = 404;
      continue;
    }

    if (isHtmlResponse(response)) {
      // Not a real endpoint on this controller — try next prefix.
      lastStatus = response.status;
      continue;
    }

    if (response.status >= 500) {
      throw new UnifiTransportError(`Controller error ${response.status} on ${url}`, {
        statusCode: response.status,
        path: url,
      });
    }

    if (response.status < 200 || response.status >= 300) {
      throw new UnifiTransportError(`Unexpected ${response.status} on ${url}`, {
        statusCode: response.status,
        path: url,
      });
    }

    return response.data;
  }

  if (lastStatus === 404) {
    throw new UnifiNotFoundError(options.path, { cause: lastError });
  }
  throw new UnifiTransportError(`Request failed: ${options.path}`, {
    cause: lastError,
    path: options.path,
  });
}

/** Helper to apply a Zod schema and convert failures into typed errors. */
export function parseOrThrow<T>(
  path: string,
  schema: { safeParse: (input: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ path: ReadonlyArray<string | number>; message: string }> } } },
  data: unknown
): T {
  const result = schema.safeParse(data);
  if (result.success && result.data !== undefined) return result.data;
  const issues = result.error?.issues.map((i) => ({
    path: i.path.join('.'),
    message: i.message,
  })) ?? [{ path: '', message: 'unknown' }];
  throw new UnifiResponseError(path, issues);
}
