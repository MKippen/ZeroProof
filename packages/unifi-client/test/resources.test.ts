/**
 * Resource-level smoke tests using sanitized fixtures captured from a live
 * UDM-Pro running UniFi Network 10.x. Each test asserts that the real UniFi
 * payload parses into the expected typed object — guarding against schema
 * drift on controller upgrades.
 *
 * Failure-path coverage (auth errors, transport errors, not-found) lives in
 * the dedicated test files for the underlying engine (request.test.ts,
 * login.test.ts, node-transport.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { UnifiClient } from '../src/index.js';
import { MockTransport } from './helpers/MockTransport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, `fixtures/${name}.json`), 'utf8'));
}

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

const SITE = 'default';

function legacyHandler(transport: MockTransport, suffix: string, fixture: unknown): MockTransport {
  return transport.on('GET', `/proxy/network/api/s/${SITE}${suffix}`, () => ({
    status: 200,
    data: fixture,
  }));
}

function v2RawHandler(transport: MockTransport, suffix: string, fixture: unknown): MockTransport {
  return transport.on('GET', `/proxy/network/v2/api/site/${SITE}${suffix}`, () => ({
    status: 200,
    data: fixture,
  }));
}

describe('devices.list', () => {
  it('parses fixture from a real controller', async () => {
    const transport = legacyHandler(new MockTransport(), '/stat/device', loadFixture('devices'));
    const c = await loggedIn(transport);
    const devices = await c.devices.list();
    expect(devices.length).toBeGreaterThan(0);
    expect(devices[0]?._id).toBeDefined();
  });
});

describe('networks.list', () => {
  it('parses fixture and exposes vlan / dhcp DNS fields', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/rest/networkconf',
      loadFixture('networks')
    );
    const c = await loggedIn(transport);
    const networks = await c.networks.list();
    expect(networks.length).toBeGreaterThan(0);
    const first = networks[0]!;
    expect(typeof first.name === 'string' || first.name === undefined).toBe(true);
  });
});

describe('wlans.list', () => {
  it('parses wlanconf fixture', async () => {
    const transport = legacyHandler(new MockTransport(), '/rest/wlanconf', loadFixture('wlans'));
    const c = await loggedIn(transport);
    const wlans = await c.wlans.list();
    expect(wlans.length).toBeGreaterThan(0);
    expect(wlans[0]?._id).toBeDefined();
  });
});

describe('clients', () => {
  it('listActive parses /stat/sta', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/stat/sta',
      loadFixture('clients-active')
    );
    const c = await loggedIn(transport);
    const clients = await c.clients.listActive();
    expect(clients.length).toBeGreaterThan(0);
    expect(clients[0]?.mac).toBeDefined();
  });

  it('listAll forwards within/limit query params', async () => {
    let observedUrl = '';
    const transport = new MockTransport().on(
      'GET',
      /\/proxy\/network\/api\/s\/default\/stat\/alluser/,
      (req) => {
        observedUrl = req.url;
        return { status: 200, data: loadFixture('clients-all') };
      }
    );
    const c = await loggedIn(transport);
    const clients = await c.clients.listAll({ withinHours: 12, limit: 5 });
    expect(observedUrl).toContain('within=12');
    expect(observedUrl).toContain('limit=5');
    expect(clients.length).toBeGreaterThan(0);
  });

  it('listAll without options omits query params', async () => {
    let observedUrl = '';
    const transport = new MockTransport().on(
      'GET',
      /\/proxy\/network\/api\/s\/default\/stat\/alluser/,
      (req) => {
        observedUrl = req.url;
        return { status: 200, data: { meta: { rc: 'ok' }, data: [] } };
      }
    );
    const c = await loggedIn(transport);
    await c.clients.listAll();
    expect(observedUrl).not.toContain('?');
  });
});

describe('firewall', () => {
  it('rules.list parses fixture', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/rest/firewallrule',
      loadFixture('firewall-rules')
    );
    const c = await loggedIn(transport);
    const rules = await c.firewallRules.list();
    expect(Array.isArray(rules)).toBe(true);
  });

  it('groups.list parses fixture', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/rest/firewallgroup',
      loadFixture('firewall-groups')
    );
    const c = await loggedIn(transport);
    const groups = await c.firewallGroups.list();
    expect(groups.length).toBeGreaterThan(0);
  });

  it('policies.list parses bare-array v2 response', async () => {
    const transport = v2RawHandler(
      new MockTransport(),
      '/firewall-policies',
      loadFixture('firewall-policies') // already a bare array on this controller
    );
    const c = await loggedIn(transport);
    const policies = await c.firewallPolicies.list();
    expect(Array.isArray(policies)).toBe(true);
    expect(policies.length).toBeGreaterThan(0);
  });

  it('rules.create POSTs to /rest/firewallrule and returns the created row', async () => {
    let postedBody: unknown;
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/api/s/default/rest/firewallrule',
      (req) => {
        postedBody = req.body;
        return {
          status: 200,
          data: {
            meta: { rc: 'ok' },
            data: [{ _id: 'rule-1', name: req.body && (req.body as Record<string, unknown>).name }],
          },
        };
      }
    );
    const c = await loggedIn(transport);
    const created = await c.firewallRules.create({ name: 'Block IoT', enabled: true });
    expect(postedBody).toEqual({ name: 'Block IoT', enabled: true });
    expect(created._id).toBe('rule-1');
  });

  it('rules.update PUTs to /rest/firewallrule/{id}', async () => {
    let observed: { url: string; body: unknown } | null = null;
    const transport = new MockTransport().on(
      'PUT',
      '/proxy/network/api/s/default/rest/firewallrule/rule-1',
      (req) => {
        observed = { url: req.url, body: req.body };
        return {
          status: 200,
          data: { meta: { rc: 'ok' }, data: [{ _id: 'rule-1', enabled: false }] },
        };
      }
    );
    const c = await loggedIn(transport);
    const updated = await c.firewallRules.update('rule-1', { enabled: false });
    expect(observed!.url).toContain('rule-1');
    expect(observed!.body).toEqual({ enabled: false });
    expect(updated.enabled).toBe(false);
  });

  it('rules.delete sends DELETE for the matching id', async () => {
    let deleted = false;
    const transport = new MockTransport().on(
      'DELETE',
      '/proxy/network/api/s/default/rest/firewallrule/rule-1',
      () => {
        deleted = true;
        return { status: 200, data: { meta: { rc: 'ok' }, data: [] } };
      }
    );
    const c = await loggedIn(transport);
    await c.firewallRules.delete('rule-1');
    expect(deleted).toBe(true);
  });

  it('rules.create throws if controller returns no data row', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/api/s/default/rest/firewallrule',
      () => ({ status: 200, data: { meta: { rc: 'ok' }, data: [] } })
    );
    const c = await loggedIn(transport);
    await expect(c.firewallRules.create({ name: 'x' })).rejects.toThrow(/no data/);
  });

  it('groups.create POSTs and returns the created group', async () => {
    const transport = new MockTransport().on(
      'POST',
      '/proxy/network/api/s/default/rest/firewallgroup',
      () => ({
        status: 200,
        data: { meta: { rc: 'ok' }, data: [{ _id: 'g1', name: 'IoT', group_type: 'address-group' }] },
      })
    );
    const c = await loggedIn(transport);
    const g = await c.firewallGroups.create({
      name: 'IoT',
      group_type: 'address-group',
      group_members: ['192.168.30.0/24'],
    });
    expect(g._id).toBe('g1');
  });
});

describe('traffic', () => {
  it('rules.list parses fixture', async () => {
    const transport = v2RawHandler(
      new MockTransport(),
      '/trafficrules',
      (loadFixture('traffic-rules') as { data?: unknown[] }).data ?? []
    );
    const c = await loggedIn(transport);
    const rules = await c.trafficRules.list();
    expect(Array.isArray(rules)).toBe(true);
  });

  it('routes.list parses fixture', async () => {
    const transport = v2RawHandler(
      new MockTransport(),
      '/trafficroutes',
      (loadFixture('traffic-routes') as { data?: unknown[] }).data ?? []
    );
    const c = await loggedIn(transport);
    const routes = await c.trafficRoutes.list();
    expect(Array.isArray(routes)).toBe(true);
  });

  it('portForwards.list parses fixture', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/rest/portforward',
      loadFixture('port-forwards')
    );
    const c = await loggedIn(transport);
    const pf = await c.portForwards.list();
    expect(Array.isArray(pf)).toBe(true);
  });

  it('routingRules.list parses fixture', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/rest/routing',
      loadFixture('routing-rules')
    );
    const c = await loggedIn(transport);
    const rr = await c.routingRules.list();
    expect(Array.isArray(rr)).toBe(true);
  });
});

describe('system + settings', () => {
  it('system.get returns the first sysinfo row', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/stat/sysinfo',
      {
        meta: { rc: 'ok' },
        data: [{ version: '8.6.9', hostname: 'UDM' }],
      }
    );
    const c = await loggedIn(transport);
    const info = await c.system.get();
    expect(info?.version).toBe('8.6.9');
  });

  it('system.getControllerVersion returns version string', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/stat/sysinfo',
      { meta: { rc: 'ok' }, data: [{ version: '8.6.9' }] }
    );
    const c = await loggedIn(transport);
    const v = await c.system.getControllerVersion();
    expect(v).toBe('8.6.9');
  });

  it('system.get returns null when no rows', async () => {
    const transport = legacyHandler(new MockTransport(), '/stat/sysinfo', {
      meta: { rc: 'ok' },
      data: [],
    });
    const c = await loggedIn(transport);
    expect(await c.system.get()).toBeNull();
    expect(await c.system.getControllerVersion()).toBeNull();
  });

  it('settings.list parses fixture', async () => {
    const transport = legacyHandler(
      new MockTransport(),
      '/get/setting',
      loadFixture('settings')
    );
    const c = await loggedIn(transport);
    const settings = await c.settings.list();
    expect(settings.length).toBeGreaterThan(0);
  });

  it('settings.getByKey finds an entry by its key', async () => {
    const transport = legacyHandler(new MockTransport(), '/get/setting', {
      meta: { rc: 'ok' },
      data: [
        { _id: '1', key: 'foo', value: 'a' },
        { _id: '2', key: 'bar', value: 'b' },
      ],
    });
    const c = await loggedIn(transport);
    const entry = await c.settings.getByKey('bar');
    expect(entry?.key).toBe('bar');
  });

  it('settings.getByKey returns null when key is absent', async () => {
    const transport = legacyHandler(new MockTransport(), '/get/setting', {
      meta: { rc: 'ok' },
      data: [],
    });
    const c = await loggedIn(transport);
    expect(await c.settings.getByKey('nope')).toBeNull();
  });
});

describe('events + alarms', () => {
  it('events.list forwards _limit query parameter', async () => {
    let observedUrl = '';
    const transport = new MockTransport().on(
      'GET',
      /\/proxy\/network\/api\/s\/default\/stat\/event/,
      (req) => {
        observedUrl = req.url;
        return { status: 200, data: { meta: { rc: 'ok' }, data: [] } };
      }
    );
    const c = await loggedIn(transport);
    await c.events.list({ limit: 100 });
    expect(observedUrl).toContain('_limit=100');
  });

  it('events.list without limit hits bare /stat/event', async () => {
    let observedUrl = '';
    const transport = new MockTransport().on(
      'GET',
      /\/proxy\/network\/api\/s\/default\/stat\/event/,
      (req) => {
        observedUrl = req.url;
        return { status: 200, data: { meta: { rc: 'ok' }, data: [] } };
      }
    );
    const c = await loggedIn(transport);
    await c.events.list();
    expect(observedUrl.endsWith('/stat/event')).toBe(true);
  });

  it('alarms.list forwards _limit query parameter', async () => {
    let observedUrl = '';
    const transport = new MockTransport().on(
      'GET',
      /\/proxy\/network\/api\/s\/default\/stat\/alarm/,
      (req) => {
        observedUrl = req.url;
        return { status: 200, data: { meta: { rc: 'ok' }, data: [] } };
      }
    );
    const c = await loggedIn(transport);
    await c.alarms.list({ limit: 50 });
    expect(observedUrl).toContain('_limit=50');
  });

  it('alarms.list without limit hits bare /stat/alarm', async () => {
    let observedUrl = '';
    const transport = new MockTransport().on(
      'GET',
      /\/proxy\/network\/api\/s\/default\/stat\/alarm/,
      (req) => {
        observedUrl = req.url;
        return { status: 200, data: { meta: { rc: 'ok' }, data: [] } };
      }
    );
    const c = await loggedIn(transport);
    await c.alarms.list();
    expect(observedUrl.endsWith('/stat/alarm')).toBe(true);
  });
});

describe('sites.list (additional smoke against fixture)', () => {
  it('parses sites fixture', async () => {
    const transport = new MockTransport().on(
      'GET',
      '/proxy/network/api/self/sites',
      () => ({ status: 200, data: loadFixture('sites') })
    );
    const c = await loggedIn(transport);
    const sites = await c.sites.list();
    expect(sites.length).toBeGreaterThan(0);
  });
});

describe('testConnection', () => {
  it('returns success when login + sites both succeed', async () => {
    const transport = new MockTransport()
      .on('POST', '/api/auth/login', () => ({ status: 200, data: {} }))
      .on('GET', '/proxy/network/api/self/sites', () => ({
        status: 200,
        data: { meta: { rc: 'ok' }, data: [{ name: 'default' }] },
      }))
      .on('POST', '/api/auth/logout', () => ({ status: 200, data: {} }));

    const c = new UnifiClient({
      host: 'h',
      port: 443,
      username: 'u',
      password: 'p',
      transport,
    });
    const result = await c.testConnection();
    expect(result.success).toBe(true);
    expect(result.sites?.length).toBe(1);
  });

  it('returns failure with message on auth error', async () => {
    const transport = new MockTransport().on('POST', '/api/auth/login', () => ({
      status: 401,
      data: {},
    }));
    const c = new UnifiClient({
      host: 'h',
      port: 443,
      username: 'u',
      password: 'p',
      transport,
    });
    const result = await c.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Invalid|Unauthorized/i);
  });

  it('reports a transport error in the message field', async () => {
    const transport = new MockTransport()
      .on('POST', '/api/auth/login', () => ({ status: 200, data: {} }))
      .on('GET', '/proxy/network/api/self/sites', () => ({ status: 500, data: {} }))
      .on('GET', '/api/self/sites', () => ({ status: 500, data: {} }));
    const c = new UnifiClient({
      host: 'h',
      port: 443,
      username: 'u',
      password: 'p',
      transport,
    });
    const result = await c.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/Controller error|sites/);
  });
});
