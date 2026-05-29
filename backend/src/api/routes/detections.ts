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
import { createUserEntry } from '../../services/dnsAllowlist';
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

/**
 * Allowlist the source detection's parent domain and bulk-resolve every
 * matching open detection in one call. Used by the "Allow *.foo" and
 * "Allow for this device" buttons on a DNS-tunneling finding.
 *
 * Response includes the new allowlist entry plus the IDs that got resolved,
 * so the UI can offer an Undo (= DELETE entry + reopen each id).
 */
const AllowlistFromDetectionBody = z.object({
  scope: z.enum(['GLOBAL', 'DEVICE']),
  note: z.string().max(500).optional(),
});

router.post('/:id/allowlist', requireAuth, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const body = AllowlistFromDetectionBody.parse(req.body ?? {});
    const source = await prisma.detection.findUnique({ where: { id } });
    if (!source) {
      sendError(res, null, 'NOT_FOUND', 'Detection not found', 404);
      return;
    }
    const meta = (source.metadata ?? {}) as {
      parentDomain?: string;
      clientIp?: string;
    };
    if (!meta.parentDomain) {
      sendError(
        res,
        null,
        'UNSUPPORTED_DETECTION',
        'This detection has no parent domain to allowlist',
        400
      );
      return;
    }
    if (body.scope === 'DEVICE' && !meta.clientIp) {
      sendError(
        res,
        null,
        'UNSUPPORTED_DETECTION',
        'This detection has no device key to scope to',
        400
      );
      return;
    }
    const userId = (req.user as { id?: string } | undefined)?.id ?? null;
    const entry = await createUserEntry({
      parentDomain: meta.parentDomain,
      scope: body.scope,
      deviceKey: body.scope === 'DEVICE' ? (meta.clientIp ?? null) : null,
      deviceLabel:
        body.scope === 'DEVICE' ? (source.affectedResource ?? null) : null,
      sourceDetectionId: id,
      note: body.note ?? null,
      createdBy: userId,
    });

    // Bulk-resolve every matching open detection.
    const candidates = await prisma.detection.findMany({
      where: { detectorId: source.detectorId, status: 'OPEN' },
      select: { id: true, metadata: true },
    });
    const matched: string[] = [];
    for (const c of candidates) {
      const m = (c.metadata ?? {}) as { parentDomain?: string; clientIp?: string };
      if (m.parentDomain !== meta.parentDomain) continue;
      if (body.scope === 'DEVICE' && m.clientIp !== meta.clientIp) continue;
      matched.push(c.id);
    }
    if (matched.length > 0) {
      await prisma.detection.updateMany({
        where: { id: { in: matched } },
        data: { status: 'RESOLVED' },
      });
    }

    const response: ApiResponse = {
      success: true,
      data: {
        entry,
        resolvedIds: matched,
        resolvedCount: matched.length,
      },
    };
    res.json(response);
  } catch (error) {
    sendError(
      res,
      error,
      'DETECTION_ALLOWLIST_ERROR',
      'Failed to allowlist detection'
    );
  }
});

/**
 * Undo a previous allowlist-from-detection action: delete the entry and
 * reopen the listed detection ids. UI sends back what came in the toast.
 */
const UndoAllowlistBody = z.object({
  entryId: z.string().min(1).max(64),
  reopenIds: z.array(z.string().min(1).max(64)).max(2000),
});

router.post('/allowlist/undo', requireAuth, async (req: Request, res: Response) => {
  try {
    const body = UndoAllowlistBody.parse(req.body ?? {});
    await prisma.dnsAllowlistEntry
      .delete({ where: { id: body.entryId } })
      .catch(() => undefined);
    if (body.reopenIds.length > 0) {
      await prisma.detection.updateMany({
        where: { id: { in: body.reopenIds } },
        data: { status: 'OPEN' },
      });
    }
    const response: ApiResponse = {
      success: true,
      data: { reopenedCount: body.reopenIds.length },
    };
    res.json(response);
  } catch (error) {
    sendError(res, error, 'DETECTION_ALLOWLIST_UNDO_ERROR', 'Failed to undo allowlist');
  }
});

export default router;
