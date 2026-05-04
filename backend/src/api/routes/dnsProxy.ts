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
} from '../../services/dnsProxyService';

const router = Router();

const SettingsSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535).default(3000),
  useHttps: z.boolean().default(false),
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

export default router;
