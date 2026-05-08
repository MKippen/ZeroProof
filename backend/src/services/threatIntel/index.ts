/**
 * Threat-intel boot module. Registers built-in IocFeed adapters with the
 * orchestrator. Call `bootstrapThreatIntel()` once at server / scheduler
 * boot — registration is idempotent so it's safe to call again.
 */
import { registerFeed } from './iocFeedService';
import { createUrlhausFeed } from './feeds/urlhaus';

let booted = false;

export function bootstrapThreatIntel(): void {
  if (booted) return;
  registerFeed(createUrlhausFeed());
  booted = true;
}

/** Test-only — re-arm bootstrap so tests can register their own stubs. */
export function resetThreatIntelBootstrap(): void {
  booted = false;
}

export {
  registerFeed,
  listFeeds,
  refreshAllFeeds,
  lookupIp,
  lookupDomain,
  getIocCacheStats,
} from './iocFeedService';
export type { IocFeed, IocRecord } from './feed';
