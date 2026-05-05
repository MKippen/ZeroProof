export {
  registerDnsProxyConfigAdapter,
  getDnsProxyConfigAdapter,
  listDnsProxyConfigAdapters,
  resetDnsProxyConfigAdapters,
  classifyClientIdentifier,
} from './registry';
export type {
  DnsProxyConfigAdapter,
  DnsProxyAuditInputs,
  NormalizedDnsProxyClient,
  NormalizedDnsProxyAutoClient,
  NormalizedClientIdentifier,
  ClientIdentifierKind,
} from './registry';
export { adguardHomeConfigAdapter, ADGUARD_PROVIDER, normalizeAdGuardPersistentClient } from './adapters/adguardHome';

import { registerDnsProxyConfigAdapter } from './registry';
import { adguardHomeConfigAdapter } from './adapters/adguardHome';

/**
 * Registers the built-in DNS proxy config adapters that ship with ZeroProof.
 * Currently AdGuard Home is the only supported provider; new providers should
 * register additional adapters here.
 *
 * Idempotent: re-registering an adapter with the same provider key replaces it.
 */
export function registerBuiltinDnsProxyConfigAdapters(): void {
  registerDnsProxyConfigAdapter(adguardHomeConfigAdapter);
}
