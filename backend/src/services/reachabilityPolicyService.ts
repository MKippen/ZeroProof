import { NetworkIntentProfile, IntentNetworkCategory, ReachabilityOverride } from '../types';
import { analyzeTopology } from './topologyAnalyzer';

export type ReachabilityExpected = 'allow' | 'block' | 'unknown';
export type ReachabilityVerdict = 'pass' | 'fail' | 'unknown' | 'conflict';

export interface PolicyNetworkInfo {
  id: string;
  name: string;
  purpose?: string;
}

export interface ReachabilityPolicyDecision {
  sourceNetworkId: string;
  targetNetworkId: string;
  sourceCategory: IntentNetworkCategory;
  targetCategory: IntentNetworkCategory;
  expected: ReachabilityExpected;
  intentExpected: ReachabilityExpected;
  effectiveExpected: ReachabilityExpected;
  conflict: boolean;
  confidence: number;
  reason: string;
  intentReason: string;
  effectiveReason: string;
  effectiveExplicit: boolean;
  policySource: 'intent' | 'effective' | 'hybrid' | 'conflict';
}

export interface ReachabilityPolicyEvaluator {
  evaluate(sourceNetworkId: string, targetNetworkId: string): ReachabilityPolicyDecision;
  getCategory(networkId: string): IntentNetworkCategory;
}

function normalizeCategory(value: string): IntentNetworkCategory {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'iot') return 'iot';
  if (normalized === 'work') return 'work';
  if (normalized === 'guest') return 'guest';
  if (normalized === 'trusted') return 'trusted';
  if (normalized === 'nas') return 'nas';
  if (normalized === 'server') return 'server';
  if (normalized === 'home') return 'home';
  return 'default';
}

function inferCategoryFromName(networkName: string): IntentNetworkCategory {
  const lower = networkName.trim().toLowerCase();
  if (lower.includes('iot')) return 'iot';
  if (lower.includes('guest')) return 'guest';
  if (lower.includes('work')) return 'work';
  if (lower.includes('trusted')) return 'trusted';
  if (lower.includes('home')) return 'home';
  if (lower.includes('nas')) return 'nas';
  if (lower.includes('server')) return 'server';
  if (lower === 'default') return 'default';
  return 'default';
}

function buildCategoryMap(
  networks: PolicyNetworkInfo[],
  profile: NetworkIntentProfile | null | undefined
): Map<string, IntentNetworkCategory> {
  const categoryByNetworkId = new Map<string, IntentNetworkCategory>();
  const mappings = profile?.networkMappings;

  for (const network of networks) {
    if (!network.id) continue;
    if (mappings?.workNetworkId === network.id) categoryByNetworkId.set(network.id, 'work');
    else if (mappings?.iotNetworkId === network.id) categoryByNetworkId.set(network.id, 'iot');
    else if (mappings?.guestNetworkId === network.id) categoryByNetworkId.set(network.id, 'guest');
    else if (mappings?.trustedNetworkId === network.id) categoryByNetworkId.set(network.id, 'trusted');
    else if (mappings?.nasNetworkId === network.id) categoryByNetworkId.set(network.id, 'nas');
    else if (mappings?.serverNetworkId === network.id) categoryByNetworkId.set(network.id, 'server');
    else categoryByNetworkId.set(network.id, inferCategoryFromName(network.name));
  }

  return categoryByNetworkId;
}

