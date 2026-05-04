import { CampaignVerdict, Prisma, Severity } from '@prisma/client';
import prisma from '../database';
import { normalizeConfig } from '../../scanners';
import { decrypt } from '../../utils/encryption';
import { UniFiAlarm, UniFiClient, UniFiEvent } from '../unifiClient';
import { extractHoneypots } from '../honeypotService';
import { Command } from '../testDefinitions';
import { CampaignOptions, ValidationCommandBatch } from './types';
import { residentialProxyDefaultOptions } from './registry';
import {
  classifyDnsSignal,
  getActiveDnsProxyConnection,
  getDnsEvidenceForClients,
  getNetworkLevelDnsSignals,
  isCampaignRelevantDnsReason,
} from '../dnsProxyService';

const SUSPICIOUS_DEVICE_PATTERNS = [
  /android\s*tv/i,
  /\baosp\b/i,
  /\btv\s*box\b/i,
  /\bdigital\s*frame\b/i,
  /\bphoto\s*frame\b/i,
  /\bgoogle\s*tv\b/i,
  /\bfire\s*tv\b/i,
  /\bchromecast\b/i,
  /\bonn\b/i,
  /\bmi\s*box\b/i,
  /\bxiaomi\b/i,
  /\bamlogic\b/i,
  /\brockchip\b/i,
  /\ballwinner\b/i,
  /\bh96\b/i,
  /\bx96\b/i,
  /\bt95\b/i,
  /\btanix\b/i,
  /\bhk1\b/i,
  /\bunknown\b/i,
];

const TELEMETRY_PATTERNS = [
  { label: 'kimwolf', pattern: /kimwolf/i },
  { label: 'aisuru', pattern: /aisuru/i },
  { label: 'residential-proxy', pattern: /residential\s*proxy/i },
  { label: 'proxy-sdk', pattern: /\b(byteconnect|ipidea|plainproxies)\b/i },
  { label: 'kimwolf-domain-xd-resi', pattern: /\bxd(?:\.|\[\.\])resi(?:\.|\[\.\])to\b/i },
  { label: 'kimwolf-domain-xd-mob', pattern: /\bxd(?:\.|\[\.\])mob(?:\.|\[\.\])to\b/i },
  { label: 'byteconnect-endpoint', pattern: /\bnew-endpoints(?:\.|\[\.\])byteconnect(?:\.|\[\.\])io\b/i },
  { label: 'ipidea-api', pattern: /\bipinfo(?:\.|\[\.\])ipidea(?:\.|\[\.\])io\b/i },
  { label: 'adb', pattern: /\badb\b/i },
  { label: 'android-debug', pattern: /android\s*debug/i },
  { label: 'adb-tcp', pattern: /\badb\s*(?:tcp|connect|shell)\b/i },
  { label: 'socks-proxy', pattern: /\bsocks(?:4|5)?\b/i },
  { label: 'proxy-listener', pattern: /\bproxy\s*(?:listener|service|port)\b/i },
  { label: 'android-tv', pattern: /android\s*tv/i },
  { label: 'tv-box', pattern: /\btv\s*box\b/i },
  { label: 'digital-frame', pattern: /\bdigital\s*(?:photo\s*)?frame\b/i },
  { label: 'port-12108', pattern: /\b12108\b/ },
  { label: 'port-3222', pattern: /\b3222\b/ },
  { label: 'port-5858', pattern: /\b5858\b/ },
  { label: 'port-40860', pattern: /\b40860\b/ },
  { label: 'port-5555', pattern: /\b5555\b/ },
  { label: 'port-socks-1080', pattern: /\b1080\b/ },
  { label: 'port-http-proxy-3128', pattern: /\b3128\b/ },
  { label: 'port-http-proxy-8080', pattern: /\b8080\b/ },
  { label: 'port-routeros-8291', pattern: /\b8291\b/ },
];

const PROTECTIVE_DNS = new Set([
  '1.1.1.2',
  '1.0.0.2',
  '1.1.1.3',
  '1.0.0.3',
  '9.9.9.9',
  '149.112.112.112',
  '94.140.14.14',
  '94.140.15.15',
  '76.76.2.0',
  '76.76.10.0',
  '8.26.56.26',
  '8.20.247.20',
]);

const HIGH_CONFIDENCE_DNS_SEVERITIES = new Set<Severity>(['CRITICAL', 'HIGH']);

export interface ResidentialCandidateDevice {
  mac: string;
  ip?: string;
  name: string;
  hostname?: string;
  networkId?: string;
  networkName?: string;
  oui?: string;
  reasonCodes: string[];
  confidence: number;
}

export interface ResidentialTelemetrySnippet {
  source: 'event' | 'alarm';
  id?: string;
  key?: string;
  datetime?: string;
  matchedTerms: string[];
  subject: string;
}

export interface ResidentialDnsProxyMatch {
  source: 'device' | 'network';
  attribution: 'device' | 'network';
  queriedAt: string;
  clientIp?: string | null;
  clientName?: string | null;
  domain: string;
  queryType?: string | null;
  status?: string | null;
  reason?: string | null;
  rule?: string | null;
  upstream?: string | null;
  blocked: boolean;
  suspicious: boolean;
  signalType?: string;
  severity?: Severity;
  title?: string;
}

