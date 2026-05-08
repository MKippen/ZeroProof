import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { resolveConfig } from '../src/config.js';
import { Session } from '../src/auth/session.js';
import { apiRequest, parseOrThrow } from '../src/transport/request.js';
import {
  UnifiAuthError,
  UnifiNotFoundError,
  UnifiResponseError,
  UnifiTransportError,
} from '../src/errors.js';
import { MockTransport } from './helpers/MockTransport.js';

const baseConfig = resolveConfig({
  host: 'controller.example',
  port: 443,
  username: 'admin',
  password: 'hunter2',
});

describe('apiRequest — UniFi-OS first, legacy fallback', () => {
  it('uses configured basePath on first attempt', async () => {
    const transport = new MockTransport()
      .on('GET', '/proxy/network/api/self/sites', () => ({
        status: 200,
        data: { meta: { rc: 'ok' }, data: [{ name: 'default' }] },
      }));
    const session = new Session();

    const result = await apiRequest(baseConfig, transport, session, {
      method: 'GET',
      path: '/api/self/sites',
    });

    expect(result).toEqual({ meta: { rc: 'ok' }, data: [{ name: 'default' }] });
    expect(transport.calls).toHaveLength(1);
  });

  it('falls back to unprefixed path when basePath returns 404', async () => {
    const transport = new MockTransport()
      .on('GET', '/proxy/network/api/legacy', () => ({ status: 404, data: { meta: { rc: 'error' } } }))
      .on('GET', '/api/legacy', () => ({
        status: 200,
        data: { meta: { rc: 'ok' }, data: [] },
      }));
    const session = new Session();

    const result = await apiRequest(baseConfig, transport, session, {
      method: 'GET',
      path: '/api/legacy',
    });

    expect(result).toBeTruthy();
    expect(transport.calls).toHaveLength(2);
  });

  it('falls back when the controller returns the SPA HTML index', async () => {
    const transport = new MockTransport()
      .on('GET', '/proxy/network/api/missing', () => ({
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        data: '<!doctype html><html>...</html>',
      }))
      .on('GET', '/api/missing', () => ({
        status: 200,
        data: { meta: { rc: 'ok' }, data: [{ id: 1 }] },
      }));
    const session = new Session();

    const result = await apiRequest<{ data: Array<{ id: number }> }>(
      baseConfig,
      transport,
      session,
      { method: 'GET', path: '/api/missing' }
    );

    expect(result.data).toEqual([{ id: 1 }]);
  });

  it('detects HTML when content-type lies but body starts with <', async () => {
    const transport = new MockTransport()
      .on('GET', '/proxy/network/api/x', () => ({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: '<html>not actually JSON</html>',
      }))
      .on('GET', '/api/x', () => ({ status: 200, data: { meta: {}, data: [] } }));

    const session = new Session();
    await apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/x' });
    expect(transport.calls).toHaveLength(2);
  });

  it('throws UnifiAuthError on 401 without falling back', async () => {
    const transport = new MockTransport().on('GET', '/proxy/network/api/p', () => ({
      status: 401,
      data: { error: 'unauthorized' },
    }));
    const session = new Session();
    await expect(
      apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/p' })
    ).rejects.toBeInstanceOf(UnifiAuthError);
  });

  it('throws UnifiAuthError on 403', async () => {
    const transport = new MockTransport().on('GET', '/proxy/network/api/p', () => ({
      status: 403,
      data: {},
    }));
    const session = new Session();
    await expect(
      apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/p' })
    ).rejects.toBeInstanceOf(UnifiAuthError);
  });

  it('throws UnifiNotFoundError when both prefixes 404', async () => {
    const transport = new MockTransport()
      .on('GET', '/proxy/network/api/gone', () => ({ status: 404, data: {} }))
      .on('GET', '/api/gone', () => ({ status: 404, data: {} }));
    const session = new Session();
    await expect(
      apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/gone' })
    ).rejects.toBeInstanceOf(UnifiNotFoundError);
  });

  it('throws UnifiTransportError on 5xx', async () => {
    const transport = new MockTransport().on('GET', '/proxy/network/api/down', () => ({
      status: 503,
      data: {},
    }));
    const session = new Session();
    await expect(
      apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/down' })
    ).rejects.toBeInstanceOf(UnifiTransportError);
  });

  it('throws UnifiTransportError on 3xx redirects we cannot follow', async () => {
    const transport = new MockTransport().on('GET', '/proxy/network/api/r', () => ({
      status: 302,
      data: {},
    }));
    const session = new Session();
    await expect(
      apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/r' })
    ).rejects.toBeInstanceOf(UnifiTransportError);
  });

  it('ingests cookies + CSRF on every successful response', async () => {
    const transport = new MockTransport().on('GET', '/proxy/network/api/p', () => ({
      status: 200,
      headers: { 'set-cookie': ['T=fresh'], 'x-csrf-token': 'new-csrf' },
      data: { meta: {}, data: [] },
    }));
    const session = new Session();
    await apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/p' });
    expect(session.authHeaders()).toEqual({ Cookie: 'T=fresh', 'X-CSRF-Token': 'new-csrf' });
  });

  it('attaches session headers to every request', async () => {
    const session = new Session();
    session.ingestResponseHeaders({ 'set-cookie': ['T=existing'], 'x-csrf-token': 'c' });
    const transport = new MockTransport().on('GET', '/proxy/network/api/h', () => ({
      data: { meta: {}, data: [] },
    }));
    await apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/h' });
    expect(transport.calls[0]?.headers?.['Cookie']).toBe('T=existing');
    expect(transport.calls[0]?.headers?.['X-CSRF-Token']).toBe('c');
  });

  it('passes POST body through the transport', async () => {
    const transport = new MockTransport().on('POST', '/proxy/network/api/x', () => ({
      data: { meta: { rc: 'ok' }, data: [] },
    }));
    const session = new Session();
    await apiRequest(baseConfig, transport, session, {
      method: 'POST',
      path: '/api/x',
      body: { foo: 'bar' },
    });
    expect(transport.calls[0]?.body).toEqual({ foo: 'bar' });
  });

  it('honours `raw: true` and skips basePath prefix', async () => {
    const transport = new MockTransport().on('GET', '/raw/path', () => ({
      data: { meta: {}, data: [] },
    }));
    const session = new Session();
    await apiRequest(baseConfig, transport, session, {
      method: 'GET',
      path: '/raw/path',
      raw: true,
    });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.url).toBe('/raw/path');
  });

  it('wraps last transport error when all prefixes fail', async () => {
    const transport = new MockTransport().setFallback(() => {
      throw new UnifiTransportError('connect ECONNREFUSED', { path: 'x' });
    });
    const session = new Session();
    await expect(
      apiRequest(baseConfig, transport, session, { method: 'GET', path: '/api/p' })
    ).rejects.toBeInstanceOf(UnifiTransportError);
  });
});

describe('parseOrThrow', () => {
  const Schema = z.object({ data: z.array(z.object({ id: z.string() })) });

  it('returns parsed data on success', () => {
    const result = parseOrThrow('/p', Schema, { data: [{ id: 'one' }] });
    expect(result.data).toEqual([{ id: 'one' }]);
  });

  it('throws UnifiResponseError with extracted issues', () => {
    try {
      parseOrThrow('/p', Schema, { data: [{ id: 42 }, { id: null }] });
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(UnifiResponseError);
      const issues = (err as UnifiResponseError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]?.path).toContain('data');
    }
  });
});
