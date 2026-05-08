import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UnifiClient } from '../src/index.js';
import { MockTransport } from './helpers/MockTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/threat-alerts-page.json'), 'utf8')
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

describe('threats.list', () => {
  it('parses a real (sanitized) threat-alert page', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/threat-alert',
      () => ({ data: FIXTURE })
    );
    const c = await loggedIn(transport);
    const page = await c.threats.list({ beginTime: 1, endTime: 2 });

    expect(page.data.length).toBeGreaterThan(0);
    const first = page.data[0]!;
    expect(first.id).toBeDefined();
    expect(first.event).toBeDefined();
    expect(first.parameters?.SRC_IP?.id).toBeDefined();
    expect(first.parameters?.DST_IP?.id).toBeDefined();
  });

  it('defaults threatTypes to HONEYPOT + THREAT', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/threat-alert',
      () => ({ data: FIXTURE })
    );
    const c = await loggedIn(transport);
    await c.threats.list({});
    const call = transport.calls.find((req) => req.url.endsWith('/system-log/threat-alert'));
    expect((call?.body as { threatTypes: string[] }).threatTypes).toEqual(['HONEYPOT', 'THREAT']);
  });

  it('forwards explicit threatTypes filter', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/threat-alert',
      () => ({ data: FIXTURE })
    );
    const c = await loggedIn(transport);
    await c.threats.list({ threatTypes: ['HONEYPOT'] });
    const call = transport.calls.find((req) => req.url.endsWith('/system-log/threat-alert'));
    expect((call?.body as { threatTypes: string[] }).threatTypes).toEqual(['HONEYPOT']);
  });
});

describe('threats.iterate', () => {
  it('dedupes by id across pages and terminates on zero-new-rows', async () => {
    const fixtureBody = FIXTURE as { data: Array<{ id: string }> };
    const pageOne = {
      data: fixtureBody.data.slice(0, 10),
      page_number: 0,
      total_element_count: 20,
      total_page_count: 2,
      has_next: true,
    };
    const pageTwo = {
      // Overlap with page one — iterator should dedupe.
      data: fixtureBody.data.slice(8, 18),
      page_number: 1,
      total_element_count: 20,
      total_page_count: 2,
      has_next: false,
    };
    let pageIdx = 0;
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/v2/api/site/default/system-log/threat-alert',
      () => ({ data: [pageOne, pageTwo][pageIdx++] })
    );
    const c = await loggedIn(transport);
    const ids: string[] = [];
    for await (const t of c.threats.iterate({ limit: 10 })) {
      ids.push(t.id);
    }
    expect(ids.length).toBe(18);
    expect(new Set(ids).size).toBe(18);
  });
});
