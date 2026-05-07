import type { ResolvedConfig } from '../config.js';
import type { HttpTransport } from '../transport/http.js';
import type { Session } from './session.js';
import { UnifiAuthError, UnifiTransportError } from '../errors.js';

/**
 * Logs into the controller, populating the session with cookies + CSRF token.
 * Tries UniFi OS first (`/api/auth/login`), falls back to legacy
 * (`/api/login`). Throws UnifiAuthError on credential failure.
 */
export async function performLogin(
  config: ResolvedConfig,
  transport: HttpTransport,
  session: Session
): Promise<{ controllerType: 'unifi-os' | 'legacy' }> {
  const candidates: Array<{ url: string; type: 'unifi-os' | 'legacy' }> = [
    { url: '/api/auth/login', type: 'unifi-os' },
    { url: '/api/login', type: 'legacy' },
  ];

  let lastStatus: number | undefined;
  let lastError: unknown;

  for (const { url, type } of candidates) {
    try {
      const response = await transport.request({
        method: 'POST',
        url,
        body: { username: config.username, password: config.password, remember: true },
      });

      session.ingestResponseHeaders(response.headers);

      if (response.status >= 200 && response.status < 300) {
        session.markLoggedIn();
        config.logger.info('Logged into UniFi controller', { type });
        return { controllerType: type };
      }

      lastStatus = response.status;
      if (response.status === 401 || response.status === 403) {
        // Credentials are wrong — no point falling back.
        throw new UnifiAuthError('Invalid UniFi credentials', { statusCode: response.status });
      }
    } catch (err) {
      if (err instanceof UnifiAuthError) throw err;
      // Transport error — try the next candidate.
      lastError = err;
      if (err instanceof UnifiTransportError) {
        config.logger.debug('Login candidate failed, trying next', { url, error: err.message });
      }
    }
  }

  throw new UnifiAuthError(
    `UniFi login failed (last status: ${lastStatus ?? 'no response'})`,
    { cause: lastError, statusCode: lastStatus }
  );
}

export async function performLogout(
  config: ResolvedConfig,
  transport: HttpTransport,
  session: Session
): Promise<void> {
  if (!session.isLoggedIn()) return;
  try {
    await transport.request({
      method: 'POST',
      url: '/api/auth/logout',
      headers: session.authHeaders(),
    });
  } catch (err) {
    config.logger.debug('Logout request failed (ignored)', { error: (err as Error).message });
  } finally {
    session.markLoggedOut();
  }
}
