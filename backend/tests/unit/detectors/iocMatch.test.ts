import type { DnsQueryEvent, FirewallFlowEvent } from '@prisma/client';
import { iocMatchDetector } from '../../../src/detectors/iocMatch';
import { createDetectorIdentity, detectorFingerprint } from '../../../src/detectors/identity';
import type { DetectorContext } from '../../../src/detectors/framework';
import prisma from '../../../src/services/database';
import * as iocFeedService from '../../../src/services/threatIntel/iocFeedService';

const now = Date.UTC(2026, 4, 7, 12, 0, 0);
const observedAt = new Date(now - 10 * 60_000);
const context: DetectorContext = {
  beginTime: now - 60 * 60_000, endTime: now, now: () => now, tz: 'UTC',
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
};
type Flow = Pick<FirewallFlowEvent, 'id' | 'connectionId' | 'scopeId' | 'occurredAt' | 'srcMac' | 'srcIp' | 'srcClientName' | 'dstIp'>;
type Query = Pick<DnsQueryEvent, 'id' | 'connectionId' | 'queriedAt' | 'domain' | 'clientIp' | 'clientName'>;
const flow = (overrides: Partial<Flow> = {}): Flow => ({
  id: 'flow-1', connectionId: 'controller-1', scopeId: 'site-scope-1', occurredAt: observedAt,
  srcMac: 'aa:bb:cc:dd:ee:01', srcIp: '10.0.0.5', srcClientName: 'iot-cam', dstIp: '203.0.113.5', ...overrides,
});
const query = (overrides: Partial<Query> = {}): Query => ({
  id: 'query-1', connectionId: 'adguard-1', queriedAt: observedAt, domain: 'sub.evil.example',
  clientIp: '10.0.0.20', clientName: 'phone', ...overrides,
});
const hit = (overrides: Partial<iocFeedService.IocLookupHit> = {}): iocFeedService.IocLookupHit => ({
  feed: 'urlhaus', kind: 'ip', value: '203.0.113.5', category: 'phishing', severity: 'HIGH',
  context: null, refreshedAt: observedAt, ...overrides,
});
const flows = prisma.firewallFlowEvent.findMany as jest.Mock;
const queries = prisma.dnsQueryEvent.findMany as jest.Mock;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  flows.mockReset().mockResolvedValue([]);
  queries.mockReset().mockResolvedValue([]);
  jest.spyOn(iocFeedService, 'lookupIp').mockResolvedValue([]);
  jest.spyOn(iocFeedService, 'lookupDomain').mockResolvedValue([]);
});

