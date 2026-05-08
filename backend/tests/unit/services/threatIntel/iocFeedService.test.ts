/**
 * iocFeedService — registry, refresh orchestration, and detector lookups.
 * Prisma is mocked at the global setup level; we feed in stub feeds.
 */
import {
  registerFeed,
  listFeeds,
  resetFeeds,
  refreshAllFeeds,
  lookupIp,
  lookupDomain,
  getIocCacheStats,
} from '../../../../src/services/threatIntel/iocFeedService';
import type { IocFeed, IocRecord } from '../../../../src/services/threatIntel/feed';
import prisma from '../../../../src/services/database';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

function makeFeed(id: string, records: IocRecord[]): IocFeed {
  return {
    id,
    name: `Feed ${id}`,
    homepage: `https://example.invalid/${id}`,
    license: 'CC0-1.0',
    fetch: jest.fn().mockResolvedValue(records),
  };
}

beforeEach(() => {
  resetFeeds();
  jest.clearAllMocks();
});

describe('feed registry', () => {
  it('register and list', () => {
    const feed = makeFeed('a', []);
    registerFeed(feed);
    expect(listFeeds()).toEqual([feed]);
  });

  it('register returns an unregister callback', () => {
    const original = makeFeed('a', []);
    const off = registerFeed(original);

    // Re-register a different instance under same id; the original's
    // unregister should NOT remove the replacement.
    const replacement = makeFeed('a', []);
    registerFeed(replacement);
    off();

    expect(listFeeds()).toEqual([replacement]);
  });
});

describe('refreshAllFeeds', () => {
  it('upserts every record from every registered feed', async () => {
    registerFeed(
      makeFeed('alpha', [
        { kind: 'ip', value: '1.2.3.4', category: 'c2' },
        { kind: 'domain', value: 'evil.example' },
      ])
    );
    registerFeed(makeFeed('beta', [{ kind: 'ip', value: '5.6.7.8' }]));

    (mockedPrisma.iocEntry.upsert as jest.Mock).mockResolvedValue({});
    (mockedPrisma.iocEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    const outcome = await refreshAllFeeds();

    expect(outcome.feeds).toHaveLength(2);
    expect(outcome.feeds.map((f) => f.feedId).sort()).toEqual(['alpha', 'beta']);
    expect(outcome.feeds.find((f) => f.feedId === 'alpha')?.upserted).toBe(2);
    expect(outcome.feeds.find((f) => f.feedId === 'beta')?.upserted).toBe(1);
    expect(mockedPrisma.iocEntry.upsert).toHaveBeenCalledTimes(3);
  });

  it('keys the upsert by composite (feed, kind, value)', async () => {
    registerFeed(
      makeFeed('alpha', [
        { kind: 'ip', value: '1.2.3.4', category: 'c2', context: { tag: 'x' } },
      ])
    );
    (mockedPrisma.iocEntry.upsert as jest.Mock).mockResolvedValue({});
    (mockedPrisma.iocEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    await refreshAllFeeds();

    expect(mockedPrisma.iocEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          feed_kind_value: { feed: 'alpha', kind: 'ip', value: '1.2.3.4' },
        },
        create: expect.objectContaining({
          feed: 'alpha',
          kind: 'ip',
          value: '1.2.3.4',
          category: 'c2',
        }),
        update: expect.objectContaining({ category: 'c2' }),
      })
    );
  });

  it('isolates per-feed errors so other feeds keep going', async () => {
    const broken: IocFeed = {
      id: 'broken',
      name: 'b',
      homepage: 'https://x',
      license: 'CC0-1.0',
      fetch: jest.fn().mockRejectedValue(new Error('upstream 503')),
    };
    registerFeed(broken);
    registerFeed(makeFeed('healthy', [{ kind: 'ip', value: '9.9.9.9' }]));

    (mockedPrisma.iocEntry.upsert as jest.Mock).mockResolvedValue({});
    (mockedPrisma.iocEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    const outcome = await refreshAllFeeds();

    const brokenOutcome = outcome.feeds.find((f) => f.feedId === 'broken');
    const healthyOutcome = outcome.feeds.find((f) => f.feedId === 'healthy');
    expect(brokenOutcome?.error).toContain('503');
    expect(brokenOutcome?.upserted).toBe(0);
    expect(healthyOutcome?.upserted).toBe(1);
  });

  it('runs only the requested feed subset when feedIds is supplied', async () => {
    const a = makeFeed('a', [{ kind: 'ip', value: '1.1.1.1' }]);
    const b = makeFeed('b', [{ kind: 'ip', value: '2.2.2.2' }]);
    registerFeed(a);
    registerFeed(b);
    (mockedPrisma.iocEntry.upsert as jest.Mock).mockResolvedValue({});
    (mockedPrisma.iocEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    await refreshAllFeeds({ feedIds: ['b'] });

    expect(a.fetch).not.toHaveBeenCalled();
    expect(b.fetch).toHaveBeenCalled();
  });

  it('prunes entries older than staleDays after refresh', async () => {
    registerFeed(makeFeed('a', []));
    (mockedPrisma.iocEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 17 });

    const outcome = await refreshAllFeeds({ staleDays: 7 });

    expect(outcome.prunedStale).toBe(17);
    const arg = (mockedPrisma.iocEntry.deleteMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.refreshedAt.lt).toBeInstanceOf(Date);
    // 7-day cutoff sanity check (within a generous window for slow CI).
    const cutoffMs = (arg.where.refreshedAt.lt as Date).getTime();
    const expectedMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(cutoffMs - expectedMs)).toBeLessThan(60_000);
  });

  it('skips records with empty value rather than upserting them', async () => {
    registerFeed(
      makeFeed('a', [
        { kind: 'ip', value: '' },
        { kind: 'ip', value: '8.8.8.8' },
      ])
    );
    (mockedPrisma.iocEntry.upsert as jest.Mock).mockResolvedValue({});
    (mockedPrisma.iocEntry.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });

    await refreshAllFeeds();

    expect(mockedPrisma.iocEntry.upsert).toHaveBeenCalledTimes(1);
    expect(mockedPrisma.iocEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { feed_kind_value: { feed: 'a', kind: 'ip', value: '8.8.8.8' } },
      })
    );
  });
});

