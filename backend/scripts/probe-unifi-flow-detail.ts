/**
 * Drills into the confirmed endpoints and dumps full sample rows so we can
 * design the FirewallFlowEvent + FirewallThreatEvent Prisma models with
 * no missing fields.
 */
import prisma from '../src/services/database';
import { decrypt } from '../src/utils/encryption';
import { UniFiClient } from '../src/services/unifiClient';
import type { AxiosInstance } from 'axios';

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

  console.log('=== /traffic-flows: ONE FULL ROW ===');
  const flowsResp = await axios.post(
    `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows`,
    { limit: 1, beginTime: since, endTime: Date.now() },
    { headers }
  );
  console.log('envelope keys:', Object.keys(flowsResp.data));
  console.log('total_element_count:', flowsResp.data.total_element_count);
  console.log('row #1:');
  console.log(JSON.stringify(flowsResp.data.data[0], null, 2));

  console.log('\n=== /traffic-flows: SAMPLE OF ACTIONS / DIRECTIONS / RISKS / SERVICES ===');
  const wide = await axios.post(
    `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows`,
    { limit: 200, beginTime: since, endTime: Date.now() },
    { headers }
  );
  const rows: Array<Record<string, unknown>> = wide.data.data;
  const actions = new Set<string>();
  const directions = new Set<string>();
  const risks = new Set<string>();
  const services = new Set<string>();
  const protocols = new Set<string>();
  const policyTypes = new Set<string>();
  const policyInternalTypes = new Set<string>();
  for (const r of rows) {
    actions.add(String(r.action));
    directions.add(String(r.direction));
    risks.add(String(r.risk));
    services.add(String(r.service));
    protocols.add(String(r.protocol));
    const pols = r.policies as Array<{ type?: string; internal_type?: string }> | undefined;
    pols?.forEach((p) => {
      if (p.type) policyTypes.add(p.type);
      if (p.internal_type) policyInternalTypes.add(p.internal_type);
    });
  }
  console.log('actions       :', [...actions]);
  console.log('directions    :', [...directions]);
  console.log('risks         :', [...risks]);
  console.log('services      :', [...services].slice(0, 30), services.size > 30 ? `... +${services.size - 30}` : '');
  console.log('protocols     :', [...protocols]);
  console.log('policy.type   :', [...policyTypes]);
  console.log('policy.internal_type:', [...policyInternalTypes]);

  console.log('\n=== /traffic-flows: COUNT BY ACTION ===');
  const actionCounts: Record<string, number> = {};
  for (const r of rows) actionCounts[String(r.action)] = (actionCounts[String(r.action)] || 0) + 1;
  console.log(actionCounts);

  console.log('\n=== /system-log/threat-alert: ONE FULL ROW ===');
  const threatsResp = await axios.post(
    `/proxy/network/v2/api/site/${conn.siteId}/system-log/threat-alert`,
    { threatTypes: ['HONEYPOT', 'THREAT'], limit: 1, beginTime: since, endTime: Date.now() },
    { headers }
  );
  console.log('envelope keys:', Object.keys(threatsResp.data));
  console.log('total_element_count:', threatsResp.data.total_element_count);
  console.log('row #1:');
  console.log(JSON.stringify(threatsResp.data.data[0], null, 2));

  console.log('\n=== /traffic-flows: actions=allowed filter ===');
  const allowResp = await axios.post(
    `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows`,
    { limit: 5, beginTime: since, endTime: Date.now(), actions: ['allowed'] },
    { headers }
  );
  console.log('total:', allowResp.data.total_element_count, 'rows returned:', allowResp.data.data.length);
  if (allowResp.data.data[0]) {
    console.log('first action:', allowResp.data.data[0].action);
  }

  console.log('\n=== /traffic-flows: no time bounds, no filter ===');
  const wideOpenResp = await axios.post(
    `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows`,
    { limit: 5 },
    { headers }
  );
  const wideRows: Array<Record<string, unknown>> = wideOpenResp.data.data;
  console.log('total:', wideOpenResp.data.total_element_count);
  console.log('actions seen:', [...new Set(wideRows.map((r) => r.action))]);

  console.log('\n=== Aggregation endpoint candidates ===');
  const aggCandidates: Array<{ method: 'GET' | 'POST'; path: string; body?: unknown }> = [
    { method: 'GET', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/top-policies` },
    { method: 'GET', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/top-clients` },
    { method: 'GET', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/top-regions` },
    { method: 'GET', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/aggregate` },
    { method: 'GET', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/summary` },
    { method: 'POST', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/summary`, body: { beginTime: since, endTime: Date.now() } },
    { method: 'POST', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/aggregate`, body: { beginTime: since, endTime: Date.now() } },
    { method: 'POST', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flows/top`, body: { beginTime: since, endTime: Date.now() } },
    { method: 'GET', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flow-stats` },
    { method: 'GET', path: `/proxy/network/v2/api/site/${conn.siteId}/traffic-flow-aggregate` },
  ];
  for (const c of aggCandidates) {
    try {
      const r = c.method === 'GET' ? await axios.get(c.path, { headers }) : await axios.post(c.path, c.body, { headers });
      const keys = r.data && typeof r.data === 'object' ? Object.keys(r.data).slice(0, 8) : 'non-object';
      console.log(`  [${r.status}] ${c.method} ${c.path} → keys: ${JSON.stringify(keys)}`);
    } catch (e) {
      const err = e as { message?: string; response?: { status?: number } };
      console.log(`  [${err.response?.status ?? 'ERR'}] ${c.method} ${c.path} → ${err.message}`);
    }
  }

  await client.logout();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
