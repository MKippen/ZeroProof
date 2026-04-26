/**
 * Rules API Routes
 *
 * Endpoints for viewing security rules, test definitions, and intent evaluations.
 * Rules are loaded from YAML files and can be synced from the official ZeroProof repo.
 */

import { Router, Request, Response } from 'express';
import { ruleLoader } from '../../services/ruleLoader';
import { officialRulesSync } from '../../services/ruleLoader/officialSync';
import { requireAuth } from '../middleware/auth';
import { logger } from '../../utils/logger';

const router = Router();
router.use(requireAuth);

// ============================================
// SECURITY RULES
// ============================================

/**
 * GET /api/v1/rules
 * Get all loaded security rules
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const rules = ruleLoader.getSecurityRules();

    // Optional filters
    const { category, severity } = req.query;

    let filtered = rules;

    if (category) {
      filtered = filtered.filter(r => r.category === category);
    }

    if (severity) {
      filtered = filtered.filter(r => r.severity === severity);
    }

    res.json({
      success: true,
      data: {
        total: filtered.length,
        rules: filtered.map(r => ({
          id: r.id,
          name: r.name,
          description: r.description,
          category: r.category,
          severity: r.severity,
          metadata: r.metadata,
        })),
      },
    });
  } catch (error) {
    logger.error('Failed to get rules', { error });
    res.status(500).json({ success: false, error: { code: 'FETCH_ERROR', message: 'Failed to get rules' } });
  }
});

/**
 * GET /api/v1/rules/stats
 * Get rule statistics
 */
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = ruleLoader.getStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Failed to get rule stats', { error });
    res.status(500).json({ success: false, error: { code: 'FETCH_ERROR', message: 'Failed to get rule stats' } });
  }
});

/**
 * POST /api/v1/rules/reload
 * Reload all rules from disk
 */
router.post('/reload', async (_req: Request, res: Response) => {
  try {
    const result = await ruleLoader.loadAllRules();
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Failed to reload rules', { error });
    res.status(500).json({ success: false, error: { code: 'RELOAD_ERROR', message: 'Failed to reload rules' } });
  }
});

// ============================================
// TEST DEFINITIONS
// ============================================

/**
 * GET /api/v1/rules/tests
 * Get all loaded test definitions
 */
router.get('/tests', async (_req: Request, res: Response) => {
  try {
    const tests = ruleLoader.getTestDefinitions();

    res.json({
      success: true,
      data: {
        total: tests.length,
        tests: tests.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          category: t.category,
          target: t.target,
          isDynamic: t.is_dynamic,
          isMeshTest: t.is_mesh_test,
          metadata: t.metadata,
        })),
      },
    });
  } catch (error) {
    logger.error('Failed to get tests', { error });
    res.status(500).json({ success: false, error: { code: 'FETCH_ERROR', message: 'Failed to get tests' } });
  }
});

/**
 * GET /api/v1/rules/tests/:id
 * Get a specific test definition
 */
router.get('/tests/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const test = ruleLoader.getTestDefinition(req.params.id);

    if (!test) {
      res.status(404).json({ error: 'Test not found' });
      return;
    }

    res.json(test);
  } catch (error) {
    logger.error('Failed to get test', { error, testId: req.params.id });
    res.status(500).json({ error: 'Failed to get test' });
  }
});

// ============================================
// INTENT EVALUATIONS
// ============================================

/**
 * GET /api/v1/rules/intents
 * Get all loaded intent evaluations
 */
router.get('/intents', async (_req: Request, res: Response) => {
  try {
    const intents = ruleLoader.getIntentEvaluations();

    res.json({
      success: true,
      data: {
        total: intents.length,
        evaluations: intents.map(i => ({
          id: i.id,
          name: i.name,
          description: i.description,
          category: i.category,
          priority: i.priority,
          intentSetting: i.intent_setting,
          metadata: i.metadata,
        })),
      },
    });
  } catch (error) {
    logger.error('Failed to get intent evaluations', { error });
    res.status(500).json({ success: false, error: { code: 'FETCH_ERROR', message: 'Failed to get intent evaluations' } });
  }
});

/**
 * GET /api/v1/rules/intents/:id
 * Get a specific intent evaluation
 */
router.get('/intents/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const intent = ruleLoader.getIntentEvaluation(req.params.id);

    if (!intent) {
      res.status(404).json({ error: 'Intent evaluation not found' });
      return;
    }

    res.json(intent);
  } catch (error) {
    logger.error('Failed to get intent evaluation', { error, intentId: req.params.id });
    res.status(500).json({ error: 'Failed to get intent evaluation' });
  }
});

// ============================================
// OFFICIAL REPO SYNC
// ============================================

/**
 * GET /api/v1/rules/sync/status
 * Get sync status and official repo info
 */
router.get('/sync/status', async (_req: Request, res: Response) => {
  try {
    const repoInfo = officialRulesSync.getOfficialRepoInfo();
    const lastSync = officialRulesSync.getLastSyncResult();

    res.json({
      success: true,
      data: {
        official: repoInfo,
        lastSync: lastSync ? {
          success: lastSync.success,
          filesDownloaded: lastSync.filesDownloaded,
          filesUpdated: lastSync.filesUpdated,
          filesSkipped: lastSync.filesSkipped,
          errors: lastSync.errors,
          timestamp: lastSync.lastSync,
        } : null,
      },
    });
  } catch (error) {
    logger.error('Failed to get sync status', { error });
    res.status(500).json({ success: false, error: { code: 'FETCH_ERROR', message: 'Failed to get sync status' } });
  }
});

/**
 * POST /api/v1/rules/sync
 * Sync rules from the official ZeroProof repository
 */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    logger.info('Starting sync from official ZeroProof repository');

    // Sync from official repo
    const syncResult = await officialRulesSync.syncFromOfficial();

    // Reload rules to pick up changes
    if (syncResult.success && (syncResult.filesDownloaded > 0 || syncResult.filesUpdated > 0)) {
      await ruleLoader.loadAllRules();
    }

    res.json({
      success: true,
      data: {
        success: syncResult.success,
        filesDownloaded: syncResult.filesDownloaded,
        filesUpdated: syncResult.filesUpdated,
        filesSkipped: syncResult.filesSkipped,
        errors: syncResult.errors,
        message: syncResult.success
          ? `Synced ${syncResult.filesDownloaded + syncResult.filesUpdated} files from official repository`
          : 'Sync failed',
      },
    });
  } catch (error) {
    logger.error('Failed to sync from official repo', { error });
    res.status(500).json({ success: false, error: { code: 'SYNC_ERROR', message: 'Failed to sync from official repository' } });
  }
});

// ============================================
// SPECIFIC RULE BY ID (must be last to avoid catching other routes)
// ============================================

/**
 * GET /api/v1/rules/:id
 * Get a specific security rule
 */
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const rule = ruleLoader.getSecurityRule(req.params.id);

    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    res.json(rule);
  } catch (error) {
    logger.error('Failed to get rule', { error, ruleId: req.params.id });
    res.status(500).json({ error: 'Failed to get rule' });
  }
});

export default router;
