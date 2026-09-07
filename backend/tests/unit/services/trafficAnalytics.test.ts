import { getTrafficSummary } from '../../../src/services/firewall/trafficAnalytics';
import prisma from '../../../src/services/database';

type ScopeCount = { scopeId: string | null; _count: { _all: number } };
const flowGroupBy = jest.fn();
const threatGroupBy = jest.fn();
Object.assign(prisma.firewallFlowEvent, { groupBy: flowGroupBy });
Object.assign(prisma.firewallThreatEvent, { groupBy: threatGroupBy });
const count = (scopeId: string | null, amount: number): ScopeCount => ({ scopeId, _count: { _all: amount } });

function setGroups(flows: ScopeCount[], threats: ScopeCount[]) {
  flowGroupBy.mockImplementation(({ by }) => Promise.resolve(by[0] === 'scopeId' ? flows : []));
  threatGroupBy.mockResolvedValue(threats);
  jest.mocked(prisma.firewallFlowEvent.findMany).mockResolvedValue([]);
}

describe('traffic summary provenance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-07T12:00:00.000Z').getTime());
  });
  afterEach(() => jest.restoreAllMocks());

  it('preserves raw totals and distinguishes legacy observations from shared and threat-only scopes', async () => {
    setGroups([count(null, 2), count('shared-scope', 2)], [count(null, 1), count('shared-scope', 1), count('threat-only-scope', 2)]);
    flowGroupBy.mockImplementation(({ by }) => Promise.resolve(by[0] === 'scopeId'
      ? [count(null, 2), count('shared-scope', 2)]
      : [{ risk: 'low', _count: { _all: 3 } }, { risk: 'high', _count: { _all: 1 } }]));
    jest.mocked(prisma.firewallFlowEvent.findMany).mockResolvedValue([{ srcMac: 'aa' }, { srcMac: 'bb' }] as any);

    const summary = await getTrafficSummary({ connectionId: 'connection-a', windowHours: 6 });
    expect(summary).toEqual({
      windowHours: 6,
      since: '2026-09-07T06:00:00.000Z',
      totalBlocked: 4,
      byRisk: { low: 3, medium: 0, high: 1, concerning: 0 },
      uniqueSrcMacs: 2,
      threatCount: 4,
      unscopedFlowCount: 2,
      unscopedThreatCount: 1,
      sourceScopeCount: 2,
    });
  });

  it('bounds both provenance queries to the same connection and inclusive time window as the totals', async () => {
    setGroups([], []);
    await getTrafficSummary({ connectionId: 'connection-b', windowHours: 12 });
    const where = { connectionId: 'connection-b', occurredAt: { gte: new Date('2026-09-07T00:00:00.000Z') } };
    expect(flowGroupBy).toHaveBeenCalledWith({ by: ['scopeId'], where, _count: { _all: true } });
    expect(threatGroupBy).toHaveBeenCalledWith({ by: ['scopeId'], where, _count: { _all: true } });
    expect(flowGroupBy).toHaveBeenCalledWith({ by: ['risk'], where, _count: { _all: true } });
    expect(prisma.firewallFlowEvent.findMany).toHaveBeenCalledWith({
      where: { ...where, srcMac: { not: null } }, select: { srcMac: true }, distinct: ['srcMac'],
    });
  });

  it.each([
    { label: 'an empty window', flows: [], threats: [], scopes: 0, unscopedFlows: 0, unscopedThreats: 0 },
    { label: 'only legacy rows', flows: [count(null, 5)], threats: [count(null, 3)], scopes: 0, unscopedFlows: 5, unscopedThreats: 3 },
    { label: 'one scope shared by both streams', flows: [count('same', 2)], threats: [count('same', 4)], scopes: 1, unscopedFlows: 0, unscopedThreats: 0 },
    { label: 'a threat-only source', flows: [], threats: [count('only-threats', 2)], scopes: 1, unscopedFlows: 0, unscopedThreats: 0 },
  ])('counts provenance correctly for $label', async ({ flows, threats, scopes, unscopedFlows, unscopedThreats }) => {
    setGroups(flows, threats);
    const summary = await getTrafficSummary({ connectionId: 'connection-a', windowHours: 24 });
    expect(summary.sourceScopeCount).toBe(scopes);
    expect(summary.unscopedFlowCount).toBe(unscopedFlows);
    expect(summary.unscopedThreatCount).toBe(unscopedThreats);
  });
});
