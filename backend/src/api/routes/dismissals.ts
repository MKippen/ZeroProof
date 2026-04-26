import { Router, Request, Response } from 'express';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';
import { FindingType } from '@prisma/client';

const router = Router();

// POST /api/v1/dismissals - Create a new dismissal
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { findingType, findingId, affectedResource, reason } = req.body;

    // Validate required fields
    if (!findingType || !findingId || !reason) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'findingType, findingId, and reason are required',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Validate findingType
    if (!['RULE', 'INTENT_GAP'].includes(findingType)) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'findingType must be RULE or INTENT_GAP',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Validate reason length (minimum 10 characters)
    if (reason.trim().length < 10) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Reason must be at least 10 characters',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Check if dismissal already exists (active or inactive)
    const existing = await prisma.findingDismissal.findUnique({
      where: {
        findingType_findingId_affectedResource: {
          findingType: findingType as FindingType,
          findingId,
          affectedResource: affectedResource || null,
        },
      },
    });

    let dismissal;
    if (existing) {
      // Reactivate existing dismissal with new reason
      dismissal = await prisma.findingDismissal.update({
        where: { id: existing.id },
        data: {
          reason: reason.trim(),
          isActive: true,
          dismissedAt: new Date(),
        },
      });
    } else {
      // Create new dismissal
      dismissal = await prisma.findingDismissal.create({
        data: {
          findingType: findingType as FindingType,
          findingId,
          affectedResource: affectedResource || null,
          reason: reason.trim(),
          isActive: true,
        },
      });
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'FINDING_DISMISSED',
        details: {
          dismissalId: dismissal.id,
          findingType,
          findingId,
          affectedResource,
        },
        ipAddress: req.ip,
      },
    });

    logger.info(`Finding dismissed: ${findingType}/${findingId} (${affectedResource || 'all'})`);

    const response: ApiResponse = {
      success: true,
      data: { dismissal },
    };
    res.status(201).json(response);
  } catch (error) {
    logger.error('Create dismissal error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'CREATE_ERROR', message: 'Failed to create dismissal' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/dismissals - List active dismissals
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { findingType, includeInactive } = req.query;

    const where: any = {};

    if (!includeInactive) {
      where.isActive = true;
    }

    if (findingType && ['RULE', 'INTENT_GAP'].includes(findingType as string)) {
      where.findingType = findingType as FindingType;
    }

    const dismissals = await prisma.findingDismissal.findMany({
      where,
      orderBy: { dismissedAt: 'desc' },
    });

    const response: ApiResponse = {
      success: true,
      data: { dismissals },
    };
    res.json(response);
  } catch (error) {
    logger.error('List dismissals error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch dismissals' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/dismissals/:id/reopen - Reopen a dismissed finding
router.post('/:id/reopen', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const dismissal = await prisma.findingDismissal.findUnique({
      where: { id },
    });

    if (!dismissal) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Dismissal not found' },
      };
      res.status(404).json(response);
      return;
    }

    // Mark as inactive (reopened)
    const updated = await prisma.findingDismissal.update({
      where: { id },
      data: { isActive: false },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'FINDING_REOPENED',
        details: {
          dismissalId: id,
          findingType: dismissal.findingType,
          findingId: dismissal.findingId,
          affectedResource: dismissal.affectedResource,
        },
        ipAddress: req.ip,
      },
    });

    logger.info(`Finding reopened: ${dismissal.findingType}/${dismissal.findingId}`);

    const response: ApiResponse = {
      success: true,
      data: { dismissal: updated },
    };
    res.json(response);
  } catch (error) {
    logger.error('Reopen dismissal error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to reopen finding' },
    };
    res.status(500).json(response);
  }
});

// DELETE /api/v1/dismissals/:id - Hard delete a dismissal
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const dismissal = await prisma.findingDismissal.findUnique({
      where: { id },
    });

    if (!dismissal) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Dismissal not found' },
      };
      res.status(404).json(response);
      return;
    }

    await prisma.findingDismissal.delete({
      where: { id },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'FINDING_DISMISSAL_DELETED',
        details: {
          dismissalId: id,
          findingType: dismissal.findingType,
          findingId: dismissal.findingId,
          affectedResource: dismissal.affectedResource,
        },
        ipAddress: req.ip,
      },
    });

    logger.info(`Dismissal deleted: ${id}`);

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Delete dismissal error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete dismissal' },
    };
    res.status(500).json(response);
  }
});

export default router;
