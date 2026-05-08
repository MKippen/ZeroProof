import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UnifiClient, UnifiNotFoundError } from '../src/index.js';
import { MockTransport } from './helpers/MockTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITES_FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/sites.json'), 'utf8')
);

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

describe('sites.list', () => {
  it('parses real (sanitized) UniFi sites response', async () => {
    const transport = new MockTransport().on(
      'GET',
      '/proxy/network/api/self/sites',
      () => ({ status: 200, data: SITES_FIXTURE })
    );

    const c = await loggedIn(transport);
    const sites = await c.sites.list();
    expect(sites.length).toBeGreaterThan(0);
    expect(sites[0]?.name).toBeDefined();
  });

  it('falls back to legacy /api/self/sites when v2 path 404s', async () => {
    const transport = new MockTransport()
      .on('GET', '/proxy/network/api/self/sites', () => ({ status: 404, data: {} }))
      .on('GET', '/api/self/sites', () => ({ status: 200, data: SITES_FIXTURE }));

    const c = await loggedIn(transport);
    const sites = await c.sites.list();
    expect(sites.length).toBeGreaterThan(0);
  });

  it('throws UnifiNotFoundError when both prefixes 404', async () => {
    const transport = new MockTransport()
      .on('GET', '/proxy/network/api/self/sites', () => ({ status: 404, data: {} }))
      .on('GET', '/api/self/sites', () => ({ status: 404, data: {} }));

    const c = await loggedIn(transport);
    await expect(c.sites.list()).rejects.toBeInstanceOf(UnifiNotFoundError);
  });
});
