/**
 * One-shot endpoint discovery script for UniFi Traffic & Flow telemetry.
 *
 * Loads the active UniFiConnection from the dev DB, logs in via UniFiClient,
 * and probes a list of candidate v2 paths. Reports HTTP status and a small
 * preview of each response so we can shape Prisma models + typed methods
 * against what the controller actually returns.
 *
 * Run from backend/: `pnpm tsx scripts/probe-unifi-flow-endpoints.ts`
 */
import prisma from '../src/services/database';
import { decrypt } from '../src/utils/encryption';
import { UniFiClient } from '../src/services/unifiClient';
import type { AxiosInstance } from 'axios';

interface Probe {
  label: string;
  method: 'GET' | 'POST';
  path: (siteId: string) => string;
  body?: unknown;
}

// Look back 24h. UniFi typically wants milliseconds since epoch.
const NOW = Date.now();
const ONE_DAY_AGO = NOW - 24 * 60 * 60 * 1000;

const PROBES: Probe[] = [
  // Confirmed working — re-probed with wider time window + larger limit
  { label: 'system-log/triggers (24h)', method: 'POST', path: (s) => `/proxy/network/v2/api/site/${s}/system-log/triggers`,
    body: { triggerTypes: ['TRAFFIC_RULE', 'TRAFFIC_ROUTE', 'FIREWALL_RULE'], limit: 5, beginTime: ONE_DAY_AGO, endTime: NOW } },
  { label: 'system-log/triggers (no filter)', method: 'POST', path: (s) => `/proxy/network/v2/api/site/${s}/system-log/triggers`,
    body: { limit: 5, beginTime: ONE_DAY_AGO, endTime: NOW } },
  { label: 'system-log/threat-alert (24h, limit=2)', method: 'POST', path: (s) => `/proxy/network/v2/api/site/${s}/system-log/threat-alert`,
    body: { threatTypes: ['HONEYPOT', 'THREAT'], limit: 2, beginTime: ONE_DAY_AGO, endTime: NOW } },

  // Per-flow row candidates — the table in the screenshot
  { label: 'firewall/events', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/firewall/events?limit=5` },
  { label: 'firewall-events', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/firewall-events?limit=5` },
  { label: 'flows', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/flows?limit=5` },
  { label: 'traffic-flows POST', method: 'POST', path: (s) => `/proxy/network/v2/api/site/${s}/traffic-flows`,
    body: { limit: 5, beginTime: ONE_DAY_AGO, endTime: NOW } },
  { label: 'security/flows', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/security/flows?limit=5` },
  { label: 'security/events', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/security/events?limit=5` },
  { label: 'security/detections', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/security/detections?limit=5` },

  // Insights subroutes
  { label: 'insights', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/insights` },
  { label: 'insights/threats', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/insights/threats` },
  { label: 'dashboard/security', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/dashboard/security` },
  { label: 'dashboard/firewall', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/dashboard/firewall` },

  // Aggregates from screenshot
  { label: 'top-policies', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/top-policies` },
  { label: 'top-clients', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/top-clients` },
  { label: 'firewall-policies', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/firewall-policies` },
  { label: 'firewall-rules', method: 'GET', path: (s) => `/proxy/network/v2/api/site/${s}/firewall-rules` },

  // Legacy v1 stat endpoints
  { label: 'stat/dpi', method: 'GET', path: (s) => `/proxy/network/api/s/${s}/stat/sitedpi` },
  { label: 'stat/clientdpi', method: 'GET', path: (s) => `/proxy/network/api/s/${s}/stat/stadpi?type=by_app` },
  { label: 'stat/health', method: 'GET', path: (s) => `/proxy/network/api/s/${s}/stat/health` },

  // Integration v1 (the official, X-API-Key surface — long shot via cookie auth)
  { label: 'integration/v1/sites', method: 'GET', path: () => `/proxy/network/integration/v1/sites` },
];

function preview(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  try {
    const json = JSON.stringify(value);
    if (json.length <= 600) return json;
    return json.slice(0, 600) + `... [${json.length} bytes total]`;
  } catch {
    return String(value);
  }
}

function describeShape(value: unknown, depth = 0, max = 3): string {
  if (depth > max) return '…';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return `[${describeShape(value[0], depth + 1, max)} × ${value.length}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 12);
    return `{ ${entries.map(([k, v]) => `${k}: ${describeShape(v, depth + 1, max)}`).join(', ')}${Object.keys(value).length > 12 ? ', …' : ''} }`;
  }
  return typeof value;
}

async function main(): Promise<void> {
  const conn = await prisma.uniFiConnection.findFirst({ where: { isActive: true } });
  if (!conn) {
    console.error('No active UniFiConnection in DB');
    process.exit(1);
  }

  const client = new UniFiClient({
    host: conn.host,
    port: conn.port,
    username: decrypt(conn.usernameEnc),
    password: decrypt(conn.passwordEnc),
    siteId: conn.siteId,
  });

  console.log(`→ Logging into ${conn.host}:${conn.port} (site=${conn.siteId})`);
  const ok = await client.login();
  if (!ok) {
    console.error('Login failed');
    process.exit(1);
  }
  console.log('✓ Logged in\n');

  // Reach into the underlying axios client. UniFiClient uses cookie + CSRF
  // interceptors so we ride the same authenticated session.
  const axios: AxiosInstance = (client as unknown as { client: AxiosInstance }).client;
  const cookies: string[] = (client as unknown as { cookies: string[] }).cookies || [];
  const csrf: string | null = (client as unknown as { csrfToken: string | null }).csrfToken;

  if (!cookies.length) {
    console.warn('⚠ No cookies captured after login — auth may not be carried into requests');
  }

  for (const probe of PROBES) {
    const url = probe.path(conn.siteId);
    const headers: Record<string, string> = {
      Cookie: cookies.join('; '),
    };
    if (csrf) headers['X-CSRF-Token'] = csrf;

    try {
      const response = probe.method === 'GET'
        ? await axios.get(url, { headers })
        : await axios.post(url, probe.body, { headers });
      const status = response.status;
      const body = response.data;
      const shape = describeShape(body);
      console.log(`[${status}] ${probe.method} ${url}`);
      console.log(`  label: ${probe.label}`);
      console.log(`  shape: ${shape}`);
      console.log(`  sample: ${preview(body)}`);
      console.log('');
    } catch (err) {
      const e = err as { response?: { status?: number; data?: unknown }; message?: string };
      const status = e.response?.status ?? 'ERR';
      console.log(`[${status}] ${probe.method} ${url}`);
      console.log(`  label: ${probe.label}`);
      console.log(`  error: ${e.message}`);
      if (e.response?.data) console.log(`  body:  ${preview(e.response.data)}`);
      console.log('');
    }
  }

  await client.logout().catch(() => {});
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
