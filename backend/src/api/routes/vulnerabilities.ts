import { Router, Request, Response } from 'express';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ApiResponse, UpdateVulnerabilitySchema, Severity } from '../../types';
import logger from '../../utils/logger';

const router = Router();

// GET /api/v1/vulnerabilities
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const severity = req.query.severity as Severity | undefined;
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;

    // Get active configuration to filter vulnerabilities
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    const where = {
      ...(activeConfig && { configId: activeConfig.id }),
      ...(severity && { severity }),
      ...(status && { status: status as any }),
      ...(type && { type }),
    };

    const [vulnerabilities, total] = await Promise.all([
      prisma.vulnerability.findMany({
        where,
        orderBy: [{ severity: 'asc' }, { lastSeen: 'desc' }],
        skip,
        take: limit,
        include: {
          testRun: { select: { id: true, testType: true } },
          configuration: { select: { siteName: true } },
        },
      }),
      prisma.vulnerability.count({ where }),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        vulnerabilities,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get vulnerabilities error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch vulnerabilities' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/vulnerabilities/stats
router.get('/stats', requireAuth, async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status as string | undefined;

    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
      select: { id: true },
    });

    const baseWhere = {
      ...(activeConfig && { configId: activeConfig.id }),
    };

    const severityStatus = (statusFilter || 'OPEN') as any;

    const [bySeverity, byStatus, byType, recentTrend] = await Promise.all([
      prisma.vulnerability.groupBy({
        by: ['severity'],
        _count: { id: true },
        where: { ...baseWhere, status: severityStatus },
      }),
      prisma.vulnerability.groupBy({
        by: ['status'],
        _count: { id: true },
        where: baseWhere,
      }),
      prisma.vulnerability.groupBy({
        by: ['type'],
        _count: { id: true },
        where: { ...baseWhere, status: severityStatus },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      prisma.vulnerability.groupBy({
        by: ['firstSeen'],
        _count: { id: true },
        where: {
          ...baseWhere,
          firstSeen: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          ...(statusFilter && { status: statusFilter as any }),
        },
      }),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        bySeverity: bySeverity.reduce(
          (acc, item) => ({ ...acc, [item.severity]: item._count?.id ?? 0 }),
          {}
        ),
        byStatus: byStatus.reduce(
          (acc, item) => ({ ...acc, [item.status]: item._count?.id ?? 0 }),
          {}
        ),
        byType,
        recentTrend,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get vulnerability stats error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch statistics' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/vulnerabilities/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id: req.params.id },
      include: {
        testRun: {
          select: { id: true, testType: true, startedAt: true, device: { select: { name: true } } },
        },
        configuration: { select: { siteName: true, controllerVersion: true } },
      },
    });

    if (!vulnerability) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Vulnerability not found' },
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: { vulnerability },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get vulnerability error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch vulnerability' },
    };
    res.status(500).json(response);
  }
});

// PATCH /api/v1/vulnerabilities/:id
router.patch(
  '/:id',
  requireAuth,
  validate(UpdateVulnerabilitySchema),
  async (req: Request, res: Response) => {
    try {
      const vulnerability = await prisma.vulnerability.findUnique({
        where: { id: req.params.id },
      });

      if (!vulnerability) {
        const response: ApiResponse = {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Vulnerability not found' },
        };
        res.status(404).json(response);
        return;
      }

      const { status, notes } = req.body;

      const updated = await prisma.vulnerability.update({
        where: { id: req.params.id },
        data: {
          ...(status && { status }),
          ...(notes !== undefined && { notes }),
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.session.userId,
          action: 'VULNERABILITY_UPDATE',
          resource: vulnerability.id,
          details: { status, notes: notes ? 'updated' : undefined },
          ipAddress: req.ip,
        },
      });

      const response: ApiResponse = {
        success: true,
        data: { vulnerability: updated },
      };
      res.json(response);
    } catch (error) {
      logger.error('Update vulnerability error:', error);
      const response: ApiResponse = {
        success: false,
        error: { code: 'UPDATE_ERROR', message: 'Failed to update vulnerability' },
      };
      res.status(500).json(response);
    }
  }
);

// POST /api/v1/vulnerabilities/:id/retest
router.post('/:id/retest', requireAuth, async (req: Request, res: Response) => {
  try {
    const vulnerability = await prisma.vulnerability.findUnique({
      where: { id: req.params.id },
      include: { testRun: { include: { device: true } } },
    });

    if (!vulnerability) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Vulnerability not found' },
      };
      res.status(404).json(response);
      return;
    }

    if (!vulnerability.testRun || !vulnerability.testRun.device) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NO_DEVICE',
          message: 'This vulnerability was found via static analysis and cannot be retested',
        },
      };
      res.status(400).json(response);
      return;
    }

    // TODO: Trigger a retest for this specific vulnerability
    // For now, just suggest running a new test

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Please run a new test to verify this vulnerability',
        deviceId: vulnerability.testRun.device.id,
        testType: vulnerability.testRun.testType,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Retest vulnerability error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'RETEST_ERROR', message: 'Failed to schedule retest' },
    };
    res.status(500).json(response);
  }
});

export default router;
