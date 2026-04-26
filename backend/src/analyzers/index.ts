import prisma from '../services/database';
import logger from '../utils/logger';
import { UniFiConfig, VulnerabilityFinding } from '../types';
import { analyzeFirewallRules } from './firewallAnalyzer';
import { analyzeVlanConfig } from './vlanAnalyzer';
import { analyzePortForwards } from './portForwardAnalyzer';
import { analyzeWlanConfig } from './wlanAnalyzer';

export async function analyzeConfiguration(
  config: UniFiConfig,
  configId: string
): Promise<VulnerabilityFinding[]> {
  const allFindings: VulnerabilityFinding[] = [];

  try {
    // Run all analyzers
    const firewallFindings = analyzeFirewallRules(config);
    const vlanFindings = analyzeVlanConfig(config);
    const portForwardFindings = analyzePortForwards(config);
    const wlanFindings = analyzeWlanConfig(config);

    allFindings.push(
      ...firewallFindings,
      ...vlanFindings,
      ...portForwardFindings,
      ...wlanFindings
    );

    // Delete existing vulnerabilities for this config to prevent duplicates
    await prisma.vulnerability.deleteMany({
      where: { configId },
    });

    // Store findings in database
    for (const finding of allFindings) {
      await prisma.vulnerability.create({
        data: {
          configId,
          type: finding.type,
          severity: finding.severity,
          title: finding.title,
          description: finding.description,
          impact: finding.impact,
          remediation: finding.remediation,
          affectedResource: finding.affectedResource,
          cveId: finding.cveId,
        },
      });
    }

    logger.info(`Configuration analysis found ${allFindings.length} issues`);
  } catch (error) {
    logger.error('Configuration analysis error:', error);
  }

  return allFindings;
}

export { analyzeFirewallRules, analyzeVlanConfig, analyzePortForwards, analyzeWlanConfig };
export { analyzeAgainstIntent } from './intentAnalyzer';
