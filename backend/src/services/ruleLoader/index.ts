/**
 * Rule Loader Service
 *
 * Loads security rules, test definitions, and intent evaluations from YAML files.
 * Supports hot-reload via file watching and GitHub sync for updates.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { EventEmitter } from 'events';
import { logger } from '../../utils/logger';
import {
  LoadedRules,
  RuleLoadResult,
  SecurityRuleDefinition,
  SecurityRulesFile,
  TestDefinition,
  TestsFile,
  IntentEvaluationDefinition,
  IntentEvaluationsFile,
  RuleSource,
  SourcesFile,
} from './types';

// Re-export types
export * from './types';

const RULES_DIR = process.env.RULES_DIR || path.join(__dirname, '../../../../rules');

class RuleLoaderService extends EventEmitter {
  private rules: LoadedRules;
  private watchers: fs.FSWatcher[] = [];
  private isWatching: boolean = false;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.rules = {
      securityRules: new Map(),
      testDefinitions: new Map(),
      intentEvaluations: new Map(),
      sources: new Map(),
      lastLoaded: new Date(),
      fileHashes: new Map(),
    };
  }

  /**
   * Initialize the rule loader - load all rules from disk
   */
  async initialize(): Promise<RuleLoadResult> {
    logger.info('Initializing rule loader...');
    const result = await this.loadAllRules();

    if (result.success) {
      logger.info(`Rule loader initialized: ${result.rulesLoaded} rules, ${result.testsLoaded} tests, ${result.intentsLoaded} intents`);
    } else {
      logger.error('Rule loader initialization failed', { errors: result.errors });
    }

    return result;
  }

  /**
   * Load all rules from the rules directory
   */
  async loadAllRules(): Promise<RuleLoadResult> {
    const result: RuleLoadResult = {
      success: true,
      rulesLoaded: 0,
      testsLoaded: 0,
      intentsLoaded: 0,
      errors: [],
      warnings: [],
    };

    try {
      // Check if rules directory exists
      if (!fs.existsSync(RULES_DIR)) {
        result.warnings.push(`Rules directory not found: ${RULES_DIR}`);
        logger.warn(`Rules directory not found: ${RULES_DIR}`);
        return result;
      }

      // Load sources first
      await this.loadSources(result);

      // Load security rules
      await this.loadSecurityRules(result);

      // Load test definitions
      await this.loadTestDefinitions(result);

      // Load intent evaluations
      await this.loadIntentEvaluations(result);

      this.rules.lastLoaded = new Date();

      // Emit reload event
      this.emit('rules-reloaded', {
        rulesLoaded: result.rulesLoaded,
        testsLoaded: result.testsLoaded,
        intentsLoaded: result.intentsLoaded,
      });

    } catch (error) {
      result.success = false;
      result.errors.push(`Failed to load rules: ${error}`);
      logger.error('Failed to load rules', { error });
    }

    return result;
  }

  /**
   * Load source attributions
   */
  private async loadSources(result: RuleLoadResult): Promise<void> {
    const sourcesFile = path.join(RULES_DIR, 'sources.yaml');

    if (!fs.existsSync(sourcesFile)) {
      result.warnings.push('sources.yaml not found');
      return;
    }

    try {
      const content = fs.readFileSync(sourcesFile, 'utf8');
      const data = yaml.load(content) as SourcesFile;

      if (data.sources) {
        this.rules.sources.clear();
        for (const [id, source] of Object.entries(data.sources)) {
          this.rules.sources.set(id, { ...source, id });
        }
      }
    } catch (error) {
      result.errors.push(`Failed to load sources.yaml: ${error}`);
    }
  }

  /**
   * Load security rules from YAML files
   */
  private async loadSecurityRules(result: RuleLoadResult): Promise<void> {
    const securityDir = path.join(RULES_DIR, 'security');

    if (!fs.existsSync(securityDir)) {
      result.warnings.push('security rules directory not found');
      return;
    }

    this.rules.securityRules.clear();
    const files = this.findYamlFiles(securityDir);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const hash = this.hashContent(content);
        this.rules.fileHashes.set(file, hash);

        const data = yaml.load(content) as SecurityRulesFile;

        if (data.rules && Array.isArray(data.rules)) {
          for (const rule of data.rules) {
            // Extract source from file path
            const sourceId = this.extractSourceFromPath(file, 'security');
            const enrichedRule = { ...rule, sourceId };

            if (this.rules.securityRules.has(rule.id)) {
              result.warnings.push(`Duplicate rule ID: ${rule.id} in ${file}`);
            }

            this.rules.securityRules.set(rule.id, enrichedRule);
            result.rulesLoaded++;
          }
        }
      } catch (error) {
        result.errors.push(`Failed to load ${file}: ${error}`);
      }
    }
  }

  /**
   * Load test definitions from YAML files
   */
  private async loadTestDefinitions(result: RuleLoadResult): Promise<void> {
    const testsDir = path.join(RULES_DIR, 'tests');

    if (!fs.existsSync(testsDir)) {
      result.warnings.push('tests directory not found');
      return;
    }

    this.rules.testDefinitions.clear();
    const files = this.findYamlFiles(testsDir);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const hash = this.hashContent(content);
        this.rules.fileHashes.set(file, hash);

        const data = yaml.load(content) as TestsFile;

        if (data.tests && Array.isArray(data.tests)) {
          for (const test of data.tests) {
            const sourceId = this.extractSourceFromPath(file, 'tests');
            const enrichedTest = { ...test, sourceId };

            if (this.rules.testDefinitions.has(test.id)) {
              result.warnings.push(`Duplicate test ID: ${test.id} in ${file}`);
            }

            this.rules.testDefinitions.set(test.id, enrichedTest);
            result.testsLoaded++;
          }
        }
      } catch (error) {
        result.errors.push(`Failed to load ${file}: ${error}`);
      }
    }
  }

  /**
   * Load intent evaluations from YAML files
   */
  private async loadIntentEvaluations(result: RuleLoadResult): Promise<void> {
    const intentDir = path.join(RULES_DIR, 'intent');

    if (!fs.existsSync(intentDir)) {
      result.warnings.push('intent directory not found');
      return;
    }

    this.rules.intentEvaluations.clear();
    const files = this.findYamlFiles(intentDir);

    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf8');
        const hash = this.hashContent(content);
        this.rules.fileHashes.set(file, hash);

        const data = yaml.load(content) as IntentEvaluationsFile;

        if (data.evaluations && Array.isArray(data.evaluations)) {
          for (const evaluation of data.evaluations) {
            const sourceId = this.extractSourceFromPath(file, 'intent');
            const enrichedEval = { ...evaluation, sourceId };

            if (this.rules.intentEvaluations.has(evaluation.id)) {
              result.warnings.push(`Duplicate intent ID: ${evaluation.id} in ${file}`);
            }

            this.rules.intentEvaluations.set(evaluation.id, enrichedEval);
            result.intentsLoaded++;
          }
        }
      } catch (error) {
        result.errors.push(`Failed to load ${file}: ${error}`);
      }
    }
  }

  /**
   * Find all YAML files recursively in a directory
   */
  private findYamlFiles(dir: string): string[] {
    const files: string[] = [];

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip README files but recurse into directories
        files.push(...this.findYamlFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Extract source ID from file path
   * e.g., /rules/security/industry-standards/firewall.yaml -> industry-standards
   */
  private extractSourceFromPath(filePath: string, category: string): string {
    const relativePath = path.relative(path.join(RULES_DIR, category), filePath);
    const parts = relativePath.split(path.sep);
    return parts[0] || 'zeroproof';
  }

  /**
   * Hash file content for change detection
   */
  private hashContent(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Start watching for file changes
   */
  startWatching(): void {
    if (this.isWatching) return;

    logger.info('Starting rule file watcher...');
    this.isWatching = true;

    const watchDirs = [
      path.join(RULES_DIR, 'security'),
      path.join(RULES_DIR, 'tests'),
      path.join(RULES_DIR, 'intent'),
    ];

    for (const dir of watchDirs) {
      if (fs.existsSync(dir)) {
        try {
          const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
            if (filename && (filename.endsWith('.yaml') || filename.endsWith('.yml'))) {
              this.handleFileChange(eventType, filename);
            }
          });
          this.watchers.push(watcher);
        } catch (error) {
          logger.error(`Failed to watch directory: ${dir}`, { error });
        }
      }
    }
  }

  /**
   * Stop watching for file changes
   */
  stopWatching(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
    this.isWatching = false;
    logger.info('Rule file watcher stopped');
  }

  /**
   * Handle file change events with debouncing
   */
  private handleFileChange(eventType: string, filename: string): void {
    // Debounce multiple rapid changes
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      logger.info(`Rule file changed: ${filename} (${eventType})`);
      await this.loadAllRules();
    }, 500);
  }

  // ============================================
  // GETTER METHODS
  // ============================================

  /**
   * Get all security rules
   */
  getSecurityRules(): SecurityRuleDefinition[] {
    return Array.from(this.rules.securityRules.values());
  }

  /**
   * Get security rule by ID
   */
  getSecurityRule(id: string): SecurityRuleDefinition | undefined {
    return this.rules.securityRules.get(id);
  }

  /**
   * Get security rules by category
   */
  getSecurityRulesByCategory(category: string): SecurityRuleDefinition[] {
    return this.getSecurityRules().filter(r => r.category === category);
  }

  /**
   * Get security rules by source
   */
  getSecurityRulesBySource(sourceId: string): SecurityRuleDefinition[] {
    return this.getSecurityRules().filter(r => (r as any).sourceId === sourceId);
  }

  /**
   * Get all test definitions
   */
  getTestDefinitions(): TestDefinition[] {
    return Array.from(this.rules.testDefinitions.values());
  }

  /**
   * Get test definition by ID
   */
  getTestDefinition(id: string): TestDefinition | undefined {
    return this.rules.testDefinitions.get(id);
  }

  /**
   * Get all intent evaluations
   */
  getIntentEvaluations(): IntentEvaluationDefinition[] {
    return Array.from(this.rules.intentEvaluations.values());
  }

  /**
   * Get intent evaluation by ID
   */
  getIntentEvaluation(id: string): IntentEvaluationDefinition | undefined {
    return this.rules.intentEvaluations.get(id);
  }

  /**
   * Get intent evaluations by setting
   */
  getIntentEvaluationsBySetting(setting: string): IntentEvaluationDefinition[] {
    return this.getIntentEvaluations().filter(e => e.intent_setting === setting);
  }

  /**
   * Get all sources
   */
  getSources(): RuleSource[] {
    return Array.from(this.rules.sources.values());
  }

  /**
   * Get source by ID
   */
  getSource(id: string): RuleSource | undefined {
    return this.rules.sources.get(id);
  }

  /**
   * Get statistics about loaded rules
   */
  getStats(): {
    securityRules: number;
    testDefinitions: number;
    intentEvaluations: number;
    sources: number;
    lastLoaded: Date;
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
  } {
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};

    for (const rule of this.rules.securityRules.values()) {
      const sourceId = (rule as any).sourceId || 'unknown';
      bySource[sourceId] = (bySource[sourceId] || 0) + 1;
      byCategory[rule.category] = (byCategory[rule.category] || 0) + 1;
    }

    return {
      securityRules: this.rules.securityRules.size,
      testDefinitions: this.rules.testDefinitions.size,
      intentEvaluations: this.rules.intentEvaluations.size,
      sources: this.rules.sources.size,
      lastLoaded: this.rules.lastLoaded,
      bySource,
      byCategory,
    };
  }
}

// Singleton instance
export const ruleLoader = new RuleLoaderService();

export default ruleLoader;
