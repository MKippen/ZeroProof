import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/stores/authStore';

const API_BASE = '/api/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiClient {
  // Per-tab CSRF token. Synchronizer-token bound to the session cookie —
  // fetched lazily on the first mutating request and refreshed on 403
  // (e.g., session rotated after login).
  private csrfToken: string | null = null;
  private csrfInflight: Promise<string | null> | null = null;
  private csrfGeneration = 0;

  private async getCsrfToken(): Promise<string | null> {
    if (this.csrfToken) return this.csrfToken;
    if (this.csrfInflight) return this.csrfInflight;
    const generation = this.csrfGeneration;
    this.csrfInflight = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/csrf`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) return null;
        const body = (await response.json()) as ApiResponse<{ csrfToken: string }>;
        if (body.success && typeof body.data?.csrfToken === 'string') {
          if (generation === this.csrfGeneration) this.csrfToken = body.data.csrfToken;
          return body.data.csrfToken;
        }
        return null;
      } catch {
        return null;
      } finally {
        if (generation === this.csrfGeneration) this.csrfInflight = null;
      }
    })();
    return this.csrfInflight;
  }

  /** Force a refresh — call after login/logout flips the session. */
  invalidateCsrfToken(): void {
    this.csrfToken = null;
    this.csrfInflight = null;
    this.csrfGeneration += 1;
  }

  private async parseResponse<T>(response: Response): Promise<ApiResponse<T>> {
    if (response.status === 204) return { success: true };

    try {
      const body: unknown = JSON.parse(await response.text());
      if (body && typeof body === 'object' && 'success' in body && typeof body.success === 'boolean') {
        return body as ApiResponse<T>;
      }
    } catch {
      // A proxy can return HTML or an empty body while the backend restarts.
    }
    return {
      success: false,
      error: {
        code: 'INVALID_RESPONSE',
        message: 'Server returned an invalid response. Please try again.',
      },
    };
  }

  private async buildHeaders(options: RequestInit): Promise<Headers> {
    const headers = new Headers(options.headers);
    // The browser must choose the multipart boundary for uploaded files.
    if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (!SAFE_METHODS.has((options.method ?? 'GET').toUpperCase())) {
      const token = await this.getCsrfToken();
      if (token) headers.set('X-CSRF-Token', token);
    }
    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false,
    sessionVersion = useAuthStore.getState().sessionVersion
  ): Promise<ApiResponse<T>> {
    const url = `${API_BASE}${endpoint}`;
    const method = (options.method ?? 'GET').toUpperCase();

    // Password rotation is a short account transition. Background requests
    // must not race its cookie update or invalidate the newly issued session.
    if (useAuthStore.getState().credentialChangePending && !endpoint.startsWith('/auth/')) {
      return this.sessionChanged();
    }

    try {
      const config: RequestInit = {
        cache: 'no-store',
        ...options,
        headers: await this.buildHeaders(options),
        credentials: 'include',
      };
      if (sessionVersion !== useAuthStore.getState().sessionVersion) return this.sessionChanged();
      const response = await fetch(url, config);
      const data = await this.parseResponse<T>(response);
      if (sessionVersion !== useAuthStore.getState().sessionVersion) return this.sessionChanged();

      // A 401 can mean the submitted password is wrong, or the upstream
      // controller rejected its credentials. Only our session middleware's
      // explicit UNAUTHORIZED response means this browser must sign in again.
      if (endpoint !== '/auth/me' && response.status === 401 && data.error?.code === 'UNAUTHORIZED') {
        // Allow a single read retry during backend restarts. Never replay a
        // mutation for an auth failure; only a verified CSRF rejection below
        // guarantees the handler has not run.
        if (!isRetry && SAFE_METHODS.has(method)) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          return this.request<T>(endpoint, options, true, sessionVersion);
        }
        this.invalidateCsrfToken();
        useAuthStore.getState().logout();
      }

      if (response.status === 401 && data.error?.code === 'PASSWORD_CHANGED_SESSION_EXPIRED') {
        this.invalidateCsrfToken();
        useAuthStore.getState().logout();
      }

      // The server can require a change after this tab booted (for example,
      // an administrator reset). The account boundary handles navigation.
      if (response.status === 403 && data.error?.code === 'PASSWORD_CHANGE_REQUIRED') {
        useAuthStore.getState().setMustChangePassword(true);
      }

      // CSRF token mismatch — most often after a login rotates the session
      // mid-tab. Invalidate the cached token, refetch, and retry once.
      if (
        response.status === 403 &&
        !isRetry &&
        data.error?.code === 'CSRF_TOKEN_INVALID'
      ) {
        this.invalidateCsrfToken();
        return this.request<T>(endpoint, options, true, sessionVersion);
      }

      if (!response.ok) {
        return {
          success: false,
          error: data.error || { code: 'UNKNOWN', message: 'Request failed' },
        };
      }

      return data as ApiResponse<T>;
    } catch (error) {
      console.error('API request failed:', endpoint, error);
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error - check if backend is running',
        },
      };
    }
  }

  private sessionChanged<T>(): ApiResponse<T> {
    return { success: false, error: { code: 'SESSION_CHANGED', message: 'Your session changed. Please try again.' } };
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  // Generic method for any HTTP verb
  async fetch<T>(method: string, endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: method.toUpperCase(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async upload<T>(endpoint: string, formData: FormData): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'POST', body: formData });
  }
}

export const api = new ApiClient();
export default api;
