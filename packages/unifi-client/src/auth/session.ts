/**
 * Session state — tracks cookies and CSRF tokens captured from controller
 * responses. Mutable by design; instantiated per UnifiClient.
 */
export class Session {
  private cookies: string[] = [];
  private csrfToken: string | null = null;
  private loggedIn = false;

  isLoggedIn(): boolean {
    return this.loggedIn;
  }

  markLoggedIn(): void {
    this.loggedIn = true;
  }

  markLoggedOut(): void {
    this.loggedIn = false;
    this.cookies = [];
    this.csrfToken = null;
  }

  /** Update session state from response headers. */
  ingestResponseHeaders(headers: Record<string, string | string[] | undefined>): void {
    const setCookie = headers['set-cookie'];
    if (setCookie) {
      const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
      this.cookies = arr.map((c) => c.split(';')[0] ?? '').filter(Boolean);
    }

    const csrf = headers['x-csrf-token'];
    if (typeof csrf === 'string' && csrf.length > 0) {
      this.csrfToken = csrf;
    } else if (Array.isArray(csrf) && csrf[0]) {
      this.csrfToken = csrf[0];
    }
  }

  /** Headers to attach to subsequent requests. */
  authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.cookies.length > 0) headers['Cookie'] = this.cookies.join('; ');
    if (this.csrfToken) headers['X-CSRF-Token'] = this.csrfToken;
    return headers;
  }
}
