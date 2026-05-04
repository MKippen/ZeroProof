import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';
import {
  CampaignServiceError,
  cancelCampaignRun,
  executeCampaignStep,
  getCampaign,
  getCampaignRun,
  listCampaigns,
  startCampaignRun,
  updateCampaignSettings,
} from '../../services/campaigns/campaignService';
import { CampaignStepId } from '../../services/campaigns/types';

const router = Router();

const CampaignSettingsSchema = z.object({
  enabled: z.boolean(),
});

const CampaignRunSchema = z.object({
  options: z.record(z.unknown()).optional(),
}).optional();

const StepBodySchema = z.object({
  options: z.record(z.unknown()).optional(),
}).passthrough().optional();

function sendCampaignError(res: Response, error: unknown, fallbackCode: string, fallbackMessage: string): void {
  if (error instanceof CampaignServiceError) {
    const response: ApiResponse = {
      success: false,
      error: { code: error.code, message: error.message },
    };
    res.status(error.status).json(response);
    return;
  }

  logger.error(fallbackMessage, error);
  const response: ApiResponse = {
    success: false,
    error: { code: fallbackCode, message: fallbackMessage },
  };
  res.status(500).json(response);
}

router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const campaigns = await listCampaigns();
    const response: ApiResponse = {
      success: true,
      data: { campaigns },
    };
    res.json(response);
  } catch (error) {
    sendCampaignError(res, error, 'CAMPAIGN_LIST_ERROR', 'Failed to fetch campaigns');
  }
});

router.get('/:campaignId', requireAuth, async (req: Request, res: Response) => {
  try {
    const campaign = await getCampaign(req.params.campaignId);
    const response: ApiResponse = {
      success: true,
      data: { campaign },
    };
    res.json(response);
  } catch (error) {
    sendCampaignError(res, error, 'CAMPAIGN_DETAIL_ERROR', 'Failed to fetch campaign');
  }
});

router.patch('/:campaignId/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = CampaignSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign settings payload' },
      };
      res.status(400).json(response);
      return;
    }

    const settings = await updateCampaignSettings(req.params.campaignId, parsed.data.enabled);
    const response: ApiResponse = {
      success: true,
      data: { settings },
    };
    res.json(response);
  } catch (error) {
    sendCampaignError(res, error, 'CAMPAIGN_SETTINGS_ERROR', 'Failed to update campaign settings');
  }
});

router.post('/:campaignId/runs', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = CampaignRunSchema.safeParse(req.body);
    if (!parsed.success) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign run payload' },
      };
      res.status(400).json(response);
      return;
    }

    const run = await startCampaignRun(req.params.campaignId, parsed.data);
    const response: ApiResponse = {
      success: true,
      data: { run },
    };
    res.json(response);
  } catch (error) {
    sendCampaignError(res, error, 'CAMPAIGN_START_ERROR', 'Failed to start campaign run');
  }
});

router.get('/:campaignId/runs/:runId', requireAuth, async (req: Request, res: Response) => {
  try {
    const run = await getCampaignRun(req.params.campaignId, req.params.runId);

    const response: ApiResponse = {
      success: true,
      data: { run },
    };
    res.json(response);
  } catch (error) {
    sendCampaignError(res, error, 'CAMPAIGN_RUN_ERROR', 'Failed to fetch campaign run');
  }
});

router.post('/:campaignId/runs/:runId/steps/:stepId', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = StepBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid campaign step payload' },
      };
      res.status(400).json(response);
      return;
    }

    const run = await executeCampaignStep(
      req.params.campaignId,
      req.params.runId,
      req.params.stepId as CampaignStepId,
      parsed.data
    );
    const response: ApiResponse = {
      success: true,
      data: { run },
    };
    res.json(response);
  } catch (error) {
    sendCampaignError(res, error, 'CAMPAIGN_STEP_ERROR', 'Failed to execute campaign step');
  }
});

router.post('/:campaignId/runs/:runId/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const run = await cancelCampaignRun(req.params.campaignId, req.params.runId);
    const response: ApiResponse = {
      success: true,
      data: { run },
    };
    res.json(response);
  } catch (error) {
    sendCampaignError(res, error, 'CAMPAIGN_CANCEL_ERROR', 'Failed to cancel campaign run');
  }
});

export default router;
