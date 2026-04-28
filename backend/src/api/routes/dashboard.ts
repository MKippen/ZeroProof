import { Router, Request, Response } from 'express';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import logger from '../../utils/logger';
import { runSecurityAnalysis, DismissalInfo } from '../../scanners';
import { analyzeAgainstIntent } from '../../analyzers/intentAnalyzer';
import { NetworkIntentProfile } from '../../types';

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

// GET /api/v1/dashboard
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Get active configuration first (needed for filtering)
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
      orderBy: { importedAt: 'desc' },
    });

    const [
      vulnerabilityStats,
      deviceStats,
      lastTest,
      recentVulnerabilities,
      recentTests,
      intentSetting,
    ] = await Promise.all([
      // Vulnerability counts by severity (open only, filtered to active config)
      prisma.vulnerability.groupBy({
        by: ['severity'],
        where: {
          status: 'OPEN',
          ...(activeConfig && { configId: activeConfig.id }),
        },
        _count: { id: true },
      }),
      // Device status counts
      prisma.device.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
      // Last test run
      prisma.testRun.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, status: true, testType: true },
      }),
      // Recent vulnerabilities (filtered to active config)
      prisma.vulnerability.findMany({
        where: {
          status: 'OPEN',
          ...(activeConfig && { configId: activeConfig.id }),
        },
        orderBy: { firstSeen: 'desc' },
        take: 5,
        select: {
          id: true,
          type: true,
          severity: true,
          title: true,
          firstSeen: true,
        },
      }),
      // Recent test runs
      prisma.testRun.findMany({
        orderBy: { startedAt: 'desc' },
        take: 5,
        include: {
          device: { select: { name: true } },
        },
      }),
      // Get intent profile setting
      prisma.setting.findUnique({
        where: { key: 'network_intent_profile' },
      }),
    ]);

    // If no active config, try most recent
    const config = activeConfig || await prisma.configuration.findFirst({
      orderBy: { importedAt: 'desc' },
    });

    // Run security analysis if we have a config
    let securityAnalysis = null;
    if (config) {
      try {
        // Fetch dismissals so we don't count dismissed findings
        const dismissals = await getActiveRuleDismissals();
        securityAnalysis = runSecurityAnalysis(config.configJson as object, dismissals);
      } catch (err) {
        logger.warn('Failed to run security analysis for dashboard:', err);
      }
    }

    // Run intent analysis if we have both config and intent profile
    let intentAnalysis = null;
    if (config && intentSetting?.value) {
      try {
        const intentProfile = intentSetting.value as unknown as NetworkIntentProfile;
        // Note: analyzeAgainstIntent expects (config, profile) not (profile, config)
        intentAnalysis = analyzeAgainstIntent(config.configJson as object, intentProfile);
        logger.info(`Intent analysis: score=${intentAnalysis.score}, gaps=${intentAnalysis.gaps.length}`);
      } catch (err) {
        logger.warn('Failed to run intent analysis for dashboard:', err);
      }
    } else {
      logger.info(`Intent analysis skipped: config=${!!config}, intentSetting=${!!intentSetting?.value}`);
    }

    // Calculate vulnerability counts from saved findings
    const vulnCounts = vulnerabilityStats.reduce(
      (acc, v) => ({ ...acc, [v.severity]: v._count.id }),
      { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 }
    );

    // Add security analysis findings to counts
    const analysisCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    if (securityAnalysis) {
      analysisCounts.CRITICAL = securityAnalysis.summary.bySeverity.CRITICAL || 0;
      analysisCounts.HIGH = securityAnalysis.summary.bySeverity.HIGH || 0;
      analysisCounts.MEDIUM = securityAnalysis.summary.bySeverity.MEDIUM || 0;
      analysisCounts.LOW = securityAnalysis.summary.bySeverity.LOW || 0;
      analysisCounts.INFO = securityAnalysis.summary.bySeverity.INFO || 0;
    }

    // Count intent gaps by severity - these ARE vulnerabilities (config doesn't match goals)
    const intentGapCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    if (intentAnalysis) {
      for (const gap of intentAnalysis.gaps) {
        const severity = gap.severity as keyof typeof intentGapCounts;
        if (severity in intentGapCounts) {
          intentGapCounts[severity]++;
        }
      }
    }

    // Combined counts (vulnerabilities + security analysis + intent gaps)
    const combinedCounts = {
      CRITICAL: vulnCounts.CRITICAL + analysisCounts.CRITICAL + intentGapCounts.CRITICAL,
      HIGH: vulnCounts.HIGH + analysisCounts.HIGH + intentGapCounts.HIGH,
      MEDIUM: vulnCounts.MEDIUM + analysisCounts.MEDIUM + intentGapCounts.MEDIUM,
      LOW: vulnCounts.LOW + analysisCounts.LOW + intentGapCounts.LOW,
      INFO: vulnCounts.INFO + analysisCounts.INFO + intentGapCounts.INFO,
    };

    const totalVulnerabilities =
      combinedCounts.CRITICAL + combinedCounts.HIGH + combinedCounts.MEDIUM + combinedCounts.LOW;

    // Calculate unified security score from multiple sources
    // Uses a weighted approach with diminishing returns to avoid immediately hitting 0

    // Weight each issue type (higher = more impact)
    const weights = { CRITICAL: 10, HIGH: 5, MEDIUM: 2, LOW: 0.5 };

    // Calculate weighted issue count
    const vulnWeight =
      vulnCounts.CRITICAL * weights.CRITICAL +
      vulnCounts.HIGH * weights.HIGH +
      vulnCounts.MEDIUM * weights.MEDIUM +
      vulnCounts.LOW * weights.LOW;

    const analysisWeight =
      analysisCounts.CRITICAL * weights.CRITICAL +
      analysisCounts.HIGH * weights.HIGH +
      analysisCounts.MEDIUM * weights.MEDIUM +
      analysisCounts.LOW * weights.LOW;

    const intentWeight =
      intentGapCounts.CRITICAL * weights.CRITICAL +
      intentGapCounts.HIGH * weights.HIGH +
      intentGapCounts.MEDIUM * weights.MEDIUM +
      intentGapCounts.LOW * weights.LOW;

    const totalWeight = vulnWeight + analysisWeight + intentWeight;

    // Use a logarithmic decay formula: score = 100 * e^(-k * weight)
    // This gives diminishing returns - first issues hurt more, later ones less
    // k=0.02 means: 10 weighted points → ~82%, 50 → ~37%, 100 → ~14%
    const k = 0.015;
    // Score is null until we have something to score against — a config has been
    // imported (so security analysis can run) or vulnerabilities have been recorded.
    // Without that, "100" would falsely advertise a clean network.
    const hasScoreableData = !!config || totalVulnerabilities > 0;
    const securityScore: number | null = hasScoreableData
      ? Math.max(0, Math.min(100, Math.round(100 * Math.exp(-k * totalWeight))))
      : null;
    logger.info(`Dashboard security score: ${securityScore} (vulns: ${JSON.stringify(vulnCounts)}, analysis: ${JSON.stringify(analysisCounts)}, intentGaps: ${JSON.stringify(intentGapCounts)})`);

    // Device stats
    const deviceCounts = deviceStats.reduce(
      (acc, d) => ({ ...acc, [d.status]: d._count.id }),
      { ONLINE: 0, OFFLINE: 0, TESTING: 0, ERROR: 0 }
    );

    // Get top issues from security analysis for display
    const topSecurityIssues = securityAnalysis?.results
      .filter((r) => !r.passed)
      .slice(0, 5)
      .map((r) => ({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        severity: r.severity,
        category: r.category,
        findingCount: r.findings.length,
      })) || [];

    // Count failed rules by severity (for accurate critical/high counts)
    const failedBySeverity = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    if (securityAnalysis) {
      for (const result of securityAnalysis.results) {
        if (!result.passed) {
          const severity = result.severity as keyof typeof failedBySeverity;
          if (severity in failedBySeverity) {
            failedBySeverity[severity]++;
          }
        }
      }
    }

    const response: ApiResponse = {
      success: true,
      data: {
        securityScore,
        // Breakdown of what's contributing to the score
        scoreBreakdown: {
          vulnerabilities: vulnCounts,
          securityAnalysis: analysisCounts,
          intentGaps: intentGapCounts,
          intentCompliance: intentAnalysis?.score ?? null,
          analysisPassRate: securityAnalysis && securityAnalysis.summary.totalRules > 0
            ? Math.round((securityAnalysis.summary.passed / securityAnalysis.summary.totalRules) * 100)
            : null,
        },
        vulnerabilities: {
          total: totalVulnerabilities + combinedCounts.INFO,
          critical: combinedCounts.CRITICAL,
          high: combinedCounts.HIGH,
          medium: combinedCounts.MEDIUM,
          low: combinedCounts.LOW,
          info: combinedCounts.INFO,
          // Separate breakdown
          fromVulnerabilities: vulnCounts.CRITICAL + vulnCounts.HIGH + vulnCounts.MEDIUM + vulnCounts.LOW,
          fromSecurityAnalysis: analysisCounts.CRITICAL + analysisCounts.HIGH + analysisCounts.MEDIUM + analysisCounts.LOW,
          fromIntentGaps: intentGapCounts.CRITICAL + intentGapCounts.HIGH + intentGapCounts.MEDIUM + intentGapCounts.LOW,
        },
        devices: {
          online: deviceCounts.ONLINE,
          offline: deviceCounts.OFFLINE,
          testing: deviceCounts.TESTING,
          error: deviceCounts.ERROR,
          total: Object.values(deviceCounts).reduce((a, b) => a + b, 0),
        },
        // Intent compliance summary
        intentCompliance: intentAnalysis
          ? {
              score: intentAnalysis.score,
              compliant: intentAnalysis.compliant,
              gapCount: intentAnalysis.gaps.length,
              topGaps: intentAnalysis.gaps.slice(0, 3).map((g) => ({
                intent: g.intent,
                severity: g.severity,
                description: g.reality,
              })),
              configRequirements: intentAnalysis.configRequirements || [],
            }
          : null,
        // Security analysis summary
        securityAnalysis: securityAnalysis
          ? {
              totalRules: securityAnalysis.summary.totalRules,
              passed: securityAnalysis.summary.passed,
              failed: securityAnalysis.summary.failed,
              failedBySeverity,
              topIssues: topSecurityIssues,
            }
          : null,
        lastTestRun: lastTest?.startedAt || null,
        recentVulnerabilities,
        recentTests,
        hasConfig: !!config,
        hasIntentProfile: !!intentSetting?.value,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get dashboard error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch dashboard data' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/dashboard/activity
router.get('/activity', requireAuth, async (req: Request, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [testActivity, vulnerabilityActivity] = await Promise.all([
      prisma.testRun.findMany({
        where: { startedAt: { gte: since } },
        select: { startedAt: true, status: true },
        orderBy: { startedAt: 'asc' },
      }),
      prisma.vulnerability.findMany({
        where: { firstSeen: { gte: since } },
        select: { firstSeen: true, severity: true },
        orderBy: { firstSeen: 'asc' },
      }),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        testActivity,
        vulnerabilityActivity,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get activity error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch activity data' },
    };
    res.status(500).json(response);
  }
});

export default router;
