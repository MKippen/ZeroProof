import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';
import {
  getReleaseChannel,
  getUpdateStatus,
  setReleaseChannel,
  type ReleaseChannel,
} from '../../services/systemUpdateService';
import { isUpdaterConfigured, postApply } from '../../services/updaterService';

const router = Router();

const ChannelSchema = z.object({
  channel: z.enum(['stable', 'beta']),
});

const ApplySchema = z.object({
  target: z.string().trim().min(1).max(64).optional(),
  op: z.enum(['apply', 'rollback']).optional(),
});

// GET /api/v1/system/update — current version, channel, latest available.
// Notify-and-confirm only; the actual upgrade is still a CLI step until
// the sidecar updater lands. Errors fetching from GitHub are returned in
// the body so the UI can show "couldn't check" without throwing.
router.get('/update', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await getUpdateStatus();
    const response: ApiResponse = {
      success: true,
      data: { ...status, applyEnabled: isUpdaterConfigured() },
    };
    res.json(response);
  } catch (error) {
    logger.error('System update status error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SYSTEM_UPDATE_ERROR', message: 'Failed to compute update status' },
    };
    res.status(500).json(response);
  }
});

// PUT /api/v1/system/update/channel — change the persisted release channel.
router.put('/update/channel', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = ChannelSchema.parse(req.body);
    await setReleaseChannel(parsed.channel as ReleaseChannel);
    const status = await getUpdateStatus();
    const response: ApiResponse = { success: true, data: status };
    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Channel must be "stable" or "beta"' },
      };
      res.status(400).json(response);
      return;
    }
    logger.error('System update channel error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SYSTEM_UPDATE_CHANNEL_ERROR', message: 'Failed to set release channel' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/system/update/channel — separate getter so the UI can render
// the channel picker without firing a full GitHub fetch on settings load.
router.get('/update/channel', requireAuth, async (_req: Request, res: Response) => {
  try {
    const channel = await getReleaseChannel();
    const response: ApiResponse = { success: true, data: { channel } };
    res.json(response);
  } catch (error) {
    logger.error('System update channel get error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SYSTEM_UPDATE_CHANNEL_ERROR', message: 'Failed to get release channel' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/system/update/apply — kicks off an in-app upgrade via the
// updater sidecar. Auth-required. Returns immediately with the run handle;
// progress lines stream over the WebSocket as `updater_progress` events,
// and a final `updater_complete` event signals the outcome (or rollback).
router.post('/update/apply', requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isUpdaterConfigured()) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'UPDATER_NOT_CONFIGURED',
          message:
            'In-app updates are not enabled on this install. Set UPDATER_SECRET in .env and restart, or run scripts/upgrade.sh from the CLI.',
        },
      };
      res.status(503).json(response);
      return;
    }
    const parsed = ApplySchema.parse(req.body ?? {});
    const result = await postApply(parsed.target ?? null, parsed.op ?? 'apply');
    const response: ApiResponse = { success: true, data: result };
    res.status(202).json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid apply request' },
      };
      res.status(400).json(response);
      return;
    }
    logger.error('System update apply error:', error);
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'SYSTEM_UPDATE_APPLY_ERROR',
        message: error instanceof Error ? error.message : 'Failed to start update',
      },
    };
    res.status(502).json(response);
  }
});

export default router;
