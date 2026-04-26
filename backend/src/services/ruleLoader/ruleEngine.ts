/**
 * Rule Engine
 *
 * Evaluates declarative YAML-based security rules against UniFi configuration data.
 * Converts YAML conditions into executable checks.
 */

import {
  SecurityRuleDefinition,
  ConditionCheck,
  DetectionFilter,
  RuleCategory,
  Severity,
} from './types';
import { UniFiConfigData, NetworkData, RuleCheckResult } from '../../scanners/types';
import { logger } from '../../utils/logger';

// ============================================
// NETWORK TYPE HELPERS
// ============================================

function isIoTNetwork(network: NetworkData): boolean {
  const name = (network.name || '').toLowerCase();
  return (
    name.includes('iot') ||
    name.includes('smart') ||
    name.includes('device') ||
    (network as any).purpose === 'iot'
  );
}

function isGuestNetwork(network: NetworkData): boolean {
  const name = (network.name || '').toLowerCase();
  return name.includes('guest') || (network as any).purpose === 'guest';
}

function isSecurityNetwork(network: NetworkData): boolean {
  const name = (network.name || '').toLowerCase();
  return (
    name.includes('camera') ||
    name.includes('security') ||
    name.includes('nvr') ||
    name.includes('surveillance')
  );
}

function isWorkNetwork(network: NetworkData): boolean {
  const name = (network.name || '').toLowerCase();
  return (
    name.includes('work') ||
    name.includes('corporate') ||
    name.includes('office') ||
    name.includes('employee')
  );
}

function isManagementNetwork(network: NetworkData): boolean {
  const name = (network.name || '').toLowerCase();
  return (
    name.includes('management') ||
    name.includes('mgmt') ||
    (network as any).purpose === 'management'
  );
}

function isCorporateNetwork(network: NetworkData): boolean {
  return (
    (network as any).purpose === 'corporate' ||
    (network as any).purpose === 'lan' ||
    (!isIoTNetwork(network) &&
      !isGuestNetwork(network) &&
      !isSecurityNetwork(network) &&
      !isManagementNetwork(network) &&
      !isWorkNetwork(network))
  );
}

function getNetworkType(network: NetworkData): string {
  if (isIoTNetwork(network)) return 'iot';
  if (isGuestNetwork(network)) return 'guest';
  if (isSecurityNetwork(network)) return 'security';
  if (isWorkNetwork(network)) return 'work';
  if (isManagementNetwork(network)) return 'management';
  if (isCorporateNetwork(network)) return 'corporate';
  return 'unknown';
}

// ============================================
// CONDITION EVALUATION
// ============================================

/**
 * Get a nested field value from an object using dot notation
 */
function getFieldValue(obj: any, fieldPath: string): any {
  const parts = fieldPath.split('.');
  let value = obj;

  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    value = value[part];
  }

  return value;
}

/**
 * Evaluate a single condition check against an item
 */
