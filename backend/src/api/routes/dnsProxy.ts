import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';
import {
  deleteDnsProxySettings,
  getDnsProxySettings,
  getDnsProxyStatus,
  getDnsSignals,
  getRecentDnsQueries,
  saveDnsProxySettings,
  syncDnsProxyConnection,
  testDnsProxyConnection,
  getActiveDnsProxyConnection,
  getHourlyDnsBuckets,
  getTopDnsDomains,
  getClientAggregates,
} from '../../services/dnsProxyService';
import prisma from '../../services/database';
import { ADGUARD_PROVIDER, getDnsProxyConfigAdapter } from '../../services/dnsProxyConfig';

const router = Router();

const SettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  useHttps: z.boolean().default(false),
  allowSelfSigned: z.boolean().default(false),
  username: z.string().trim().max(255).optional().default(''),
  password: z.string().optional(),
  pollingEnabled: z.boolean().default(false),
  retentionDays: z.coerce.number().int().min(1).max(30).default(7),
});

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().optional(),
  client: z.string().trim().optional(),
  status: z.enum(['all', 'blocked', 'allowed']).optional(),
  suspiciousOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

const SignalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  campaignId: z.string().trim().optional(),
});

const AnalyticsQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).optional(),
});

function macFromIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^([0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/.test(trimmed)) {
    return trimmed.replace(/-/g, ':').toLowerCase();
  }
  return null;
}

function sendDnsProxyError(res: Response, error: unknown, code: string, message: string, status = 500): void {
  if (error instanceof z.ZodError) {
    const response: ApiResponse = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid DNS proxy request', details: error.message },
    };
    res.status(400).json(response);
    return;
  }

  const errorMessage = error instanceof Error ? error.message : message;
  if (status >= 500) {
    logger.error(message, error);
  }
  const response: ApiResponse = {
    success: false,
    error: { code, message: errorMessage },
  };
  res.status(status).json(response);
}

router.get('/settings', requireAuth, async (_req: Request, res: Response) => {
  try {
    const settings = await getDnsProxySettings();
    const response: ApiResponse = { success: true, data: settings };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_SETTINGS_ERROR', 'Failed to fetch DNS proxy settings');
  }
});

router.post('/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = SettingsSchema.parse(req.body);
    const result = await testDnsProxyConnection(parsed);
    const response: ApiResponse = {
      success: true,
      data: {
        connected: true,
        status: result.status,
        queryLogConfig: result.queryLogConfig,
      },
    };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_TEST_FAILED', 'Failed to connect to AdGuard Home', 400);
  }
});

router.post('/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = SettingsSchema.parse(req.body);
    const settings = await saveDnsProxySettings(parsed);
    const response: ApiResponse = { success: true, data: { settings, configured: true } };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_SAVE_ERROR', 'Failed to save DNS proxy settings', 400);
  }
});

router.delete('/settings', requireAuth, async (_req: Request, res: Response) => {
  try {
    await deleteDnsProxySettings();
    const response: ApiResponse = { success: true, data: { configured: false } };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_DELETE_ERROR', 'Failed to delete DNS proxy settings');
  }
});

router.get('/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await getDnsProxyStatus();
    const response: ApiResponse = { success: true, data: status };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_STATUS_ERROR', 'Failed to fetch DNS proxy status');
  }
});

router.post('/sync', requireAuth, async (_req: Request, res: Response) => {
  try {
    const connection = await getActiveDnsProxyConnection();
    if (!connection) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'DNS_PROXY_NOT_CONFIGURED', message: 'No DNS proxy is configured' },
      };
      res.status(400).json(response);
      return;
    }

    const result = await syncDnsProxyConnection(connection.id);
    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_SYNC_ERROR', 'Failed to sync DNS proxy logs', 400);
  }
});

router.get('/queries', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = QuerySchema.parse(req.query);
    const result = await getRecentDnsQueries(parsed);
    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_QUERY_ERROR', 'Failed to fetch DNS proxy query logs');
  }
});

router.get('/signals', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = SignalsQuerySchema.parse(req.query);
    const signals = await getDnsSignals(parsed);
    const response: ApiResponse = { success: true, data: { signals } };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_SIGNALS_ERROR', 'Failed to fetch DNS proxy signals');
  }
});

