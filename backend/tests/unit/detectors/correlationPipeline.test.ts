import prisma from '../../../src/services/database';
import { iocMatchDetector } from '../../../src/detectors/iocMatch';
import { validatedCompromiseDetector } from '../../../src/detectors/validatedCompromise';
import { persistDetectionResults } from '../../../src/services/detection/detectionService';
import type { DetectorContext } from '../../../src/detectors/framework';

const endTime = Date.UTC(2026, 8, 6, 12);
const ctx: DetectorContext = {
  beginTime: endTime - 120 * 60_000, endTime, now: () => endTime, tz: 'UTC',
  log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
};
const eventTime = new Date(endTime - 30 * 60_000);
const flow = (overrides: Record<string, unknown> = {}) => ({
  id: 'flow-a', connectionId: 'connection-a', scopeId: 'scope-a',
  occurredAt: eventTime, srcIp: '10.0.0.5', srcMac: 'AA-BB-CC-DD-EE-01',
  srcClientName: 'Named camera', dstIp: '203.0.113.7', ...overrides,
});
const threat = (overrides: Record<string, unknown> = {}) => ({
  id: 'threat-a', connectionId: 'connection-a', scopeId: 'scope-a',
  occurredAt: eventTime, srcIp: '10.0.0.5', deviceMac: '60:22:32:96:06:6d',
  deviceModel: 'UDM-Pro', category: 'SECURITY',
  type: 'THREAT_DETECTION_AND_PREVENTION', subcategory: 'SECURITY_INTRUSION_PREVENTION', ...overrides,
});

describe('IOC → persisted JSON → IDS correlation contract', () => {
  let flows: ReturnType<typeof flow>[];
  let threats: ReturnType<typeof threat>[];
  let dns: Array<Record<string, unknown>>;
  let saved: Array<Record<string, any>>;

  beforeEach(() => {
    jest.clearAllMocks();
    flows = [flow()];
    threats = [threat()];
    dns = [];
    saved = [];
    (prisma.firewallFlowEvent.findMany as jest.Mock).mockImplementation(async ({ where, take }) =>
      flows.filter((row) => !where.id || where.id.in.includes(row.id)).slice(0, take));
    (prisma.dnsQueryEvent.findMany as jest.Mock).mockImplementation(async () => dns);
    (prisma.firewallThreatEvent.findMany as jest.Mock).mockImplementation(async ({ where, take }) =>
      threats.filter((row) => where.scopeId.in.includes(row.scopeId)).slice(0, take));
    (prisma.iocEntry.findMany as jest.Mock).mockImplementation(async ({ where }) => [{
      feed: 'fixture-feed', kind: where.kind,
      value: where.kind === 'ip' ? where.value : 'bad.example',
      category: 'phishing', severity: 'HIGH', context: null, refreshedAt: eventTime,
    }]);
    (prisma.detection.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.detection.create as jest.Mock).mockImplementation(async ({ data }) => {
      // Exercise the real writer and the database JSON serialization boundary;
      // do not manufacture a separate correlation-only metadata fixture.
      const row = JSON.parse(JSON.stringify({ id: `detection-${saved.length}`, ...data }));
      saved.push(row);
      return row;
    });
    (prisma.detection.findMany as jest.Mock).mockImplementation(async ({ where, take }) =>
      saved.filter((row) => row.detectorId === where.detectorId && (!where.id || row.id > where.id.gt)).slice(0, take));
  });

  async function runPipeline() {
    const ioc = await iocMatchDetector.evaluate(ctx);
    await persistDetectionResults(ioc, { detectorId: 'ioc_match' });
    const correlations = await validatedCompromiseDetector.evaluate(ctx);
    return { ioc, correlations };
  }

  it('uses real normalized IOC identity after persistence and corroborates the named endpoint rather than its gateway', async () => {
    const { ioc, correlations } = await runPipeline();
    expect(ioc).toHaveLength(1);
    expect(saved[0]?.metadata.identity).toMatchObject({
      version: 2, sourceKind: 'unifi', scopeId: 'scope-a',
      srcIp: '10.0.0.5', srcMac: 'aa:bb:cc:dd:ee:01', observedAt: eventTime.toISOString(),
    });
    expect(correlations).toHaveLength(1);
    expect(correlations[0]).toMatchObject({ affectedResource: 'Named camera', srcMac: 'aa:bb:cc:dd:ee:01' });
    expect(correlations[0]?.evidence).toEqual(expect.arrayContaining([
      { kind: 'flow', id: 'flow-a' }, { kind: 'ioc', ioc: '203.0.113.7', feed: 'fixture-feed' },
      { kind: 'threat', id: 'threat-a' },
    ]));
  });

  it('retains named DNS and other-scope IOC findings without cross-source IDS corroboration', async () => {
    flows = [flow({ scopeId: 'scope-b' })];
    dns = [{ id: 'dns-a', connectionId: 'connection-a', queriedAt: eventTime,
      domain: 'sub.bad.example', clientIp: '10.0.0.5', clientName: 'Named DNS client' }];
    const { ioc, correlations } = await runPipeline();
    expect(ioc).toHaveLength(2);
    expect(ioc.find((finding) => finding.affectedResource === 'Named DNS client')?.metadata).toMatchObject({
      matchedValue: 'bad.example', identity: { sourceKind: 'adguard', srcIp: '10.0.0.5', scopeId: null },
    });
    expect(correlations).toEqual([]);
  });

  it('correlates the earlier evidenced IP when a MAC-grouped IOC now records a newer address', async () => {
    flows.push(flow({ id: 'flow-b', srcIp: '10.0.0.6', occurredAt: new Date(endTime - 1) }));
    const { ioc, correlations } = await runPipeline();
    expect(ioc).toHaveLength(1);
    expect(saved[0]?.metadata.identity.srcIp).toBe('10.0.0.6');
    expect(correlations).toHaveLength(1);
    expect(correlations[0]?.metadata?.sourceIps).toEqual(['10.0.0.5']);
    expect(correlations[0]?.evidence).toContainEqual({ kind: 'flow', id: 'flow-a' });
    expect(correlations[0]?.evidence).not.toContainEqual({ kind: 'flow', id: 'flow-b' });
  });

  it('does not refresh old raw activity merely because persistence sets a current lastSeen', async () => {
    const ioc = await iocMatchDetector.evaluate(ctx);
    await persistDetectionResults(ioc, { detectorId: 'ioc_match' });
    flows = [flow({ occurredAt: new Date(ctx.beginTime - 1) })];
    expect(await validatedCompromiseDetector.evaluate(ctx)).toEqual([]);
  });
});
