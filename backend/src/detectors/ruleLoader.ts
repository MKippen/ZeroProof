/**
 * Loads detector rule metadata from YAML files in `rules/detection/`.
 *
 * Why split TS detector + YAML rule?
 *   - The detection *logic* (TS) and the security *interpretation* (YAML —
 *     severity tiers, remediation guidance, references) evolve on different
 *     cadences and by different people. Security guidance can change without
 *     a code deploy; detector logic gets shipped through normal review.
 *   - YAML rules are the contract for community contributions and intel
 *     feed authors who shouldn't need TypeScript to add a recommendation.
 *
 * Structure of a detector YAML (see rules/detection/*.yaml for examples):
 *   id: "ioc_match"
 *   description: "..."
 *   severity:
 *     base: HIGH
 *     escalate_to: CRITICAL
 *     when: ["category:malware-c2"]
 *   remediation: "..."
 *   references: ["https://urlhaus.abuse.ch/", "..."]
 *   retention_days: 14
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import yaml from 'js-yaml';
import logger from '../utils/logger';

const SeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);

const RuleFileSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional().default(''),
  severity: z
    .object({
      base: SeveritySchema,
      escalate_to: SeveritySchema.optional(),
      when: z.array(z.string()).optional(),
    })
    .or(SeveritySchema.transform((s) => ({ base: s }))),
  remediation: z.string().optional(),
  references: z.array(z.string()).optional(),
  retention_days: z.number().int().min(1).max(365).optional(),
});

export type RuleFile = z.infer<typeof RuleFileSchema>;

export interface DetectorRule {
  id: string;
  description: string;
  severityBase: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  severityEscalateTo?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  severityEscalateWhen?: string[];
  remediation?: string;
  references?: string[];
  retentionDays?: number;
}

const rules = new Map<string, DetectorRule>();

/** Look up a previously-loaded rule by id. */
export function getDetectorRule(id: string): DetectorRule | undefined {
  return rules.get(id);
}

export function listDetectorRules(): DetectorRule[] {
  return Array.from(rules.values());
}

/** Test-only. */
export function resetDetectorRules(): void {
  rules.clear();
}

/**
 * Walks a directory and registers every YAML rule found. Rules are
 * shallow-validated; any file that fails validation is logged and skipped
 * so one bad file doesn't break boot.
 */
export function loadDetectorRulesFromDirectory(dir: string): {
  loaded: number;
  errors: string[];
} {
  const errors: string[] = [];
  let loaded = 0;

  if (!existsSync(dir)) {
    logger.warn(`Detector rules directory does not exist: ${dir}`);
    return { loaded, errors };
  }

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const sub = loadDetectorRulesFromDirectory(full);
      loaded += sub.loaded;
      errors.push(...sub.errors);
      continue;
    }
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) continue;

    try {
      const raw = readFileSync(full, 'utf8');
      const parsed = yaml.load(raw);
      const validated = RuleFileSchema.parse(parsed);
      registerDetectorRule(validated);
      loaded += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${full}: ${msg}`);
      logger.warn(`Failed to load detector rule ${full}: ${msg}`);
    }
  }
  return { loaded, errors };
}

function registerDetectorRule(file: RuleFile): void {
  const sev = file.severity;
  const escalateTo = 'escalate_to' in sev ? sev.escalate_to : undefined;
  const escalateWhen = 'when' in sev ? sev.when : undefined;
  rules.set(file.id, {
    id: file.id,
    description: file.description ?? '',
    severityBase: sev.base,
    severityEscalateTo: escalateTo,
    severityEscalateWhen: escalateWhen,
    remediation: file.remediation,
    references: file.references,
    retentionDays: file.retention_days,
  });
}