function evaluateCondition(
  condition: ConditionCheck,
  item: any,
  config?: UniFiConfigData,
  context?: Record<string, unknown>
): boolean {
  // Handle logical operators
  if (condition.operator) {
    switch (condition.operator) {
      case 'AND':
        return condition.checks?.every(c => evaluateCondition(c, item, config, context)) ?? false;

      case 'OR':
        return condition.checks?.some(c => evaluateCondition(c, item, config, context)) ?? false;

      case 'NOT':
        return condition.check ? !evaluateCondition(condition.check, item, config, context) : false;

      default:
        return false;
    }
  }

  // Handle field-based conditions
  if (!condition.field || !condition.op) {
    return false;
  }

  const fieldValue = getFieldValue(item, condition.field);
  const compareValue = condition.value;

  switch (condition.op) {
    case 'equals':
      return fieldValue === compareValue;

    case 'not_equals':
      return fieldValue !== compareValue;

    case 'contains':
      if (typeof fieldValue === 'string') {
        return fieldValue.includes(String(compareValue));
      }
      if (Array.isArray(fieldValue)) {
        return fieldValue.includes(compareValue);
      }
      return false;

    case 'not_contains':
      if (typeof fieldValue === 'string') {
        return !fieldValue.includes(String(compareValue));
      }
      if (Array.isArray(fieldValue)) {
        return !fieldValue.includes(compareValue);
      }
      return true;

    case 'matches':
      if (typeof fieldValue !== 'string') return false;
      try {
        const regex = new RegExp(String(compareValue));
        return regex.test(fieldValue);
      } catch {
        return false;
      }

    case 'matches_i':
      if (typeof fieldValue !== 'string') return false;
      try {
        const regex = new RegExp(String(compareValue), 'i');
        return regex.test(fieldValue);
      } catch {
        return false;
      }

    case 'in':
      if (!Array.isArray(compareValue)) return false;
      return compareValue.includes(fieldValue);

    case 'not_in':
      if (!Array.isArray(compareValue)) return true;
      return !compareValue.includes(fieldValue);

    case 'gt':
      return typeof fieldValue === 'number' && fieldValue > Number(compareValue);

    case 'lt':
      return typeof fieldValue === 'number' && fieldValue < Number(compareValue);

    case 'gte':
      return typeof fieldValue === 'number' && fieldValue >= Number(compareValue);

    case 'lte':
      return typeof fieldValue === 'number' && fieldValue <= Number(compareValue);

    case 'empty':
      return fieldValue === null ||
        fieldValue === undefined ||
        fieldValue === '' ||
        (Array.isArray(fieldValue) && fieldValue.length === 0);

    case 'not_empty':
      return fieldValue !== null &&
        fieldValue !== undefined &&
        fieldValue !== '' &&
        !(Array.isArray(fieldValue) && fieldValue.length === 0);

    case 'empty_array':
      return !Array.isArray(fieldValue) || fieldValue.length === 0;

    case 'in_port_list': {
      if (!Array.isArray(compareValue)) return false;
      const port = parseInt(String(fieldValue), 10);
      return compareValue.includes(port);
    }

    case 'port_range_exceeds': {
      if (typeof fieldValue !== 'string') return false;
      if (!fieldValue.includes('-')) return false;
      const [start, end] = fieldValue.split('-').map(Number);
      return (end - start) > Number(compareValue);
    }

    case 'equals_ref': {
      if (!condition.ref_field) return false;
      const refValue = context ? getFieldValue(context, condition.ref_field) : undefined;
      return fieldValue === refValue;
    }

    default:
      logger.warn(`Unknown condition operator: ${condition.op}`);
      return false;
  }
}

/**
 * Apply filters to get target items from config
 */
function getTargetItems(target: string, config: UniFiConfigData, filter?: DetectionFilter): any[] {
  let items: any[] = [];
  const resolveNetworkName = (id?: string) => {
    if (!id) return '';
    return config.networks?.find(n => n._id === id)?.name || id;
  };

  switch (target) {
    case 'firewallRules':
      items = config.firewallRules || [];
      break;
    case 'networks':
      items = config.networks || [];
      break;
    case 'wlans':
      items = config.wlans || [];
      break;
    case 'portForwards':
      items = config.portForwards || [];
      break;
    case 'settings':
      items = config.settings ? [config.settings] : [];
      break;
    case 'firewallPolicies':
      items = config.firewallPolicies || [];
      break;
    case 'aclRules':
      items = (config.aclRules || []).map(rule => {
        let sourceDesc = 'Any';
        let destDesc = 'Any';

        if (rule.traffic_source?.ips_or_subnets?.length) {
          sourceDesc = rule.traffic_source.ips_or_subnets.join(', ');
        } else if (rule.traffic_source?.network_ids?.length) {
          sourceDesc = rule.traffic_source.network_ids.map(resolveNetworkName).join(', ');
        }

        if (rule.traffic_destination?.ips_or_subnets?.length) {
          destDesc = rule.traffic_destination.ips_or_subnets.join(', ');
        } else if (rule.traffic_destination?.network_ids?.length) {
          destDesc = rule.traffic_destination.network_ids.map(resolveNetworkName).join(', ');
        }

        return {
          ...rule,
          source_desc: sourceDesc,
          dest_desc: destDesc,
        };
      });
      break;
    case 'l3AclIsolation':
      items = (config.l3AclIsolation || []).map(entry => ({
        ...entry,
        source_network_name: resolveNetworkName(entry.source_network),
        destination_networks_names: (entry.destination_networks || []).map(resolveNetworkName).join(', '),
      }));
      break;
    case 'deviceIsolationNetworks':
      items = (config.deviceIsolationNetworks || []).map(id => ({
        networkId: id,
        network_name: resolveNetworkName(id),
      }));
      break;
    case 'clients':
      items = config.clients || [];
      break;
    case 'devices':
      items = config.devices || [];
      break;
    case 'vpnServers':
      items = config.vpnServers || [];
      break;
    case 'firewallZones':
      items = config.firewallZones || [];
      break;
    default:
      logger.warn(`Unknown target: ${target}`);
      return [];
  }

  // Apply filters
  if (filter) {
    items = items.filter(item => {
      for (const [key, value] of Object.entries(filter)) {
        // Special filter keys
        if (key === 'network_type') {
          if (target === 'networks') {
            const networkType = getNetworkType(item as NetworkData);
            if (typeof value === 'object' && value !== null && 'op' in value) {
              const filterCondition: ConditionCheck = {
                field: 'network_type',
                op: (value as any).op,
                value: (value as any).value,
              };
              if (!evaluateCondition(filterCondition, { network_type: networkType })) return false;
            } else if (networkType !== value) {
              return false;
            }
          }
          continue;
        }

        if (key === 'name_pattern') {
          const name = (item.name || '').toLowerCase();
          try {
            const regex = new RegExp(String(value), 'i');
            if (!regex.test(name)) return false;
          } catch {
            return false;
          }
          continue;
        }

        // Handle nested filter with op
        if (typeof value === 'object' && value !== null && 'op' in value) {
          const filterCondition: ConditionCheck = {
            field: key,
            op: (value as any).op,
            value: (value as any).value,
          };
          if (!evaluateCondition(filterCondition, item)) return false;
          continue;
        }

        // Simple equality filter
        if (item[key] !== value) return false;
      }
      return true;
    });
  }

  return items;
}

