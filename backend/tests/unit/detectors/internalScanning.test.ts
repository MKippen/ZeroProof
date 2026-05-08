/**
 * internalScanning detector — exercises distinct-target counting,
 * private→private filter, and severity tiering.
 */
import { internalScanningDetector } from '../../../src/detectors/internalScanning';
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

function flowsToTargets(srcMac: string, srcIp: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${srcMac}-${i}`,
    srcMac,
    srcIp,
    srcClientName: 'scanner',
    dstIp: `10.0.0.${i + 10}`,
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.INTERNAL_SCAN_THRESHOLD;
});

describe('internalScanningDetector', () => {
  it('emits nothing under the threshold', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue(
      flowsToTargets('aa:aa:aa:aa:aa:aa', '10.0.0.5', 10)
    );
    expect(await internalScanningDetector.evaluate(ctx())).toEqual([]);
  });

  it('fires MEDIUM at the threshold', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue(
      flowsToTargets('aa:aa:aa:aa:aa:aa', '10.0.0.5', 25)
    );
    const findings = await internalScanningDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('MEDIUM');
    expect(findings[0]?.metadata?.distinctTargets).toBe(25);
  });

  it('fires HIGH at >= 2x threshold', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue(
      flowsToTargets('aa:aa:aa:aa:aa:aa', '10.0.0.5', 50)
    );
    const findings = await internalScanningDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('counts each dst IP only once', async () => {
    const dup = [
      {
        id: 'd1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'h',
        dstIp: '10.0.0.10',
      },
      {
        id: 'd2',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'h',
        dstIp: '10.0.0.10',
      },
    ];
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue(dup);
    expect(await internalScanningDetector.evaluate(ctx())).toEqual([]);
  });

  it('skips flows where dst is public', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({
        id: `f-${i}`,
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'h',
        dstIp: `203.0.113.${i + 1}`,
      }))
    );
    expect(await internalScanningDetector.evaluate(ctx())).toEqual([]);
  });

  it('honors INTERNAL_SCAN_THRESHOLD env override', async () => {
    process.env.INTERNAL_SCAN_THRESHOLD = '3';
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue(
      flowsToTargets('aa:aa:aa:aa:aa:aa', '10.0.0.5', 4)
    );
    const findings = await internalScanningDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
  });
});