describe('iocMatchDetector', () => {
  it('emits nothing when no events match', async () => {
    expect(await iocMatchDetector.evaluate(context)).toEqual([]);
  });

  it('caches repeated misses only within a page and sees refreshed intelligence on the next run', async () => {
    flows.mockResolvedValue([flow(), flow({ id: 'flow-2' })]);
    queries.mockResolvedValue([query(), query({ id: 'query-2' })]);
    expect(await iocMatchDetector.evaluate(context)).toEqual([]);
    expect(iocFeedService.lookupIp).toHaveBeenCalledTimes(1);
    expect(iocFeedService.lookupDomain).toHaveBeenCalledTimes(1);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValue([hit()]);
    jest.mocked(iocFeedService.lookupDomain).mockResolvedValue([hit({ kind: 'domain', value: 'evil.example' })]);
    expect(await iocMatchDetector.evaluate(context)).toHaveLength(2);
    expect(iocFeedService.lookupIp).toHaveBeenCalledTimes(2);
    expect(iocFeedService.lookupDomain).toHaveBeenCalledTimes(2);
  });

  it('stores typed observed identity and emits a scoped v2 fingerprint', async () => {
    const event = flow();
    flows.mockResolvedValue([event]);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValue([hit()]);
    const findings = await iocMatchDetector.evaluate(context);
    const identity = createDetectorIdentity({ ...event, sourceKind: 'unifi', eventId: event.id, observedAt: event.occurredAt });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'HIGH', affectedResource: 'iot-cam', srcMac: 'aa:bb:cc:dd:ee:01',
      fingerprint: detectorFingerprint('ioc_match', identity, 'ip:203.0.113.5'),
      metadata: { identity, firstObservedAt: observedAt.toISOString(), lastObservedAt: observedAt.toISOString(), sourceEventCount: 1 },
    });
    expect(findings[0]!.evidence).toEqual([
      { kind: 'flow', id: 'flow-1' }, { kind: 'ioc', ioc: '203.0.113.5', feed: 'urlhaus' },
    ]);
  });

  it.each([{ category: 'malware-c2' }, { category: 'cryptominer' }, { severity: 'CRITICAL' }])('honors a critical feed signal: %s', async (critical) => {
    flows.mockResolvedValue([flow()]);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValue([hit(), hit({ feed: 'critical-feed', ...critical })]);
    expect((await iocMatchDetector.evaluate(context))[0]!.severity).toBe('CRITICAL');
  });

  it('coalesces normalized MACs, merges every feed/severity, and retains the latest actual observation', async () => {
    const older = flow({ id: 'earlier', occurredAt: new Date(now - 20 * 60_000), srcClientName: 'old label' });
    const latest = flow({ id: 'latest', srcMac: 'AA-BB-CC-DD-EE-01', srcIp: '10.0.0.6', srcClientName: 'new label' });
    flows.mockResolvedValue([latest, older, latest]);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValue([
      hit(), hit({ feed: 'spamhaus', category: 'malware-c2', severity: 'CRITICAL' }),
    ]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'CRITICAL', affectedResource: 'new label',
      metadata: {
        identity: { eventId: 'latest', observedAt: observedAt.toISOString(), srcIp: '10.0.0.6', srcMac: 'aa:bb:cc:dd:ee:01' },
        feeds: ['spamhaus', 'urlhaus'], categories: ['malware-c2', 'phishing'], sourceEventCount: 2,
        firstObservedAt: older.occurredAt.toISOString(), lastObservedAt: latest.occurredAt.toISOString(),
      },
    });
    expect(findings[0]!.evidence).toHaveLength(4);
    expect(findings[0]!.description).toContain('spamhaus, urlhaus');
  });

  it('separates identical device addresses across controllers and immutable site scopes', async () => {
    flows.mockResolvedValue([
      flow(), flow({ id: 'different-controller', connectionId: 'controller-2' }),
      flow({ id: 'different-site', scopeId: 'site-scope-2' }),
    ]);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValue([hit()]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(3);
    expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(3);
  });

  it('does not merge unidentified sources or legacy flows without immutable site provenance', async () => {
    flows.mockResolvedValue([
      flow({ id: 'missing-source-1', srcIp: null, srcMac: null }),
      flow({ id: 'missing-source-2', srcIp: null, srcMac: null }),
      flow({ id: 'legacy-1', scopeId: null }), flow({ id: 'legacy-2', scopeId: null }),
    ]);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValue([hit()]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(4);
    expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(4);
  });

  it('normalizes IPv6 source and indicator spellings without relying on display names', async () => {
    flows.mockResolvedValue([
      flow({ id: 'expanded', srcMac: null, srcIp: '2001:0DB8:0:0:0:0:0:1', dstIp: '2001:0DB8:0:0:0:0:0:2', srcClientName: 'label A' }),
      flow({ id: 'compressed', srcMac: null, srcIp: '2001:db8::1', dstIp: '2001:db8::2', srcClientName: 'label B' }),
    ]);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValue([hit({ value: '2001:0db8:0:0:0:0:0:2' })]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.metadata).toMatchObject({ identity: { srcIp: '2001:db8::1' }, matchedValue: '2001:db8::2', sourceEventCount: 2 });
    expect(iocFeedService.lookupIp).toHaveBeenCalledWith('2001:0db8:0:0:0:0:0:2');
    expect(iocFeedService.lookupIp).toHaveBeenCalledWith('2001:db8::2');
  });

  it('preserves a named DNS client IP and the actual parent indicator separately from queried hostnames', async () => {
    queries.mockResolvedValue([query(), query({ id: 'query-2', domain: 'OTHER.EVIL.EXAMPLE.' })]);
    jest.mocked(iocFeedService.lookupDomain).mockResolvedValue([hit({ kind: 'domain', value: 'evil.example' })]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ affectedResource: 'phone', metadata: {
      identity: { version: 2, sourceKind: 'adguard', connectionId: 'adguard-1', scopeId: null, srcIp: '10.0.0.20', srcMac: null },
      matchedValue: 'evil.example', observedDestinations: ['other.evil.example', 'sub.evil.example'], sourceEventCount: 2,
    } });
    expect(findings[0]!.evidence).toHaveLength(3);
    expect(findings[0]!.evidence).toContainEqual({ kind: 'ioc', ioc: 'evil.example', feed: 'urlhaus' });
  });

  it('separates DNS connections and never substitutes equal client labels for missing IPs', async () => {
    queries.mockResolvedValue([
      query(), query({ id: 'other-adguard', connectionId: 'adguard-2' }),
      query({ id: 'missing-ip-1', clientIp: null }), query({ id: 'missing-ip-2', clientIp: null }),
    ]);
    jest.mocked(iocFeedService.lookupDomain).mockResolvedValue([hit({ kind: 'domain', value: 'evil.example' })]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(4);
    expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(4);
  });

  it('retains separate listed indicators when one DNS query matches multiple feed entries', async () => {
    queries.mockResolvedValue([query()]);
    jest.mocked(iocFeedService.lookupDomain).mockResolvedValue([
      hit({ kind: 'domain', value: 'evil.example' }),
      hit({ kind: 'domain', value: 'sub.evil.example', category: 'malware-c2' }),
    ]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.metadata?.matchedValue)).toEqual(['evil.example', 'sub.evil.example']);
  });

  it('pages with ID ranges, bounds lookup caches per page, and merges later feed severity without losing events', async () => {
    const firstFlows = Array.from({ length: 500 }, (_, index) => flow({ id: `flow-${String(index).padStart(3, '0')}` }));
    const firstQueries = Array.from({ length: 500 }, (_, index) => query({ id: `query-${String(index).padStart(3, '0')}` }));
    flows.mockResolvedValueOnce(firstFlows).mockResolvedValueOnce([flow({ id: 'flow-last' })]);
    queries.mockResolvedValueOnce(firstQueries).mockResolvedValueOnce([query({ id: 'query-last' })]);
    jest.mocked(iocFeedService.lookupIp).mockResolvedValueOnce([hit()])
      .mockResolvedValueOnce([hit({ feed: 'spamhaus', category: 'malware-c2', severity: 'CRITICAL' })]);
    jest.mocked(iocFeedService.lookupDomain).mockResolvedValue([hit({ kind: 'domain', value: 'evil.example' })]);
    const findings = await iocMatchDetector.evaluate(context);
    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.metadata?.sourceEventCount)).toEqual([501, 501]);
    expect(findings[0]).toMatchObject({ severity: 'CRITICAL', metadata: { feeds: ['spamhaus', 'urlhaus'] } });
    expect(iocFeedService.lookupIp).toHaveBeenCalledTimes(2);
    expect(iocFeedService.lookupDomain).toHaveBeenCalledTimes(2);
    expect(flows).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 500, where: expect.objectContaining({ id: { gt: 'flow-499' } }), orderBy: { id: 'asc' } }));
    expect(queries).toHaveBeenNthCalledWith(2, expect.objectContaining({ take: 500, where: expect.objectContaining({ id: { gt: 'query-499' } }) }));
    expect(flows.mock.calls[1][0]).not.toHaveProperty('cursor');
    expect(queries.mock.calls[1][0]).not.toHaveProperty('cursor');
    expect(flows).toHaveBeenCalledWith(expect.objectContaining({ where: { occurredAt: { gte: new Date(context.beginTime), lte: new Date(context.endTime) }, dstIp: { not: null } } }));
    expect(queries).toHaveBeenCalledWith(expect.objectContaining({ where: { queriedAt: { gte: new Date(context.beginTime), lte: new Date(context.endTime) } } }));
  });
});
