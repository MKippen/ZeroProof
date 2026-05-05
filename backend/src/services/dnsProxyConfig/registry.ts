import type { AdGuardConnection } from '@prisma/client';

export type ClientIdentifierKind = 'ip' | 'mac' | 'clientid' | 'hostname';

export interface NormalizedClientIdentifier {
  kind: ClientIdentifierKind;
  value: string;
}

export interface NormalizedDnsProxyClient {
  name: string;
  identifiers: NormalizedClientIdentifier[];
  tags: string[];
  /** True when the client just inherits global settings — no per-device policy. */
  usesGlobalSettings: boolean;
  filteringEnabled: boolean | null;
  safeBrowsingEnabled: boolean | null;
  parentalEnabled: boolean | null;
  blockedServices: string[];
  upstreams: string[];
}

export interface NormalizedDnsProxyAutoClient {
  name: string;
  ip: string;
  source: string;
}

export interface DnsProxyAuditInputs {
  provider: string;
  persistentClients: NormalizedDnsProxyClient[];
  autoClients: NormalizedDnsProxyAutoClient[];
}

export interface DnsProxyConfigAdapter {
  /** Stable provider identifier. Must match AdGuardConnection.provider once that field exists. */
  provider: string;
  /** Fetch and normalize whatever audit-relevant config the provider exposes. */
  fetchAuditInputs(connection: AdGuardConnection): Promise<DnsProxyAuditInputs>;
}

const adapters = new Map<string, DnsProxyConfigAdapter>();

export function registerDnsProxyConfigAdapter(adapter: DnsProxyConfigAdapter): () => void {
  adapters.set(adapter.provider, adapter);
  return () => {
    if (adapters.get(adapter.provider) === adapter) {
      adapters.delete(adapter.provider);
    }
  };
}

export function getDnsProxyConfigAdapter(provider: string): DnsProxyConfigAdapter | undefined {
  return adapters.get(provider);
}

export function listDnsProxyConfigAdapters(): DnsProxyConfigAdapter[] {
  return Array.from(adapters.values());
}

/** Test-only. */
export function resetDnsProxyConfigAdapters(): void {
  adapters.clear();
}

/**
 * Classifies an AdGuard client identifier string into one of the durable kinds.
 * AdGuard's `ids` array can contain IPv4/IPv6 (fragile), MAC (durable),
 * a ClientID set via DHCP option 12 (durable), or a CIDR / hostname.
 */
export function classifyClientIdentifier(raw: string): ClientIdentifierKind {
  const trimmed = raw.trim();
  if (!trimmed) return 'clientid';
  if (/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(trimmed)) return 'mac';
  if (/^([0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}$/.test(trimmed)) return 'mac';
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/.test(trimmed)) return 'ip';
  if (/^[0-9a-fA-F:]+$/.test(trimmed) && trimmed.includes(':')) return 'ip'; // simplistic IPv6
  if (/^[a-zA-Z][a-zA-Z0-9\-_.]*$/.test(trimmed) && trimmed.includes('.')) return 'hostname';
  return 'clientid';
}
