import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import prisma from './database';
import { decrypt, encrypt } from '../utils/encryption';
import logger from '../utils/logger';
import {
  AdGuardClient,
  AdGuardCredentials,
  AdGuardQueryLogConfig,
  AdGuardQueryLogItem,
  AdGuardStatusResponse,
} from './adguardClient';

const DEFAULT_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 30;
const DEFAULT_SIGNAL_RETENTION_DAYS = 90;
const DEFAULT_POLLING_INTERVAL_SEC = 60;
const QUERY_SYNC_LIMIT = 500;
const BULKY_QUERY_JSON_RETENTION_HOURS = 24;
const SECURITY_DNS_REASONS = ['FilteredSafeBrowsing', 'FilteredBlockedService'];

const CAMPAIGN_DOMAIN_PATTERNS: Array<{ type: string; label: string; pattern: RegExp; severity: 'HIGH' | 'MEDIUM' }> = [
  { type: 'known_campaign_domain', label: 'Kimwolf xdresi domain', pattern: /(^|\.)xdresi\.to\.?$/i, severity: 'HIGH' },
  { type: 'known_campaign_domain', label: 'Kimwolf xdmob domain', pattern: /(^|\.)xdmob\.to\.?$/i, severity: 'HIGH' },
  { type: 'proxy_infrastructure_domain', label: 'ByteConnect endpoint', pattern: /(^|\.)byteconnect\.io\.?$/i, severity: 'HIGH' },
  { type: 'proxy_infrastructure_domain', label: 'IPIdea endpoint', pattern: /(^|\.)ipidea\.io\.?$/i, severity: 'HIGH' },
  { type: 'proxy_infrastructure_domain', label: 'PlainProxies endpoint', pattern: /(^|\.)plainproxies\.com\.?$/i, severity: 'HIGH' },
  { type: 'proxy_keyword_domain', label: 'Proxy-like domain', pattern: /(^|[.-])(resi|residential|proxy|socks|mob)[.-]/i, severity: 'MEDIUM' },
];

export interface DnsProxySettingsInput {
  host: string;
  port: number;
  useHttps: boolean;
  username?: string;
  password?: string;
  pollingEnabled: boolean;
  retentionDays: number;
}

export interface DnsProxySettingsView {
  id: string;
  host: string;
  port: number;
  useHttps: boolean;
  username: string;
  pollingEnabled: boolean;
  pollingIntervalSec: number;
  retentionDays: number;
  lastSyncAt?: string;
  lastSyncStatus?: string;
  lastSyncError?: string | null;
  lastQueryAt?: string;
  queryLogEnabled?: boolean | null;
  anonymizeClientIp?: boolean | null;
  attributionStatus: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  attributionReason?: string | null;
}

export interface DnsAttributionResult {
  status: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  reason: string;
  uniqueClientCount: number;
  matchedClientCount: number;
  sampleClients: string[];
}

export interface NormalizedDnsQueryEvent {
  eventHash: string;
  queriedAt: Date;
  expiresAt: Date;
  clientIp?: string;
  clientName?: string;
  clientId?: string;
  clientProto?: string;
  domain: string;
  queryType?: string;
  status?: string;
  reason?: string;
  rule?: string;
  upstream?: string;
  answerJson?: Prisma.InputJsonValue;
  rulesJson?: Prisma.InputJsonValue;
  rawJson?: Prisma.InputJsonValue;
  isBlocked: boolean;
  isSuspicious: boolean;
  signal?: DnsSignalCandidate;
}

interface DnsSignalCandidate {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  confidence: number;
  evidence: Prisma.InputJsonValue;
}

interface SyncResult {
  inserted: number;
  signalsCreated: number;
  latestQueryAt: Date | null;
  queryLogConfig: AdGuardQueryLogConfig;
  attribution: DnsAttributionResult;
}

