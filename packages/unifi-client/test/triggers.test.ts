import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UnifiClient } from '../src/index.js';
import { MockTransport } from './helpers/MockTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/triggers-page.json'), 'utf8')
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

describe('triggers.list', () => {
  it('handles an empty page (common — no recent triggered policies)', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/triggers',
      () => ({ data: FIXTURE })
    );
    const c = await loggedIn(transport);
    const page = await c.triggers.list({ beginTime: 1, endTime: 2 });
    expect(page.data).toEqual([]);
    expect(page.totalElementCount).toBe(0);
  });

  it('defaults triggerTypes to TRAFFIC_RULE + TRAFFIC_ROUTE + FIREWALL_RULE', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/triggers',
      () => ({ data: FIXTURE })
    );
    const c = await loggedIn(transport);
    await c.triggers.list({});
    const call = transport.calls.find((req) => req.url.endsWith('/system-log/triggers'));
    expect((call?.body as { triggerTypes: string[] }).triggerTypes).toEqual([
      'TRAFFIC_RULE',
      'TRAFFIC_ROUTE',
      'FIREWALL_RULE',
    ]);
  });

  it('iterate walks pages and stops on hasNext=false', async () => {
    const populated = {
      data: [
        { id: 'T1', triggerType: 'FIREWALL_RULE' },
        { id: 'T2', triggerType: 'FIREWALL_RULE' },
      ],
      page_number: 0,
      total_element_count: 4,
      total_page_count: 2,
      has_next: true,
    };
    const populatedTwo = { ...populated, page_number: 1, has_next: false };
    let calls = 0;
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/triggers',
      () => ({ data: calls++ === 0 ? populated : populatedTwo })
    );
    const c = await loggedIn(transport);
    const ids: string[] = [];
    for await (const t of c.triggers.iterate({ limit: 2 })) {
      ids.push(t.id);
      if (ids.length > 1000) throw new Error('runaway');
    }
    expect(ids).toEqual(['T1', 'T2', 'T1', 'T2']);
  });

  it('parses populated trigger entries when present', async () => {
    const populated = {
      data: [
        {
          id: 'T1',
          timestamp: 1700000000000,
          triggerType: 'FIREWALL_RULE',
          category: 'POLICY',
          event: 'POLICY_FIRED',
          severity: 'INFO',
        },
      ],
      page_number: 0,
      total_element_count: 1,
      total_page_count: 1,
      has_next: false,
    };
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/triggers',
      () => ({ data: populated })
    );
    const c = await loggedIn(transport);
    const page = await c.triggers.list({});
    expect(page.data[0]?.triggerType).toBe('FIREWALL_RULE');
  });
});
