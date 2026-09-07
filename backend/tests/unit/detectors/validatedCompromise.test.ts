import { validatedCompromiseDetector } from '../../../src/detectors/validatedCompromise';
import { createDetectorIdentity } from '../../../src/detectors/identity';
import type { DetectorContext } from '../../../src/detectors/framework';
import prisma from '../../../src/services/database';

const findDetections = prisma.detection.findMany as jest.Mock;
const findFlows = prisma.firewallFlowEvent.findMany as jest.Mock;
const findThreats = prisma.firewallThreatEvent.findMany as jest.Mock;
const endTime = Date.UTC(2026, 4, 7, 12);
const beginTime = endTime - 120 * 60_000;
const flowTime = new Date(beginTime + 30 * 60_000);
const threatTime = new Date(beginTime + 60 * 60_000);
const ctx = (): DetectorContext => ({
  beginTime, endTime, now: () => endTime, tz: 'UTC',
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
});

function flow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'f-1', connectionId: 'controller-a', scopeId: 'site-a',
    srcIp: '10.0.0.5', srcMac: 'aa:bb:cc:dd:ee:ff', srcClientName: 'named-camera',
    dstIp: '203.0.113.5', occurredAt: flowTime, ...overrides,
  };
}

function threat(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1', connectionId: 'controller-a', scopeId: 'site-a', srcIp: '10.0.0.5',
    deviceMac: '60:22:32:96:06:6d', deviceModel: 'UDM-Pro',
    occurredAt: threatTime, category: 'SECURITY', subcategory: 'SECURITY_INTRUSION_PREVENTION',
    type: 'THREAT_DETECTION_AND_PREVENTION', ...overrides,
  };
}

function ioc(source = flow(), overrides: Record<string, unknown> = {}) {
  return {
    id: 'd-1', affectedResource: source.srcClientName, srcMac: source.srcMac, lastSeen: new Date(endTime),
    metadata: {
      identity: createDetectorIdentity({
        sourceKind: 'unifi', connectionId: source.connectionId, scopeId: source.scopeId,
        srcIp: source.srcIp, srcMac: source.srcMac, eventId: source.id, observedAt: source.occurredAt,
      }),
      matchedValue: source.dstIp,
    },
    evidence: [{ kind: 'flow', id: source.id }, { kind: 'ioc', ioc: source.dstIp, feed: 'urlhaus' }],
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findDetections.mockResolvedValue([ioc()]);
  findFlows.mockResolvedValue([flow()]);
  findThreats.mockResolvedValue([threat()]);
});