export interface DnsProxyStatus {
  configured: boolean;
  settings: DnsProxySettingsView | null;
  adguard?: {
    reachable: boolean;
    version?: string;
    protectionEnabled?: boolean;
    queryLogConfig?: AdGuardQueryLogConfig;
    error?: string;
  };
  stats: {
    totalQueries: number;
    recentQueries: number;
    blockedQueries: number;
    suspiciousQueries: number;
    uniqueClients: number;
    lastQueryAt?: string;
  };
  attribution: DnsAttributionResult;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeDomain(domain?: string): string {
  return String(domain || '').trim().replace(/\.$/, '').toLowerCase();
}

function normalizeString(value?: string): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function hashEvent(parts: unknown[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function safeDate(value?: string): Date {
  const parsed = value ? new Date(value) : new Date();
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function asJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value as Prisma.InputJsonValue;
}

export function isAdGuardQueryBlocked(reason?: string): boolean {
  return Boolean(reason && reason.startsWith('Filtered'));
}

export function isCampaignRelevantDnsReason(reason?: string | null): boolean {
  return Boolean(reason && SECURITY_DNS_REASONS.includes(reason));
}

export function classifyDnsSignal(
  domain: string,
  reason?: string,
  rule?: string
): DnsSignalCandidate | undefined {
  for (const indicator of CAMPAIGN_DOMAIN_PATTERNS) {
    if (!indicator.pattern.test(domain)) continue;
    return {
      type: indicator.type,
      severity: indicator.severity,
      title: indicator.label,
      description: `AdGuard observed DNS activity for ${domain}, which matches a campaign or proxy infrastructure indicator.`,
      confidence: indicator.severity === 'HIGH' ? 0.9 : 0.65,
      evidence: { domain, reason, rule, matched: indicator.label },
    };
  }

  if (reason === 'FilteredSafeBrowsing') {
    return {
      type: 'adguard_safebrowsing_block',
      severity: 'HIGH',
      title: 'AdGuard Safe Browsing block',
      description: `AdGuard blocked ${domain} using Safe Browsing protection.`,
      confidence: 0.85,
      evidence: { domain, reason, rule },
    };
  }

  if (reason === 'FilteredBlockedService') {
    return {
      type: 'adguard_blocked_service',
      severity: 'MEDIUM',
      title: 'AdGuard blocked service',
      description: `AdGuard blocked ${domain} through a blocked service rule.`,
      confidence: 0.7,
      evidence: { domain, reason, rule },
    };
  }

  return undefined;
}

export function normalizeAdGuardQueryItem(
  item: AdGuardQueryLogItem,
  connectionId: string,
  retentionDays = DEFAULT_RETENTION_DAYS
): NormalizedDnsQueryEvent | null {
  const domain = normalizeDomain(item.question?.host || item.question?.name);
  if (!domain) return null;

  const queriedAt = safeDate(item.time);
  const clientIp = normalizeString(item.client);
  const clientName = normalizeString(item.client_info?.name);
  const queryType = normalizeString(item.question?.type);
  const status = normalizeString(item.status);
  const reason = normalizeString(item.reason);
  const rule = normalizeString(item.rules?.[0]?.text || item.rule);
  const upstream = normalizeString(item.upstream);
  const signal = classifyDnsSignal(domain, reason, rule);
  const isBlocked = isAdGuardQueryBlocked(reason);

  const eventHash = hashEvent([
    connectionId,
    queriedAt.toISOString(),
    clientIp || '',
    domain,
    queryType || '',
    status || '',
    reason || '',
  ]);

  return {
    eventHash,
    queriedAt,
    expiresAt: addDays(new Date(), Math.min(MAX_RETENTION_DAYS, Math.max(1, retentionDays))),
    clientIp,
    clientName,
    clientId: normalizeString(item.client_id),
    clientProto: normalizeString(item.client_proto),
    domain,
    queryType,
    status,
    reason,
    rule,
    upstream,
    answerJson: signal ? asJson(item.answer) : undefined,
    rulesJson: isBlocked || signal ? asJson(item.rules) : undefined,
    rawJson: undefined,
    isBlocked,
    isSuspicious: Boolean(signal),
    signal,
  };
}

export function evaluateDnsAttribution(
  clientIps: string[],
  knownUniFiClientIps: string[],
  totalEvents: number,
  anonymizeClientIp?: boolean
): DnsAttributionResult {
  const uniqueClients = Array.from(new Set(clientIps.filter(Boolean))).sort();
  const knownIps = new Set(knownUniFiClientIps.filter(Boolean));
  const matched = uniqueClients.filter((ip) => knownIps.has(ip));

  if (anonymizeClientIp) {
    return {
      status: 'UNKNOWN',
      reason: 'AdGuard query logging anonymizes client IPs, so ZeroProof cannot verify device-level attribution.',
      uniqueClientCount: uniqueClients.length,
      matchedClientCount: matched.length,
      sampleClients: uniqueClients.slice(0, 5),
    };
  }

  if (totalEvents < 5 || uniqueClients.length === 0) {
    return {
      status: 'UNKNOWN',
      reason: 'Not enough DNS query volume has been observed to assess attribution.',
      uniqueClientCount: uniqueClients.length,
      matchedClientCount: matched.length,
      sampleClients: uniqueClients.slice(0, 5),
    };
  }

  if (matched.length >= 2 && matched.length / uniqueClients.length >= 0.4) {
    return {
      status: 'HEALTHY',
      reason: 'AdGuard is seeing multiple client IPs that match UniFi client inventory.',
      uniqueClientCount: uniqueClients.length,
      matchedClientCount: matched.length,
      sampleClients: uniqueClients.slice(0, 5),
    };
  }

  if (uniqueClients.length <= 2 && knownUniFiClientIps.length >= 5) {
    return {
      status: 'DEGRADED',
      reason: 'Most DNS queries appear to come from one or two IPs. This usually means clients query the UniFi gateway, which forwards to AdGuard.',
      uniqueClientCount: uniqueClients.length,
      matchedClientCount: matched.length,
      sampleClients: uniqueClients.slice(0, 5),
    };
  }

  return {
    status: 'UNKNOWN',
    reason: 'ZeroProof sees DNS clients, but cannot yet confidently match them to UniFi client inventory.',
    uniqueClientCount: uniqueClients.length,
    matchedClientCount: matched.length,
    sampleClients: uniqueClients.slice(0, 5),
  };
}

function credentialsFromConnection(connection: {
  host: string;
  port: number;
  useHttps: boolean;
  usernameEnc: string;
  passwordEnc: string;
}): AdGuardCredentials {
  return {
    host: connection.host,
    port: connection.port,
    useHttps: connection.useHttps,
    username: decrypt(connection.usernameEnc),
    password: decrypt(connection.passwordEnc),
  };
}

function toSettingsView(connection: {
  id: string;
  host: string;
  port: number;
  useHttps: boolean;
  usernameEnc: string;
  pollingEnabled: boolean;
  pollingIntervalSec: number;
  retentionDays: number;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastQueryAt: Date | null;
  queryLogEnabled: boolean | null;
  anonymizeClientIp: boolean | null;
  attributionStatus: string;
  attributionReason: string | null;
}): DnsProxySettingsView {
  return {
    id: connection.id,
    host: connection.host,
    port: connection.port,
    useHttps: connection.useHttps,
    username: decrypt(connection.usernameEnc),
    pollingEnabled: connection.pollingEnabled,
    pollingIntervalSec: connection.pollingIntervalSec,
    retentionDays: connection.retentionDays,
    lastSyncAt: connection.lastSyncAt?.toISOString(),
    lastSyncStatus: connection.lastSyncStatus || undefined,
    lastSyncError: connection.lastSyncError,
    lastQueryAt: connection.lastQueryAt?.toISOString(),
    queryLogEnabled: connection.queryLogEnabled,
    anonymizeClientIp: connection.anonymizeClientIp,
    attributionStatus: connection.attributionStatus as DnsProxySettingsView['attributionStatus'],
    attributionReason: connection.attributionReason,
  };
}

export async function getActiveDnsProxyConnection() {
  return prisma.adGuardConnection.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getDnsProxySettings(): Promise<{ configured: boolean; settings: DnsProxySettingsView | null }> {
  const connection = await getActiveDnsProxyConnection();
  if (!connection) return { configured: false, settings: null };
  return { configured: true, settings: toSettingsView(connection) };
}

export async function saveDnsProxySettings(input: DnsProxySettingsInput): Promise<DnsProxySettingsView> {
  const existing = await getActiveDnsProxyConnection();
  const username = input.username?.trim() || '';
  const passwordEnc = input.password
    ? encrypt(input.password)
    : username === ''
      ? encrypt('')
      : existing?.passwordEnc;
  if (!passwordEnc && username !== '') {
    throw new Error('Password is required');
  }

  const retentionDays = Math.min(MAX_RETENTION_DAYS, Math.max(1, input.retentionDays || DEFAULT_RETENTION_DAYS));
  const data = {
    host: input.host.trim(),
    port: input.port,
    useHttps: input.useHttps,
    usernameEnc: encrypt(username),
    passwordEnc: passwordEnc || encrypt(''),
    pollingEnabled: input.pollingEnabled,
    pollingIntervalSec: DEFAULT_POLLING_INTERVAL_SEC,
    retentionDays,
    isActive: true,
  };

  if (existing) {
    const updated = await prisma.adGuardConnection.update({
      where: { id: existing.id },
      data,
    });
    return toSettingsView(updated);
  }

  await prisma.adGuardConnection.updateMany({
    where: { isActive: true },
    data: { isActive: false },
  });

  const created = await prisma.adGuardConnection.create({ data });
  return toSettingsView(created);
}

export async function deleteDnsProxySettings(): Promise<void> {
  await prisma.adGuardConnection.updateMany({
    where: { isActive: true },
    data: { isActive: false, pollingEnabled: false },
  });
}

export async function testDnsProxyConnection(input: DnsProxySettingsInput): Promise<{
  status: AdGuardStatusResponse;
  queryLogConfig: AdGuardQueryLogConfig;
}> {
  const username = input.username?.trim() || '';
  let password = input.password;
  if (!password && username) {
    const existing = await getActiveDnsProxyConnection();
    if (
      existing &&
      existing.host === input.host.trim() &&
      existing.port === input.port &&
      existing.useHttps === input.useHttps
    ) {
      password = decrypt(existing.passwordEnc);
    }
  }
  if (!password && username) {
    throw new Error('Password is required');
  }

  const client = new AdGuardClient({
    host: input.host.trim(),
    port: input.port,
    useHttps: input.useHttps,
    username,
    password: password || '',
  });
  const [status, queryLogConfig] = await Promise.all([
    client.getStatus(),
    client.getQueryLogConfig(),
  ]);
  return { status, queryLogConfig };
}

async function knownUniFiClientIps(): Promise<string[]> {
  const clients = await prisma.networkClient.findMany({
    where: { lastIp: { not: null } },
    select: { lastIp: true },
  });
  return clients.map((client) => client.lastIp).filter((ip): ip is string => Boolean(ip));
}

async function insertNormalizedEvents(
  connectionId: string,
  retentionDays: number,
  items: AdGuardQueryLogItem[]
): Promise<{ inserted: number; signalsCreated: number; latestQueryAt: Date | null }> {
  let inserted = 0;
  let signalsCreated = 0;
  let latestQueryAt: Date | null = null;

  for (const item of items) {
    const normalized = normalizeAdGuardQueryItem(item, connectionId, retentionDays);
    if (!normalized) continue;
    if (!latestQueryAt || normalized.queriedAt > latestQueryAt) {
      latestQueryAt = normalized.queriedAt;
    }

    const existing = await prisma.dnsQueryEvent.findUnique({
      where: { eventHash: normalized.eventHash },
      select: { id: true },
    });
    if (existing) continue;

    const created = await prisma.dnsQueryEvent.create({
      data: {
        connectionId,
        source: 'adguard_home',
        eventHash: normalized.eventHash,
        queriedAt: normalized.queriedAt,
        expiresAt: normalized.expiresAt,
        clientIp: normalized.clientIp,
        clientName: normalized.clientName,
        clientId: normalized.clientId,
        clientProto: normalized.clientProto,
        domain: normalized.domain,
        queryType: normalized.queryType,
        status: normalized.status,
        reason: normalized.reason,
        rule: normalized.rule,
        upstream: normalized.upstream,
        answerJson: normalized.answerJson,
        rulesJson: normalized.rulesJson,
        rawJson: normalized.rawJson,
        isBlocked: normalized.isBlocked,
        isSuspicious: normalized.isSuspicious,
      },
      select: { id: true },
    });
    inserted++;

    if (normalized.signal) {
      await prisma.dnsSignal.create({
        data: {
          connectionId,
          queryEventId: created.id,
          type: normalized.signal.type,
          severity: normalized.signal.severity,
          title: normalized.signal.title,
          description: normalized.signal.description,
          domain: normalized.domain,
          clientIp: normalized.clientIp,
          clientName: normalized.clientName,
          confidence: normalized.signal.confidence,
          evidenceJson: normalized.signal.evidence,
          detectedAt: normalized.queriedAt,
          expiresAt: addDays(new Date(), DEFAULT_SIGNAL_RETENTION_DAYS),
        },
      });
      signalsCreated++;
    }
  }

  return { inserted, signalsCreated, latestQueryAt };
}

async function calculateAttribution(connectionId: string, anonymizeClientIp?: boolean): Promise<DnsAttributionResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [events, knownIps, totalEvents] = await Promise.all([
    prisma.dnsQueryEvent.findMany({
      where: {
        connectionId,
        queriedAt: { gte: since },
        clientIp: { not: null },
      },
      orderBy: { queriedAt: 'desc' },
      take: 1000,
      select: { clientIp: true },
    }),
    knownUniFiClientIps(),
    prisma.dnsQueryEvent.count({
      where: { connectionId, queriedAt: { gte: since } },
    }),
  ]);

  return evaluateDnsAttribution(
    events.map((event) => event.clientIp).filter((ip): ip is string => Boolean(ip)),
    knownIps,
    totalEvents,
    anonymizeClientIp
  );
}

export async function syncDnsProxyConnection(connectionId: string): Promise<SyncResult> {
  const connection = await prisma.adGuardConnection.findUnique({ where: { id: connectionId } });
  if (!connection || !connection.isActive) {
    throw new Error('DNS proxy connection not found');
  }

  await prisma.adGuardConnection.update({
    where: { id: connection.id },
    data: { lastSyncStatus: 'IN_PROGRESS', lastSyncError: null },
  });

  try {
    const client = new AdGuardClient(credentialsFromConnection(connection));
    const [queryLogConfig, queryLog] = await Promise.all([
      client.getQueryLogConfig(),
      client.getQueryLog({ limit: QUERY_SYNC_LIMIT, responseStatus: 'all' }),
    ]);

    const { inserted, signalsCreated, latestQueryAt } = await insertNormalizedEvents(
      connection.id,
      connection.retentionDays,
      queryLog.data || []
    );
    const attribution = await calculateAttribution(connection.id, queryLogConfig.anonymize_client_ip);

    await prisma.adGuardConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'SUCCESS',
        lastSyncError: null,
        lastQueryAt: latestQueryAt || connection.lastQueryAt,
        queryLogEnabled: queryLogConfig.enabled,
        anonymizeClientIp: queryLogConfig.anonymize_client_ip,
        attributionStatus: attribution.status,
        attributionReason: attribution.reason,
      },
    });

    return { inserted, signalsCreated, latestQueryAt, queryLogConfig, attribution };
  } catch (error: any) {
    await prisma.adGuardConnection.update({
      where: { id: connection.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'FAILED',
        lastSyncError: error.message || 'DNS proxy sync failed',
      },
    });
    throw error;
  }
}

