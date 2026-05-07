import { describe, it, expect, vi } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { Session } from '../src/auth/session.js';
import { performLogin, performLogout } from '../src/auth/login.js';
import { UnifiAuthError, UnifiTransportError } from '../src/errors.js';
import { MockTransport } from './helpers/MockTransport.js';

const baseConfig = resolveConfig({
  host: 'controller.example',
  port: 443,
  username: 'admin',
  password: 'hunter2',
});

describe('performLogin', () => {
  it('succeeds via UniFi-OS path on first try', async () => {
    const session = new Session();
    const transport = new MockTransport().on('POST', '/api/auth/login', () => ({
      status: 200,
      headers: { 'set-cookie': ['T=abc'] },
      data: { meta: { rc: 'ok' } },
    }));
    const result = await performLogin(baseConfig, transport, session);
    expect(result.controllerType).toBe('unifi-os');
    expect(session.isLoggedIn()).toBe(true);
  });

  it('falls back to legacy /api/login on transport error', async () => {
    const session = new Session();
    const transport = new MockTransport()
      .on('POST', '/api/auth/login', () => {
        throw new UnifiTransportError('refused', { path: '/api/auth/login' });
      })
      .on('POST', '/api/login', () => ({
        status: 200,
        headers: { 'set-cookie': ['T=fallback'] },
        data: { meta: { rc: 'ok' } },
      }));
    const result = await performLogin(baseConfig, transport, session);
    expect(result.controllerType).toBe('legacy');
    expect(session.isLoggedIn()).toBe(true);
  });

  it('throws UnifiAuthError on 401 and does not fall back', async () => {
    const session = new Session();
    let legacyCalled = false;
    const transport = new MockTransport()
      .on('POST', '/api/auth/login', () => ({ status: 401, data: {} }))
      .on('POST', '/api/login', () => {
        legacyCalled = true;
        return { status: 200, data: {} };
      });
    await expect(performLogin(baseConfig, transport, session)).rejects.toBeInstanceOf(
      UnifiAuthError
    );
    expect(legacyCalled).toBe(false);
  });

  it('throws UnifiAuthError on 403 and does not fall back', async () => {
    const session = new Session();
    const transport = new MockTransport().on('POST', '/api/auth/login', () => ({
      status: 403,
      data: {},
    }));
    await expect(performLogin(baseConfig, transport, session)).rejects.toBeInstanceOf(
      UnifiAuthError
    );
  });

  it('throws UnifiAuthError when both candidates fail with non-credential errors', async () => {
    const session = new Session();
    const transport = new MockTransport()
      .on('POST', '/api/auth/login', () => ({ status: 500, data: {} }))
      .on('POST', '/api/login', () => ({ status: 500, data: {} }));
    await expect(performLogin(baseConfig, transport, session)).rejects.toBeInstanceOf(
      UnifiAuthError
    );
  });

  it('logs successful login when a logger is provided', async () => {
    const info = vi.fn();
    const config = resolveConfig({
      host: 'h',
      port: 443,
      username: 'u',
      password: 'p',
      logger: { info },
    });
    const session = new Session();
    const transport = new MockTransport().on('POST', '/api/auth/login', () => ({
      status: 200,
      data: { meta: {} },
    }));
    await performLogin(config, transport, session);
    expect(info).toHaveBeenCalledWith('Logged into UniFi controller', { type: 'unifi-os' });
  });

  it('logs debug on candidate failure', async () => {
    const debug = vi.fn();
    const config = resolveConfig({
      host: 'h',
      port: 443,
      username: 'u',
      password: 'p',
      logger: { debug },
    });
    const session = new Session();
    const transport = new MockTransport()
      .on('POST', '/api/auth/login', () => {
        throw new UnifiTransportError('boom', { path: '/x' });
      })
      .on('POST', '/api/login', () => ({ status: 200, data: {} }));
    await performLogin(config, transport, session);
    expect(debug).toHaveBeenCalled();
  });
});

describe('performLogout', () => {
  it('is a no-op when not logged in', async () => {
    const session = new Session();
    const transport = new MockTransport();
    await performLogout(baseConfig, transport, session);
    expect(transport.calls).toHaveLength(0);
  });

  it('clears session state on success', async () => {
    const session = new Session();
    session.markLoggedIn();
    session.ingestResponseHeaders({ 'set-cookie': ['T=abc'] });
    const transport = new MockTransport().on('POST', '/api/auth/logout', () => ({
      status: 200,
      data: {},
    }));
    await performLogout(baseConfig, transport, session);
    expect(session.isLoggedIn()).toBe(false);
    expect(session.authHeaders()).toEqual({});
  });

  it('still clears session even when controller errors out', async () => {
    const session = new Session();
    session.markLoggedIn();
    const transport = new MockTransport().on('POST', '/api/auth/logout', () => {
      throw new Error('network gone');
    });
    await performLogout(baseConfig, transport, session);
    expect(session.isLoggedIn()).toBe(false);
  });
});