router.get('/analytics', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = AnalyticsQuerySchema.parse(req.query);
    const hours = parsed.hours ?? 24;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const connection = await getActiveDnsProxyConnection();
    if (!connection) {
      const response: ApiResponse = {
        success: true,
        data: {
          configured: false,
          windowHours: hours,
          since: since.toISOString(),
          hourlyBuckets: [],
          topBlocked: [],
          topAllowed: [],
          topClients: [],
          coverage: { seen: [], silent: [], unknownSources: [], totals: { unifi: 0, adguard: 0, matched: 0 } },
        },
      };
      res.json(response);
      return;
    }

    const adapter = getDnsProxyConfigAdapter(ADGUARD_PROVIDER);

    const [hourlyBuckets, topBlocked, topAllowed, clientAggregates, unifiClients, audit] = await Promise.all([
      getHourlyDnsBuckets(connection.id, since),
      getTopDnsDomains(connection.id, since, true, 10),
      getTopDnsDomains(connection.id, since, false, 10),
      getClientAggregates(connection.id, since),
      prisma.networkClient.findMany({
        select: { mac: true, displayName: true, hostname: true, lastIp: true },
      }),
      adapter ? adapter.fetchAuditInputs(connection).catch(() => null) : Promise.resolve(null),
    ]);

    // Index AdGuard persistent clients by MAC and IP for reconciliation.
    const persistentByMac = new Map<string, { name: string }>();
    const persistentByIp = new Map<string, { name: string }>();
    if (audit) {
      for (const c of audit.persistentClients) {
        for (const id of c.identifiers) {
          if (id.kind === 'mac') {
            const mac = macFromIdentifier(id.value);
            if (mac) persistentByMac.set(mac, { name: c.name });
          } else if (id.kind === 'ip') {
            persistentByIp.set(id.value, { name: c.name });
          }
        }
      }
    }

    // Index UniFi clients by MAC and IP.
    const unifiByMac = new Map<string, (typeof unifiClients)[number]>();
    const unifiByIp = new Map<string, (typeof unifiClients)[number]>();
    for (const u of unifiClients) {
      if (u.mac) unifiByMac.set(u.mac.toLowerCase(), u);
      if (u.lastIp) unifiByIp.set(u.lastIp, u);
    }

    // Aggregate query traffic by UniFi client (resolved via IP→MAC where possible).
    const seenUnifiMacs = new Set<string>();
    const unknownSources: Array<{
      clientIp: string;
      clientName: string | null;
      queries: number;
      blocked: number;
      lastSeen: string;
    }> = [];
    const seen: Array<{
      mac: string;
      displayName: string;
      queries: number;
      blocked: number;
      suspicious: number;
      lastSeen: string;
      adguardName: string | null;
    }> = [];

    for (const agg of clientAggregates) {
      if (!agg.clientIp) continue;
      const unifi = unifiByIp.get(agg.clientIp);
      if (unifi && unifi.mac) {
        seenUnifiMacs.add(unifi.mac.toLowerCase());
        const adguard = persistentByMac.get(unifi.mac.toLowerCase()) || persistentByIp.get(agg.clientIp);
        seen.push({
          mac: unifi.mac,
          displayName: unifi.displayName || unifi.hostname || agg.clientName || agg.clientIp,
          queries: agg.queries,
          blocked: agg.blocked,
          suspicious: agg.suspicious,
          lastSeen: agg.lastSeen,
          adguardName: adguard?.name ?? null,
        });
      } else {
        unknownSources.push({
          clientIp: agg.clientIp,
          clientName: agg.clientName,
          queries: agg.queries,
          blocked: agg.blocked,
          lastSeen: agg.lastSeen,
        });
      }
    }

    // Silent UniFi clients: in inventory but no traffic in window.
    const silent = unifiClients
      .filter((u) => u.mac && !seenUnifiMacs.has(u.mac.toLowerCase()))
      .map((u) => ({
        mac: u.mac as string,
        displayName: u.displayName || u.hostname || u.lastIp || (u.mac as string),
        lastIp: u.lastIp,
        adguardName: u.mac ? persistentByMac.get(u.mac.toLowerCase())?.name ?? null : null,
      }));

    const matchedCount = audit
      ? unifiClients.filter((u) => u.mac && persistentByMac.has(u.mac.toLowerCase())).length
      : 0;

    const topClients = seen
      .slice()
      .sort((a, b) => b.queries - a.queries)
      .slice(0, 25);

    const response: ApiResponse = {
      success: true,
      data: {
        configured: true,
        windowHours: hours,
        since: since.toISOString(),
        hourlyBuckets,
        topBlocked,
        topAllowed,
        topClients,
        coverage: {
          seen,
          silent,
          unknownSources: unknownSources.sort((a, b) => b.queries - a.queries).slice(0, 25),
          totals: {
            unifi: unifiClients.length,
            adguard: audit ? audit.persistentClients.length : 0,
            matched: matchedCount,
          },
        },
      },
    };
    res.json(response);
  } catch (error) {
    sendDnsProxyError(res, error, 'DNS_PROXY_ANALYTICS_ERROR', 'Failed to fetch DNS proxy analytics');
  }
});

export default router;
