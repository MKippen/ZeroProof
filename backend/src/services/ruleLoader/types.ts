/**
 * Rule Loader Types
 * Type definitions for YAML-based rules, tests, and intent evaluations
 */

// ============================================
// COMMON TYPES
// ============================================

export interface RuleMetadata {
  author?: string;
  created?: string;
  modified?: string;
  version?: string;
  tags?: string[];
  references?: string[];
  mitre_attack?: string[];
  cwe?: string[];
  false_positives?: string[];
  estimated_duration?: string;
}

export interface RuleSource {
  id: string;
  name: string;
  description: string;
  url?: string;
  license?: string;
  references?: string[];
}

// ============================================
// SECURITY RULE TYPES
// ============================================

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type RuleCategory =
  | 'firewall'
  | 'vlan'
  | 'dns'
  | 'port'
  | 'upnp'
  | 'wireless'
  | 'general'
  | 'ids_ips'
  | 'access_control'
  | 'switch'
  | 'optimization'
  | 'version';

export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'not_contains'
  | 'matches'
  | 'matches_i'
  | 'in'
  | 'not_in'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'empty'
  | 'not_empty'
  | 'empty_array'
  | 'in_port_list'
  | 'port_range_exceeds'
  | 'equals_ref';

export interface ConditionCheck {
  field?: string;
  op?: ConditionOperator;
  value?: unknown;
  ref_field?: string;
  operator?: 'AND' | 'OR' | 'NOT';
  checks?: ConditionCheck[];
  check?: ConditionCheck;
}

export interface DetectionFilter {
  [key: string]: unknown;
  network_type?: string;
  name_pattern?: string;
}

export interface DetectionOutput {
  affected_resource: string;
  details: string;
  current_value?: string;
  expected_value?: string;
}

export interface RuleDetection {
  target: string;
  filter?: DetectionFilter;
  name_pattern?: string;
  condition: ConditionCheck;
  cross_reference?: {
    type: string;
    key?: string;
    target_field?: string;
    check_blocks_to?: { name_pattern: string };
  };
  aggregate?: string;
  aggregate_filter?: ConditionCheck | DetectionFilter;
  additional_condition?: {
    target: string;
    aggregate: string;
    op: string;
    value: number;
  };
  report_mode?: 'exists' | 'each';
  output: DetectionOutput;
}

export interface SecurityRuleDefinition {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  severity: Severity;
  impact: string;
  remediation: string;
  sourceId?: string;
  metadata?: RuleMetadata;
  sensitive_ports?: Record<string, string>;
  detection: RuleDetection;
}

export interface SecurityRulesFile {
  rules: SecurityRuleDefinition[];
}

// ============================================
// TEST DEFINITION TYPES
// ============================================

export interface TestCommand {
  op: string;
  [key: string]: unknown;
}

export interface TestPostProcess {
  after_arp_scan?: {
    action: string;
    ports: number[];
  };
}

export interface DynamicTestConfig {
  source: string;
  generator: string;
  options?: Record<string, unknown>;
}

export interface MeshTestConfig {
  mode: 'all_to_all' | 'hub_spoke' | 'sequential';
  parallel?: boolean;
  collect_matrix?: boolean;
}

export interface TestDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  target: 'esp32' | 'server' | 'both';
  metadata?: RuleMetadata;
  is_dynamic?: boolean;
  is_mesh_test?: boolean;
  dynamic?: DynamicTestConfig;
  mesh?: MeshTestConfig;
  post_process?: TestPostProcess;
  commands: TestCommand[];
}

export interface TestsFile {
  tests: TestDefinition[];
}

// ============================================
// INTENT EVALUATION TYPES
// ============================================

export interface IntentApplicableWhen {
  intent_field?: string;
  op?: string;
  value?: unknown;
  operator?: 'AND' | 'OR';
  checks?: IntentApplicableWhen[];
  networks_exist?: { name_pattern: string };
}

export interface IntentEvaluationCheck {
  name: string;
  description?: string;
  target: string;
  filter?: DetectionFilter;
  condition: ConditionCheck;
  required: boolean;
  weight: number;
  severity_if_missing?: Severity;
}

export interface IntentEvaluation {
  checks: IntentEvaluationCheck[];
  scoring?: {
    all_required_pass: string;
    some_required_fail: string;
    optional_bonus?: boolean;
  };
}

export interface IntentOutput {
  configured?: {
    summary: string;
    details: string;
  };
  not_configured?: {
    summary: string;
    details?: string;
    remediation: string;
  };
  partial?: {
    summary: string;
    details: string;
  };
}

export interface IntentEvaluationDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: number;
  intent_setting: string;
  metadata?: RuleMetadata;
  applicable_when: IntentApplicableWhen;
  evaluation: IntentEvaluation;
  output: IntentOutput;
}

export interface IntentEvaluationsFile {
  evaluations: IntentEvaluationDefinition[];
}

// ============================================
// SOURCES FILE TYPE
// ============================================

export interface SourcesFile {
  sources: Record<string, RuleSource>;
}

// ============================================
// LOADED RULES STATE
// ============================================

export interface LoadedRules {
  securityRules: Map<string, SecurityRuleDefinition>;
  testDefinitions: Map<string, TestDefinition>;
  intentEvaluations: Map<string, IntentEvaluationDefinition>;
  sources: Map<string, RuleSource>;
  lastLoaded: Date;
  fileHashes: Map<string, string>;
}

export interface RuleLoadResult {
  success: boolean;
  rulesLoaded: number;
  testsLoaded: number;
  intentsLoaded: number;
  errors: string[];
  warnings: string[];
}
