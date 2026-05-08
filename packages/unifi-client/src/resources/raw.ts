import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from '../auth/session.js';
import { apiRequest } from '../transport/request.js';

/**
 * Escape hatch for endpoints the library hasn't yet modeled as a typed
 * resource. Returns the parsed JSON response verbatim with no schema
 * validation. Callers are responsible for typing / runtime checks.
 *
 * **Use a typed resource (`client.devices.list()`, etc.) where one exists.**
 * `raw` should only be reached for legacy / version-specific endpoints that
 * don't justify a permanent resource module.
 */
export class RawResource {
  constructor(
    private readonly config: ResolvedConfig,
    private readonly transport: HttpTransport,
    private readonly session: Session
  ) {}

  /** GET on a path. Auto-falls-back from basePath to legacy when 404 / HTML. */
  async get<T = unknown>(path: string): Promise<T> {
    return apiRequest(this.config, this.transport, this.session, {
      method: 'GET',
      path,
      raw: path.startsWith('/proxy/'),
    }) as Promise<T>;
  }

  /** POST with JSON body. Same path conventions as `get`. */
  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return apiRequest(this.config, this.transport, this.session, {
      method: 'POST',
      path,
      body,
      raw: path.startsWith('/proxy/'),
    }) as Promise<T>;
  }

  /** PUT — typically used for partial updates against legacy endpoints. */
  async put<T = unknown>(path: string, body?: unknown): Promise<T> {
    return apiRequest(this.config, this.transport, this.session, {
      method: 'PUT',
      path,
      body,
      raw: path.startsWith('/proxy/'),
    }) as Promise<T>;
  }

  /** DELETE for a resource removal. */
  async delete<T = unknown>(path: string): Promise<T> {
    return apiRequest(this.config, this.transport, this.session, {
      method: 'DELETE',
      path,
      raw: path.startsWith('/proxy/'),
    }) as Promise<T>;
  }
}