function computeIntentExpectation(
  sourceCategory: IntentNetworkCategory,
  targetCategory: IntentNetworkCategory,
  profile: NetworkIntentProfile | null | undefined
): { expected: ReachabilityExpected; reason: string } {
  if (!profile) {
    return { expected: 'unknown', reason: 'No intent profile configured.' };
  }

  const overrides = (profile.reachabilityOverrides || []) as ReachabilityOverride[];
  const matchedOverride = overrides.find(
    (override) =>
      normalizeCategory(override.sourceCategory) === sourceCategory &&
      normalizeCategory(override.targetCategory) === targetCategory
  );
  if (matchedOverride) {
    return {
      expected: matchedOverride.action,
      reason: matchedOverride.reason || 'Matched explicit policy override.',
    };
  }

  if (sourceCategory === targetCategory) {
    return { expected: 'allow', reason: 'Same network category path.' };
  }

  let expected: ReachabilityExpected = profile.interVlanDefault === 'deny' ? 'block' : 'allow';
  let reason = profile.interVlanDefault === 'deny'
    ? 'Inter-VLAN default policy is deny.'
    : 'Inter-VLAN default policy is allow.';

  const involvesIoT = sourceCategory === 'iot' || targetCategory === 'iot';
  if (profile.hasIoT && profile.iotIsolation && involvesIoT) {
    expected = 'block';
    reason = 'IoT isolation requires blocking traffic to/from IoT.';
  }

  const involvesGuest = sourceCategory === 'guest' || targetCategory === 'guest';
  if (profile.guestNetwork && profile.guestIsolation && involvesGuest) {
    expected = 'block';
    reason = 'Guest isolation requires blocking traffic to/from Guest.';
  }

  const involvesWork = sourceCategory === 'work' || targetCategory === 'work';
  if (profile.workFromHome && profile.workDeviceIsolation && involvesWork) {
    const workMode = profile.workIsolationMode || 'phased';
    if (workMode === 'strict') {
      expected = 'block';
      reason = 'WORK strict mode blocks Work to/from all non-Work categories.';
    } else {
      const otherCategory = sourceCategory === 'work' ? targetCategory : sourceCategory;
      if (otherCategory === 'iot' || otherCategory === 'guest') {
        expected = 'block';
        reason = 'WORK phased mode blocks Work to/from IoT and Guest.';
      } else if (
        otherCategory === 'trusted' ||
        otherCategory === 'home' ||
        otherCategory === 'nas' ||
        otherCategory === 'server' ||
        otherCategory === 'default'
      ) {
        expected = 'allow';
        reason = 'WORK phased mode allows Work to/from Trusted, NAS, and Server paths.';
      }
    }
  }

  if (targetCategory === 'nas') {
    if (profile.nasAccessibleFrom === 'all') {
      expected = 'allow';
      reason = 'NAS access policy allows all networks.';
    } else if (profile.nasAccessibleFrom === 'trusted') {
      expected = sourceCategory === 'trusted' || sourceCategory === 'home' ? 'allow' : 'block';
      reason = expected === 'allow'
        ? 'NAS policy allows trusted/home network access.'
        : 'NAS policy limits access to trusted/home networks.';
    } else {
      expected = 'unknown';
      reason = 'NAS policy is specific_vlans and requires explicit override mappings.';
    }
  }

  return { expected, reason };
}

interface EffectiveReachabilityEvidence {
  expected: ReachabilityExpected;
  reason: string;
  explicit: boolean;
}

function toDecision(
  sourceNetworkId: string,
  targetNetworkId: string,
  sourceCategory: IntentNetworkCategory,
  targetCategory: IntentNetworkCategory,
  intentDecision: { expected: ReachabilityExpected; reason: string },
  effectiveEvidence?: EffectiveReachabilityEvidence
): ReachabilityPolicyDecision {
  const intentExpected = intentDecision.expected;
  const effectiveExpected = effectiveEvidence?.expected || 'unknown';
  const effectiveReason = effectiveEvidence?.reason || 'No inferred effective policy evidence.';
  const effectiveExplicit = effectiveEvidence?.explicit || false;

  if (intentExpected !== 'unknown' && effectiveExpected !== 'unknown' && intentExpected !== effectiveExpected) {
    return {
      sourceNetworkId,
      targetNetworkId,
      sourceCategory,
      targetCategory,
      expected: intentExpected,
      intentExpected,
      effectiveExpected,
      conflict: true,
      confidence: 0.45,
      reason: `Intent expects ${intentExpected} (${intentDecision.reason}), but inferred UniFi behavior is ${effectiveExpected} (${effectiveReason}).`,
      intentReason: intentDecision.reason,
      effectiveReason,
      effectiveExplicit,
      policySource: 'conflict',
    };
  }

  if (intentExpected !== 'unknown' && effectiveExpected !== 'unknown') {
    return {
      sourceNetworkId,
      targetNetworkId,
      sourceCategory,
      targetCategory,
      expected: intentExpected,
      intentExpected,
      effectiveExpected,
      conflict: false,
      confidence: 0.95,
      reason: `${intentDecision.reason} Effective UniFi behavior agrees: ${effectiveReason}`,
      intentReason: intentDecision.reason,
      effectiveReason,
      effectiveExplicit,
      policySource: 'hybrid',
    };
  }

  if (intentExpected !== 'unknown') {
    return {
      sourceNetworkId,
      targetNetworkId,
      sourceCategory,
      targetCategory,
      expected: intentExpected,
      intentExpected,
      effectiveExpected,
      conflict: false,
      confidence: 0.72,
      reason: intentDecision.reason,
      intentReason: intentDecision.reason,
      effectiveReason,
      effectiveExplicit,
      policySource: 'intent',
    };
  }

  if (effectiveExpected !== 'unknown') {
    return {
      sourceNetworkId,
      targetNetworkId,
      sourceCategory,
      targetCategory,
      expected: effectiveExpected,
      intentExpected,
      effectiveExpected,
      conflict: false,
      confidence: 0.7,
      reason: `Derived from inferred UniFi effective policy: ${effectiveReason}`,
      intentReason: intentDecision.reason,
      effectiveReason,
      effectiveExplicit,
      policySource: 'effective',
    };
  }

  return {
    sourceNetworkId,
    targetNetworkId,
    sourceCategory,
    targetCategory,
    expected: 'unknown',
    intentExpected,
    effectiveExpected,
    conflict: false,
    confidence: 0.2,
    reason: 'No intent or effective policy evidence for this path.',
    intentReason: intentDecision.reason,
    effectiveReason,
    effectiveExplicit,
    policySource: 'hybrid',
  };
}

