/**
 * Captures sanitized fixtures for the @uguard/unifi-client test suite.
 * Replaces public IPs with documentation-range placeholders so we can commit
 * the JSON without leaking the controller's external traffic.
 */
import prisma from '../src/services/database';
import { decrypt } from '../src/utils/encryption';
import { UniFiClient } from '../src/services/unifiClient';
import type { AxiosInstance } from 'axios';
import { writeFileSync } from 'fs';
import path from 'path';

const FIXTURE_DIR = path.resolve(__dirname, '../../packages/unifi-client/test/fixtures');

function sanitize(input: unknown): unknown {
  let pubCounter = 100;
  let macCounter = 1;

  function isPrivateIp(ip: string): boolean {
    return /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(ip);
  }

  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = walk(v);
      }
      // Per-object IP/MAC rewrite
      if (typeof out.ip === 'string' && !isPrivateIp(out.ip)) {
        const fake = `203.0.113.${pubCounter++}`;
        out.ip = fake;
        if (typeof out.id === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(out.id)) out.id = fake;
      }
      if (typeof out.mac === 'string' && /^[0-9a-fA-F:]{17}$/.test(out.mac)) {
        const last = (macCounter++ % 256).toString(16).padStart(2, '0');
        out.mac = `aa:bb:cc:dd:ee:${last}`;
        if (typeof out.id === 'string' && /^[0-9a-fA-F:]{17}$/.test(out.id)) out.id = out.mac;
      }
      return out;
    }
    return value;
  }

  return walk(input);
}

async function main(): Promise<void> {
  const conn = await prisma.uniFiConnection.findFirst({ where: { isActive: true } });
  if (!conn) throw new Error('No active UniFiConnection');

  const client = new UniFiClient({
    host: conn.host,
    port: conn.port,
    username: decrypt(conn.usernameEnc),
    password: decrypt(conn.passwordEnc),
    siteId: conn.siteId,
  });
  await client.login();

  const axios: AxiosInstance = (client as unknown as { client: AxiosInstance }).client;
  const cookies: string[] = (client as unknown as { cookies: string[] }).cookies;
  const csrf: string | null = (client as unknown as { csrfToken: string | null }).csrfToken;
  const headers: Record<string, string> = { Cookie: cookies.join('; ') };
  if (csrf) headers['X-CSRF-Token'] = csrf;

  const since = Date.now() - 24 * 60 * 60 * 1000;

  type Capture = { name: string; method: 'GET' | 'POST'; url: string; body?: unknown; truncate?: number };
  const captures: Capture[] = [
    // v2 endpoints (POST with body)
    { name: 'traffic-flows-page', method: 'POST', url: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows`,
      body: { limit: 5, beginTime: since, endTime: Date.now() } },
    { name: 'threat-alerts-page', method: 'POST', url: `/proxy/network/v2/api/site/${conn.siteId}/system-log/threat-alert`,
      body: { threatTypes: ['HONEYPOT', 'THREAT'], limit: 3, beginTime: since, endTime: Date.now() } },
    { name: 'triggers-page', method: 'POST', url: `/proxy/network/v2/api/site/${conn.siteId}/system-log/triggers`,
      body: { triggerTypes: ['TRAFFIC_RULE', 'TRAFFIC_ROUTE', 'FIREWALL_RULE'], limit: 5, beginTime: since, endTime: Date.now() } },
    { name: 'firewall-policies', method: 'GET', url: `/proxy/network/v2/api/site/${conn.siteId}/firewall-policies`, truncate: 5 },

    // legacy /api/s/{site}/...
    { name: 'sites', method: 'GET', url: `/proxy/network/api/self/sites` },
    { name: 'devices', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/stat/device`, truncate: 3 },
    { name: 'networks', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/rest/networkconf`, truncate: 5 },
    { name: 'wlans', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/rest/wlanconf`, truncate: 3 },
    { name: 'firewall-rules', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/rest/firewallrule`, truncate: 5 },
    { name: 'firewall-groups', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/rest/firewallgroup`, truncate: 5 },
    { name: 'port-forwards', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/rest/portforward`, truncate: 5 },
    { name: 'routing-rules', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/rest/routing`, truncate: 5 },
    { name: 'traffic-rules', method: 'GET', url: `/proxy/network/v2/api/site/${conn.siteId}/trafficrules`, truncate: 5 },
    { name: 'traffic-routes', method: 'GET', url: `/proxy/network/v2/api/site/${conn.siteId}/trafficroutes`, truncate: 5 },
    { name: 'traffic-matching-lists', method: 'GET', url: `/proxy/network/v2/api/site/${conn.siteId}/traffic-matching-targets`, truncate: 5 },
    { name: 'vpn-servers', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/rest/vpnconfig`, truncate: 5 },
    { name: 'firewall-zones', method: 'GET', url: `/proxy/network/v2/api/site/${conn.siteId}/firewall/zones`, truncate: 5 },
    { name: 'settings', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/get/setting` },
    { name: 'self', method: 'GET', url: `/proxy/network/api/self` },
    { name: 'clients-active', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/stat/sta`, truncate: 3 },
    { name: 'clients-all', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/stat/alluser?within=24&limit=5` },
    { name: 'events', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/stat/event?_limit=3` },
    { name: 'alarms', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/stat/alarm?_limit=3` },
    { name: 'acl-rules', method: 'GET', url: `/proxy/network/v2/api/site/${conn.siteId}/firewall/acl-rules`, truncate: 5 },
    { name: 'sysinfo', method: 'GET', url: `/proxy/network/api/s/${conn.siteId}/stat/sysinfo` },
  ];

  for (const c of captures) {
    try {
      const r = c.method === 'GET'
        ? await axios.get(c.url, { headers })
        : await axios.post(c.url, c.body, { headers });

      let data = r.data as { data?: unknown[] };
      if (c.truncate && Array.isArray(data?.data)) {
        data = { ...data, data: data.data.slice(0, c.truncate) };
      }
      const cleaned = sanitize(data);
      writeFileSync(`${FIXTURE_DIR}/${c.name}.json`, JSON.stringify(cleaned, null, 2));
      const itemCount = Array.isArray((data as { data?: unknown[] }).data) ? (data as { data: unknown[] }).data.length : 'n/a';
      console.log(`✓ ${c.name} [${r.status}] items=${itemCount}`);
    } catch (err) {
      const e = err as { message?: string; response?: { status?: number } };
      console.log(`✗ ${c.name} [${e.response?.status ?? 'ERR'}] ${e.message}`);
    }
  }

  await client.logout();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('capture failed:', err);
  process.exit(1);
});
