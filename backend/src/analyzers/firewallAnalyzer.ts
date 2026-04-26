import { UniFiConfig, UniFiFirewallRule, VulnerabilityFinding, Severity } from '../types';

export function analyzeFirewallRules(config: UniFiConfig): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const rules = config.firewallRules || [];

  // Check for allow-all rules
  for (const rule of rules) {
    if (!rule.enabled) continue;

    // Check for overly permissive rules
    if (isOverlyPermissive(rule)) {
      findings.push({
        type: 'OVERLY_PERMISSIVE_RULE',
        severity: 'HIGH',
        title: `Overly permissive firewall rule: ${rule.name}`,
        description: `The firewall rule "${rule.name}" allows all traffic without restrictions. This could allow unauthorized access.`,
        impact: 'Attackers could exploit this rule to access resources that should be protected.',
        remediation: `Review the rule "${rule.name}" and restrict it to specific ports, protocols, or addresses.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Firewall\n2. Edit the rule "${rule.name}"\n3. Specify source and destination networks\n4. Limit to required ports only`,
        affectedResource: rule.name,
      });
    }

    // Check for dangerous port exposures
    const dangerousPorts = checkDangerousPorts(rule);
    findings.push(...dangerousPorts);

    // Check for rule conflicts
    const conflicts = findRuleConflicts(rule, rules);
    findings.push(...conflicts);
  }

  // Check for missing essential rules
  const missingRules = checkMissingRules(rules);
  findings.push(...missingRules);

  // Check for disabled security rules
  const disabledRules = checkDisabledSecurityRules(rules);
  findings.push(...disabledRules);

  return findings;
}

function isOverlyPermissive(rule: UniFiFirewallRule): boolean {
  if (rule.action !== 'accept') return false;

  const hasNoSrcRestriction =
    !rule.src_address &&
    (!rule.src_firewallgroup_ids || rule.src_firewallgroup_ids.length === 0);
  const hasNoDstRestriction =
    !rule.dst_address &&
    (!rule.dst_firewallgroup_ids || rule.dst_firewallgroup_ids.length === 0);
  const hasNoPortRestriction = !rule.dst_port && !rule.src_port;
  const hasNoProtocolRestriction = rule.protocol === 'all';

  return (
    hasNoSrcRestriction &&
    hasNoDstRestriction &&
    hasNoPortRestriction &&
    hasNoProtocolRestriction
  );
}

function checkDangerousPorts(rule: UniFiFirewallRule): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];

  if (rule.action !== 'accept' || !rule.enabled) return findings;

  const dangerousPorts: Record<string, { severity: Severity; description: string }> = {
    '22': { severity: 'MEDIUM', description: 'SSH should be restricted to trusted IPs' },
    '23': { severity: 'HIGH', description: 'Telnet is insecure and should be disabled' },
    '3389': { severity: 'HIGH', description: 'RDP should not be exposed to the internet' },
    '5900': { severity: 'MEDIUM', description: 'VNC should be restricted' },
    '1433': { severity: 'HIGH', description: 'MSSQL should not be exposed' },
    '3306': { severity: 'HIGH', description: 'MySQL should not be exposed' },
    '5432': { severity: 'HIGH', description: 'PostgreSQL should not be exposed' },
    '27017': { severity: 'HIGH', description: 'MongoDB should not be exposed' },
    '6379': { severity: 'HIGH', description: 'Redis should not be exposed' },
  };

  const dstPort = rule.dst_port;
  if (!dstPort) return findings;

  const ports = dstPort.split(',');
  for (const port of ports) {
    const trimmedPort = port.trim();
    if (dangerousPorts[trimmedPort] && rule.ruleset?.includes('WAN')) {
      const info = dangerousPorts[trimmedPort];
      findings.push({
        type: 'DANGEROUS_PORT_EXPOSED',
        severity: info.severity,
        title: `Port ${trimmedPort} exposed via rule "${rule.name}"`,
        description: `${info.description}. This port is being allowed through the WAN firewall.`,
        impact: 'Exposed services can be targeted by attackers scanning the internet.',
        remediation: `Review if port ${trimmedPort} really needs to be exposed. Consider using a VPN instead.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Firewall\n2. Find and edit rule "${rule.name}"\n3. Remove port ${trimmedPort} or restrict source IPs`,
        affectedResource: `${rule.name} (port ${trimmedPort})`,
      });
    }
  }

  return findings;
}