function buildEffectiveReachabilityMap(
  configJson: Record<string, unknown> | null | undefined,
  profile: NetworkIntentProfile | null | undefined
): Map<string, EffectiveReachabilityEvidence> {
  const map = new Map<string, EffectiveReachabilityEvidence>();
  if (!configJson) return map;

  const topology = analyzeTopology(configJson, profile || null);

  const describeRule = (connection: { rules?: Array<{ name?: string; action?: string; ruleset?: string; ruleIndex?: number }> }): {
    description: string;
    explicit: boolean;
  } => {
    const firstRule = connection.rules?.[0];
    if (!firstRule) {
      return { description: '', explicit: false };
    }
    const ruleName = firstRule.name || 'Unnamed UniFi rule';
    const ruleset = firstRule.ruleset ? ` (${firstRule.ruleset}` : '';
    const ruleIndex = typeof firstRule.ruleIndex === 'number' ? ` #${firstRule.ruleIndex}` : '';
    const suffix = ruleset ? `${ruleset}${ruleIndex})` : ruleIndex ? ` (${ruleIndex.trim()})` : '';
    return {
      description: `${ruleName}${suffix}`.trim(),
      explicit: true,
    };
  };

  for (const connection of topology.connections) {
    if (connection.dstId === 'WAN' || connection.srcId === 'WAN') continue;

    const ruleInfo = describeRule(connection);
    let evidence: EffectiveReachabilityEvidence;

    if (connection.allowed) {
      if (ruleInfo.explicit) {
        evidence = {
          expected: 'allow',
          reason: `Allowed by UniFi policy/rule ${ruleInfo.description}.`,
          explicit: true,
        };
      } else if (connection.allowedByDefault) {
        evidence = {
          expected: 'allow',
          reason: 'No matching deny/isolation rule found; path is effectively allowed by default.',
          explicit: false,
        };
      } else {
        evidence = {
          expected: 'allow',
          reason: 'Path is effectively allowed based on inferred UniFi behavior.',
          explicit: false,
        };
      }
    } else {
      if (connection.blockedByIsolation) {
        const source = connection.isolationSource ? ` on ${connection.isolationSource}` : '';
        evidence = {
          expected: 'block',
          reason: `Blocked by UniFi network isolation${source}.`,
          explicit: true,
        };
      } else if (ruleInfo.explicit) {
        evidence = {
          expected: 'block',
          reason: `Blocked by UniFi policy/rule ${ruleInfo.description}.`,
          explicit: true,
        };
      } else {
        evidence = {
          expected: 'block',
          reason: 'Path is effectively blocked based on inferred UniFi behavior.',
          explicit: false,
        };
      }
    }

    map.set(
      `${connection.srcId}:${connection.dstId}`,
      evidence
    );
  }

  return map;
}

export function createReachabilityPolicyEvaluator(params: {
  configJson?: Record<string, unknown> | null;
  intentProfile?: NetworkIntentProfile | null;
  networks: PolicyNetworkInfo[];
}): ReachabilityPolicyEvaluator {
  const profile = params.intentProfile || null;
  const categoryMap = buildCategoryMap(params.networks, profile);
  const effectiveMap = buildEffectiveReachabilityMap(params.configJson || null, profile);

  return {
    getCategory(networkId: string): IntentNetworkCategory {
      return categoryMap.get(networkId) || 'default';
    },

    evaluate(sourceNetworkId: string, targetNetworkId: string): ReachabilityPolicyDecision {
      const sourceCategory = categoryMap.get(sourceNetworkId) || 'default';
      const targetCategory = categoryMap.get(targetNetworkId) || 'default';
      const intentDecision = computeIntentExpectation(sourceCategory, targetCategory, profile);
      const effectiveEvidence = effectiveMap.get(`${sourceNetworkId}:${targetNetworkId}`);
      return toDecision(
        sourceNetworkId,
        targetNetworkId,
        sourceCategory,
        targetCategory,
        intentDecision,
        effectiveEvidence
      );
    },
  };
}
