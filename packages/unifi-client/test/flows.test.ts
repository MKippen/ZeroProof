import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UnifiClient } from '../src/index.js';
import { MockTransport } from './helpers/MockTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FLOW_FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/traffic-flows-page.json'), 'utf8')
);

async function loggedInClient(transport: MockTransport): Promise<UnifiClient> {
  transport.on('POST', '/api/auth/login', () => ({
    status: 200,
    headers: { 'set-cookie': ['TOKEN=abc'], 'x-csrf-token': 'csrf' },
    data: { meta: { rc: 'ok' } },
  }));

  const c = new UnifiClient({
    host: 'controller.example',
    port: 443,
    username: 'admin',
    password: 'hunter2',
    siteId: 'default',
    transport,
  });
  await c.login();
  return c;
}

describe('flows.list', () => {
  it('parses a real (sanitized) UniFi 10.x response into typed FlowEvents', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/traffic-flows',
      () => ({ status: 200, data: FLOW_FIXTURE })
    );

    const c = await loggedInClient(transport);
    const page = await c.flows.list({ beginTime: 1, endTime: 2, limit: 5 });

    expect(page.data.length).toBeGreaterThan(0);
    expect(page.totalElementCount).toBe(FLOW_FIXTURE.total_element_count);

    const first = page.data[0]!;
    expect(first.action).toBe('blocked');
    expect(first.source?.client_name).toBeDefined();
    expect(first.destination?.ip).toBeDefined();
    expect(first.policies?.[0]?.name).toBeDefined();
    expect(first.in?.network_name).toBeDefined();
  });

  it('forwards body params to the controller', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/traffic-flows',
      () => ({ data: FLOW_FIXTURE })
    );

    const c = await loggedInClient(transport);
    await c.flows.list({ beginTime: 100, endTime: 200, limit: 50, page: 1, actions: ['blocked'] });

    const flowCall = transport.calls.find((call) => call.url.endsWith('/traffic-flows'));
    expect(flowCall?.body).toEqual({
      beginTime: 100,
      endTime: 200,
      limit: 50,
      page: 1,
      actions: ['blocked'],
    });
  });

  it('attaches Cookie + X-CSRF-Token headers from the active session', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/traffic-flows',
      () => ({ data: FLOW_FIXTURE })
    );

    const c = await loggedInClient(transport);
    await c.flows.list({});

    const flowCall = transport.calls.find((call) => call.url.endsWith('/traffic-flows'));
    expect(flowCall?.headers?.['Cookie']).toContain('TOKEN=abc');
    expect(flowCall?.headers?.['X-CSRF-Token']).toBe('csrf');
  });
});

describe('flows.iterate', () => {
  it('walks distinct pages and yields each row once', async () => {
    // UniFi-style: page 1 has fresh ids, page 2 has different ids, page 3
    // repeats one of page 2's ids (the iterator must dedupe).
    const fixture = FLOW_FIXTURE as { data: Array<{ id: string }> };
    const pageOne = {
      data: fixture.data.slice(0, 10),
      page_number: 0,
      total_element_count: 30,
      total_page_count: 3,
      has_next: true,
    };
    const pageTwo = {
      data: fixture.data.slice(10, 20),
      page_number: 1,
      total_element_count: 30,
      total_page_count: 3,
      has_next: true,
    };
    const pageThree = {
      data: fixture.data.slice(15, 25),
      page_number: 2,
      total_element_count: 30,
      total_page_count: 3,
      has_next: false,
    };
    let pageIdx = 0;
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/traffic-flows',
      () => ({ data: [pageOne, pageTwo, pageThree][pageIdx++] })
    );

    const c = await loggedInClient(transport);
    const ids: string[] = [];
    for await (const flow of c.flows.iterate({ limit: 10 })) {
      ids.push(flow.id);
      if (ids.length > 1000) throw new Error('runaway iterator');
    }
    // Page 1 (10) + page 2 (10) + page 3 (5 new, 5 dup) = 25 unique rows.
    expect(ids.length).toBe(25);
    expect(new Set(ids).size).toBe(25);
  });

  it('terminates when a page yields zero new rows (UniFi page-param-ignored case)', async () => {
    const fixture = FLOW_FIXTURE as { data: Array<{ id: string }> };
    const samePage = {
      data: fixture.data.slice(0, 10),
      page_number: 0,
      total_element_count: 100,
      total_page_count: 10,
      has_next: true,
    };
    let calls = 0;
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/traffic-flows',
      () => {
        calls += 1;
        return { data: samePage };
      }
    );

    const c = await loggedInClient(transport);
    const ids: string[] = [];
    for await (const flow of c.flows.iterate({ limit: 10 })) {
      ids.push(flow.id);
    }
    // Only the first page's 10 rows; second call sees zero new ids → stop.
    expect(ids.length).toBe(10);
    expect(calls).toBe(2);
  });
});
