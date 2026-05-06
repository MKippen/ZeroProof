import type { AdGuardConnection, NetworkClient } from '@prisma/client';
import { VulnerabilityFinding } from '../types';
import logger from '../utils/logger';
import {
  ADGUARD_PROVIDER,
  DnsProxyAuditInputs,
  NormalizedDnsProxyClient,
  getDnsProxyConfigAdapter,
} from '../services/dnsProxyConfig';

export interface DnsProxyClientAnalyzerInput {
  adguardConnection: AdGuardConnection | null;
  unifiClients: Pick<NetworkClient, 'mac' | 'displayName' | 'hostname' | 'lastIp'>[];
}

interface MatchResult {
  unifi: DnsProxyClientAnalyzerInput['unifiClients'][number];
  adguardClient?: NormalizedDnsProxyClient;
  matchedBy?: 'mac' | 'ip' | 'hostname';
}

const COVERAGE_GAP_RATIO = 0.5;

export async function analyzeDnsProxyClientCoverage(
  input: DnsProxyClientAnalyzerInput
): Promise<VulnerabilityFinding[]> {
  const { adguardConnection, unifiClients } = input;
  if (!adguardConnection || unifiClients.length === 0) return [];

  const adapter = getDnsProxyConfigAdapter(ADGUARD_PROVIDER);
  if (!adapter) {
    logger.warn('No DNS proxy config adapter registered for adguard_home — skipping client coverage audit.');
    return [];
  }

  let audit: DnsProxyAuditInputs;
  try {
    audit = await adapter.fetchAuditInputs(adguardConnection);
  } catch (err) {
    logger.warn(
      `DNS proxy client audit skipped — could not fetch AdGuard config: ${(err as Error).message}`
    );
    return [];
  }

  return evaluateClientCoverage({ unifiClients, audit });
}

export interface EvaluateInput {
  unifiClients: DnsProxyClientAnalyzerInput['unifiClients'];
  audit: DnsProxyAuditInputs;
}

