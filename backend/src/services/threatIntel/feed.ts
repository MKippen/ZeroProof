/**
 * Pluggable interface for an IOC feed source. Each feed knows how to fetch
 * its data, normalize it into IocRecord shape, and self-identify with a
 * stable id. Adding a new feed is one file in `feeds/`.
 *
 * Feeds NEVER hit the network from inside detectors — they're refreshed on
 * a schedule by `iocFeedService.refreshAllFeeds()` and cached in `IocEntry`.
 */

export interface IocRecord {
  /** Indicator type. */
  kind: 'ip' | 'domain' | 'url' | 'hash';
  /** Normalized indicator value (lower-cased, no surrounding whitespace). */
  value: string;
  /** Optional category (e.g. "malware-c2", "phishing"). Stored as-is. */
  category?: string;
  /** Optional severity hint provided by the feed. */
  severity?: string;
  /** Feed-specific context (timestamps, tags, sample URL, etc.). */
  context?: Record<string, unknown>;
}

export interface IocFeed {
  /** Stable kebab-case identifier. */
  readonly id: string;
  /** Human-readable name for logs / dashboard. */
  readonly name: string;
  /** Where this feed is documented. */
  readonly homepage: string;
  /** License — surfaces in EXTERNALS / dashboard. */
  readonly license: string;
  /**
   * Fetch the latest entries. Implementations should:
   *   - throw on transport / parse errors so the caller can log them
   *   - return only well-formed records (skip malformed lines silently)
   *   - normalize values (lower-case domains, strip CIDR /32 from IPs)
   */
  fetch(): Promise<IocRecord[]>;
}