/**
 * Interpolate template strings with item values
 */
function interpolateTemplate(template: string, item: any, context?: any): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (item[key] !== undefined) return String(item[key]);
    if (context && context[key] !== undefined) return String(context[key]);
    return match;
  });
}

// ============================================
// RULE EXECUTION
// ============================================

export interface RuleExecutionResult {
  ruleId: string;
  ruleName: string;
  category: RuleCategory;
  severity: Severity;
  sourceId: string;
  findings: RuleCheckResult[];
}

/**
 * Execute a security rule against configuration data
 */
export function executeRule(
  rule: SecurityRuleDefinition,
  config: UniFiConfigData
): RuleExecutionResult {
  const result: RuleExecutionResult = {
    ruleId: rule.id,
    ruleName: rule.name,
    category: rule.category,
    severity: rule.severity,
    sourceId: rule.sourceId || 'unknown',
    findings: [],
  };

  try {
    const detection = rule.detection;

    // Handle aggregate rules
    if (detection.aggregate) {
      const aggregateResult = executeAggregateRule(rule, config);
      if (aggregateResult) {
        result.findings.push(aggregateResult);
      }
      return result;
    }

    // Handle report mode rules (informational)
    if (detection.report_mode === 'exists' || detection.report_mode === 'each') {
      const items = getTargetItems(detection.target, config, detection.filter);
      if (items.length > 0) {
        for (const item of items) {
          result.findings.push({
            found: true,
            affectedResource: interpolateTemplate(detection.output.affected_resource, item),
            details: interpolateTemplate(detection.output.details, item),
            currentValue: detection.output.current_value
              ? interpolateTemplate(detection.output.current_value, item)
              : undefined,
            expectedValue: detection.output.expected_value
              ? interpolateTemplate(detection.output.expected_value, item)
              : undefined,
          });
        }
      }
      return result;
    }

    // Standard rule: get target items and evaluate conditions
    const items = getTargetItems(detection.target, config, detection.filter);
    const ruleContext: Record<string, unknown> = {};

    if (detection.cross_reference?.type === 'find_corporate_network') {
      const corporateNetwork = config.networks.find(n => isCorporateNetwork(n) && n.dhcpd_dns_1);
      if (!corporateNetwork) {
        return result;
      }
      ruleContext.corporate_dns = corporateNetwork.dhcpd_dns_1;
      ruleContext.corporate_network_id = corporateNetwork._id;
      ruleContext.corporate_network_name = corporateNetwork.name;
    }

    if (detection.cross_reference?.type === 'l3_acl_coverage' && detection.target === 'networks') {
      const pattern = detection.cross_reference.check_blocks_to?.name_pattern;
      const trustedNetworks = config.networks.filter(n => {
        const name = (n.name || '').toLowerCase();
        const matchesPattern = pattern ? new RegExp(String(pattern), 'i').test(name) : false;
        return matchesPattern || n.purpose === 'corporate';
      });

      const l3AclBlocks = new Map<string, Set<string>>();
      for (const isolation of config.l3AclIsolation || []) {
        if (!l3AclBlocks.has(isolation.source_network)) {
          l3AclBlocks.set(isolation.source_network, new Set());
        }
        for (const dest of isolation.destination_networks || []) {
          l3AclBlocks.get(isolation.source_network)!.add(dest);
        }
      }

      for (const item of items) {
        const blockedDests = l3AclBlocks.get(item._id);
        const missing = trustedNetworks.filter(t => !blockedDests?.has(t._id));
        item.missing_l3_acl_blocks = missing.map(m => m.name);
        item.has_l3_acl_blocks = trustedNetworks.length === 0 ? true : missing.length === 0;
      }
    }

    for (const item of items) {
      // Check if condition matches (finding found)
      if (evaluateCondition(detection.condition, item, config, ruleContext)) {
        // Build context for port lookups, etc.
        const itemContext: Record<string, unknown> = { ...ruleContext };
        if (rule.sensitive_ports && item.dst_port) {
          itemContext.port_service = rule.sensitive_ports[item.dst_port] || 'Unknown';
        }
        if (item.dst_port && item.dst_port.includes('-')) {
          const [start, end] = item.dst_port.split('-').map(Number);
          itemContext.port_range_size = end - start + 1;
        }

        result.findings.push({
          found: true,
          affectedResource: interpolateTemplate(detection.output.affected_resource, item, itemContext),
          details: interpolateTemplate(detection.output.details, item, itemContext),
          currentValue: detection.output.current_value
            ? interpolateTemplate(detection.output.current_value, item, itemContext)
            : undefined,
          expectedValue: detection.output.expected_value
            ? interpolateTemplate(detection.output.expected_value, item, itemContext)
            : undefined,
        });
      }
    }

  } catch (error) {
    logger.error(`Error executing rule ${rule.id}`, { error });
  }

  return result;
}

