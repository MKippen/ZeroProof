import prisma from '../services/database';
import type { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { UniFiConfig, VulnerabilityFinding, NetworkIntentProfile } from '../types';
import { analyzeFirewallRules } from './firewallAnalyzer';
import { analyzeVlanConfig } from './vlanAnalyzer';
import { analyzePortForwards } from './portForwardAnalyzer';
import { analyzeWlanConfig } from './wlanAnalyzer';
import { analyzeDnsProxyHygiene } from './dnsProxyAnalyzer';
import { analyzeDnsProxyClientCoverage } from './dnsProxyClientAnalyzer';
import { analyzeFirmwareAdvisories } from './firmwareAdvisoryAnalyzer';

export async function collectConfigurationFindings(
  config: UniFiConfig
): Promise<VulnerabilityFinding[]> {
  const allFindings: VulnerabilityFinding[] = [];

  // Run all analyzers
  const firewallFindings = analyzeFirewallRules(config);
  const vlanFindings = analyzeVlanConfig(config);
  const portForwardFindings = analyzePortForwards(config);
  const wlanFindings = analyzeWlanConfig(config);
  const firmwareAdvisoryFindings = analyzeFirmwareAdvisories(config);

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
    ...firmwareAdvisoryFindings,
    ...dnsProxyFindings,
    ...dnsProxyClientFindings
  );

  return allFindings;
}

/** Store already-collected findings; no external calls or disposition resets. */
export async function persistConfigurationFindings(
  configId: string,
  findings: VulnerabilityFinding[],
  db: Pick<Prisma.TransactionClient, 'vulnerability'> = prisma
): Promise<void> {
  for (let offset = 0; offset < findings.length; offset += 500) {
    await db.vulnerability.createMany({
      data: findings.slice(offset, offset + 500).map((finding) => ({
        configId, type: finding.type, severity: finding.severity,
        title: finding.title, description: finding.description, impact: finding.impact,
        remediation: finding.remediation, affectedResource: finding.affectedResource, cveId: finding.cveId,
      })),
    });
  }
}

/** Compatibility entry point for uploaded configuration analysis. */
export async function analyzeConfiguration(config: UniFiConfig, configId: string): Promise<VulnerabilityFinding[]> {
  let findings: VulnerabilityFinding[] = [];
  try {
    findings = await collectConfigurationFindings(config);
    await prisma.vulnerability.deleteMany({ where: { configId } });
    await persistConfigurationFindings(configId, findings);
    logger.info(`Configuration analysis found ${findings.length} issues`);
  } catch (error) {
    logger.error('Configuration analysis error:', error);
  }
  return findings;
}

export { analyzeFirewallRules, analyzeVlanConfig, analyzePortForwards, analyzeWlanConfig };
export { analyzeFirmwareAdvisories } from './firmwareAdvisoryAnalyzer';
export { analyzeAgainstIntent } from './intentAnalyzer';
