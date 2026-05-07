export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type VulnStatus = 'OPEN' | 'ACKNOWLEDGED' | 'FIXED' | 'FALSE_POSITIVE';
export type DeviceStatus = 'ONLINE' | 'OFFLINE' | 'TESTING' | 'UPDATING' | 'ERROR';
export type TestStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type DnsAttributionStatus = 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';

export interface DnsProxySettings {
  id: string;
  host: string;
  port: number;
  useHttps: boolean;
  allowSelfSigned: boolean;
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
  attributionStatus: DnsAttributionStatus;
  attributionReason?: string | null;
}

export interface DnsProxyQuery {
  id: string;
  queriedAt: string;
  clientIp?: string | null;
  clientName?: string | null;
  domain: string;
  queryType?: string | null;
  status?: string | null;
  reason?: string | null;
  rule?: string | null;
  upstream?: string | null;
  isBlocked: boolean;
  isSuspicious: boolean;
}

export interface DnsProxyQueriesResponse {
  queries: DnsProxyQuery[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DnsProxyStatus {
  configured: boolean;
  settings: DnsProxySettings | null;
  adguard?: {
    reachable: boolean;
    version?: string;
    protectionEnabled?: boolean;
    queryLogConfig?: {
      enabled?: boolean;
      anonymize_client_ip?: boolean;
      interval?: number | string;
    };
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
  attribution: {
    status: DnsAttributionStatus;
    reason: string;
    uniqueClientCount: number;
    matchedClientCount: number;
    sampleClients: string[];
  };
}

export interface DnsHourlyBucket {
  hour: string;
  allowed: number;
  blocked: number;
}

export interface DnsTopDomain {
  domain: string;
  count: number;
}

export interface DnsTopClient {
  mac: string;
  displayName: string;
  queries: number;
  blocked: number;
  suspicious: number;
  lastSeen: string;
  adguardName: string | null;
}

export interface DnsCoverageSilent {
  mac: string;
  displayName: string;
  lastIp?: string | null;
  adguardName: string | null;
}

export interface DnsCoverageUnknownSource {
  clientIp: string;
  clientName: string | null;
  queries: number;
  blocked: number;
  lastSeen: string;
}

export interface TrafficSummary {
  windowHours: number;
  since: string;
  totalBlocked: number;
  byRisk: { low: number; medium: number; high: number; concerning: number };
  uniqueSrcMacs: number;
  threatCount: number;
}

export interface TrafficTopPolicy {
  name: string;
  type: string | null;
  count: number;
}

export interface TrafficTopClient {
  mac: string;
  displayName: string;
  count: number;
}

export interface TrafficTopRegion {
  region: string;
  count: number;
}

export interface TrafficFlow {
  id: string;
  occurredAt: string;
  action: string;
  protocol: string | null;
  service: string | null;
  risk: string | null;
  direction: string | null;
  srcMac: string | null;
  srcClientName: string | null;
  srcNetworkName: string | null;
  dstIp: string | null;
  dstRegion: string | null;
  dstClientName: string | null;
  inNetworkName: string | null;
  outNetworkName: string | null;
  primaryPolicyName: string | null;
}

export interface TrafficThreat {
  id: string;
  occurredAt: string;
  severity: string | null;
  message: string | null;
  srcIp: string | null;
  dstIp: string | null;
  deviceMac: string | null;
}

export interface TrafficAnalytics {
  configured: boolean;
  windowHours: number;
  since: string;
  summary: TrafficSummary | null;
  topPolicies: TrafficTopPolicy[];
  topClients: TrafficTopClient[];
  topRegions: TrafficTopRegion[];
  recentFlows: TrafficFlow[];
  recentThreats: TrafficThreat[];
}

export interface DnsProxyAnalytics {
  configured: boolean;
  windowHours: number;
  since: string;
  hourlyBuckets: DnsHourlyBucket[];
  topBlocked: DnsTopDomain[];
  topAllowed: DnsTopDomain[];
  topClients: DnsTopClient[];
  coverage: {
    seen: DnsTopClient[];
    silent: DnsCoverageSilent[];
    unknownSources: DnsCoverageUnknownSource[];
    totals: { unifi: number; adguard: number; matched: number };
  };
}

export interface User {
  id: number;
  username: string;
  mustChangePassword?: boolean;
  lastLogin?: string;
}

export interface Device {
  id: string;
  deviceId: string;
  name: string;
  macAddress?: string;
  ipAddress?: string;
  firmwareVersion?: string;
  status: DeviceStatus;
  lastSeen?: string;
  configuredNetworks?: string[];
  testRunCount?: number;
}

export interface TestRun {
  id: string;
  deviceId: string;
  device?: { name: string; deviceId: string };
  configId?: string;
  testType: string;
  status: TestStatus;
  progress: number;
  currentStep?: string;
  startedAt: string;
  completedAt?: string;
  duration?: number;
  resultsJson?: unknown;
  errorMessage?: string;
  vulnerabilityCount?: number;
  serviceCount?: number;
}

export interface Vulnerability {
  id: string;
  testRunId?: string;
  testRun?: { id: string; testType: string };
  configId?: string;
  configuration?: { siteName: string };
  type: string;
  severity: Severity;
  title: string;
  description: string;
  impact?: string;
  remediation?: string;
  affectedResource?: string;
  cveId?: string;
  status: VulnStatus;
  firstSeen: string;
  lastSeen: string;
  notes?: string;
}

export interface Configuration {
  id: string;
  siteName?: string;
  controllerVersion?: string;
  importedAt: string;
  isActive: boolean;
  notes?: string;
  vulnerabilityCount?: number;
  testRunCount?: number;
}

// Honeypot types
export interface Honeypot {
  id: string;
  enabled: boolean;
  ipAddress: string;
  port: number;
  protocol: 'tcp' | 'udp';
  serviceType: string;
  networkId?: string;
  networkName?: string;
}

export interface DiscoveredService {
  id: number;
  testRunId: string;
  ipAddress: string;
  port: number;
  protocol: string;
  serviceName?: string;
  version?: string;
  banner?: string;
  discoveredAt: string;
  // Enriched from UniFi config
  deviceName?: string;
  deviceHostname?: string;
}

export interface DashboardData {
  securityScore: number | null;
  scoreBreakdown: {
    vulnerabilities: Record<Severity, number>;
    securityAnalysis: Record<Severity, number>;
    intentGaps: Record<Severity, number>;
    intentCompliance: number | null;
    analysisPassRate: number | null;
  };
  vulnerabilities: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    fromVulnerabilities: number;
    fromSecurityAnalysis: number;
    fromIntentGaps: number;
  };
  devices: {
    online: number;
    offline: number;
    testing: number;
    error: number;
    total: number;
  };
  intentCompliance: {
    score: number;
    compliant: boolean;
    gapCount: number;
    topGaps: Array<{
      category: string;
      severity: Severity;
      description: string;
    }>;
    configRequirements?: ConfigRequirement[];
  } | null;
  securityAnalysis: {
    totalRules: number;
    passed: number;
    failed: number;
    failedBySeverity?: Record<Severity, number>;
    topIssues: Array<{
      ruleId: string;
      ruleName: string;
      severity: Severity;
      category: string;
      findingCount: number;
    }>;
  } | null;
  lastTestRun: string | null;
  recentVulnerabilities: Vulnerability[];
  recentTests: TestRun[];
  hasConfig: boolean;
  hasIntentProfile: boolean;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ESP32 Setup types
export interface FirmwareInfo {
  version: string;
  filename: string;
  size: number;
  checksum: string;
  releaseDate: string;
  minHardwareVersion?: string;
}

export interface WlanInfo {
  ssid: string;
  security: string;
  isGuest: boolean;
  password?: string; // Only included when fetched with includePassword=true
}

export interface ESP32DeviceInfo {
  deviceId: string;
  macAddress: string;
  firmwareVersion?: string;
  isWifiConnected?: boolean;
  ipAddress?: string;
  ssid?: string;
  rssi?: number;
}

export interface ESP32VerifyResponse {
  deviceId: string;
  name: string;
  isOnline: boolean;
  ipAddress: string | null;
  firmwareVersion: string | null;
  lastSeen: string | null;
}

export interface MqttConfig {
  broker: string;
  port: number;
  username: string;
  password: string;
}

// Network Intent Profile types
export interface NetworkMappings {
  workNetworkId?: string;
  iotNetworkId?: string;
  guestNetworkId?: string;
  trustedNetworkId?: string;
  nasNetworkId?: string;
  serverNetworkId?: string;
}

// Device mappings for specific devices like NAS, servers
export interface DeviceMapping {
  mac: string;
  ip?: string;
  name?: string;
  networkId?: string;
}

export interface DeviceMappings {
  nasDevice?: DeviceMapping;
  serverDevice?: DeviceMapping;
}

// Discovered device from UniFi config
export interface DiscoveredDevice {
  mac: string;
  ip?: string;
  name?: string;
  hostname?: string;
  networkId?: string;
  networkName?: string;
  oui?: string;
  isWired?: boolean;
  lastSeen?: string;
}

export interface NetworkIntentProfile {
  // Work
  workFromHome: boolean;
  workDeviceIsolation: boolean;
  workIsolationMode?: 'phased' | 'strict';
  workVpn: boolean;
  homeServer: boolean;

  // Devices
  hasIoT: boolean;
  iotIsolation: boolean;
  iotInternetAccess: 'full' | 'limited' | 'none';
  hasGaming: boolean;
  hasNAS: boolean;
  nasAccessibleFrom: 'all' | 'trusted' | 'specific_vlans';

  // Guest
  guestNetwork: boolean;
  guestIsolation: boolean;
  guestBandwidthLimit: boolean;

  // Security
  securityLevel: 'maximum' | 'balanced' | 'convenience';
  dnsFiltering: boolean;
  dnsFilteringNetworks?: string[]; // Network IDs that should have DNS filtering
  dnsFilteringServerIp?: string; // IP address of DNS filtering server (AdGuard, Pi-hole, etc.)
  malwareBlocking: boolean;
  interVlanDefault: 'allow' | 'deny';
  reachabilityOverrides?: ReachabilityOverride[];

  // Network Mappings
  networkMappings?: NetworkMappings;

  // Device Mappings
  deviceMappings?: DeviceMappings;

  // Metadata
  completedAt: string;
  version: number;
}

export type IntentNetworkCategory =
  | 'default'
  | 'home'
  | 'work'
  | 'iot'
  | 'guest'
  | 'trusted'
  | 'nas'
  | 'server';

export interface ReachabilityOverride {
  sourceCategory: IntentNetworkCategory;
  targetCategory: IntentNetworkCategory;
  action: 'allow' | 'block';
  reason?: string;
}

export interface IntentGap {
  intent: string;
  reality: string;
  severity: Severity;
  remediation: string;
  // Dismissal fields
  settingId?: string;
  isDismissed?: boolean;
  dismissalId?: string;
  dismissalReason?: string;
}

// Individual setting evaluation
export type IntentSettingStatus = 'configured' | 'not_configured' | 'partial' | 'not_applicable';

export interface IntentSettingEvaluation {
  id: string;
  category: 'work' | 'devices' | 'guest' | 'security';
  name: string;
  description: string;
  required: boolean;
  status: IntentSettingStatus;
  severity: Severity;
  currentValue?: string;
  expectedValue?: string;
  mappedNetwork?: {
    id: string;
    name: string;
    vlan?: number;
    hasVlan: boolean;
  };
  mappedDevice?: {
    mac: string;
    ip?: string;
    name?: string;
  };
  requiresDeviceMapping?: boolean;
  remediation?: string;
  // Dismissal fields
  isDismissed?: boolean;
  dismissalId?: string;
  dismissalReason?: string;
}

export interface ConfigRequirement {
  id: string;
  type: 'network_mapping' | 'device_mapping' | 'controller_connection' | 'config_sync';
  message: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  action: string;
  actionPath: string;
}

export interface IntentAnalysisResult {
  compliant: boolean;
  score: number;
  gaps: IntentGap[];
  settings: IntentSettingEvaluation[];
  summary: {
    total: number;
    configured: number;
    notConfigured: number;
    partial: number;
    notApplicable: number;
    dismissed?: number;
  };
  configRequirements?: ConfigRequirement[];
  // Timestamps
  configImportedAt?: string;
  configSiteName?: string;
  analyzedAt?: string;
}

export interface UniFiNetwork {
  _id: string;
  name: string;
  purpose: string;
  vlan?: number;
  vlan_enabled?: boolean;
  subnet?: string;
}

// Security Rule System types
export type RuleCategory =
  | 'firewall'
  | 'vlan'
  | 'dns'
  | 'port'
  | 'upnp'
  | 'wireless'
  | 'general'
  | 'ids_ips'
  | 'access_control'
  | 'switch'
  | 'optimization';

export interface RuleSource {
  id: string;
  name: string;
  description: string;
  url?: string;
  license?: string;
}

export interface RuleFinding {
  title: string;
  description: string;
  impact: string;
  remediation: string;
  affectedResource?: string;
  details?: string;
  currentValue?: string;
  expectedValue?: string;
  // Dismissal fields
  isDismissed?: boolean;
  dismissalId?: string;
  dismissalReason?: string;
}

export interface RuleEvaluationResult {
  ruleId: string;
  ruleName: string;
  ruleDescription: string;
  sourceId: string;
  sourceName: string;
  category: RuleCategory;
  severity: Severity;
  passed: boolean;
  findings: RuleFinding[];
}

export interface SecurityAnalysisResult {
  analyzedAt: string;
  duration: number;
  configId?: string;
  configSiteName?: string;
  configImportedAt?: string;
  summary: {
    totalRules: number;
    passed: number;
    failed: number;
    dismissed?: number;
    bySeverity: Record<Severity, number>;
    bySource: Record<string, number>;
    byCategory: Record<RuleCategory, number>;
  };
  results: RuleEvaluationResult[];
}

// Finding Dismissal types
export type FindingType = 'RULE' | 'INTENT_GAP';

export interface FindingDismissal {
  id: string;
  findingType: FindingType;
  findingId: string;
  affectedResource: string | null;
  reason: string;
  dismissedAt: string;
  isActive: boolean;
}

export interface SecurityRule {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  severity: Severity;
}

// Network Connectivity Validation types
export interface ConnectivityValidationResult {
  canReachServer: boolean;
  sourceNetwork: {
    id: string;
    name: string;
    vlanId: number | null;
    subnet: string | null;
  } | null;
  serverNetwork: {
    id: string;
    name: string;
    vlanId: number | null;
    subnet: string | null;
  } | null;
  serverIp: string;
  blockedReason?: 'firewall' | 'isolation' | 'both' | 'no_route' | 'same_network';
  blockDetails?: string;
  firewallRules?: Array<{ name: string; action: string }>;
  recommendation?: string;
  // Device-specific policies that may override network-level blocks
  devicePolicies?: Array<{ name: string; action: string; targetsMac: boolean }>;
  hasDeviceOverride?: boolean;
}

// Notification types
export type NotificationType =
  | 'NEW_VULNERABILITIES' | 'CONFIG_CHANGED' | 'SYNC_FAILED'
  | 'SYNC_COMPLETED' | 'SECURITY_SCORE_DECREASED'
  | 'NEW_DEVICES' | 'FIRMWARE_UPDATE';

export interface Notification {
  id: string;
  type: NotificationType;
  severity: Severity;
  title: string;
  message: string;
  resourceType?: string;
  resourceId?: string;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
}

// Timeline types
export type TimelineFilter = 'all' | 'security' | 'config' | 'devices' | 'clients' | 'firmware';
export type TimelineGroupBy = 'day' | 'week' | 'month';

export interface TimelineEvent {
  id: string;
  changeType: 'CREATED' | 'MODIFIED' | 'DELETED';
  resourceType: string;
  resourceId?: string;
  resourceName?: string;
  previousValue?: unknown;
  newValue?: unknown;
  detectedAt: string;
}

export interface TimelineGroup {
  period: string;
  label: string;
  summary: {
    total: number;
    newClients: number;
    removedClients: number;
    deviceChanges: number;
    configChanges: number;
    securityChanges: number;
    firmwareUpdates: number;
  };
  events: TimelineEvent[];
}

export interface TimelineStats {
  totalSyncs: number;
  totalChanges: number;
  totalClients: number;
  firstSyncDate: string | null;
  latestSyncDate: string | null;
  firstEventDate: string | null;
  changesByType: Record<string, number>;
}

export interface TimelineHistogramEntry {
  date: string;
  security: number;
  config: number;
  clients: number;
  devices: number;
  firmware: number;
  total: number;
}

// Clients by Network types
export type TrustLevel = 'trusted' | 'untrusted' | 'unknown';

export interface NetworkGroupClient {
  mac: string;
  hostname?: string;
  displayName?: string;
  oui?: string;
  lastIp?: string;
  isWired: boolean;
  deviceName?: string;
  uplinkName?: string;
  unifiFirstSeen?: string;
  unifiLastSeen?: string;
}

export interface NetworkGroup {
  networkId: string | null;
  name: string;
  vlan: number | null;
  subnet: string | null;
  purpose: string | null;
  trustLevel: TrustLevel;
  intentPurpose: string | null;
  ssids: string[];
  clientCount: number;
  clients: NetworkGroupClient[];
}

export interface ClientsByNetworkData {
  networks: NetworkGroup[];
  totalClients: number;
  hasIntentProfile: boolean;
}

export interface NetworkClientDetail {
  mac: string;
  hostname?: string;
  displayName?: string;
  oui?: string;
  lastIp?: string;
  lastNetworkName?: string;
  isWired: boolean;
  unifiFirstSeen?: string;
  unifiLastSeen?: string;
  network?: { name: string; vlan?: number; subnet?: string; isGuest?: boolean };
  applicableFirewallRules?: Array<{ name: string; action: string; direction: string }>;
  wifiNetwork?: { ssid: string; security: string };
}