export async function syncActiveDnsProxyConnections(): Promise<void> {
  const connections = await prisma.adGuardConnection.findMany({
    where: { isActive: true, pollingEnabled: true },
  });

  for (const connection of connections) {
    const lastSync = connection.lastSyncAt?.getTime() || 0;
    if (Date.now() - lastSync < connection.pollingIntervalSec * 1000) continue;

    try {
      const result = await syncDnsProxyConnection(connection.id);
      if (result.inserted > 0 || result.signalsCreated > 0) {
        logger.info(`DNS proxy sync inserted ${result.inserted} queries and ${result.signalsCreated} signals`);
      }
    } catch (error: any) {
      logger.warn(`DNS proxy sync failed: ${error.message}`);
    }
  }
}

export async function getDnsProxyStatus(): Promise<DnsProxyStatus> {
  const connection = await getActiveDnsProxyConnection();
  if (!connection) {
    return {
      configured: false,
      settings: null,
      stats: {
        totalQueries: 0,
        recentQueries: 0,
        blockedQueries: 0,
        suspiciousQueries: 0,
        uniqueClients: 0,
      },
      attribution: {
        status: 'UNKNOWN',
        reason: 'No DNS proxy is configured.',
        uniqueClientCount: 0,
        matchedClientCount: 0,
        sampleClients: [],
      },
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalQueries, recentQueries, blockedQueries, suspiciousQueries, latestQuery, clients] = await Promise.all([
    prisma.dnsQueryEvent.count({ where: { connectionId: connection.id } }),
    prisma.dnsQueryEvent.count({ where: { connectionId: connection.id, queriedAt: { gte: since } } }),
    prisma.dnsQueryEvent.count({ where: { connectionId: connection.id, isBlocked: true, queriedAt: { gte: since } } }),
    prisma.dnsQueryEvent.count({ where: { connectionId: connection.id, isSuspicious: true, queriedAt: { gte: since } } }),
    prisma.dnsQueryEvent.findFirst({
      where: { connectionId: connection.id },
      orderBy: { queriedAt: 'desc' },
      select: { queriedAt: true },
    }),
    prisma.dnsQueryEvent.findMany({
      where: { connectionId: connection.id, queriedAt: { gte: since }, clientIp: { not: null } },
      distinct: ['clientIp'],
      select: { clientIp: true },
      take: 1000,
    }),
  ]);

  let adguard: DnsProxyStatus['adguard'] = { reachable: false };
  try {
    const client = new AdGuardClient(credentialsFromConnection(connection));
    const [status, queryLogConfig] = await Promise.all([
      client.getStatus(),
      client.getQueryLogConfig(),
    ]);
    adguard = {
      reachable: true,
      version: typeof status.version === 'string' ? status.version : undefined,
      protectionEnabled: typeof status.protection_enabled === 'boolean' ? status.protection_enabled : undefined,
      queryLogConfig,
    };
    await prisma.adGuardConnection.update({
      where: { id: connection.id },
      data: {
        queryLogEnabled: queryLogConfig.enabled,
        anonymizeClientIp: queryLogConfig.anonymize_client_ip,
      },
    });
  } catch (error: any) {
    adguard = { reachable: false, error: error.message || 'Unable to reach AdGuard Home' };
  }

  const liveAnonymized =
    adguard.reachable && adguard.queryLogConfig
      ? adguard.queryLogConfig.anonymize_client_ip
      : connection.anonymizeClientIp || undefined;
  const attribution = await calculateAttribution(connection.id, liveAnonymized);

  return {
    configured: true,
    settings: toSettingsView(connection),
    adguard,
    stats: {
      totalQueries,
      recentQueries,
      blockedQueries,
      suspiciousQueries,
      uniqueClients: clients.length,
      lastQueryAt: latestQuery?.queriedAt.toISOString(),
    },
    attribution,
  };
}

export async function getRecentDnsQueries(params: {
  page?: number;
  limit?: number;
  search?: string;
  client?: string;
  status?: 'all' | 'blocked' | 'allowed';
  suspiciousOnly?: boolean;
}) {
  const connection = await getActiveDnsProxyConnection();
  if (!connection) {
    return { queries: [], pagination: { page: 1, limit: params.limit || 50, total: 0, totalPages: 0 } };
  }

  const page = Math.max(1, params.page || 1);
  const limit = Math.min(200, Math.max(1, params.limit || 50));
  const where: Prisma.DnsQueryEventWhereInput = { connectionId: connection.id };

  if (params.search) {
    where.domain = { contains: params.search, mode: 'insensitive' };
  }
  if (params.client) {
    where.OR = [
      { clientIp: { contains: params.client, mode: 'insensitive' } },
      { clientName: { contains: params.client, mode: 'insensitive' } },
    ];
  }
  if (params.status === 'blocked') where.isBlocked = true;
  if (params.status === 'allowed') where.isBlocked = false;
  if (params.suspiciousOnly) where.isSuspicious = true;

  const [queries, total] = await Promise.all([
    prisma.dnsQueryEvent.findMany({
      where,
      orderBy: { queriedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        queriedAt: true,
        clientIp: true,
        clientName: true,
        domain: true,
        queryType: true,
        status: true,
        reason: true,
        rule: true,
        upstream: true,
        isBlocked: true,
        isSuspicious: true,
      },
    }),
    prisma.dnsQueryEvent.count({ where }),
  ]);

  return {
    queries: queries.map((query) => ({
      ...query,
      queriedAt: query.queriedAt.toISOString(),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getDnsSignals(params: { limit?: number; campaignId?: string } = {}) {
  const limit = Math.min(100, Math.max(1, params.limit || 25));
  const where: Prisma.DnsSignalWhereInput = {};
  if (params.campaignId) where.campaignId = params.campaignId;

  const signals = await prisma.dnsSignal.findMany({
    where,
    orderBy: { detectedAt: 'desc' },
    take: limit,
  });

  return signals.map((signal) => ({
    ...signal,
    detectedAt: signal.detectedAt.toISOString(),
    expiresAt: signal.expiresAt.toISOString(),
  }));
}

export async function cleanupExpiredDnsProxyData(): Promise<number> {
  const now = new Date();
  const bulkyJsonCutoff = new Date(Date.now() - BULKY_QUERY_JSON_RETENTION_HOURS * 60 * 60 * 1000);
  const [signals, events, scrubbedEvents] = await Promise.all([
    prisma.dnsSignal.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.dnsQueryEvent.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.dnsQueryEvent.updateMany({
      where: {
        ingestedAt: { lt: bulkyJsonCutoff },
        isSuspicious: false,
      },
      data: {
        answerJson: Prisma.DbNull,
        rulesJson: Prisma.DbNull,
        rawJson: Prisma.DbNull,
      },
    }),
  ]);
  return signals.count + events.count + scrubbedEvents.count;
}

export async function getDnsEvidenceForClients(params: {
  clientIps: string[];
  domains?: RegExp[];
  since: Date;
  limit?: number;
}) {
  const clientIps = Array.from(new Set(params.clientIps.filter(Boolean)));
  if (clientIps.length === 0) return [];

  const queries = await prisma.dnsQueryEvent.findMany({
    where: {
      clientIp: { in: clientIps },
      queriedAt: { gte: params.since },
      OR: [
        { isSuspicious: true },
        { reason: { in: SECURITY_DNS_REASONS } },
      ],
    },
    orderBy: { queriedAt: 'desc' },
    take: params.limit || 50,
  });

  const domainPatterns = params.domains || [];
  return queries.filter((query) => {
    if (query.isSuspicious || domainPatterns.length === 0) return true;
    return domainPatterns.some((pattern) => pattern.test(query.domain));
  });
}

export async function getNetworkLevelDnsSignals(params: { since: Date; limit?: number }) {
  return prisma.dnsSignal.findMany({
    where: { detectedAt: { gte: params.since } },
    orderBy: { detectedAt: 'desc' },
    take: params.limit || 50,
  });
}
