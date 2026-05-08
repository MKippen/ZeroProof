import type { HttpRequest, HttpResponse, HttpTransport } from '../../src/transport/http.js';

export interface RecordedCall {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface CannedResponse {
  status?: number;
  headers?: Record<string, string | string[]>;
  data: unknown;
}

type Handler = (req: HttpRequest) => CannedResponse | Promise<CannedResponse>;

/**
 * Test double for HttpTransport. Lets tests register per-path handlers and
 * inspect the calls made by the library.
 */
export class MockTransport implements HttpTransport {
  readonly calls: RecordedCall[] = [];
  private handlers = new Map<string, Handler>();
  private fallback: Handler | null = null;

  on(method: string, urlPattern: string | RegExp, handler: Handler): this {
    const key = `${method}:${urlPattern.toString()}`;
    this.handlers.set(key, handler);
    return this;
  }

  setFallback(handler: Handler): this {
    this.fallback = handler;
    return this;
  }

  async request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
    this.calls.push({ method: req.method, url: req.url, headers: req.headers, body: req.body });

    for (const [key, handler] of this.handlers) {
      const [method, patternStr] = key.split(':', 2);
      if (method !== req.method) continue;
      const pattern = patternStr ?? '';
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        const regex = new RegExp(pattern.slice(1, -1));
        if (regex.test(req.url)) {
          const result = await handler(req);
          return this.toResponse<T>(result);
        }
      } else if (pattern === req.url) {
        const result = await handler(req);
        return this.toResponse<T>(result);
      }
    }

    if (this.fallback) {
      return this.toResponse<T>(await this.fallback(req));
    }

    throw new Error(`MockTransport: no handler for ${req.method} ${req.url}`);
  }

  private toResponse<T>(canned: CannedResponse): HttpResponse<T> {
    return {
      status: canned.status ?? 200,
      headers: canned.headers ?? {},
      data: canned.data as T,
    };
  }
}
