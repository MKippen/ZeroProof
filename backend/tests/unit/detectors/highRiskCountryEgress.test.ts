/**
 * highRiskCountryEgress detector — exercises the env-driven watch list,
 * action-based severity, and per-(srcKey, region) dedupe.
 */
import { highRiskCountryEgressDetector } from '../../../src/detectors/highRiskCountryEgress';
import type { DetectorContext } from '../../../src/detectors/framework';
import prisma from '../../../src/services/database';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

function ctx(): DetectorContext {
  const now = Date.UTC(2026, 4, 7, 12, 0, 0);
  return {
    beginTime: now - 60 * 60 * 1000,
    endTime: now,
    log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
    tz: 'UTC',
    now: () => now,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.HIGH_RISK_COUNTRIES;
});

describe('highRiskCountryEgressDetector', () => {
  it('queries the default region list when env is unset', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([]);
    await highRiskCountryEgressDetector.evaluate(ctx());

    const arg = (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mock
      .calls[0][0];
    expect(arg.where.dstRegion.in).toEqual(['CN', 'RU', 'KP', 'IR']);
  });

  it('honors HIGH_RISK_COUNTRIES override (comma-separated, trimmed, uppercased)', async () => {
    process.env.HIGH_RISK_COUNTRIES = ' cn , by ,sy ';
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([]);
    await highRiskCountryEgressDetector.evaluate(ctx());

    const arg = (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mock
      .calls[0][0];
    expect(arg.where.dstRegion.in).toEqual(['CN', 'BY', 'SY']);
  });

  it('rates a blocked flow as INFO and an allowed flow as MEDIUM', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'BLOCKED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'host-a',
        dstIp: '1.1.1.1',
        dstRegion: 'CN',
        bytesTotal: BigInt(123),
      },
      {
        id: 'f-2',
        action: 'ALLOWED',
        srcMac: 'bb:bb:bb:bb:bb:bb',
        srcIp: '10.0.0.2',
        srcClientName: 'host-b',
        dstIp: '2.2.2.2',
        dstRegion: 'RU',
        bytesTotal: BigInt(456),
      },
    ]);

    const findings = await highRiskCountryEgressDetector.evaluate(ctx());
    const byHost = new Map(
      findings.map((f) => [f.affectedResource, f.severity])
    );
    expect(byHost.get('host-a')).toBe('INFO');
    expect(byHost.get('host-b')).toBe('MEDIUM');
  });

  it('coalesces multiple flows from one device to one region into one finding', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'h',
        dstIp: '1.1.1.1',
        dstRegion: 'CN',
        bytesTotal: BigInt(100),
      },
      {
        id: 'f-2',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'h',
        dstIp: '1.1.1.2',
        dstRegion: 'CN',
        bytesTotal: BigInt(200),
      },
    ]);

    const findings = await highRiskCountryEgressDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toHaveLength(2);
    expect(findings[0]?.metadata?.totalBytes).toBe('300');
  });

  it('escalates to MEDIUM if any one flow in the group is allowed', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'BLOCKED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'h',
        dstIp: '1.1.1.1',
        dstRegion: 'CN',
        bytesTotal: null,
      },
      {
        id: 'f-2',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'h',
        dstIp: '1.1.1.2',
        dstRegion: 'CN',
        bytesTotal: null,
      },
    ]);

    const findings = await highRiskCountryEgressDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('returns [] when the watch list is explicitly empty', async () => {
    process.env.HIGH_RISK_COUNTRIES = ' , , ';
    const findings = await highRiskCountryEgressDetector.evaluate(ctx());
    expect(findings).toEqual([]);
    expect(mockedPrisma.firewallFlowEvent.findMany).not.toHaveBeenCalled();
  });
});
