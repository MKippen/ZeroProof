import { z } from 'zod';

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
}

export interface ApiError {
  code: string;
  message: string;
  details?: string;
}

// Auth types
export interface SessionUser {
  id: number;
}

// Express type augmentations are in types/express.d.ts

// Zod Schemas for validation
export const LoginSchema = z.object({
  password: z.string().min(8).max(100),
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(8),
  newPassword: z.string().min(8).max(100),
});

export const StartTestSchema = z.object({
  deviceId: z.string(),
  testType: z.enum(['connectivity', 'quick_scan', 'port_scan', 'vlan_isolation', 'service_discovery', 'gateway_audit', 'full_audit', 'honeypot_validation', 'topology_validation', 'device_to_device']),
  configId: z.string().optional(),
  options: z
    .object({
      portRange: z.string().optional(),
      targetVlans: z.array(z.number()).optional(),
      timeout: z.number().optional(),
      excludeHoneypots: z.boolean().optional(), // Exclude honeypot IPs from scan
      honeypotIds: z.array(z.string()).optional(), // Specific honeypots to test (for honeypot_validation)
    })
    .optional(),
});

export const UpdateVulnerabilitySchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'FIXED', 'FALSE_POSITIVE']).optional(),
  notes: z.string().optional(),
});

export const DeviceWifiSchema = z.object({
  ssid: z.string().min(1).max(32),
  password: z.string().min(8).max(63),
});

// ESP32 Provisioning schemas
export const ESP32ProvisionSchema = z.object({
  deviceId: z.string().min(1).max(32),
  name: z.string().min(1).max(50),
  macAddress: z.string().regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/),
});

// ESP32 types
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
  password?: string; // Only included when explicitly requested for ESP32 provisioning
}

export interface ESP32ProvisionRequest {
  deviceId: string;
  name: string;
  macAddress: string;
}

// Honeypot types
export interface UniFiHoneypot {
  _id?: string;
  enabled: boolean;
  ip_address: string;
  port: number;
  protocol?: 'tcp' | 'udp';
  service_type?: string; // e.g., 'ssh', 'http', 'telnet'
  network_id?: string;
}

// UniFi Config types
export interface UniFiConfig {
  version?: string;
  site?: UniFiSite;
  networks?: UniFiNetwork[];
  firewallRules?: UniFiFirewallRule[];
  portForwards?: UniFiPortForward[];
  wlanConf?: UniFiWlan[];
  devices?: UniFiDevice[];
  honeypots?: UniFiHoneypot[];
  /** sysinfo version fields used for security-advisory analysis (SAB-064 etc.) */
  sysInfo?: UniFiSysInfo;
}

export interface UniFiSysInfo {
  /** UniFi Network Application version (e.g. "9.x"). NOT the UniFi OS version. */
  version?: string;
  /** UniFi OS / console firmware version (e.g. "5.1.12") that advisories are versioned against. */
  udm_version?: string;
  build?: string;
}

export interface UniFiSite {
  name: string;
  desc?: string;
  _id?: string;
}

export interface UniFiNetwork {
  _id?: string;
  name: string;
  purpose: string;
  vlan?: number;
  vlan_enabled?: boolean;
  subnet?: string;
  dhcpd_enabled?: boolean;
  dhcpd_start?: string;
  dhcpd_stop?: string;
  domain_name?: string;
  networkgroup?: string;
  igmp_snooping?: boolean;
  network_isolation?: boolean;
}

export interface UniFiFirewallRule {
  _id?: string;
  name: string;
  enabled: boolean;
  ruleset: string;
  rule_index: number;
  action: 'accept' | 'drop' | 'reject';
  protocol: string;
  protocol_match_excepted?: boolean;
  src_firewallgroup_ids?: string[];
  dst_firewallgroup_ids?: string[];
  src_address?: string;
  dst_address?: string;
  src_port?: string;
  dst_port?: string;
  logging?: boolean;
  state_new?: boolean;
  state_established?: boolean;
  state_related?: boolean;
  state_invalid?: boolean;
}

export interface UniFiPortForward {
  _id?: string;
  name: string;
  enabled: boolean;
  src?: string;
  dst_port: string;
  fwd: string;
  fwd_port: string;
  proto: string;
  log?: boolean;
}

export interface UniFiWlan {
  _id?: string;
  name: string;
  enabled: boolean;
  security: string;
  wpa_mode?: string;
  wpa_enc?: string;
  is_guest?: boolean;
  networkconf_id?: string;
  vlan?: number;
  vlan_enabled?: boolean;
  hide_ssid?: boolean;
  pmf_mode?: string;
  l2_isolation?: boolean;
}

