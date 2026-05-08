/**
 * /api/v1/traffic — UniFi firewall flow + threat analytics. Mirrors panels
 * from UniFi's "Traffic & Flow" view but persisted across sessions and
 * cross-correlatable with DNS proxy events.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import prisma from '../../services/database';
import {
  getTrafficSummary,
  getTopPolicies,
  getTopClients,
  getTopRegions,
  getRecentFlows,
  getRecentThreats,
} from '../../services/firewall/trafficAnalytics';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';

const router = Router();

const WindowSchema = z.object({
  hours: z.coerce.number().int().min(1).max(168).optional(),
});

function sendError(res: Response, error: unknown, code: string, message: string, status = 500): void {
  if (error instanceof z.ZodError) {
    const response: ApiResponse = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid traffic request', details: error.message },
    };
    res.status(400).json(response);
    return;
  }
  const errorMessage = error instanceof Error ? error.message : message;
  if (status >= 500) logger.error(message, error);
  const response: ApiResponse = { success: false, error: { code, message: errorMessage } };
  res.status(status).json(response);
}

async function activeConnectionId(): Promise<string | null> {
  const conn = await prisma.uniFiConnection.findFirst({ where: { isActive: true } });
  return conn?.id ?? null;
}

/**
 * Single endpoint that returns everything the /traffic page needs in one
 * call. Mirrors the DNS proxy analytics shape so the UI can reuse the same
 * caching/refresh pattern.
 */
router.get('/analytics', requireAuth, async (req: Request, res: Response) => {
  try {
    const { hours } = WindowSchema.parse(req.query);
    const windowHours = hours ?? 24;

    const connectionId = await activeConnectionId();
    if (!connectionId) {
      const response: ApiResponse = {
        success: true,
        data: {
          configured: false,
          windowHours,
          since: new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString(),
          summary: null,
          topPolicies: [],
          topClients: [],
          topRegions: [],
          recentFlows: [],
          recentThreats: [],
        },
      };
      res.json(response);
      return;
    }

    const params = { connectionId, windowHours };

    const [summary, topPolicies, topClients, topRegions, recentFlows, recentThreats] =
      await Promise.all([
        getTrafficSummary(params),
        getTopPolicies(params, 10),
        getTopClients(params, 10),
        getTopRegions(params, 10),
        getRecentFlows(params, 100),
        getRecentThreats(params, 50),
      ]);

    const response: ApiResponse = {
      success: true,
      data: {
        configured: true,
        windowHours,
        since: summary.since,
        summary,
        topPolicies,
        topClients,
        topRegions,
        recentFlows,
        recentThreats,
      },
    };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'TRAFFIC_ANALYTICS_ERROR', 'Failed to fetch traffic analytics');
  }
});

export default router;
