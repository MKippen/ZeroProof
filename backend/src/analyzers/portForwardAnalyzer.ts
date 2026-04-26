import { UniFiConfig, VulnerabilityFinding, Severity } from '../types';

export function analyzePortForwards(config: UniFiConfig): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const portForwards = config.portForwards || [];

  const riskyPorts: Record<
    string,
    { severity: Severity; service: string; recommendation: string }
  > = {
    '21': {
      severity: 'HIGH',
      service: 'FTP',
      recommendation: 'Use SFTP or SCP instead of FTP',
    },
    '22': {
      severity: 'MEDIUM',
      service: 'SSH',
      recommendation: 'Use a VPN or restrict to specific IPs',
    },
    '23': {
      severity: 'CRITICAL',
      service: 'Telnet',
      recommendation: 'Never expose Telnet - use SSH instead',
    },
    '25': {
      severity: 'MEDIUM',
      service: 'SMTP',
      recommendation: 'Use a proper mail relay or hosting service',
    },
    '110': {
      severity: 'HIGH',
      service: 'POP3',
      recommendation: 'Use POP3S (port 995) instead',
    },
    '143': {
      severity: 'HIGH',
      service: 'IMAP',
      recommendation: 'Use IMAPS (port 993) instead',
    },
    '445': {
      severity: 'CRITICAL',
      service: 'SMB',
      recommendation: 'Never expose SMB to the internet',
    },
    '1433': {
      severity: 'CRITICAL',
      service: 'MSSQL',
      recommendation: 'Use a VPN for database access',
    },
    '3306': {
      severity: 'CRITICAL',
      service: 'MySQL',
      recommendation: 'Use a VPN for database access',
    },
    '3389': {
      severity: 'HIGH',
      service: 'RDP',
      recommendation: 'Use a VPN instead of exposing RDP directly',
    },
    '5432': {
      severity: 'CRITICAL',
      service: 'PostgreSQL',
      recommendation: 'Use a VPN for database access',
    },
    '5900': {
      severity: 'HIGH',
      service: 'VNC',
      recommendation: 'Use a VPN instead of exposing VNC directly',
    },
    '6379': {
      severity: 'CRITICAL',
      service: 'Redis',
      recommendation: 'Never expose Redis to the internet',
    },
    '27017': {
      severity: 'CRITICAL',
      service: 'MongoDB',
      recommendation: 'Never expose MongoDB to the internet',
    },
  };

  for (const pf of portForwards) {
    if (!pf.enabled) continue;

    const dstPort = pf.dst_port;
    const fwdPort = pf.fwd_port;

    // Check for risky port forwards
    const portToCheck = dstPort || fwdPort;
    if (portToCheck && riskyPorts[portToCheck]) {
      const risk = riskyPorts[portToCheck];
      findings.push({
        type: 'RISKY_PORT_FORWARD',
        severity: risk.severity,
        title: `${risk.service} (port ${portToCheck}) is forwarded to the internet`,
        description: `The port forward "${pf.name}" exposes ${risk.service} to the internet. ${risk.recommendation}.`,
        impact: `${risk.service} is a common target for attackers. Exposing it directly to the internet significantly increases your attack surface.`,
        remediation: `${risk.recommendation}.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Port Forwarding\n2. Disable or remove "${pf.name}"\n3. Set up a VPN for remote access instead`,
        affectedResource: `${pf.name} (${pf.fwd}:${fwdPort})`,
      });
    }

    // Check for port forwards with no source restriction
    if (!pf.src || pf.src === 'any') {
      findings.push({
        type: 'UNRESTRICTED_PORT_FORWARD',
        severity: 'MEDIUM',
        title: `Port forward "${pf.name}" allows any source IP`,
        description: `The port forward allows connections from any IP address. Consider restricting to known IPs if possible.`,
        impact: 'Anyone on the internet can attempt to connect to the forwarded service.',
        remediation: `If you know which IPs need access, restrict the port forward to those IPs only.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Port Forwarding\n2. Edit "${pf.name}"\n3. Set a specific source IP or range`,
        affectedResource: pf.name,
      });
    }

    // Check for non-standard port mappings (potential security through obscurity)
    if (dstPort !== fwdPort) {
      findings.push({
        type: 'PORT_MAPPING_MISMATCH',
        severity: 'INFO',
        title: `Port forward "${pf.name}" uses non-standard mapping`,
        description: `External port ${dstPort} forwards to internal port ${fwdPort}. This provides minimal security benefit.`,
        impact: 'Port scanners will still discover the service regardless of the external port used.',
        remediation: 'Security through obscurity is not effective. Focus on securing the service itself.',
        affectedResource: pf.name,
      });
    }

    // Check for logging disabled on port forwards
    if (!pf.log) {
      findings.push({
        type: 'PORT_FORWARD_NO_LOGGING',
        severity: 'LOW',
        title: `Logging disabled on port forward "${pf.name}"`,
        description: 'Connection attempts to this port forward are not being logged.',
        impact: 'You will not have visibility into who is connecting to this service.',
        remediation: `Enable logging for this port forward.\n\nIn UniFi:\n1. Go to Settings > Routing & Firewall > Port Forwarding\n2. Edit "${pf.name}"\n3. Enable logging`,
        affectedResource: pf.name,
      });
    }
  }

  // Check for too many port forwards
  const enabledForwards = portForwards.filter((pf) => pf.enabled);
  if (enabledForwards.length > 10) {
    findings.push({
      type: 'EXCESSIVE_PORT_FORWARDS',
      severity: 'MEDIUM',
      title: `${enabledForwards.length} active port forwards detected`,
      description:
        'A large number of port forwards increases your attack surface. Review if all are necessary.',
      impact: 'Each port forward is a potential entry point for attackers.',
      remediation:
        'Review all port forwards and disable any that are no longer needed. Consider using a VPN for services that only you need to access.',
      affectedResource: 'Port Forward Configuration',
    });
  }

  return findings;
}