export interface UniFiDevice {
  _id?: string;
  mac: string;
  name?: string;
  model?: string;
  type: string;
  version?: string;
  ip?: string;
}

// Test types
export interface TestCommand {
  testId: string;
  deviceId: string;
  testType: string;
  options?: Record<string, unknown>;
}

export interface TestProgress {
  testId: string;
  deviceId: string;
  progress: number;
  currentStep: string;
}

export interface TestResult {
  testId: string;
  deviceId: string;
  success: boolean;
  results: unknown;
  error?: string;
  duration: number;
  transport?: {
    chunked?: boolean;
    chunkCount?: number;
    receivedChunks?: number;
    truncated?: boolean;
    incomplete?: boolean;
    reason?: string;
  };
}

// Vulnerability types
export type VulnerabilitySource = 'internal' | 'networkoptimizer' | 'custom';

export interface VulnerabilityFinding {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  impact?: string;
  remediation?: string;
  affectedResource?: string;
  cveId?: string;
  // Scanner integration fields
  source?: VulnerabilitySource;
  externalId?: string;      // Original ID from external scanner
  externalCategory?: string; // Category in external system
  confidence?: number;       // 0-100 confidence score
  rawData?: Record<string, unknown>; // Original scanner output for debugging
}

// Dashboard types
export interface DashboardStats {
  securityScore: number;
  totalVulnerabilities: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  devicesOnline: number;
  devicesOffline: number;
  lastTestRun?: Date;
  recentFindings: VulnerabilityFinding[];
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
  // Can add more device types as needed
}

// Discovered device from UniFi config
export interface DiscoveredDevice {
  mac: string;
  ip?: string;
  name?: string;
  hostname?: string;
  networkId?: string;
  networkName?: string;
  oui?: string; // Manufacturer from MAC lookup
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

  // Device Mappings (for specific devices like NAS, server)
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
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  remediation: string;
  // Dismissal fields
  settingId?: string; // Links gap to the setting for dismissal matching
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
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
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
  requiresDeviceMapping?: boolean; // Indicates this setting needs a device selected
  remediation?: string;
  // Dismissal fields
  isDismissed?: boolean;
  dismissalId?: string;
  dismissalReason?: string;
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
  /** Tracks configuration actions needed for accurate analysis */
  configRequirements?: ConfigRequirement[];
}

/** A configuration action the user needs to take for full analysis */
export interface ConfigRequirement {
  id: string;
  type: 'network_mapping' | 'device_mapping' | 'controller_connection' | 'config_sync';
  message: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Where the user should go to fix this */
  action: string;
  actionPath: string;
}

// Zod schema for network mappings
export const NetworkMappingsSchema = z.object({
  workNetworkId: z.string().optional(),
  iotNetworkId: z.string().optional(),
  guestNetworkId: z.string().optional(),
  trustedNetworkId: z.string().optional(),
  nasNetworkId: z.string().optional(),
  serverNetworkId: z.string().optional(),
});

// Zod schema for intent validation
export const NetworkIntentProfileSchema = z.object({
  workFromHome: z.boolean(),
  workDeviceIsolation: z.boolean(),
  workIsolationMode: z.enum(['phased', 'strict']).optional(),
  workVpn: z.boolean(),
  homeServer: z.boolean(),
  hasIoT: z.boolean(),
  iotIsolation: z.boolean(),
  iotInternetAccess: z.enum(['full', 'limited', 'none']),
  hasGaming: z.boolean(),
  hasNAS: z.boolean(),
  nasAccessibleFrom: z.enum(['all', 'trusted', 'specific_vlans']),
  guestNetwork: z.boolean(),
  guestIsolation: z.boolean(),
  guestBandwidthLimit: z.boolean(),
  securityLevel: z.enum(['maximum', 'balanced', 'convenience']),
  dnsFiltering: z.boolean(),
  dnsFilteringNetworks: z.array(z.string()).optional(),
  dnsFilteringServerIp: z.string().optional(),
  malwareBlocking: z.boolean(),
  interVlanDefault: z.enum(['allow', 'deny']),
  reachabilityOverrides: z
    .array(
      z.object({
        sourceCategory: z.enum(['default', 'home', 'work', 'iot', 'guest', 'trusted', 'nas', 'server']),
        targetCategory: z.enum(['default', 'home', 'work', 'iot', 'guest', 'trusted', 'nas', 'server']),
        action: z.enum(['allow', 'block']),
        reason: z.string().optional(),
      })
    )
    .optional(),
  networkMappings: NetworkMappingsSchema.optional(),
  completedAt: z.string().optional(),
  version: z.number().optional(),
});

export type { Severity, VulnStatus, DeviceStatus, TestStatus } from '@prisma/client';