describe('validatedCompromiseDetector source and event provenance', () => {
  it('does no telemetry work without IOC findings', async () => {
    findDetections.mockResolvedValue([]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
    expect(findFlows).not.toHaveBeenCalled();
    expect(findThreats).not.toHaveBeenCalled();
  });

  it('requires both signals', async () => {
    findThreats.mockResolvedValue([]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it('corroborates a named endpoint even when the IDS reporter is a different gateway MAC', async () => {
    const findings = await validatedCompromiseDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'CRITICAL', affectedResource: 'named-camera', srcMac: 'aa:bb:cc:dd:ee:ff' });
    expect(findings[0]!.evidence).toEqual([
      { kind: 'flow', id: 'f-1' }, { kind: 'ioc', ioc: '203.0.113.5', feed: 'urlhaus' }, { kind: 'threat', id: 't-1' },
    ]);
    expect(findings[0]!.title).toContain('Corroborated IOC and IDS activity');
    expect(findings[0]!.description).toContain('does not establish successful compromise');
    expect(findings[0]!.metadata).toMatchObject({
      iocFindingIds: ['d-1'], threatCount: 1, sourceIps: ['10.0.0.5'],
      firstObservedAt: flowTime.toISOString(), lastObservedAt: threatTime.toISOString(),
    });
  });

  it('never treats a matching gateway MAC as evidence about another source IP', async () => {
    findThreats.mockResolvedValue([threat({ deviceMac: flow().srcMac, srcIp: '10.0.0.99' })]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it.each([
    ['another controller', { connectionId: 'controller-b', scopeId: 'site-b' }],
    ['another site on the same connection', { scopeId: 'site-b' }],
    ['an inconsistent connection', { connectionId: 'controller-b' }],
    ['unknown historical provenance', { scopeId: null }],
  ])('does not correlate the same private IP from %s', async (_name, overrides) => {
    findThreats.mockResolvedValue([threat(overrides)]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it('keeps independent findings for identical MAC/IPs across controllers', async () => {
    const second = flow({ id: 'f-2', connectionId: 'controller-b', scopeId: 'site-b' });
    findDetections.mockResolvedValue([ioc(), ioc(second, { id: 'd-2' })]);
    findFlows.mockResolvedValue([flow(), second]);
    findThreats.mockResolvedValue([threat(), threat({ id: 't-2', connectionId: 'controller-b', scopeId: 'site-b' })]);
    const results = await validatedCompromiseDetector.evaluate(ctx());
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.fingerprint)).size).toBe(2);
    expect(results.map((r) => r.metadata?.threatCount)).toEqual([1, 1]);
  });

  it('uses explicit source IP for a named flow without a MAC', async () => {
    const source = flow({ srcMac: null });
    findDetections.mockResolvedValue([ioc(source, { affectedResource: 'not-an-ip-label' })]);
    findFlows.mockResolvedValue([source]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toHaveLength(1);
  });

  it('normalizes IPv6 representations without accepting labels as addresses', async () => {
    const source = flow({ srcIp: '2001:0DB8:0000:0000:0000:0000:0000:0005', srcMac: null });
    findDetections.mockResolvedValue([ioc(source)]);
    findFlows.mockResolvedValue([source]);
    findThreats.mockResolvedValue([threat({ srcIp: '2001:db8::5' })]);
    const results = await validatedCompromiseDetector.evaluate(ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.metadata?.sourceIps).toEqual(['2001:db8::5']);
    findThreats.mockResolvedValue([threat({ srcIp: 'named-camera' })]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it.each([new Date(beginTime - 1), new Date(endTime + 1)])('rejects raw IOC activity at %s despite a fresh detection lastSeen', async (occurredAt) => {
    const source = flow({ occurredAt });
    findDetections.mockResolvedValue([ioc(source)]);
    findFlows.mockResolvedValue([source]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
    expect(findThreats).not.toHaveBeenCalled();
  });

  it.each([new Date(beginTime - 1), new Date(endTime + 1)])('rejects IDS activity outside the event window at %s', async (occurredAt) => {
    findThreats.mockResolvedValue([threat({ occurredAt })]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it('accepts inclusive event boundaries without a processing-time filter', async () => {
    const source = flow({ occurredAt: new Date(beginTime) });
    findDetections.mockResolvedValue([ioc(source, { lastSeen: new Date(endTime + 60_000) })]);
    findFlows.mockResolvedValue([source]);
    findThreats.mockResolvedValue([threat({ occurredAt: new Date(endTime) })]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toHaveLength(1);
    expect(findDetections.mock.calls[0][0].where).not.toHaveProperty('lastSeen');
  });

  it.each([
    ['missing raw rows', []],
    ['legacy raw scope', [flow({ scopeId: null })]],
    ['wrong raw scope', [flow({ scopeId: 'site-b' })]],
    ['wrong raw connection', [flow({ connectionId: 'controller-b' })]],
    ['wrong raw endpoint', [flow({ srcMac: '00:11:22:33:44:55' })]],
    ['wrong destination', [flow({ dstIp: '203.0.113.99' })]],
    ['missing source address', [flow({ srcIp: null })]],
    ['unreferenced raw row', [flow({ id: 'not-referenced' })]],
  ])('requires matching underlying IOC evidence: %s', async (_name, rows) => {
    findFlows.mockResolvedValue(rows);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it.each([null, [], 'invalid', {}, { identity: { version: 1 } }])('skips ambiguous legacy or malformed metadata %p', async (metadata) => {
    findDetections.mockResolvedValue([ioc(flow(), { metadata, affectedResource: '10.0.0.5' })]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
    expect(findFlows).not.toHaveBeenCalled();
  });

  it('retains DNS IOC findings without guessing an AdGuard-to-UniFi binding', async () => {
    const candidate = ioc();
    candidate.metadata.identity.sourceKind = 'adguard';
    // Even a colliding connection id / copied scope id is not a network binding.
    findDetections.mockResolvedValue([candidate]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
    expect(findFlows).not.toHaveBeenCalled();
  });

  it.each([
    [{ kind: 'flow', id: 'f-1' }],
    [{ kind: 'flow', id: 'f-1' }, { kind: 'ioc', ioc: '203.0.113.99', feed: 'urlhaus' }],
    [null, 1, 'invalid', { kind: 'ioc', ioc: '203.0.113.5', feed: '' }],
  ])('does not fabricate indicator corroboration from invalid evidence %p', async (...evidence) => {
    findDetections.mockResolvedValue([ioc(flow(), { evidence })]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it('requires an intrusion event rather than a generic security/honeypot log', async () => {
    findThreats.mockResolvedValue([threat({ type: 'HONEYPOT', subcategory: null })]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it('keeps all corroborating IOC and IDS evidence without duplicated counts', async () => {
    const source = flow({ id: 'f-2', dstIp: '198.51.100.7' });
    findDetections.mockResolvedValue([ioc(), ioc(source, { id: 'd-2' })]);
    findFlows.mockResolvedValue([flow(), source]);
    findThreats.mockResolvedValue([threat(), threat({ id: 't-2', category: 'SECOND_CATEGORY' })]);
    const results = await validatedCompromiseDetector.evaluate(ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.evidence).toHaveLength(6); // two flows, two indicators, two threats
    expect(results[0]!.metadata).toMatchObject({
      iocFindingIds: ['d-1', 'd-2'], threatCount: 2, threatCategories: ['SECOND_CATEGORY', 'SECURITY'],
    });
  });

  it('uses each raw IP for MAC-grouped observations and preserves only corroborated evidence', async () => {
    const latest = flow({ id: 'f-2', srcIp: '10.0.0.6', occurredAt: new Date(endTime - 1) });
    const finding = ioc(latest);
    finding.evidence.push({ kind: 'flow', id: 'f-1' });
    findDetections.mockResolvedValue([finding]);
    findFlows.mockResolvedValue([flow(), latest]);
    const results = await validatedCompromiseDetector.evaluate(ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.metadata?.sourceIps).toEqual(['10.0.0.5']);
    expect(results[0]!.evidence).toContainEqual({ kind: 'flow', id: 'f-1' });
    expect(results[0]!.evidence).not.toContainEqual({ kind: 'flow', id: 'f-2' });
  });

  it('continues beyond a full candidate page and a full IDS page', async () => {
    findDetections.mockResolvedValueOnce(Array.from({ length: 200 }, (_, index) => ({ id: `legacy-${index}`, metadata: null, evidence: [] })))
      .mockResolvedValueOnce([ioc()]);
    findThreats.mockResolvedValueOnce(Array.from({ length: 200 }, (_, index) => threat({ id: `t-${String(index).padStart(3, '0')}` })))
      .mockResolvedValueOnce([threat({ id: 't-200' })]);
    const results = await validatedCompromiseDetector.evaluate(ctx());
    expect(results[0]!.metadata?.threatCount).toBe(201);
    expect(findDetections.mock.calls[1][0].where.id).toEqual({ gt: 'legacy-199' });
    expect(findThreats.mock.calls[1][0].where.id).toEqual({ gt: 't-199' });
    for (const mock of [findDetections, findFlows, findThreats]) {
      for (const [query] of mock.mock.calls) expect(query.take).toBeLessThanOrEqual(200);
    }
  });
});