export interface ResidentialDnsProxyEvidence {
  configured: boolean;
  queryLogEnabled?: boolean | null;
  anonymizedClientIp?: boolean | null;
  attributionStatus: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  attributionReason: string;
  deviceLevelQueryCount: number;
  networkLevelSignalCount: number;
  matches: ResidentialDnsProxyMatch[];
  indicators: string[];
}

export interface ResidentialEvidence {
  collectedAt: string;
  configId?: string;
  siteName?: string | null;
  dataSources: {
    activeConfig: boolean;
    unifiConnection: boolean;
    eventsChecked: number;
    alarmsChecked: number;
    validationRunners: Array<{ id: string; deviceId: string; name: string; status: string; ipAddress?: string | null }>;
  };
  candidateDevices: ResidentialCandidateDevice[];
  riskyNetworkPosture: {
    targetNetworks: Array<{ id: string; name: string; vlan?: number | null; subnet?: string | null }>;
    weakSegmentation: boolean;
    indicators: string[];
  };
  dnsPosture: {
    protectiveDnsLikely: boolean | null;
    indicators: string[];
  };
  dnsProxyEvidence: ResidentialDnsProxyEvidence;
  idsHoneypotStatus: {
    idsIpsEnabled: boolean | null;
    honeypotEnabled: boolean | null;
    honeypotCount: number;
    indicators: string[];
  };
  portForwards: Array<{
    id?: string;
    name: string;
    externalPort?: string;
    internalPort?: string;
    targetIp?: string;
    protocol?: string;
    matchedPorts: number[];
  }>;
  upnpNatPmp: {
    upnpEnabled: boolean | null;
    natPmpEnabled: boolean | null;
    indicators: string[];
  };
  telemetryMatches: {
    snippets: ResidentialTelemetrySnippet[];
    eventMatchCount: number;
    alarmMatchCount: number;
  };
  validation?: ResidentialValidationEvidence;
}

export interface ResidentialValidationEvidence {
  runner?: { id: string; deviceId: string; name: string; ipAddress?: string | null };
  testRunIds: string[];
  scannedHosts: number;
  scannedPorts: number;
  openPorts: Array<{
    host: string;
    port: number;
    service: string;
    candidateName?: string;
    candidateMac?: string;
  }>;
  cleanHosts: string[];
  failedTestRuns: string[];
}

export interface ResidentialFinding {
  resourceKey: string;
  type: string;
  severity: Severity;
  title: string;
  description: string;
  impact: string;
  remediation: string;
  affectedResource: string;
  confidence: number;
  evidence: string[];
}

