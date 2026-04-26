import { Router, Request, Response } from 'express';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import {
  runSecurityAnalysis,
  runOptimizationAnalysis,
  toVulnerabilityFindings,
  getAllRules,
  getRuleSources,
  DismissalInfo,
} from '../../scanners';
import logger from '../../utils/logger';

// Helper to fetch active rule dismissals
async function getActiveRuleDismissals(): Promise<DismissalInfo[]> {
  const dismissals = await prisma.findingDismissal.findMany({
    where: {
      findingType: 'RULE',
      isActive: true,
    },
  });
  return dismissals.map((d) => ({
    id: d.id,
    findingId: d.findingId,
    affectedResource: d.affectedResource,
    reason: d.reason,
  }));
}

const router = Router();

// GET /api/v1/security/rules - Get all available security rules
router.get('/rules', requireAuth, async (_req: Request, res: Response) => {
  try {
    const rules = getAllRules();
    const sources = getRuleSources();

    // Group rules by source
    const rulesBySource: Record<string, any[]> = {};
    for (const rule of rules) {
      const sourceId = rule.sourceId || 'unknown';
      if (!rulesBySource[sourceId]) {
        rulesBySource[sourceId] = [];
      }
      rulesBySource[sourceId].push({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        category: rule.category,
        severity: rule.severity,
      });
    }

    const response: ApiResponse = {
      success: true,
      data: {
        totalRules: rules.length,
        sources: Object.values(sources),
        rulesBySource,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get security rules error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch security rules' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/security/sources - Get rule sources with attribution
router.get('/sources', requireAuth, async (_req: Request, res: Response) => {
  try {
    const sources = getRuleSources();

    const response: ApiResponse = {
      success: true,
      data: { sources: Object.values(sources) },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get rule sources error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch rule sources' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/security/analyze - Run security analysis on current config
router.post('/analyze', requireAuth, async (req: Request, res: Response) => {
  try {
    // Get active configuration, or most recent if none is active
    let activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig) {
      activeConfig = await prisma.configuration.findFirst({
        orderBy: { importedAt: 'desc' },
      });
    }

    if (!activeConfig) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NO_CONFIG',
          message: 'No configuration available. Import or sync a UniFi config first.',
        },
      };
      res.status(400).json(response);
      return;
    }

    const config = activeConfig.configJson as object;

    // Fetch active dismissals
    const dismissals = await getActiveRuleDismissals();

    // Run security analysis with dismissals
    const analysisResult = runSecurityAnalysis(config, dismissals);

    // Convert to vulnerability findings for storage
    const findings = toVulnerabilityFindings(analysisResult);

    // Optionally save findings to database
    if (req.body.saveFindings) {
      for (const finding of findings) {
        // Check if finding already exists
        const existing = await prisma.vulnerability.findFirst({
          where: {
            configId: activeConfig.id,
            type: finding.type,
            affectedResource: finding.affectedResource || null,
          },
        });

        if (existing) {
          // Update existing finding
          await prisma.vulnerability.update({
            where: { id: existing.id },
            data: {
              lastSeen: new Date(),
              severity: finding.severity,
              description: finding.description,
            },
          });
        } else {
          // Create new finding
          await prisma.vulnerability.create({
            data: {
              configId: activeConfig.id,
              type: finding.type,
              severity: finding.severity,
              title: finding.title,
              description: finding.description,
              impact: finding.impact,
              remediation: finding.remediation,
              affectedResource: finding.affectedResource,
              status: 'OPEN',
              firstSeen: new Date(),
              lastSeen: new Date(),
            },
          });
        }
      }

      logger.info(`Security analysis saved ${findings.length} findings`);
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'SECURITY_ANALYSIS_RUN',
        details: {
          configId: activeConfig.id,
          totalRules: analysisResult.summary.totalRules,
          passed: analysisResult.summary.passed,
          failed: analysisResult.summary.failed,
        },
        ipAddress: req.ip,
      },
    });

    const response: ApiResponse = {
      success: true,
      data: {
        ...analysisResult,
        configId: activeConfig.id,
        configSiteName: activeConfig.siteName,
        configImportedAt: activeConfig.importedAt.toISOString(),
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Security analysis error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'ANALYSIS_ERROR', message: 'Failed to run security analysis' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/security/analysis - Get latest security analysis results
router.get('/analysis', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Get active configuration
    let activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig) {
      activeConfig = await prisma.configuration.findFirst({
        orderBy: { importedAt: 'desc' },
      });
    }

    if (!activeConfig) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NO_CONFIG',
          message: 'No configuration available.',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Fetch active dismissals
    const dismissals = await getActiveRuleDismissals();

    // Run fresh analysis with dismissals
    const config = activeConfig.configJson as object;
    const analysisResult = runSecurityAnalysis(config, dismissals);

    const response: ApiResponse = {
      success: true,
      data: {
        ...analysisResult,
        configId: activeConfig.id,
        configSiteName: activeConfig.siteName,
        configImportedAt: activeConfig.importedAt.toISOString(),
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get security analysis error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to get security analysis' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/security/optimization - Get optimization recommendations (best practices)
router.get('/optimization', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Get active configuration
    let activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig) {
      activeConfig = await prisma.configuration.findFirst({
        orderBy: { importedAt: 'desc' },
      });
    }

    if (!activeConfig) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NO_CONFIG',
          message: 'No configuration available.',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Run optimization analysis
    const config = activeConfig.configJson as object;
    const analysisResult = runOptimizationAnalysis(config);

    const response: ApiResponse = {
      success: true,
      data: {
        ...analysisResult,
        configId: activeConfig.id,
        configSiteName: activeConfig.siteName,
        configImportedAt: activeConfig.importedAt.toISOString(),
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get optimization analysis error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to get optimization analysis' },
    };
    res.status(500).json(response);
  }
});

export default router;