/**
 * Execute an aggregate rule (count, exists, etc.)
 */
function executeAggregateRule(
  rule: SecurityRuleDefinition,
  config: UniFiConfigData
): RuleCheckResult | null {
  const detection = rule.detection;
  let items = getTargetItems(detection.target, config);

  // Apply aggregate filter
  if (detection.aggregate_filter) {
    if ('operator' in detection.aggregate_filter) {
      items = items.filter(item => evaluateCondition(detection.aggregate_filter as ConditionCheck, item, config));
    } else {
      // Simple filter object
      items = items.filter(item => {
        for (const [key, value] of Object.entries(detection.aggregate_filter!)) {
          if (typeof value === 'object' && value !== null && 'op' in value) {
            const condition: ConditionCheck = {
              field: key,
              op: (value as any).op,
              value: (value as any).value,
            };
            if (!evaluateCondition(condition, item)) return false;
          } else if (item[key] !== value) {
            return false;
          }
        }
        return true;
      });
    }
  }

  let aggregateResult: any;

  switch (detection.aggregate) {
    case 'count':
    case 'count_where':
      aggregateResult = items.length;
      break;
    case 'exists_where':
      aggregateResult = items.length > 0;
      break;
    default:
      return null;
  }

  // Check additional condition if present
  if (detection.additional_condition) {
    const additionalItems = getTargetItems(detection.additional_condition.target, config);
    let additionalResult: number;

    if (detection.additional_condition.aggregate === 'count') {
      additionalResult = additionalItems.length;
    } else {
      additionalResult = 0;
    }

    // Check if additional condition passes
    const op = detection.additional_condition.op;
    const value = detection.additional_condition.value;

    let passes = false;
    if (op === 'gt') passes = additionalResult > value;
    else if (op === 'lt') passes = additionalResult < value;
    else if (op === 'gte') passes = additionalResult >= value;
    else if (op === 'lte') passes = additionalResult <= value;
    else if (op === 'equals') passes = additionalResult === value;

    if (!passes) return null;
  }

  // Check condition on aggregate result
  const condition = detection.condition;
  let conditionMet = false;

  if (condition.op === 'equals') {
    conditionMet = aggregateResult === condition.value;
  } else if (condition.op === 'lt') {
    conditionMet = aggregateResult < Number(condition.value);
  } else if (condition.op === 'gt') {
    conditionMet = aggregateResult > Number(condition.value);
  }

  if (conditionMet) {
    const context = { aggregate_result: aggregateResult };
    return {
      found: true,
      affectedResource: interpolateTemplate(detection.output.affected_resource, {}, context),
      details: interpolateTemplate(detection.output.details, {}, context),
      currentValue: detection.output.current_value
        ? interpolateTemplate(detection.output.current_value, {}, context)
        : undefined,
      expectedValue: detection.output.expected_value
        ? interpolateTemplate(detection.output.expected_value, {}, context)
        : undefined,
    };
  }

  return null;
}

/**
 * Execute all loaded security rules against configuration
 */
export function executeAllRules(
  rules: SecurityRuleDefinition[],
  config: UniFiConfigData
): RuleExecutionResult[] {
  const results: RuleExecutionResult[] = [];

  for (const rule of rules) {
    const result = executeRule(rule, config);
    results.push(result);
  }

  return results;
}
