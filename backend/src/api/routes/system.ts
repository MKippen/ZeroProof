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

const router = Router();

const ChannelSchema = z.object({
  channel: z.enum(['stable', 'beta']),
});

// GET /api/v1/system/update — current version, channel, latest available.
// Notify-and-confirm only; the actual upgrade is still a CLI step until
// the sidecar updater lands. Errors fetching from GitHub are returned in
// the body so the UI can show "couldn't check" without throwing.
router.get('/update', requireAuth, async (_req: Request, res: Response) => {
  try {
    const status = await getUpdateStatus();
    const response: ApiResponse = { success: true, data: status };
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

export default router;
