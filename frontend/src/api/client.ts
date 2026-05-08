import type { ApiResponse } from '@/types';
import { useAuthStore } from '@/stores/authStore';

const API_BASE = '/api/v1';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

class ApiClient {
  // Per-tab CSRF token. Synchronizer-token bound to the session cookie —
  // fetched lazily on the first mutating request and refreshed on 403
  // (e.g., session rotated after login).
  private csrfToken: string | null = null;
  private csrfInflight: Promise<string | null> | null = null;

  private async getCsrfToken(): Promise<string | null> {
    if (this.csrfToken) return this.csrfToken;
    if (this.csrfInflight) return this.csrfInflight;
    this.csrfInflight = (async () => {
      try {
        const response = await fetch(`${API_BASE}/auth/csrf`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) return null;
        const body = (await response.json()) as ApiResponse<{ csrfToken: string }>;
        if (body.success && body.data) {
          this.csrfToken = body.data.csrfToken;
          return this.csrfToken;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.csrfInflight = null;
      }
    })();
    return this.csrfInflight;
  }

  /** Force a refresh — call after login/logout flips the session. */
  invalidateCsrfToken(): void {
    this.csrfToken = null;
  }

  private async parseResponse<T>(response: Response): Promise<Partial<ApiResponse<T>>> {
    const body = await response.text();
    if (!body) {
      return {};
    }

    try {
      return JSON.parse(body) as ApiResponse<T>;
    } catch {
      return {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Server returned an invalid JSON response',
        },
      };
    }
  }

  private async buildHeaders(
    method: string,
    extra?: HeadersInit,
    isRetry = false
  ): Promise<HeadersInit> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(extra as Record<string, string> | undefined),
    };
    if (!SAFE_METHODS.has(method.toUpperCase())) {
      if (isRetry) this.invalidateCsrfToken();
      const token = await this.getCsrfToken();
      if (token) headers['X-CSRF-Token'] = token;
    }
    return headers;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    isRetry = false
  ): Promise<ApiResponse<T>> {
    const url = `${API_BASE}${endpoint}`;
    const method = (options.method ?? 'GET').toUpperCase();

    const config: RequestInit = {
      cache: 'no-store',
      ...options,
      headers: await this.buildHeaders(method, options.headers, isRetry),
      credentials: 'include',
    };

    try {
      const response = await fetch(url, config);
      const data = await this.parseResponse<T>(response);

      // Handle session expiration - redirect to login
      if (response.status === 401 && !endpoint.includes('/auth/login')) {
        console.warn('Session expired, logging out...');
        useAuthStore.getState().logout();
        // Only redirect if we're not already on login page
        if (!window.location.pathname.includes('/login')) {
          window.location.href = '/login';
        }
      }

      // CSRF token mismatch — most often after a login rotates the session
      // mid-tab. Invalidate the cached token, refetch, and retry once.
      if (
        response.status === 403 &&
        !isRetry &&
        data.error?.code === 'CSRF_TOKEN_INVALID'
      ) {
        this.invalidateCsrfToken();
        return this.request<T>(endpoint, options, true);
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

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  // Generic method for any HTTP verb
  async fetch<T>(method: string, endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: method.toUpperCase(),
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async upload<T>(endpoint: string, formData: FormData): Promise<ApiResponse<T>> {
    const url = `${API_BASE}${endpoint}`;
    const csrfHeaders: Record<string, string> = {};
    const token = await this.getCsrfToken();
    if (token) csrfHeaders['X-CSRF-Token'] = token;

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        credentials: 'include',
        cache: 'no-store',
        headers: csrfHeaders,
      });
      const data = await this.parseResponse<T>(response);

      if (!response.ok) {
        return {
          success: false,
          error: data.error || { code: 'UNKNOWN', message: 'Upload failed' },
        };
      }

      return data as ApiResponse<T>;
    } catch (error) {
      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }
}

export const api = new ApiClient();
export default api;