describe('lookupIp', () => {
  it('queries the cache by exact normalized value', async () => {
    (mockedPrisma.iocEntry.findMany as jest.Mock).mockResolvedValue([
      { feed: 'urlhaus', kind: 'ip', value: '1.2.3.4', category: 'c2' },
    ]);

    const hits = await lookupIp(' 1.2.3.4 ');

    expect(hits).toHaveLength(1);
    expect(mockedPrisma.iocEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { kind: 'ip', value: '1.2.3.4' } })
    );
  });

  it('returns [] without hitting the DB for empty input', async () => {
    const hits = await lookupIp('   ');
    expect(hits).toEqual([]);
    expect(mockedPrisma.iocEntry.findMany).not.toHaveBeenCalled();
  });
});

describe('lookupDomain', () => {
  it('walks parent labels so a parent-zone IOC catches subdomains', async () => {
    (mockedPrisma.iocEntry.findMany as jest.Mock).mockResolvedValue([]);
    await lookupDomain('a.b.c.example.com');

    const arg = (mockedPrisma.iocEntry.findMany as jest.Mock).mock.calls[0][0];
    const candidates = arg.where.value.in as string[];
    expect(candidates).toContain('a.b.c.example.com');
    expect(candidates).toContain('b.c.example.com');
    expect(candidates).toContain('c.example.com');
    expect(candidates).toContain('example.com');
    // Single-label TLD is never useful as an IOC.
    expect(candidates).not.toContain('com');
  });

  it('strips a trailing dot and lowercases the input', async () => {
    (mockedPrisma.iocEntry.findMany as jest.Mock).mockResolvedValue([]);
    await lookupDomain('Bad.Example.COM.');

    const arg = (mockedPrisma.iocEntry.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.value.in).toContain('bad.example.com');
  });

  it('returns [] for empty input', async () => {
    const hits = await lookupDomain(' ');
    expect(hits).toEqual([]);
    expect(mockedPrisma.iocEntry.findMany).not.toHaveBeenCalled();
  });
});

describe('getIocCacheStats', () => {
  it('aggregates totals, byFeed, byKind, and oldestRefreshedAt', async () => {
    (mockedPrisma.iocEntry.count as jest.Mock).mockResolvedValue(42);
    (mockedPrisma.iocEntry.groupBy as jest.Mock)
      .mockResolvedValueOnce([
        { feed: 'urlhaus', _count: { _all: 30 } },
        { feed: 'spamhaus', _count: { _all: 12 } },
      ])
      .mockResolvedValueOnce([
        { kind: 'ip', _count: { _all: 25 } },
        { kind: 'domain', _count: { _all: 17 } },
      ]);
    const oldest = new Date('2026-04-01T00:00:00Z');
    (mockedPrisma.iocEntry.findFirst as jest.Mock).mockResolvedValue({
      refreshedAt: oldest,
    });

    const stats = await getIocCacheStats();

    expect(stats.total).toBe(42);
    expect(stats.byFeed).toEqual({ urlhaus: 30, spamhaus: 12 });
    expect(stats.byKind).toEqual({ ip: 25, domain: 17 });
    expect(stats.oldestRefreshedAt).toEqual(oldest);
  });

  it('returns null oldestRefreshedAt when the cache is empty', async () => {
    (mockedPrisma.iocEntry.count as jest.Mock).mockResolvedValue(0);
    (mockedPrisma.iocEntry.groupBy as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.iocEntry.findFirst as jest.Mock).mockResolvedValue(null);

    const stats = await getIocCacheStats();
    expect(stats.oldestRefreshedAt).toBeNull();
  });
});
