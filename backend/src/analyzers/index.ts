import prisma from '../services/database';
import logger from '../utils/logger';
import { UniFiConfig, VulnerabilityFinding, NetworkIntentProfile } from '../types';
import { analyzeFirewallRules } from './firewallAnalyzer';
import { analyzeVlanConfig } from './vlanAnalyzer';
import { analyzePortForwards } from './portForwardAnalyzer';
import { analyzeWlanConfig } from './wlanAnalyzer';
import { analyzeDnsProxyHygiene } from './dnsProxyAnalyzer';
import { analyzeDnsProxyClientCoverage } from './dnsProxyClientAnalyzer';

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

    // Load intent profile + DNS proxy connection for hygiene checks
    const [intentSetting, adguardConnection] = await Promise.all([
      prisma.setting.findUnique({ where: { key: 'network_intent_profile' } }),
      prisma.adGuardConnection.findFirst({ where: { isActive: true } }),
    ]);
    const intent = (intentSetting?.value as unknown as NetworkIntentProfile | null) || null;

    const dnsProxyFindings = analyzeDnsProxyHygiene({
      config,
      intent,
      adguardConnection,
    });

    let dnsProxyClientFindings: VulnerabilityFinding[] = [];
    if (adguardConnection) {
      const unifiClients = await prisma.networkClient.findMany({
        select: { mac: true, displayName: true, hostname: true, lastIp: true },
      });
      dnsProxyClientFindings = await analyzeDnsProxyClientCoverage({
        adguardConnection,
        unifiClients,
      });
    }

    allFindings.push(
      ...firewallFindings,
      ...vlanFindings,
      ...portForwardFindings,
      ...wlanFindings,
      ...dnsProxyFindings,
      ...dnsProxyClientFindings
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