export function evaluateClientCoverage(input: EvaluateInput): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const { unifiClients, audit } = input;
  const persistent = audit.persistentClients;

  if (persistent.length === 0) {
    findings.push({
      type: 'DNS_PROXY_NO_PERSISTENT_CLIENTS',
      severity: 'HIGH',
      title: 'DNS Proxy has no persistent clients defined',
      description:
        `Your DNS proxy has zero persistent client identities, but UniFi has ${unifiClients.length} client(s) on the network. ` +
        `Without persistent client definitions, every device receives the same global filtering policy — there is no way to apply per-device or per-VLAN DNS rules (kids' parental controls, IoT telemetry blocking, work-laptop tracker blocking).`,
      impact:
        'Per-device policy is impossible. Every device gets the same global filter, so the DNS proxy cannot honor per-VLAN intent (e.g., aggressive IoT blocking but lenient guest filtering). Most of the value of running a DNS proxy is unrealized.',
      remediation:
        `Open AdGuard Home → Settings → Client settings and add persistent clients for each device that needs distinct policy. Identify clients by MAC address or by ClientID (DHCP option 12) for stable identification across DHCP renewals — IP-based identification will break the moment leases rotate.`,
      affectedResource: 'DNS Proxy clients',
    });
    return findings;
  }

  const matches = matchClients(unifiClients, persistent);
  const matched = matches.filter((m) => m.adguardClient).length;
  const missing = matches.filter((m) => !m.adguardClient);
  const missingNames = missing
    .map((m) => m.unifi.displayName || m.unifi.hostname || m.unifi.mac)
    .filter(Boolean) as string[];
  const coverageRatio = matched / unifiClients.length;

  if (matched === 0) {
    findings.push({
      type: 'DNS_PROXY_NO_CLIENT_OVERLAP',
      severity: 'HIGH',
      title: 'DNS Proxy persistent clients do not match any UniFi device',
      description:
        `Your DNS proxy has ${persistent.length} persistent client identitie(s) defined, but none match any of the ${unifiClients.length} UniFi devices we know about (no shared MAC, IP, or hostname). ` +
        `Either the AdGuard client identifiers are stale, or AdGuard is sitting in a network position where it cannot see the real client IPs.`,
      impact:
        'Per-device policy in AdGuard is misaligned with the actual network. Whatever rules are configured per-client will not apply to the devices the operator believes they apply to.',
      remediation:
        `Reconcile AdGuard client identifiers against the UniFi device inventory. The most reliable identifier is the device MAC; the next is a ClientID set via DHCP option 12 in UniFi.`,
      affectedResource: 'DNS Proxy clients',
    });
  } else if (coverageRatio < COVERAGE_GAP_RATIO) {
    const previewLimit = 8;
    const previewList =
      missingNames.slice(0, previewLimit).join(', ') +
      (missingNames.length > previewLimit ? `, +${missingNames.length - previewLimit} more` : '');
    findings.push({
      type: 'DNS_PROXY_CLIENT_INVENTORY_GAP',
      severity: 'MEDIUM',
      title: `DNS Proxy is missing ${missing.length} of ${unifiClients.length} UniFi devices`,
      description:
        `Only ${matched} of your ${unifiClients.length} UniFi clients (${Math.round(coverageRatio * 100)}%) are defined as persistent clients in your DNS proxy. ` +
        `Devices not in the persistent client list fall back to the global default filter, which means per-device intent (parental controls, IoT-specific blocking, work-laptop policy) is not being applied. ` +
        `Missing: ${previewList}.`,
      impact:
        'Devices not represented in AdGuard are filtered against the global default policy, not their intended per-device or per-VLAN policy. Coverage gaps are how IoT telemetry leaks, parental controls miss kid devices, and work-machine tracker-blocking gets skipped.',
      remediation:
        `Add the missing devices in AdGuard Home → Settings → Client settings. Identify each by MAC address (preferred) or ClientID. Group them into AdGuard tags that match the VLAN they live on so per-tag filter assignment is straightforward.`,
      affectedResource: missingNames.length > 0 ? missingNames.join(', ') : 'DNS Proxy clients',
    });
  }

  const ipOnlyClients = persistent.filter(
    (c) => c.identifiers.length > 0 && c.identifiers.every((i) => i.kind === 'ip')
  );

  if (ipOnlyClients.length > 0) {
    const previewLimit = 8;
    const names = ipOnlyClients.map((c) => c.name);
    const preview =
      names.slice(0, previewLimit).join(', ') +
      (names.length > previewLimit ? `, +${names.length - previewLimit} more` : '');
    findings.push({
      type: 'DNS_PROXY_CLIENTS_IP_IDENTIFIED',
      severity: 'MEDIUM',
      title: `${ipOnlyClients.length} DNS Proxy client(s) identified by IP only`,
      description:
        `These persistent clients in your DNS proxy are identified solely by IP address: ${preview}. ` +
        `IP-based identification breaks the moment DHCP leases rotate, the device reconnects with a new lease, or the network is renumbered. The per-client policy attached to these entries will silently stop applying.`,
      impact:
        'Per-device DNS policy is fragile. A power cycle on the device, a DHCP lease expiry, or a router reboot can reassign the IP and the DNS proxy will start treating that device as anonymous traffic against the global default policy.',
      remediation:
        `Edit each affected client in AdGuard Home → Settings → Client settings and add either the device MAC address or a ClientID (DHCP option 12 set in UniFi → Client → Configure DHCP). MAC is the simplest durable identifier on a typical home network.`,
      affectedResource: names.join(', '),
    });
  }

  return findings;
}

function matchClients(
  unifi: DnsProxyClientAnalyzerInput['unifiClients'],
  adguard: NormalizedDnsProxyClient[]
): MatchResult[] {
  const macIndex = new Map<string, NormalizedDnsProxyClient>();
  const ipIndex = new Map<string, NormalizedDnsProxyClient>();
  const hostIndex = new Map<string, NormalizedDnsProxyClient>();

  for (const client of adguard) {
    for (const id of client.identifiers) {
      const value = id.value.toLowerCase();
      if (id.kind === 'mac') macIndex.set(value, client);
      else if (id.kind === 'ip') ipIndex.set(value, client);
      else if (id.kind === 'hostname') hostIndex.set(value, client);
    }
  }

  return unifi.map((u) => {
    const mac = (u.mac || '').toLowerCase();
    const ip = (u.lastIp || '').toLowerCase();
    const host = (u.hostname || '').toLowerCase();

    if (mac && macIndex.has(mac)) return { unifi: u, adguardClient: macIndex.get(mac), matchedBy: 'mac' };
    if (ip && ipIndex.has(ip)) return { unifi: u, adguardClient: ipIndex.get(ip), matchedBy: 'ip' };
    if (host && hostIndex.has(host)) return { unifi: u, adguardClient: hostIndex.get(host), matchedBy: 'hostname' };
    return { unifi: u };
  });
}
