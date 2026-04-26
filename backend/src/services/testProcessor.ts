import prisma from './database';
import logger from '../utils/logger';
import { VulnerabilityFinding, Severity } from '../types';
import { analyzeTopologyResults } from './topologyTestGenerator';
import { asJsonObject } from './testRunResultsJson';
import {
  AUTO_ACK_FIREWALL_OPENING_NOTE,
  AUTO_DEDUP_NOTE,
  classifyTopologyBreachType,
  extractNetworkFindingEndpoint,
  extractNetworkFindingSource,
  isNetworkFindingType,
  NETWORK_FINDING_TYPES,
  shouldAutoAcknowledgeFinding,
} from './vulnerabilityDispositionService';

interface PortScanResult {
  ip: string;
  openPorts: Array<{
    port: number;
    protocol: string;
    service?: string;
    banner?: string;
  }>;
}

interface VlanTestResult {
  sourceVlan: number;
  targetVlan: number;
  canReach: boolean;
  testedPorts: number[];
}

interface ServiceDiscoveryResult {
  ip: string;
  port: number;
  service: string;
  version?: string;
  vulnerabilities?: string[];
}

export async function processTestResults(
  testRunId: string,
  results: unknown
): Promise<void> {
  try {
    const testRun = await prisma.testRun.findUnique({
      where: { id: testRunId },
      select: { testType: true, configId: true },
    });

    if (!testRun) {
      logger.error(`Test run ${testRunId} not found`);
      return;
    }

    const parsedResults = results as Record<string, unknown>;

    switch (testRun.testType) {
      case 'port_scan':
        await processPortScanResults(testRunId, testRun.configId, parsedResults);
        break;
      case 'vlan_isolation':
        await processVlanTestResults(testRunId, testRun.configId, parsedResults);
        break;
      case 'service_discovery':
        await processServiceDiscoveryResults(testRunId, testRun.configId, parsedResults);
        break;
      case 'topology_validation':
        await processTopologyValidationResults(testRunId, testRun.configId, parsedResults);
        break;
      case 'full_audit':
        // Full audit contains multiple test types
        if (parsedResults.portScan) {
          await processPortScanResults(testRunId, testRun.configId, parsedResults.portScan as Record<string, unknown>);
        }
        if (parsedResults.vlanTest) {
          await processVlanTestResults(testRunId, testRun.configId, parsedResults.vlanTest as Record<string, unknown>);
        }
        if (parsedResults.serviceDiscovery) {
          await processServiceDiscoveryResults(testRunId, testRun.configId, parsedResults.serviceDiscovery as Record<string, unknown>);
        }
        break;
    }
  } catch (error) {
    logger.error('Error processing test results:', error);
  }
}

async function processPortScanResults(
  testRunId: string,
  configId: string | null,
  results: Record<string, unknown>
): Promise<void> {
  const findings: VulnerabilityFinding[] = [];
  const hosts = (results.hosts || []) as PortScanResult[];

  for (const host of hosts) {
    // Store discovered services
    for (const port of host.openPorts) {
      await prisma.discoveredService.create({
        data: {
          testRunId,
          ipAddress: host.ip,
          port: port.port,
          protocol: port.protocol,
          serviceName: port.service,
          banner: port.banner,
        },
      });

      // Check for risky ports
      const riskyPorts: Record<number, { name: string; severity: Severity; reason: string }> = {
        21: { name: 'FTP', severity: 'HIGH', reason: 'FTP transmits credentials in plaintext' },
        23: { name: 'Telnet', severity: 'HIGH', reason: 'Telnet transmits data in plaintext' },
        445: { name: 'SMB', severity: 'MEDIUM', reason: 'SMB can be vulnerable to attacks' },
        3389: { name: 'RDP', severity: 'MEDIUM', reason: 'RDP should not be exposed' },
        5900: { name: 'VNC', severity: 'MEDIUM', reason: 'VNC may have weak authentication' },
        6379: { name: 'Redis', severity: 'HIGH', reason: 'Redis often lacks authentication' },
        27017: { name: 'MongoDB', severity: 'HIGH', reason: 'MongoDB may be unauthenticated' },
      };

      if (riskyPorts[port.port]) {
        const risk = riskyPorts[port.port];
        findings.push({
          type: 'RISKY_PORT_OPEN',
          severity: risk.severity,
          title: `${risk.name} service exposed on ${host.ip}:${port.port}`,
          description: `The ${risk.name} service was found running on port ${port.port}. ${risk.reason}.`,
          impact: 'This service could be exploited by attackers to gain unauthorized access.',
          remediation: `Consider disabling the ${risk.name} service or restricting access via firewall rules.`,
          affectedResource: `${host.ip}:${port.port}`,
        });
      }
    }
  }

  await createVulnerabilities(findings, testRunId, configId);
}

