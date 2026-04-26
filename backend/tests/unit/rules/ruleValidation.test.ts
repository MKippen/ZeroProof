import fs from 'fs';
import path from 'path';
import * as yaml from 'js-yaml';

type AnyRecord = Record<string, any>;

const ROOT_DIR = path.resolve(__dirname, '../../../../');
const RULES_DIR = path.join(ROOT_DIR, 'rules');

const SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const CATEGORIES = new Set([
  'firewall',
  'vlan',
  'dns',
  'port',
  'upnp',
  'wireless',
  'general',
  'ids_ips',
  'access_control',
  'switch',
  'vpn',
  'version',
  'optimization',
]);

const CONDITION_OPS = new Set([
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'matches',
  'matches_i',
  'in',
  'not_in',
  'gt',
  'lt',
  'gte',
  'lte',
  'empty',
  'not_empty',
  'empty_array',
  'in_port_list',
  'port_range_exceeds',
  'equals_ref',
]);

const TEST_OPS = new Set([
  'get_network_info',
  'tcp_connect',
  'tcp_banner',
  'dns_lookup',
  'arp_scan',
  'ping',
]);

function listYamlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listYamlFiles(full));
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      files.push(full);
    }
  }
  return files;
}

function loadYaml(filePath: string): AnyRecord {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = yaml.load(content);
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid YAML: ${filePath}`);
  }
  return data as AnyRecord;
}

function validateConditionOps(condition: AnyRecord, errors: string[], context: string): void {
  if (!condition || typeof condition !== 'object') return;

  if (condition.operator) {
    if (condition.operator === 'AND' || condition.operator === 'OR') {
      const checks = condition.checks || [];
      for (const check of checks) validateConditionOps(check, errors, context);
    } else if (condition.operator === 'NOT') {
      validateConditionOps(condition.check, errors, context);
    }
    return;
  }

  if (condition.op && !CONDITION_OPS.has(condition.op)) {
    errors.push(`${context}: unsupported op "${condition.op}"`);
  }
}

describe('YAML rule validation', () => {
  const sourcesPath = path.join(RULES_DIR, 'sources.yaml');
  const sourcesData = fs.existsSync(sourcesPath) ? loadYaml(sourcesPath) : {};
  const sourceRefs = sourcesData.sources?.['industry-standards']?.references || [];

  it('security rules conform to schema and supported operators', () => {
    const securityFiles = listYamlFiles(path.join(RULES_DIR, 'security'));
    const errors: string[] = [];
    const ids = new Set<string>();

    for (const file of securityFiles) {
      const data = loadYaml(file);
      const rules = Array.isArray(data.rules) ? data.rules : [];
      if (!rules.length) {
        errors.push(`${file}: missing or empty rules list`);
        continue;
      }

      for (const rule of rules) {
        const context = `${file} (${rule?.id || 'unknown'})`;
        if (!rule?.id || !rule?.name || !rule?.description) {
          errors.push(`${context}: missing id/name/description`);
        }
        if (!rule?.category || !CATEGORIES.has(rule.category)) {
          errors.push(`${context}: invalid category "${rule?.category}"`);
        }
        if (!rule?.severity || !SEVERITIES.has(rule.severity)) {
          errors.push(`${context}: invalid severity "${rule?.severity}"`);
        }
        if (!rule?.impact || !rule?.remediation) {
          errors.push(`${context}: missing impact/remediation`);
        }
        if (!rule?.detection || !rule?.detection?.output) {
          errors.push(`${context}: missing detection/output`);
        }

        if (rule?.id) {
          if (ids.has(rule.id)) {
            errors.push(`${context}: duplicate rule id "${rule.id}"`);
          }
          ids.add(rule.id);
        }

        if (file.includes(`${path.sep}industry-standards${path.sep}`)) {
          const refs = rule?.metadata?.references || sourceRefs;
          if (!Array.isArray(refs) || refs.length === 0) {
            errors.push(`${context}: missing industry-standards references`);
          }
        }

        if (rule?.detection?.condition) {
          validateConditionOps(rule.detection.condition, errors, context);
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('test definitions use supported operations', () => {
    const testFiles = listYamlFiles(path.join(RULES_DIR, 'tests'));
    const errors: string[] = [];
    const ids = new Set<string>();

    for (const file of testFiles) {
      const data = loadYaml(file);
      const tests = Array.isArray(data.tests) ? data.tests : [];
      if (!tests.length) {
        errors.push(`${file}: missing or empty tests list`);
        continue;
      }

      for (const test of tests) {
        const context = `${file} (${test?.id || 'unknown'})`;
        if (!test?.id || !test?.name || !test?.category || !test?.target) {
          errors.push(`${context}: missing id/name/category/target`);
        }
        if (test?.id) {
          if (ids.has(test.id)) {
            errors.push(`${context}: duplicate test id "${test.id}"`);
          }
          ids.add(test.id);
        }

        const commands = test?.commands || [];
        for (const cmd of commands) {
          if (!TEST_OPS.has(cmd?.op)) {
            errors.push(`${context}: unsupported op "${cmd?.op}"`);
          }
        }
      }
    }

    expect(errors).toEqual([]);
  });

  it('intent evaluations use supported condition operators', () => {
    const intentFiles = listYamlFiles(path.join(RULES_DIR, 'intent'));
    const errors: string[] = [];
    const ids = new Set<string>();

    for (const file of intentFiles) {
      const data = loadYaml(file);
      const evaluations = Array.isArray(data.evaluations) ? data.evaluations : [];
      if (!evaluations.length) {
        errors.push(`${file}: missing or empty evaluations list`);
        continue;
      }

      for (const evaluation of evaluations) {
        const context = `${file} (${evaluation?.id || 'unknown'})`;
        if (!evaluation?.id || !evaluation?.name || !evaluation?.intent_setting) {
          errors.push(`${context}: missing id/name/intent_setting`);
        }
        if (evaluation?.id) {
          if (ids.has(evaluation.id)) {
            errors.push(`${context}: duplicate evaluation id "${evaluation.id}"`);
          }
          ids.add(evaluation.id);
        }

        if (evaluation?.applicable_when) {
          validateConditionOps(evaluation.applicable_when, errors, context);
        }

        const checks = evaluation?.evaluation?.checks || [];
        for (const check of checks) {
          if (check?.condition) {
            validateConditionOps(check.condition, errors, context);
          }
        }
      }
    }

    expect(errors).toEqual([]);
  });
});
