import type { AdGuardConnection } from '@prisma/client';
import { UniFiConfig, UniFiFirewallRule, NetworkIntentProfile, VulnerabilityFinding } from '../types';
import { getRawNetworks } from '../utils/configNormalizer';

export interface DnsProxyAnalyzerInput {
  config: UniFiConfig;
  intent: NetworkIntentProfile | null;
  adguardConnection: Pick<AdGuardConnection, 'host'> | null;
}

export function analyzeDnsProxyHygiene(input: DnsProxyAnalyzerInput): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const { config, intent, adguardConnection } = input;

  const intentIp = intent?.dnsFilteringServerIp?.trim() || '';
  const proxyIp = adguardConnection?.host?.trim() || '';
  const expectedFilterIp = intentIp || proxyIp;

  if (!expectedFilterIp) return findings;

  if (intentIp && proxyIp && intentIp !== proxyIp) {
    findings.push({
      type: 'DNS_PROXY_INTENT_MISMATCH',
      severity: 'MEDIUM',
      title: 'DNS Proxy host differs from declared filter intent',
      description:
        `Your security wizard declares ${intentIp} as the DNS filtering server, but the connected DNS Proxy points at ${proxyIp}. ` +
        `Attribution and signal correlation will use the connected proxy while intent compliance is scored against the declared IP, producing false negatives in both directions.`,
      impact:
        'Operators will see green DNS Proxy status but the intent analyzer will flag networks as misconfigured (or vice versa). Campaign DNS evidence may not align with the network you think you are protecting.',
      remediation:
        `Reconcile the two values:\n` +
        `1. Open Settings → Wizard and update "DNS Filtering Server IP" to ${proxyIp}, OR\n` +
        `2. Open Settings → DNS Proxy and change the host to ${intentIp}.\n\n` +
        `Whichever IP is the real AdGuard Home should win.`,
      affectedResource: 'DNS Proxy configuration',
    });
  }

  if (!intent?.dnsFiltering) return findings;

  const declaredNetworkIds = new Set(
    (intent.dnsFilteringNetworks || []).map((id) => String(id).trim()).filter(Boolean)
  );
  if (declaredNetworkIds.size === 0) return findings;

  const protectedNetworks = getRawNetworks(config)
    .map((n: any) => ({
      id: String(n._id || n.id || n.network_id || '').trim(),
      name: n.name || n.network_name || 'Unknown',
      purpose: n.purpose || n.network_purpose || 'corporate',
    }))
    .filter((n) => declaredNetworkIds.has(n.id) && n.purpose !== 'wan');

  if (protectedNetworks.length === 0) return findings;

  const rules = config.firewallRules || [];
  const hasDnsBlock = rules.some(
    (rule) => rule.enabled !== false && (rule.action === 'drop' || rule.action === 'reject') && ruleBlocksDnsPorts(rule)
  );

  if (!hasDnsBlock) {
    const protectedNames = protectedNetworks.map((n) => n.name).join(', ');
    findings.push({
      type: 'DNS_BYPASS_NOT_BLOCKED',
      severity: 'HIGH',
      title: 'External DNS is not blocked — filter can be bypassed',
      description:
        `Networks you declared as filtered (${protectedNames}) point at ${expectedFilterIp} for DNS, but no firewall rule blocks outbound DNS to other servers. ` +
        `Devices can ignore the configured DNS server simply by hardcoding a public resolver like 1.1.1.1, 8.8.8.8, or any DNS-over-TLS endpoint.`,
      impact:
        'The DNS filter becomes optional in practice. Malware, misconfigured IoT devices, and privacy-aware browsers can use external DNS, DoT, or DoH to evade detection. Campaign DNS evidence will miss any client that bypasses, and the "blocked queries" count understates the real attack surface.',
      remediation:
        `Add a firewall rule to enforce the filter:\n` +
        `1. Source: the filtered networks (${protectedNames})\n` +
        `2. Destination: any IP except ${expectedFilterIp}\n` +
        `3. Protocol: TCP/UDP, destination port 53 (DNS) and TCP destination port 853 (DoT)\n` +
        `4. Action: Drop (place above any allow-all rules)\n\n` +
        `For DoH (DNS-over-HTTPS) bypass, add traffic rules in Settings → Routing & Firewall → Traffic Rules blocking known DoH endpoints: dns.google, mozilla.cloudflare-dns.com, chrome.cloudflare-dns.com, dns.quad9.net.`,
      affectedResource: protectedNames,
    });
  }

  return findings;
}

function ruleBlocksDnsPorts(rule: UniFiFirewallRule): boolean {
  if (!rule.dst_port) return false;
  const portStr = String(rule.dst_port).trim();
  if (!portStr) return false;

  const tokens = portStr.split(',').map((t) => t.trim()).filter(Boolean);
  for (const token of tokens) {
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const lo = parseInt(range[1], 10);
      const hi = parseInt(range[2], 10);
      if ((lo <= 53 && hi >= 53) || (lo <= 853 && hi >= 853)) return true;
    } else if (/^\d+$/.test(token)) {
      const port = parseInt(token, 10);
      if (port === 53 || port === 853) return true;
    }
  }
  return false;
}
