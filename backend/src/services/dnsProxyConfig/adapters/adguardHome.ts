import type { AdGuardConnection } from '@prisma/client';
import { AdGuardClient, AdGuardPersistentClient, AdGuardAutoClient } from '../../adguardClient';
import { decrypt } from '../../../utils/encryption';
import {
  DnsProxyAuditInputs,
  DnsProxyConfigAdapter,
  NormalizedDnsProxyAutoClient,
  NormalizedDnsProxyClient,
  classifyClientIdentifier,
} from '../registry';

export const ADGUARD_PROVIDER = 'adguard_home';

export function normalizeAdGuardPersistentClient(raw: AdGuardPersistentClient): NormalizedDnsProxyClient {
  const ids = (raw.ids || []).map((id) => String(id || '').trim()).filter(Boolean);
  const usesGlobal = raw.use_global_settings !== false;
  return {
    name: (raw.name || '').trim() || ids[0] || 'Unnamed client',
    identifiers: ids.map((value) => ({ value, kind: classifyClientIdentifier(value) })),
    tags: (raw.tags || []).map((t) => String(t)),
    usesGlobalSettings: usesGlobal,
    filteringEnabled: usesGlobal ? null : Boolean(raw.filtering_enabled),
    safeBrowsingEnabled: usesGlobal ? null : Boolean(raw.safebrowsing_enabled),
    parentalEnabled: usesGlobal ? null : Boolean(raw.parental_enabled),
    blockedServices: raw.use_global_blocked_services === false ? raw.blocked_services || [] : [],
    upstreams: raw.upstreams || [],
  };
}

function normalizeAdGuardAutoClient(raw: AdGuardAutoClient): NormalizedDnsProxyAutoClient | null {
  const ip = String(raw.ip || '').trim();
  if (!ip) return null;
  return {
    ip,
    name: (raw.name || '').trim(),
    source: (raw.source || '').trim() || 'unknown',
  };
}

export const adguardHomeConfigAdapter: DnsProxyConfigAdapter = {
  provider: ADGUARD_PROVIDER,
  async fetchAuditInputs(connection: AdGuardConnection): Promise<DnsProxyAuditInputs> {
    const client = new AdGuardClient({
      host: connection.host,
      port: connection.port,
      useHttps: connection.useHttps,
      allowSelfSigned: connection.allowSelfSigned,
      username: connection.usernameEnc ? decrypt(connection.usernameEnc) : '',
      password: connection.passwordEnc ? decrypt(connection.passwordEnc) : '',
    });

    const response = await client.getPersistentClients();
    const persistentClients = (response.clients || []).map(normalizeAdGuardPersistentClient);
    const autoClients = (response.auto_clients || [])
      .map(normalizeAdGuardAutoClient)
      .filter((c): c is NormalizedDnsProxyAutoClient => c !== null);

    return {
      provider: ADGUARD_PROVIDER,
      persistentClients,
      autoClients,
    };
  },
};
