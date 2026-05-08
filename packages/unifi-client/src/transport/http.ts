/**
 * Pluggable HTTP transport. The library ships an axios-backed default
 * (transport/axios.ts) but consumers can inject their own (e.g. fetch / undici)
 * to swap timeout policies, retries, or test fakes.
 */

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Absolute URL, including the controller origin. */
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  data: T;
}

export interface HttpTransport {
  request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>>;
}
