/**
 * Threat-intel orchestrator. Owns:
 *  - the in-process feed registry (one entry per `IocFeed` adapter)
 *  - scheduled refresh: fetch each feed, upsert into the `IocEntry` cache,
 *    and prune entries that fell out of the upstream list more than
 *    `STALE_DAYS` ago
 *  - lookups for detectors: `lookupIp(value)` / `lookupDomain(value)` —
 *    reads ONLY from the cache, never from the network
 *
 * Feeds register themselves at boot via `registerFeed()`. Detectors then call
 * `lookup*` against the cached `IocEntry` table during evaluation, so a feed
 * outage never stalls detection.
 */
import prisma from '../database';
import logger from '../../utils/logger';
import type { IocFeed, IocRecord } from './feed';

/** Entries not seen in any refresh for this many days are pruned. */
const DEFAULT_STALE_DAYS = 14;

/** Upsert chunk size — keep under DB parameter limits when we widen feeds. */
const UPSERT_CHUNK_SIZE = 200;

const feeds = new Map<string, IocFeed>();

export function registerFeed(feed: IocFeed): () => void {
  feeds.set(feed.id, feed);
  return () => {
    if (feeds.get(feed.id) === feed) feeds.delete(feed.id);
  };
}

export function getFeed(id: string): IocFeed | undefined {
  return feeds.get(id);
}

export function listFeeds(): IocFeed[] {
  return Array.from(feeds.values());
}

/** Test-only. */
export function resetFeeds(): void {
  feeds.clear();
}

export interface RefreshFeedOutcome {
  feedId: string;
  fetched: number;
  upserted: number;
  durationMs: number;
  error?: string;
}

export interface RefreshAllOutcome {
  feeds: RefreshFeedOutcome[];
  prunedStale: number;
}

export interface RefreshAllOptions {
  /** Override the default stale-prune cutoff (days). */
  staleDays?: number;
  /** Run only this subset of feeds (by id) — others are left untouched. */
  feedIds?: ReadonlyArray<string>;
}

/**
 * Refresh every registered feed independently. A failure in one feed never
 * stops the others; the caller logs the per-feed error.
 */
export async function refreshAllFeeds(
  options: RefreshAllOptions = {}
): Promise<RefreshAllOutcome> {
  const targets = options.feedIds
    ? listFeeds().filter((f) => options.feedIds!.includes(f.id))
    : listFeeds();

  const outcomes: RefreshFeedOutcome[] = [];
  for (const feed of targets) {
    outcomes.push(await refreshFeed(feed));
  }

  const prunedStale = await pruneStale(options.staleDays ?? DEFAULT_STALE_DAYS);
  return { feeds: outcomes, prunedStale };
}

async function refreshFeed(feed: IocFeed): Promise<RefreshFeedOutcome> {
  const started = Date.now();
  try {
    const records = await feed.fetch();
    const upserted = await upsertBatch(feed.id, records);
    const durationMs = Date.now() - started;
    logger.info(
      `IOC feed ${feed.id}: fetched ${records.length}, upserted ${upserted} (${durationMs}ms)`
    );
    return { feedId: feed.id, fetched: records.length, upserted, durationMs };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`IOC feed ${feed.id} refresh failed: ${message}`);
    return {
      feedId: feed.id,
      fetched: 0,
      upserted: 0,
      durationMs: Date.now() - started,
      error: message,
    };
  }
}

async function upsertBatch(
  feedId: string,
  records: ReadonlyArray<IocRecord>
): Promise<number> {
  const now = new Date();
  let upserted = 0;
  for (let i = 0; i < records.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = records.slice(i, i + UPSERT_CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (record) => {
        if (!record.value) return;
        await prisma.iocEntry.upsert({
          where: {
            feed_kind_value: { feed: feedId, kind: record.kind, value: record.value },
          },
          create: {
            feed: feedId,
            kind: record.kind,
            value: record.value,
            category: record.category ?? null,
            severity: record.severity ?? null,
            context: (record.context ?? undefined) as object | undefined,
            refreshedAt: now,
          },
          update: {
            category: record.category ?? null,
            severity: record.severity ?? null,
            context: (record.context ?? undefined) as object | undefined,
            refreshedAt: now,
          },
        });
        upserted += 1;
      })
    );
  }
  return upserted;
}

async function pruneStale(staleDays: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const result = await prisma.iocEntry.deleteMany({
    where: { refreshedAt: { lt: cutoff } },
  });
  if (result.count > 0) {
    logger.info(`IOC cache: pruned ${result.count} stale entries (>${staleDays}d)`);
  }
  return result.count;
}

export interface IocLookupHit {
  feed: string;
  kind: string;
  value: string;
  category: string | null;
  severity: string | null;
  context: unknown;
  refreshedAt: Date;
}

/**
 * Cache lookup for an IPv4/IPv6 address. Returns every feed that flags this
 * indicator so the detector can score by feed reputation.
 */
export async function lookupIp(ip: string): Promise<IocLookupHit[]> {
  const value = ip.trim().toLowerCase();
  if (!value) return [];
  return prisma.iocEntry.findMany({
    where: { kind: 'ip', value },
    select: {
      feed: true,
      kind: true,
      value: true,
      category: true,
      severity: true,
      context: true,
      refreshedAt: true,
    },
  });
}

/**
 * Cache lookup for a DNS name. Matches the exact host first, then walks up
 * the parent labels (e.g. `c2.example.com` → `example.com` → `com`) so a
 * feed entry on a parent zone catches subdomains.
 */
export async function lookupDomain(domain: string): Promise<IocLookupHit[]> {
  const normalized = domain.trim().toLowerCase().replace(/\.$/, '');
  if (!normalized) return [];

  const candidates: string[] = [normalized];
  const parts = normalized.split('.');
  // Walk up to the eTLD+1 only — single-label TLDs are never useful as IOCs.
  for (let i = 1; i < parts.length - 1; i += 1) {
    candidates.push(parts.slice(i).join('.'));
  }

  return prisma.iocEntry.findMany({
    where: { kind: 'domain', value: { in: candidates } },
    select: {
      feed: true,
      kind: true,
      value: true,
      category: true,
      severity: true,
      context: true,
      refreshedAt: true,
    },
  });
}

export interface IocCacheStats {
  total: number;
  byFeed: Record<string, number>;
  byKind: Record<string, number>;
  oldestRefreshedAt: Date | null;
}

/** Surface for the dashboard / health route. */
export async function getIocCacheStats(): Promise<IocCacheStats> {
  const [total, byFeedRows, byKindRows, oldest] = await Promise.all([
    prisma.iocEntry.count(),
    prisma.iocEntry.groupBy({ by: ['feed'], _count: { _all: true } }),
    prisma.iocEntry.groupBy({ by: ['kind'], _count: { _all: true } }),
    prisma.iocEntry.findFirst({
      orderBy: { refreshedAt: 'asc' },
      select: { refreshedAt: true },
    }),
  ]);

  const byFeed: Record<string, number> = {};
  for (const row of byFeedRows as Array<{ feed: string; _count: { _all: number } }>) {
    byFeed[row.feed] = row._count._all;
  }
  const byKind: Record<string, number> = {};
  for (const row of byKindRows as Array<{ kind: string; _count: { _all: number } }>) {
    byKind[row.kind] = row._count._all;
  }

  return {
    total,
    byFeed,
    byKind,
    oldestRefreshedAt: oldest?.refreshedAt ?? null,
  };
}