export interface ResidentialEvaluationSummary {
  verdict: CampaignVerdict;
  score: number;
  confidence: number;
  highSignals: string[];
  mediumSignals: string[];
  lowSignals: string[];
  findings: ResidentialFinding[];
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

export function mergeResidentialOptions(raw?: Partial<CampaignOptions> | null): CampaignOptions {
  return {
    ...residentialProxyDefaultOptions,
    ...(raw || {}),
    targetNetworkKeywords:
      raw?.targetNetworkKeywords?.filter(Boolean) || residentialProxyDefaultOptions.targetNetworkKeywords,
    validationPorts:
      raw?.validationPorts?.filter((port) => Number.isInteger(port) && port > 0 && port <= 65535) ||
      residentialProxyDefaultOptions.validationPorts,
    manualClientMacs: raw?.manualClientMacs?.map((mac) => mac.toLowerCase()) || [],
    lookbackHours: raw?.lookbackHours || residentialProxyDefaultOptions.lookbackHours,
    validationTimeoutMs: raw?.validationTimeoutMs || residentialProxyDefaultOptions.validationTimeoutMs,
    cleanupCompleted: raw?.cleanupCompleted || [],
  };
}

function portSpecMatches(spec: unknown, targetPorts: number[]): number[] {
  const text = String(spec || '');
  if (!text.trim()) return [];

  const ranges = text.split(',').map((token) => token.trim()).filter(Boolean);
  const matches: number[] = [];

  for (const range of ranges) {
    const [startRaw, endRaw] = range.split('-', 2);
    const start = Number(startRaw);
    const end = endRaw === undefined ? start : Number(endRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;

    for (const port of targetPorts) {
      if (port >= start && port <= end) {
        matches.push(port);
      }
    }
  }

  return uniq(matches).sort((a, b) => a - b);
}

function displayName(client: any): string {
  return client.name || client.hostname || client.display_name || client.mac || 'Unknown client';
}

function getMac(client: any): string {
  return String(client.mac || client._id || '').toLowerCase();
}

function detectCandidateDevices(
  clients: any[],
  networksById: Map<string, any>,
  targetNetworkIds: Set<string>,
  options: CampaignOptions
): ResidentialCandidateDevice[] {
  const candidates: ResidentialCandidateDevice[] = [];
  const manualMacs = new Set(options.manualClientMacs.map((mac) => mac.toLowerCase()));

  for (const client of clients) {
    const mac = getMac(client);
    if (!mac) continue;

    const name = displayName(client);
    const haystack = [name, client.hostname, client.oui, client.fingerprint, client.os_name, client.vendor]
      .filter(Boolean)
      .join(' ');
    const networkId = client.network_id || client.networkId || client.lastNetworkId || client.usergroup_id;
    const network = networkId ? networksById.get(networkId) : undefined;
    const reasonCodes: string[] = [];

    if (manualMacs.has(mac)) reasonCodes.push('manual-selection');
    if (!networkId || !network) reasonCodes.push('unknown-network');
    if (networkId && targetNetworkIds.has(networkId)) reasonCodes.push('target-network');
    if (SUSPICIOUS_DEVICE_PATTERNS.some((pattern) => pattern.test(haystack))) {
      reasonCodes.push('suspicious-device-fingerprint');
    }

    if (reasonCodes.length === 0) continue;

    const confidence =
      0.25 +
      (reasonCodes.includes('suspicious-device-fingerprint') ? 0.35 : 0) +
      (reasonCodes.includes('target-network') ? 0.15 : 0) +
      (reasonCodes.includes('manual-selection') ? 0.2 : 0) +
      (reasonCodes.includes('unknown-network') ? 0.1 : 0);

    candidates.push({
      mac,
      ip: client.ip || client.lastIp || client.fixed_ip,
      name,
      hostname: client.hostname,
      networkId,
      networkName: network?.name,
      oui: client.oui,
      reasonCodes: uniq(reasonCodes),
      confidence: Math.min(0.95, Number(confidence.toFixed(2))),
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

function matchedTelemetryTerms(record: Record<string, any>): string[] {
  const subject = [
    record.key,
    record.msg,
    record.hostname,
    record.user,
    record.ip,
    record.ap_name,
    record.sw_name,
    record.gw_name,
  ]
    .filter(Boolean)
    .join(' ');

  const terms: string[] = [];
  for (const { label, pattern } of TELEMETRY_PATTERNS) {
    if (pattern.test(subject)) {
      terms.push(label);
    }
  }
  return uniq(terms);
}

function sanitizeTelemetryRecord(
  source: 'event' | 'alarm',
  record: UniFiEvent | UniFiAlarm
): ResidentialTelemetrySnippet | null {
  const matchedTerms = matchedTelemetryTerms(record);
  if (matchedTerms.length === 0) return null;

  return {
    source,
    id: record._id,
    key: record.key,
    datetime: record.datetime,
    matchedTerms,
    subject: String(record.msg || record.key || 'Matched UniFi telemetry').slice(0, 220),
  };
}

async function collectTelemetrySnippets(options: CampaignOptions): Promise<{
  snippets: ResidentialTelemetrySnippet[];
  eventsChecked: number;
  alarmsChecked: number;
  unifiConnection: boolean;
}> {
  const connection = await prisma.uniFiConnection.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!connection) {
    return { snippets: [], eventsChecked: 0, alarmsChecked: 0, unifiConnection: false };
  }

  try {
    const client = new UniFiClient({
      host: connection.host,
      port: connection.port,
      username: decrypt(connection.usernameEnc),
      password: decrypt(connection.passwordEnc),
      siteId: connection.siteId,
    });
    await client.login();

    const [events, alarms] = await Promise.all([client.getEvents(500), client.getAlarms(500)]);
    const since = Date.now() - options.lookbackHours * 60 * 60 * 1000;

    const recentEvents = events.filter((event) => !event.time || event.time >= since);
    const recentAlarms = alarms.filter((alarm) => !alarm.time || alarm.time >= since);
    const snippets = [
      ...recentEvents.map((event) => sanitizeTelemetryRecord('event', event)),
      ...recentAlarms.map((alarm) => sanitizeTelemetryRecord('alarm', alarm)),
    ].filter((snippet): snippet is ResidentialTelemetrySnippet => Boolean(snippet));

    return {
      snippets: snippets.slice(0, 25),
      eventsChecked: recentEvents.length,
      alarmsChecked: recentAlarms.length,
      unifiConnection: true,
    };
  } catch {
    return { snippets: [], eventsChecked: 0, alarmsChecked: 0, unifiConnection: true };
  }
}

function getSettingsArray(configJson: any): any[] {
  const raw = configJson.settings || configJson.setting || [];
  if (Array.isArray(raw)) return raw;
  return [raw];
}

function readSettingBoolean(configJson: any, keys: string[]): boolean | null {
  for (const setting of getSettingsArray(configJson)) {
    for (const key of keys) {
      if (typeof setting?.[key] === 'boolean') return setting[key];
    }
  }
  for (const key of keys) {
    if (typeof configJson?.[key] === 'boolean') return configJson[key];
  }
  return null;
}

function emptyDnsProxyEvidence(reason = 'DNS Proxy is not configured.'): ResidentialDnsProxyEvidence {
  return {
    configured: false,
    attributionStatus: 'UNKNOWN',
    attributionReason: reason,
    deviceLevelQueryCount: 0,
    networkLevelSignalCount: 0,
    matches: [],
    indicators: [reason],
  };
}

async function collectDnsProxyEvidence(
  candidates: ResidentialCandidateDevice[],
  options: CampaignOptions
): Promise<ResidentialDnsProxyEvidence> {
  const connection = await getActiveDnsProxyConnection();
  if (!connection) return emptyDnsProxyEvidence();

  const since = new Date(Date.now() - options.lookbackHours * 60 * 60 * 1000);
  const canUseDeviceLevel =
    connection.attributionStatus === 'HEALTHY' &&
    connection.anonymizeClientIp !== true;
  const candidateIps = candidates.map((candidate) => candidate.ip).filter((ip): ip is string => Boolean(ip));

  const [deviceQueries, networkSignals] = await Promise.all([
    canUseDeviceLevel
      ? getDnsEvidenceForClients({ clientIps: candidateIps, since, limit: 50 })
      : Promise.resolve([]),
    canUseDeviceLevel
      ? Promise.resolve([])
      : getNetworkLevelDnsSignals({ since, limit: 50 }),
  ]);

  const deviceMatches: ResidentialDnsProxyMatch[] = deviceQueries.map((query) => {
    const signal = classifyDnsSignal(query.domain, query.reason || undefined, query.rule || undefined);
    return {
      source: 'device',
      attribution: 'device',
      queriedAt: query.queriedAt.toISOString(),
      clientIp: query.clientIp,
      clientName: query.clientName,
      domain: query.domain,
      queryType: query.queryType,
      status: query.status,
      reason: query.reason,
      rule: query.rule,
      upstream: query.upstream,
      blocked: query.isBlocked,
      suspicious: query.isSuspicious,
      signalType: signal?.type,
      severity: signal?.severity,
      title: signal?.title,
    };
  });

  const networkMatches: ResidentialDnsProxyMatch[] = networkSignals
    .filter((signal) => Boolean(signal.domain))
    .map((signal) => ({
      source: 'network',
      attribution: 'network',
      queriedAt: signal.detectedAt.toISOString(),
      clientIp: signal.clientIp,
      clientName: signal.clientName,
      domain: signal.domain || 'unknown',
      blocked: false,
      suspicious: true,
      signalType: signal.type,
      severity: signal.severity,
      title: signal.title,
    }));

  const indicators: string[] = [];
  if (connection.queryLogEnabled === false) {
    indicators.push('AdGuard query logging has not been confirmed enabled.');
  }
  if (connection.anonymizeClientIp) {
    indicators.push('AdGuard anonymizes client IPs, so DNS evidence is network-level only.');
  }
  if (connection.attributionStatus === 'HEALTHY') {
    indicators.push('AdGuard sees UniFi client IPs; DNS evidence can be attributed to devices.');
  } else if (connection.attributionStatus === 'DEGRADED') {
    indicators.push('AdGuard mostly sees gateway or router IPs; DNS evidence is network-level only.');
  } else {
    indicators.push('DNS attribution is not established yet.');
  }
  if (connection.attributionReason) {
    indicators.push(connection.attributionReason);
  }
  if (deviceMatches.length === 0 && networkMatches.length === 0) {
    indicators.push('No recent campaign-grade DNS proxy signals were found in the lookback window.');
  }

  return {
    configured: true,
    queryLogEnabled: connection.queryLogEnabled,
    anonymizedClientIp: connection.anonymizeClientIp,
    attributionStatus: connection.attributionStatus as ResidentialDnsProxyEvidence['attributionStatus'],
    attributionReason: connection.attributionReason || 'DNS attribution has not been assessed yet.',
    deviceLevelQueryCount: deviceMatches.length,
    networkLevelSignalCount: networkMatches.length,
    matches: [...deviceMatches, ...networkMatches].slice(0, 75),
    indicators: uniq(indicators),
  };
}

export async function collectResidentialProxyEvidence(
  rawOptions?: Partial<CampaignOptions> | null
): Promise<{ evidence: ResidentialEvidence; options: CampaignOptions }> {
  const options = mergeResidentialOptions(rawOptions);
  const activeConfig = await prisma.configuration.findFirst({
    where: { isActive: true },
    orderBy: { importedAt: 'desc' },
  });

  const runners = await prisma.device.findMany({
    where: { status: 'ONLINE' },
    orderBy: [{ deviceId: 'asc' }],
    select: { id: true, deviceId: true, name: true, status: true, ipAddress: true },
  });

  if (!activeConfig) {
    return {
      options,
      evidence: {
        collectedAt: new Date().toISOString(),
        dataSources: {
          activeConfig: false,
          unifiConnection: false,
          eventsChecked: 0,
          alarmsChecked: 0,
          validationRunners: runners,
        },
        candidateDevices: [],
        riskyNetworkPosture: { targetNetworks: [], weakSegmentation: false, indicators: [] },
        dnsPosture: { protectiveDnsLikely: null, indicators: ['No active UniFi config available.'] },
        dnsProxyEvidence: emptyDnsProxyEvidence('No active UniFi config available for DNS attribution.'),
        idsHoneypotStatus: {
          idsIpsEnabled: null,
          honeypotEnabled: null,
          honeypotCount: 0,
          indicators: ['No active UniFi config available.'],
        },
        portForwards: [],
        upnpNatPmp: { upnpEnabled: null, natPmpEnabled: null, indicators: [] },
        telemetryMatches: { snippets: [], eventMatchCount: 0, alarmMatchCount: 0 },
      },
    };
  }

  const configJson = activeConfig.configJson as any;
  const normalized = normalizeConfig(configJson);
  const networksById = new Map(normalized.networks.map((network) => [network._id, network]));
  const targetNetworkKeywords = options.targetNetworkKeywords.map((keyword) => keyword.toLowerCase());
  const targetNetworks = normalized.networks.filter((network) =>
    targetNetworkKeywords.some((keyword) => network.name.toLowerCase().includes(keyword))
  );
  const targetNetworkIds = new Set(targetNetworks.map((network) => network._id));
  const clients = normalized.clients.length > 0 ? normalized.clients : asArray(configJson.clients);
  const candidates = detectCandidateDevices(clients, networksById, targetNetworkIds, options);
  const telemetry = await collectTelemetrySnippets(options);
  const dnsProxyEvidence = await collectDnsProxyEvidence(candidates, options);
  const settings = normalized.settings;
  const honeypots = extractHoneypots({
    ...configJson,
    setting: configJson.setting || configJson.settings,
  });

  const weakSegmentationIndicators: string[] = [];
  for (const network of targetNetworks) {
    if (!network.network_isolation) {
      weakSegmentationIndicators.push(`${network.name} does not show network isolation enabled.`);
    }
  }
  if (
    settings.default_security_posture &&
    !['deny', 'block_all'].includes(String(settings.default_security_posture).toLowerCase())
  ) {
    weakSegmentationIndicators.push(`Default security posture is ${settings.default_security_posture}.`);
  }

  const dnsIndicators: string[] = [];
  let protectiveDnsCount = 0;
  for (const network of targetNetworks) {
    const dnsServers = [network.dhcpd_dns_1, network.dhcpd_dns_2].filter(Boolean) as string[];
    const hasProtectiveDns = dnsServers.some((dns) => PROTECTIVE_DNS.has(dns));
    if (hasProtectiveDns) {
      protectiveDnsCount++;
      dnsIndicators.push(`${network.name} uses protective DNS (${dnsServers.join(', ')}).`);
    } else if (dnsServers.length > 0) {
      dnsIndicators.push(`${network.name} uses DNS ${dnsServers.join(', ')}.`);
    } else {
      dnsIndicators.push(`${network.name} inherits default DNS.`);
    }
  }

  const idsIpsEnabled =
    typeof settings.ips_enabled === 'boolean'
      ? settings.ips_enabled
      : settings.ips_mode === 'ids' || settings.ips_mode === 'ips'
        ? true
        : null;
  const honeypotEnabled =
    typeof settings.honeypot_enabled === 'boolean'
      ? settings.honeypot_enabled
      : honeypots.some((honeypot) => honeypot.enabled)
        ? true
        : null;

  const upnpEnabled = readSettingBoolean(configJson, ['upnp_enabled']);
  const natPmpEnabled = readSettingBoolean(configJson, ['upnp_nat_pmp_enabled', 'nat_pmp_enabled']);
  const upnpIndicators: string[] = [];
  if (upnpEnabled) upnpIndicators.push('UPnP appears enabled.');
  if (natPmpEnabled) upnpIndicators.push('NAT-PMP appears enabled.');

  const portForwards = normalized.portForwards
    .filter((forward) => forward.enabled !== false)
    .map((forward) => {
      const matchedPorts = uniq([
        ...portSpecMatches(forward.dst_port, options.validationPorts),
        ...portSpecMatches(forward.fwd_port, options.validationPorts),
      ]);
      return {
        id: forward._id,
        name: forward.name || 'Unnamed port forward',
        externalPort: forward.dst_port,
        internalPort: forward.fwd_port,
        targetIp: forward.fwd,
        protocol: forward.proto,
        matchedPorts,
      };
    })
    .filter((forward) => forward.matchedPorts.length > 0);

  return {
    options,
    evidence: {
      collectedAt: new Date().toISOString(),
      configId: activeConfig.id,
      siteName: activeConfig.siteName,
      dataSources: {
        activeConfig: true,
        unifiConnection: telemetry.unifiConnection,
        eventsChecked: telemetry.eventsChecked,
        alarmsChecked: telemetry.alarmsChecked,
        validationRunners: runners,
      },
      candidateDevices: candidates,
      riskyNetworkPosture: {
        targetNetworks: targetNetworks.map((network) => ({
          id: network._id,
          name: network.name,
          vlan: network.vlan,
          subnet: network.subnet,
        })),
        weakSegmentation: weakSegmentationIndicators.length > 0,
        indicators: weakSegmentationIndicators,
      },
      dnsPosture: {
        protectiveDnsLikely:
          targetNetworks.length === 0 ? null : protectiveDnsCount === targetNetworks.length,
        indicators: dnsIndicators,
      },
      dnsProxyEvidence,
      idsHoneypotStatus: {
        idsIpsEnabled,
        honeypotEnabled,
        honeypotCount: uniq(honeypots.map((honeypot) => honeypot.ipAddress)).length,
        indicators: [
          idsIpsEnabled ? 'IDS/IPS appears enabled.' : 'IDS/IPS was not confirmed enabled.',
          honeypotEnabled ? 'UniFi honeypot configuration was found.' : 'UniFi honeypot coverage was not confirmed.',
        ],
      },
      portForwards,
      upnpNatPmp: {
        upnpEnabled,
        natPmpEnabled,
        indicators: upnpIndicators,
      },
      telemetryMatches: {
        snippets: telemetry.snippets,
        eventMatchCount: telemetry.snippets.filter((snippet) => snippet.source === 'event').length,
        alarmMatchCount: telemetry.snippets.filter((snippet) => snippet.source === 'alarm').length,
      },
    },
  };
}

function buildDeviceFinding(
  candidate: ResidentialCandidateDevice,
  severity: Severity,
  confidence: number,
  evidence: string[]
): ResidentialFinding {
  const name = candidate.name || candidate.hostname || candidate.mac;
  return {
    resourceKey: candidate.mac || candidate.ip || name,
    type: 'campaign_residential_proxy_exposure',
    severity,
    title:
      severity === 'HIGH'
        ? `Potential residential proxy exposure on ${name}`
        : `Residential proxy risk on ${name}`,
    description:
      'ZeroProof found signals associated with Kimwolf-style residential proxy exposure: suspicious endpoint inventory, risky posture, telemetry matches, or exposed ADB/proxy ports.',
    impact:
      'A compromised local device can provide attacker-controlled residential proxy access from inside the network, bypassing perimeter-only detections and creating attribution risk.',
    remediation:
      'Remove or replace suspect devices, disable ADB/debug services, isolate IoT and media networks, disable UPnP/NAT-PMP, enable protective DNS, and rerun this campaign validation.',
    affectedResource: `${name}${candidate.ip ? ` (${candidate.ip})` : ''}`,
    confidence,
    evidence,
  };
}

function isHighConfidenceDnsMatch(match: ResidentialDnsProxyMatch): boolean {
  return Boolean(
    match.attribution === 'device' &&
      (HIGH_CONFIDENCE_DNS_SEVERITIES.has(match.severity as Severity) || match.reason === 'FilteredSafeBrowsing')
  );
}

function isMediumConfidenceDnsMatch(match: ResidentialDnsProxyMatch): boolean {
  return Boolean(
    match.attribution === 'device' &&
      !isHighConfidenceDnsMatch(match) &&
      (match.suspicious || isCampaignRelevantDnsReason(match.reason))
  );
}

export function evaluateResidentialProxyEvidence(
  evidence: ResidentialEvidence
): ResidentialEvaluationSummary {
  if (!evidence.dataSources.activeConfig) {
    return {
      verdict: 'INCONCLUSIVE',
      score: 0,
      confidence: 0.2,
      highSignals: [],
      mediumSignals: [],
      lowSignals: ['No active UniFi configuration was available.'],
      findings: [],
    };
  }

  const highSignals: string[] = [];
  const mediumSignals: string[] = [];
  const lowSignals: string[] = [];
  const findingsByResource = new Map<string, ResidentialFinding>();

  const dnsProxyEvidence = evidence.dnsProxyEvidence;
  if (dnsProxyEvidence?.configured) {
    if (dnsProxyEvidence.attributionStatus === 'HEALTHY') {
      lowSignals.push('DNS Proxy confirms device-level DNS attribution is available.');
    } else if (dnsProxyEvidence.attributionStatus === 'DEGRADED') {
      lowSignals.push('DNS Proxy is collecting domain evidence, but attribution is gateway-only.');
    } else {
      lowSignals.push('DNS Proxy is configured, but attribution is not yet established.');
    }
  }

  const deviceDnsMatches = (dnsProxyEvidence?.matches || []).filter((match) => match.attribution === 'device');
  const highConfidenceDeviceDnsMatches = deviceDnsMatches.filter(isHighConfidenceDnsMatch);
  if (highConfidenceDeviceDnsMatches.length > 0) {
    highSignals.push(
      `${highConfidenceDeviceDnsMatches.length} high-confidence device-level DNS proxy indicator(s) matched candidate clients.`
    );

    for (const match of highConfidenceDeviceDnsMatches.slice(0, 5)) {
      const candidate = evidence.candidateDevices.find((device) => device.ip === match.clientIp);
      if (!candidate) continue;

      const finding = buildDeviceFinding(candidate, 'HIGH', Math.max(candidate.confidence, 0.9), [
        `Device-level DNS query to ${match.domain}${match.title ? ` (${match.title})` : match.reason ? ` (${match.reason})` : ''}.`,
        ...candidate.reasonCodes,
      ]);
      findingsByResource.set(finding.resourceKey, finding);
    }
  }

  const mediumConfidenceDeviceDnsMatches = deviceDnsMatches.filter(isMediumConfidenceDnsMatch);
  if (mediumConfidenceDeviceDnsMatches.length > 0) {
    mediumSignals.push(
      `${mediumConfidenceDeviceDnsMatches.length} device-level DNS security indicator(s) matched candidate clients.`
    );

    for (const match of mediumConfidenceDeviceDnsMatches.slice(0, 5)) {
      const candidate = evidence.candidateDevices.find((device) => device.ip === match.clientIp);
      if (!candidate) continue;

      const finding = buildDeviceFinding(candidate, 'MEDIUM', Math.max(candidate.confidence, 0.72), [
        `Device-level DNS security event for ${match.domain}${match.title ? ` (${match.title})` : match.reason ? ` (${match.reason})` : ''}.`,
        ...candidate.reasonCodes,
      ]);
      if (!findingsByResource.has(finding.resourceKey)) {
        findingsByResource.set(finding.resourceKey, finding);
      }
    }
  }

  const networkDnsMatches = (dnsProxyEvidence?.matches || []).filter((match) => match.attribution === 'network');
  if (networkDnsMatches.length > 0) {
    mediumSignals.push(
      `${networkDnsMatches.length} network-level DNS proxy indicator(s) were observed without device attribution.`
    );
    findingsByResource.set('dns-proxy-network', {
      resourceKey: 'dns-proxy-network',
      type: 'campaign_residential_proxy_dns_network',
      severity: 'MEDIUM',
      title: 'Network-level DNS indicators match proxy infrastructure',
      description:
        'AdGuard observed DNS domains associated with residential proxy or campaign infrastructure, but the DNS source cannot be attributed to a specific device.',
      impact:
        'Gateway-forwarded DNS can confirm risky domains on the network, but it does not prove which client generated them.',
      remediation:
        'Configure UniFi DHCP to hand out the AdGuard Home IP directly per network or VLAN, then rerun collection to recover device-level attribution.',
      affectedResource: 'DNS Proxy',
      confidence: 0.72,
      evidence: networkDnsMatches
        .slice(0, 5)
        .map((match) => `${match.domain}${match.title ? `:${match.title}` : ''}`),
    });
  }

  const telemetryCount =
    evidence.telemetryMatches.eventMatchCount + evidence.telemetryMatches.alarmMatchCount;
  if (telemetryCount > 0) {
    highSignals.push(`${telemetryCount} curated UniFi telemetry matches reference proxy/ADB indicators.`);
    findingsByResource.set('telemetry', {
      resourceKey: 'telemetry',
      type: 'campaign_residential_proxy_telemetry',
      severity: 'HIGH',
      title: 'Residential proxy indicators in UniFi telemetry',
      description:
        'Recent UniFi events or alarms contain curated Kimwolf, residential proxy, ADB, SOCKS, or campaign-port indicators.',
      impact:
        'Strong telemetry matches can indicate that a local device is acting as a proxy node or exposing debug/proxy services.',
      remediation:
        'Inspect the referenced clients and controller telemetry, remove suspect devices, disable debug services, isolate affected networks, and rerun validation.',
      affectedResource: 'UniFi telemetry',
      confidence: 0.9,
      evidence: evidence.telemetryMatches.snippets
        .slice(0, 5)
        .map((snippet) => `${snippet.source}:${snippet.key || 'match'}:${snippet.matchedTerms.join(',')}`),
    });
  }

  const openPorts = evidence.validation?.openPorts || [];
  for (const openPort of openPorts) {
    highSignals.push(`${openPort.host}:${openPort.port} is reachable during validation.`);
    const candidate = evidence.candidateDevices.find(
      (device) => device.ip === openPort.host || device.mac === openPort.candidateMac
    );
    if (candidate) {
      const finding = buildDeviceFinding(candidate, 'HIGH', 0.95, [
        `Open TCP ${openPort.port} (${openPort.service}) confirmed by validation.`,
        ...candidate.reasonCodes,
      ]);
      findingsByResource.set(finding.resourceKey, finding);
    }
  }

  for (const candidate of evidence.candidateDevices) {
    const candidateSignals = [...candidate.reasonCodes];
    if (evidence.riskyNetworkPosture.weakSegmentation) {
      candidateSignals.push('weak-segmentation');
    }
    if (evidence.dnsPosture.protectiveDnsLikely === false) {
      candidateSignals.push('dns-not-confirmed-protective');
    }
    if (evidence.upnpNatPmp.upnpEnabled || evidence.upnpNatPmp.natPmpEnabled) {
      candidateSignals.push('upnp-or-nat-pmp-enabled');
    }

    if (
      !findingsByResource.has(candidate.mac) &&
      candidate.reasonCodes.includes('suspicious-device-fingerprint') &&
      candidateSignals.length >= 2
    ) {
      mediumSignals.push(`${candidate.name} matches suspicious device inventory plus posture risk.`);
      const finding = buildDeviceFinding(candidate, 'MEDIUM', Math.max(candidate.confidence, 0.65), candidateSignals);
      findingsByResource.set(finding.resourceKey, finding);
    }
  }

  if (evidence.portForwards.length > 0) {
    mediumSignals.push(`${evidence.portForwards.length} port forward(s) overlap campaign validation ports.`);
  }
  if (evidence.riskyNetworkPosture.weakSegmentation) {
    lowSignals.push('Target networks have segmentation indicators that need review.');
  }
  if (evidence.dnsPosture.protectiveDnsLikely === false) {
    lowSignals.push('Protective DNS was not confirmed on all target networks.');
  }
  if (evidence.upnpNatPmp.upnpEnabled || evidence.upnpNatPmp.natPmpEnabled) {
    lowSignals.push('Automatic port mapping appears enabled.');
  }

  let verdict: CampaignVerdict = 'VALIDATED';
  if (!evidence.validation && evidence.candidateDevices.length > 0) {
    verdict = 'AT_RISK';
  }
  if (lowSignals.length > 0 || evidence.candidateDevices.length > 0) {
    verdict = 'AT_RISK';
  }
  if (mediumSignals.length > 0) {
    verdict = 'AT_RISK';
  }
  if (highSignals.length > 0) {
    verdict = 'SUSPECTED_COMPROMISE';
  }
  if (evidence.dataSources.validationRunners.length === 0 && evidence.candidateDevices.length > 0) {
    verdict = 'INCONCLUSIVE';
    lowSignals.push('No validation runner is online, so candidate devices could not be actively checked.');
  }

  const score = Math.min(
    100,
    highSignals.length * 35 + mediumSignals.length * 18 + lowSignals.length * 8
  );
  const confidence =
    evidence.validation || highSignals.length > 0
      ? 0.9
      : evidence.dataSources.unifiConnection
        ? 0.72
        : 0.58;

  return {
    verdict,
    score,
    confidence,
    highSignals,
    mediumSignals,
    lowSignals,
    findings: Array.from(findingsByResource.values()),
  };
}

function serviceNameForPort(port: number): string {
  const names: Record<number, string> = {
    5555: 'android-debug-bridge',
    12108: 'adb-persistent-or-proxy',
    3222: 'proxy-or-remote-shell',
    5858: 'node-debug-or-proxy',
    40860: 'kimwolf-risk-listener',
    1080: 'socks-proxy',
    3128: 'http-proxy',
    8080: 'http-proxy',
    8291: 'routeros-winbox',
  };
  return names[port] || 'tcp-service';
}

export function buildResidentialValidationCommandBatches(
  evidence: ResidentialEvidence,
  options: CampaignOptions,
  maxCommandsPerBatch = 80
): ValidationCommandBatch[] {
  const candidatesWithIp = evidence.candidateDevices.filter((candidate) => candidate.ip);
  const commands: Command[] = [];

  for (const candidate of candidatesWithIp) {
    for (const port of options.validationPorts) {
      commands.push({
        op: 'tcp_connect',
        host: candidate.ip,
        port,
        timeout: options.validationTimeoutMs,
        campaign: 'residential-proxy-kimwolf',
        candidateMac: candidate.mac,
        candidateName: candidate.name,
      });
    }
  }

  const batches: ValidationCommandBatch[] = [];
  for (let i = 0; i < commands.length; i += maxCommandsPerBatch) {
    const batchCommands = commands.slice(i, i + maxCommandsPerBatch);
    batches.push({
      commands: batchCommands,
      hostCount: uniq(batchCommands.map((cmd) => String(cmd.host))).length,
      portCount: options.validationPorts.length,
    });
  }

  return batches;
}

function extractCommandResults(resultsJson: unknown): any[] {
  if (!isRecord(resultsJson)) return [];
  if (Array.isArray(resultsJson.commandResults)) return resultsJson.commandResults;
  if (Array.isArray(resultsJson.results)) return resultsJson.results;
  return [];
}

export function mergeValidationEvidence(
  evidence: ResidentialEvidence,
  testRuns: Array<{ id: string; status: string; resultsJson: unknown }>,
  scannedPorts: number,
  runner?: { id: string; deviceId: string; name: string; ipAddress?: string | null }
): ResidentialEvidence {
  const openPorts: ResidentialValidationEvidence['openPorts'] = [];
  const failedTestRuns: string[] = [];

  for (const testRun of testRuns) {
    if (testRun.status !== 'COMPLETED') {
      failedTestRuns.push(testRun.id);
      continue;
    }

    for (const commandResult of extractCommandResults(testRun.resultsJson)) {
      const data = commandResult?.data || {};
      if (commandResult?.op !== 'tcp_connect' || !data.open) continue;
      const host = String(data.host || '');
      const port = Number(data.port);
      const candidate = evidence.candidateDevices.find((device) => device.ip === host);
      if (!host || !Number.isInteger(port)) continue;
      openPorts.push({
        host,
        port,
        service: serviceNameForPort(port),
        candidateName: candidate?.name,
        candidateMac: candidate?.mac,
      });
    }
  }

  const scannedHosts = uniq(evidence.candidateDevices.filter((device) => device.ip).map((device) => device.ip!)).length;
  const cleanHosts = evidence.candidateDevices
    .filter((device) => device.ip && !openPorts.some((openPort) => openPort.host === device.ip))
    .map((device) => device.ip!);

  return {
    ...evidence,
    validation: {
      runner,
      testRunIds: testRuns.map((testRun) => testRun.id),
      scannedHosts,
      scannedPorts,
      openPorts,
      cleanHosts,
      failedTestRuns,
    },
  };
}

export function toInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}