function findRuleConflicts(
  rule: UniFiFirewallRule,
  allRules: UniFiFirewallRule[]
): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];

  // Find rules that might conflict
  for (const otherRule of allRules) {
    if (rule._id === otherRule._id) continue;
    if (!otherRule.enabled) continue;
    if (rule.ruleset !== otherRule.ruleset) continue;

    // Check for shadowed rules (higher index rule that never matches)
    if (rule.rule_index < otherRule.rule_index) {
      if (rulesShadow(rule, otherRule)) {
        findings.push({
          type: 'SHADOWED_RULE',
          severity: 'LOW',
          title: `Rule "${otherRule.name}" is shadowed by "${rule.name}"`,
          description: `The rule "${otherRule.name}" will never match because "${rule.name}" has a higher priority and covers the same traffic.`,
          impact: 'Shadowed rules have no effect and may indicate a misconfiguration.',
          remediation: `Review rules "${rule.name}" and "${otherRule.name}". Either remove the shadowed rule or adjust rule priorities.`,
          affectedResource: otherRule.name,
        });
      }
    }

    // Check for conflicting actions
    if (rule.action !== otherRule.action && rulesOverlap(rule, otherRule)) {
      findings.push({
        type: 'CONFLICTING_RULES',
        severity: 'MEDIUM',
        title: `Rules "${rule.name}" and "${otherRule.name}" may conflict`,
        description: `These rules have opposite actions (${rule.action} vs ${otherRule.action}) but may match similar traffic. The rule with lower index takes precedence.`,
        impact: 'Conflicting rules can lead to unexpected traffic being allowed or blocked.',
        remediation: `Review these rules to ensure the intended behavior. Consider consolidating or reordering them.`,
        affectedResource: `${rule.name} / ${otherRule.name}`,
      });
    }
  }

  return findings;
}

function rulesShadow(higherPriority: UniFiFirewallRule, lowerPriority: UniFiFirewallRule): boolean {
  // Simplified check - in reality this needs more sophisticated logic
  if (higherPriority.protocol !== 'all' && higherPriority.protocol !== lowerPriority.protocol) {
    return false;
  }
  if (higherPriority.dst_port && lowerPriority.dst_port) {
    if (higherPriority.dst_port !== lowerPriority.dst_port) return false;
  }
  return true;
}

function rulesOverlap(rule1: UniFiFirewallRule, rule2: UniFiFirewallRule): boolean {
  // Simplified overlap check
  if (rule1.protocol !== 'all' && rule2.protocol !== 'all' && rule1.protocol !== rule2.protocol) {
    return false;
  }
  return true;
}

function checkMissingRules(rules: UniFiFirewallRule[]): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];

  // Check for RFC1918 blocking on WAN
  const hasRfc1918Block = rules.some(
    (r) =>
      r.enabled &&
      r.action === 'drop' &&
      r.ruleset?.includes('WAN') &&
      (r.name?.toLowerCase().includes('rfc1918') ||
        r.name?.toLowerCase().includes('private') ||
        r.src_address?.includes('10.0.0.0') ||
        r.src_address?.includes('192.168.') ||
        r.src_address?.includes('172.16.'))
  );

  if (!hasRfc1918Block) {
    findings.push({
      type: 'MISSING_RFC1918_BLOCK',
      severity: 'MEDIUM',
      title: 'No RFC1918 block on WAN interface',
      description:
        'Private IP addresses (RFC1918) from the WAN should be blocked to prevent IP spoofing attacks.',
      impact: 'Attackers could spoof internal IP addresses to bypass security controls.',
      remediation: `Create a firewall rule to drop traffic from private IP ranges on the WAN interface.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Firewall\n2. Create a new WAN IN rule\n3. Action: Drop\n4. Source: Create groups for 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16\n5. Place at top of rules`,
      affectedResource: 'WAN Firewall',
    });
  }

  return findings;
}

function checkDisabledSecurityRules(rules: UniFiFirewallRule[]): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];

  const securityKeywords = ['block', 'drop', 'deny', 'reject', 'security', 'isolat'];

  for (const rule of rules) {
    if (rule.enabled) continue;

    const nameMatch = securityKeywords.some((kw) => rule.name?.toLowerCase().includes(kw));
    const isDropRule = rule.action === 'drop' || rule.action === 'reject';

    if (nameMatch || isDropRule) {
      findings.push({
        type: 'DISABLED_SECURITY_RULE',
        severity: 'MEDIUM',
        title: `Security rule "${rule.name}" is disabled`,
        description: `The firewall rule "${rule.name}" appears to be a security rule but is currently disabled.`,
        impact: 'Traffic that should be blocked may be allowed through.',
        remediation: `Review whether this rule should be enabled.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Firewall\n2. Find rule "${rule.name}"\n3. Enable if appropriate`,
        affectedResource: rule.name,
      });
    }
  }

  return findings;
}
