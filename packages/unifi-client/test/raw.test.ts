import { describe, it, expect } from 'vitest';
import { UnifiClient } from '../src/index.js';
import { MockTransport } from './helpers/MockTransport.js';

async function loggedIn(transport: MockTransport): Promise<UnifiClient> {
  transport.on('POST', '/api/auth/login', () => ({
    status: 200,
    headers: { 'set-cookie': ['T=abc'] },
    data: { meta: { rc: 'ok' } },
  }));
  const c = new UnifiClient({
    host: 'controller.example',
    port: 443,
    username: 'admin',
    password: 'hunter2',
    transport,
  });
  await c.login();
  return c;
}

describe('raw escape hatch', () => {
  it('GET returns parsed JSON without schema validation', async () => {
    const transport = new MockTransport().on(
      'GET',
      '/proxy/network/api/s/default/anything',
      () => ({ status: 200, data: { meta: { rc: 'ok' }, data: ['hello'] } })
    );
    const c = await loggedIn(transport);
    const result = await c.raw.get<{ data: string[] }>('/api/s/default/anything');
    expect(result.data).toEqual(['hello']);
  });

  it('GET with /proxy/ prefix is treated as raw path (no basePath rewrite)', async () => {
    const transport = new MockTransport().on(
      'GET',
      '/proxy/network/v2/api/site/default/custom',
      () => ({ status: 200, data: ['a'] })
    );
    const c = await loggedIn(transport);
    const result = await c.raw.get<string[]>('/proxy/network/v2/api/site/default/custom');
    expect(result).toEqual(['a']);
  });

  it('POST forwards body', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/api/s/default/x',
      (req) => ({ data: { meta: { rc: 'ok' }, echoed: req.body } })
    );
    const c = await loggedIn(transport);
    const result = await c.raw.post<{ echoed: unknown }>('/api/s/default/x', { hello: 'world' });
    expect(result.echoed).toEqual({ hello: 'world' });
  });

  it('PUT forwards body', async () => {
    const transport = new MockTransport().on(
      'PUT',
      '/proxy/network/api/s/default/x/1',
      (req) => ({ data: { ok: true, body: req.body } })
    );
    const c = await loggedIn(transport);
    const result = await c.raw.put<{ ok: boolean; body: unknown }>('/api/s/default/x/1', { v: 2 });
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ v: 2 });
  });

  it('DELETE returns the controller response', async () => {
    const transport = new MockTransport().on(
      'DELETE',
      '/proxy/network/api/s/default/x/1',
      () => ({ status: 200, data: { meta: { rc: 'ok' }, data: [] } })
    );
    const c = await loggedIn(transport);
    const result = await c.raw.delete<{ data: unknown[] }>('/api/s/default/x/1');
    expect(result.data).toEqual([]);
  });
});