async function processVlanTestResults(
  testRunId: string,
  configId: string | null,
  results: Record<string, unknown>
): Promise<void> {
  const findings: VulnerabilityFinding[] = [];
  const tests = (results.tests || []) as VlanTestResult[];

  for (const test of tests) {
    if (test.canReach && test.sourceVlan !== test.targetVlan) {
      findings.push({
        type: 'VLAN_ISOLATION_FAILURE',
        severity: 'CRITICAL',
        title: `VLAN isolation breach: VLAN ${test.sourceVlan} can reach VLAN ${test.targetVlan}`,
        description: `Testing from VLAN ${test.sourceVlan} was able to reach devices on VLAN ${test.targetVlan}. This indicates that VLAN isolation is not properly configured.`,
        impact: 'Devices on different VLANs should be isolated. A breach allows lateral movement between network segments.',
        remediation: `Review firewall rules between VLAN ${test.sourceVlan} and VLAN ${test.targetVlan}. Ensure inter-VLAN routing is properly restricted.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Firewall\n2. Create a LAN IN rule to block traffic between these VLANs\n3. Ensure the rule is placed before any allow rules`,
        affectedResource: `VLAN ${test.sourceVlan} → VLAN ${test.targetVlan}`,
      });
    }
  }

  await createVulnerabilities(findings, testRunId, configId);
}

async function processServiceDiscoveryResults(
  testRunId: string,
  configId: string | null,
  results: Record<string, unknown>
): Promise<void> {
  const findings: VulnerabilityFinding[] = [];
  const services = (results.services || []) as ServiceDiscoveryResult[];

  for (const service of services) {
    // Store discovered service
    await prisma.discoveredService.create({
      data: {
        testRunId,
        ipAddress: service.ip,
        port: service.port,
        serviceName: service.service,
        version: service.version,
      },
    });

    // Check for known vulnerable versions
    if (service.version) {
      const vulnerableVersions: Record<string, { pattern: RegExp; severity: Severity; cve?: string }[]> = {
        ssh: [
          { pattern: /OpenSSH_[0-6]\./i, severity: 'HIGH', cve: 'Multiple CVEs' },
          { pattern: /OpenSSH_7\.[0-3]/i, severity: 'MEDIUM' },
        ],
        http: [
          { pattern: /Apache\/2\.2/i, severity: 'HIGH', cve: 'EOL software' },
          { pattern: /nginx\/1\.[0-9]\./i, severity: 'MEDIUM' },
        ],
      };

      const serviceVulns = vulnerableVersions[service.service.toLowerCase()];
      if (serviceVulns) {
        for (const vuln of serviceVulns) {
          if (vuln.pattern.test(service.version)) {
            findings.push({
              type: 'OUTDATED_SERVICE',
              severity: vuln.severity,
              title: `Outdated ${service.service} version on ${service.ip}:${service.port}`,
              description: `The ${service.service} service is running version ${service.version} which may contain known vulnerabilities.`,
              impact: 'Outdated software may contain security vulnerabilities that could be exploited.',
              remediation: `Update ${service.service} to the latest stable version.`,
              affectedResource: `${service.ip}:${service.port}`,
              cveId: vuln.cve,
            });
            break;
          }
        }
      }
    }
  }

  await createVulnerabilities(findings, testRunId, configId);
}

