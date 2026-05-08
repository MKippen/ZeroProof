/**
 * URLhaus adapter — pure unit tests against a sample fixture. Network is
 * stubbed via the `fetcher` injection on the adapter.
 */
import { createUrlhausFeed } from '../../../../src/services/threatIntel/feeds/urlhaus';

const SAMPLE_PAYLOAD = JSON.stringify({
  // Two entries under one id key (the upstream format), each with a different
  // host — covers both the IP-host and domain-host code paths.
  entry_1: [
    {
      id: '1',
      url: 'http://203.0.113.5/payload.exe',
      host: '203.0.113.5',
      threat: 'malware_download',
      tags: ['CobaltStrike', 'exe'],
      url_status: 'online',
      date_added: '2026-05-01T00:00:00Z',
      urlhaus_reference: 'https://urlhaus.abuse.ch/url/1',
    },
  ],
  entry_2: [
    {
      id: '2',
      url: 'http://bad.example.com/p',
      host: 'BAD.example.com',
      threat: 'phishing',
      tags: ['login'],
      url_status: 'online',
      date_added: '2026-05-02T00:00:00Z',
    },
  ],
  offline_entry: [
    {
      id: '3',
      url: 'http://gone.example.com/',
      host: 'gone.example.com',
      url_status: 'offline',
    },
  ],
  malformed_entry: [
    {
      // Missing url + host — should be skipped, not throw.
      id: '4',
    },
    {
      // Missing host only — also skipped.
      id: '5',
      url: 'http://no-host.example.com/',
    },
  ],
  miner_entry: [
    {
      id: '6',
      url: 'http://miner.example.com/script.js',
      host: 'miner.example.com',
      threat: 'malware_download',
      tags: ['coinminer'],
      url_status: 'online',
    },
  ],
  duplicate_entry: [
    // Same host as entry_2 — should dedupe.
    {
      id: '7',
      url: 'http://bad.example.com/dupe',
      host: 'bad.example.com',
      url_status: 'online',
    },
  ],
});

describe('createUrlhausFeed', () => {
  function makeFeed(payload: string = SAMPLE_PAYLOAD) {
    return createUrlhausFeed({
      url: 'https://example.invalid/recent.json',
      fetcher: async () => payload,
    });
  }

  it('exposes the expected metadata for EXTERNALS surfacing', () => {
    const feed = makeFeed();
    expect(feed.id).toBe('urlhaus');
    expect(feed.name).toBe('abuse.ch URLhaus');
    expect(feed.license).toBe('CC0-1.0');
    expect(feed.homepage).toContain('urlhaus.abuse.ch');
  });

  it('parses both ip and domain entries with normalized casing', async () => {
    const records = await makeFeed().fetch();
    const byValue = new Map(records.map((r) => [r.value, r]));

    expect(byValue.has('203.0.113.5')).toBe(true);
    expect(byValue.get('203.0.113.5')?.kind).toBe('ip');

    expect(byValue.has('bad.example.com')).toBe(true);
    expect(byValue.get('bad.example.com')?.kind).toBe('domain');
  });

  it('classifies threats from threat name + tags', async () => {
    const records = await makeFeed().fetch();
    const byValue = new Map(records.map((r) => [r.value, r]));

    expect(byValue.get('203.0.113.5')?.category).toBe('malware-c2');
    expect(byValue.get('bad.example.com')?.category).toBe('phishing');
    expect(byValue.get('miner.example.com')?.category).toBe('cryptominer');
  });

  it('attaches sample url + reference + tags as context for evidence', async () => {
    const records = await makeFeed().fetch();
    const ip = records.find((r) => r.value === '203.0.113.5');
    expect(ip?.context).toMatchObject({
      sampleUrl: 'http://203.0.113.5/payload.exe',
      tags: ['CobaltStrike', 'exe'],
      reference: 'https://urlhaus.abuse.ch/url/1',
    });
  });

  it('skips entries that are offline upstream', async () => {
    const records = await makeFeed().fetch();
    expect(records.find((r) => r.value === 'gone.example.com')).toBeUndefined();
  });

  it('skips malformed entries silently rather than throwing', async () => {
    const records = await makeFeed().fetch();
    // Malformed entries should not appear, and should not derail the others.
    expect(records.length).toBeGreaterThan(0);
    expect(records.find((r) => r.value === 'no-host.example.com')).toBeUndefined();
  });

  it('dedupes by kind+value across the payload', async () => {
    const records = await makeFeed().fetch();
    const dupes = records.filter((r) => r.value === 'bad.example.com');
    expect(dupes).toHaveLength(1);
  });

  it('marks every record as HIGH severity (URLhaus is high-confidence)', async () => {
    const records = await makeFeed().fetch();
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record.severity).toBe('HIGH');
    }
  });

  it('throws when the body cannot be parsed', async () => {
    const feed = makeFeed('not json');
    await expect(feed.fetch()).rejects.toThrow();
  });
});
