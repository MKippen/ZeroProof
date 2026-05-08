import { describe, it, expect } from 'vitest';
import { UnifiClient, UnifiAuthError } from '../src/index.js';
import { MockTransport } from './helpers/MockTransport.js';

function client(transport: MockTransport, overrides: Partial<{ allowSelfSigned: boolean }> = {}) {
  return new UnifiClient({
    host: 'controller.example',
    port: 443,
    username: 'admin',
    password: 'hunter2',
    siteId: 'default',
    transport,
    ...overrides,
  });
}

describe('UnifiClient.login', () => {
  it('logs in via UniFi-OS and stores cookies + CSRF token', async () => {
    const transport = new MockTransport().on('POST', '/api/auth/login', (req) => {
      expect(req.body).toEqual({ username: 'admin', password: 'hunter2', remember: true });
      return {
        status: 200,
        headers: {
          'set-cookie': ['TOKEN=abc; Path=/; HttpOnly', 'csrf=xyz'],
          'x-csrf-token': 'csrf-token-value',
        },
        data: { meta: { rc: 'ok' } },
      };
    });

    const c = client(transport);
    await c.login();
    expect(c.isLoggedIn()).toBe(true);
  });

  it('throws UnifiAuthError on 401', async () => {
    const transport = new MockTransport().on('POST', '/api/auth/login', () => ({
      status: 401,
      data: { error: 'unauthorized' },
    }));

    const c = client(transport);
    await expect(c.login()).rejects.toBeInstanceOf(UnifiAuthError);
    expect(c.isLoggedIn()).toBe(false);
  });

  it('falls back to legacy /api/login when UniFi OS returns transport error', async () => {
    let osTriedFirst = false;
    const transport = new MockTransport()
      .on('POST', '/api/auth/login', () => {
        osTriedFirst = true;
        throw new Error('socket hang up');
      })
      .on('POST', '/api/login', () => ({
        status: 200,
        headers: { 'set-cookie': ['unifises=session-id'] },
        data: { meta: { rc: 'ok' } },
      }));

    const c = client(transport);
    await c.login();
    expect(osTriedFirst).toBe(true);
    expect(c.isLoggedIn()).toBe(true);
  });
});

describe('UnifiClient.logout', () => {
  it('is idempotent before login', async () => {
    const transport = new MockTransport();
    const c = client(transport);
    await expect(c.logout()).resolves.toBeUndefined();
    expect(transport.calls).toHaveLength(0);
  });
});