async function createVulnerabilities(
  findings: VulnerabilityFinding[],
  testRunId: string,
  configId: string | null
): Promise<void> {
  const findExistingVulnerability = async (finding: VulnerabilityFinding) => {
    if (isNetworkFindingType(finding.type)) {
      const endpoint = extractNetworkFindingEndpoint(finding.affectedResource);
      if (endpoint) {
        const findingSource = extractNetworkFindingSource(finding.title, finding.description);
        const candidates = await prisma.vulnerability.findMany({
          where: {
            ...(configId ? { configId } : {}),
            type: { in: [...NETWORK_FINDING_TYPES] },
            status: { in: ['OPEN', 'ACKNOWLEDGED'] },
            affectedResource: { contains: endpoint },
          },
          orderBy: [{ lastSeen: 'desc' }, { firstSeen: 'desc' }],
        });

        if (candidates.length > 0) {
          const exactSource = findingSource
            ? candidates.find((candidate) => {
                const source = extractNetworkFindingSource(candidate.title, candidate.description);
                return source === findingSource;
              })
            : null;

          if (exactSource) return exactSource;

          const unknownSource = candidates.find((candidate) => {
            const source = extractNetworkFindingSource(candidate.title, candidate.description);
            return !source;
          });
          if (unknownSource) return unknownSource;

          return candidates[0];
        }
      }
    }

    return prisma.vulnerability.findFirst({
      where: {
        ...(configId ? { configId } : {}),
        type: finding.type,
        affectedResource: finding.affectedResource,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
      orderBy: [{ lastSeen: 'desc' }, { firstSeen: 'desc' }],
    });
  };

  const collapseDuplicateNetworkFindings = async (
    keeperId: string,
    finding: VulnerabilityFinding
  ) => {
    if (!isNetworkFindingType(finding.type)) return;

    const endpoint = extractNetworkFindingEndpoint(finding.affectedResource);
    if (!endpoint) return;

    const findingSource = extractNetworkFindingSource(finding.title, finding.description);
    const duplicates = await prisma.vulnerability.findMany({
      where: {
        ...(configId ? { configId } : {}),
        type: { in: [...NETWORK_FINDING_TYPES] },
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        affectedResource: { contains: endpoint },
      },
      orderBy: [{ lastSeen: 'desc' }, { firstSeen: 'desc' }],
    });

    for (const duplicate of duplicates) {
      if (duplicate.id === keeperId) continue;

      const duplicateSource = extractNetworkFindingSource(duplicate.title, duplicate.description);
      const sourceMatches =
        !findingSource ||
        !duplicateSource ||
        duplicateSource === findingSource;
      if (!sourceMatches) continue;

      const nextNotes =
        !duplicate.notes || duplicate.notes === AUTO_DEDUP_NOTE
          ? AUTO_DEDUP_NOTE
          : duplicate.notes;

      await prisma.vulnerability.update({
        where: { id: duplicate.id },
        data: {
          status: 'ACKNOWLEDGED',
          notes: nextNotes,
        },
      });
    }
  };

  for (const finding of findings) {
    const autoAcknowledge = shouldAutoAcknowledgeFinding(finding);

    // Check for existing similar vulnerability (canonicalized for network findings).
    const existing = await findExistingVulnerability(finding);

    if (existing) {
      // Refresh finding details on repeat hits so severity/title/policy context stay current.
      const statusWasAutoAck =
        existing.status === 'ACKNOWLEDGED' &&
        existing.notes === AUTO_ACK_FIREWALL_OPENING_NOTE;
      const nextStatus = autoAcknowledge
        ? 'ACKNOWLEDGED'
        : statusWasAutoAck
          ? 'OPEN'
          : existing.status;

      let nextNotes: string | null | undefined;
      if (autoAcknowledge) {
        if (!existing.notes || existing.notes === AUTO_ACK_FIREWALL_OPENING_NOTE) {
          nextNotes = AUTO_ACK_FIREWALL_OPENING_NOTE;
        }
      } else if (existing.notes === AUTO_ACK_FIREWALL_OPENING_NOTE) {
        nextNotes = null;
      }

      await prisma.vulnerability.update({
        where: { id: existing.id },
        data: {
          lastSeen: new Date(),
          testRunId,
          configId,
          status: nextStatus,
          severity: finding.severity,
          title: finding.title,
          description: finding.description,
          impact: finding.impact,
          remediation: finding.remediation,
          cveId: finding.cveId,
          ...(nextNotes !== undefined && { notes: nextNotes }),
        },
      });

      await collapseDuplicateNetworkFindings(existing.id, finding);
    } else {
      // Create new vulnerability
      const created = await prisma.vulnerability.create({
        data: {
          testRunId,
          configId,
          type: finding.type,
          severity: finding.severity,
          title: finding.title,
          description: finding.description,
          impact: finding.impact,
          remediation: finding.remediation,
          affectedResource: finding.affectedResource,
          cveId: finding.cveId,
          status: autoAcknowledge ? 'ACKNOWLEDGED' : 'OPEN',
          ...(autoAcknowledge && { notes: AUTO_ACK_FIREWALL_OPENING_NOTE }),
        },
      });

      await collapseDuplicateNetworkFindings(created.id, finding);
    }
  }

  if (findings.length > 0) {
    logger.info(`Created ${findings.length} vulnerability findings for test ${testRunId}`);
  }
}

async function processTopologyValidationResults(
  testRunId: string,
  configId: string | null,
  results: Record<string, unknown>
): Promise<void> {
  // Get the stored metadata from the test run
  const testRun = await prisma.testRun.findUnique({
    where: { id: testRunId },
    select: { resultsJson: true },
  });

  const storedResults = asJsonObject(testRun?.resultsJson);
  const nestedTopologyMetadata = asJsonObject(asJsonObject(storedResults.metadata).topologyMetadata);
  const metadata =
    Object.keys(nestedTopologyMetadata).length > 0
      ? nestedTopologyMetadata
      : asJsonObject(storedResults.topologyMetadata);

  // The results array contains command execution results
  const commandResults = ((results.commandResults || results.results) || []) as any[];

  // Analyze results for isolation violations
  const analysisResults = analyzeTopologyResults(commandResults, metadata);

  // Convert to vulnerability findings
  const findings: VulnerabilityFinding[] = analysisResults
    .filter(r => r.type === 'isolation_breach')
    .map(r => ({
      type: classifyTopologyBreachType(r.title),
      severity: r.severity,
      title: r.title,
      description: r.description,
      impact: r.impact,
      remediation: r.remediation,
      affectedResource: r.affectedResource,
    }));

  await createVulnerabilities(findings, testRunId, configId);

  // Log summary
  const breaches = analysisResults.filter(r => r.type === 'isolation_breach').length;
  const verified = analysisResults.filter(r => r.type === 'isolation_verified').length;
  logger.info(`Topology validation: ${breaches} isolation breaches found, ${verified} rules verified`);
}
