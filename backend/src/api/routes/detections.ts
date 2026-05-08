/**
 * /api/v1/detections — read + manage outputs of the detection engine.
 *
 *   GET /analytics       summary + breakdowns + top affected resources
 *   GET /                paginated list with filtering
 *   GET /:id             single detection (full evidence + metadata)
 *   POST /:id/resolve    operator marks the finding fixed
 *   POST /:id/dismiss    operator marks the finding intentional / not-an-issue
 *   POST /:id/reopen     undo a resolve/dismiss
 *
 * All routes require auth.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Severity } from '@prisma/client';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import {
  getDetectionSummary,
  listDetections,
} from '../../services/detection/detectionAnalytics';
import type { ApiResponse } from '../../types';
import logger from '../../utils/logger';

const router = Router();

const SeveritySchema = z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const StatusSchema = z.enum(['OPEN', 'RESOLVED', 'DISMISSED']);

const AnalyticsQuery = z.object({
  hours: z.coerce.number().int().min(1).max(168).optional(),
});

const ListQuery = z.object({
  hours: z.coerce.number().int().min(1).max(168).optional(),
  status: StatusSchema.optional(),
  detectorId: z.string().min(1).max(64).optional(),
  severityAtLeast: SeveritySchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function sendError(
  res: Response,
  error: unknown,
  code: string,
  message: string,
  status = 500
): void {
  if (error instanceof z.ZodError) {
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid detections request',
        details: error.message,
      },
    };
    res.status(400).json(response);
    return;
  }
  const errorMessage = error instanceof Error ? error.message : message;
  if (status >= 500) logger.error(message, error);
  const response: ApiResponse = { success: false, error: { code, message: errorMessage } };
  res.status(status).json(response);
}

router.get('/analytics', requireAuth, async (req: Request, res: Response) => {
  try {
    const { hours } = AnalyticsQuery.parse(req.query);
    const summary = await getDetectionSummary({ windowHours: hours ?? 24 });
    const response: ApiResponse = { success: true, data: summary };
    res.json(response);
  } catch (error) {
    sendError(
      res,
      error,
      'DETECTION_ANALYTICS_ERROR',
      'Failed to fetch detection analytics'
    );
  }
});

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = ListQuery.parse(req.query);
    const rows = await listDetections({
      windowHours: parsed.hours ?? 24,
      status: parsed.status,
      detectorId: parsed.detectorId,
      severityAtLeast: parsed.severityAtLeast as Severity | undefined,
      limit: parsed.limit,
    });
    const response: ApiResponse = { success: true, data: rows };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DETECTION_LIST_ERROR', 'Failed to list detections');
  }
});

router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const row = await prisma.detection.findUnique({ where: { id } });
    if (!row) {
      sendError(res, null, 'NOT_FOUND', 'Detection not found', 404);
      return;
    }
    const response: ApiResponse = {
      success: true,
      data: {
        ...row,
        firstSeen: row.firstSeen.toISOString(),
        lastSeen: row.lastSeen.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      },
    };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DETECTION_GET_ERROR', 'Failed to load detection');
  }
});

async function setStatus(
  res: Response,
  id: string,
  status: 'OPEN' | 'RESOLVED' | 'DISMISSED'
): Promise<void> {
  try {
    const updated = await prisma.detection.update({
      where: { id },
      data: { status },
    });
    const response: ApiResponse = { success: true, data: { id: updated.id, status } };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DETECTION_UPDATE_ERROR', 'Failed to update detection');
  }
}

router.post('/:id/resolve', requireAuth, (req: Request, res: Response) =>
  setStatus(res, String(req.params.id), 'RESOLVED')
);

router.post('/:id/dismiss', requireAuth, (req: Request, res: Response) =>
  setStatus(res, String(req.params.id), 'DISMISSED')
);

router.post('/:id/reopen', requireAuth, (req: Request, res: Response) =>
  setStatus(res, String(req.params.id), 'OPEN')
);

export default router;
