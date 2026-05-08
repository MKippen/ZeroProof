/**
 * highEgressVolume detector — exercises threshold tiering, the
 * private→public direction filter, and BigInt summation.
 */
import { highEgressVolumeDetector } from '../../../src/detectors/highEgressVolume';
import type { DetectorContext } from '../../../src/detectors/framework';
import prisma from '../../../src/services/database';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

const GIB = BigInt(1024) * BigInt(1024) * BigInt(1024);

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
  delete process.env.HIGH_EGRESS_BYTES_THRESHOLD;
});

describe('highEgressVolumeDetector', () => {
  it('emits nothing under the default threshold', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'host',
        dstIp: '8.8.8.8',
        bytesTotal: BigInt(1024) * BigInt(1024) * BigInt(100), // 100 MiB
      },
    ]);
    expect(await highEgressVolumeDetector.evaluate(ctx())).toEqual([]);
  });

  it('fires MEDIUM when total crosses the threshold', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'host',
        dstIp: '8.8.8.8',
        bytesTotal: GIB + BigInt(1),
      },
    ]);
    const findings = await highEgressVolumeDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('fires HIGH at >= 5x threshold', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'host',
        dstIp: '8.8.8.8',
        bytesTotal: GIB * BigInt(6),
      },
    ]);
    const findings = await highEgressVolumeDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('only sums private→public flows (LAN-to-LAN does not count)', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'lan',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'host',
        dstIp: '10.0.0.99',
        bytesTotal: GIB * BigInt(10),
      },
    ]);
    expect(await highEgressVolumeDetector.evaluate(ctx())).toEqual([]);
  });

  it('groups multiple flows from the same source and sums bytes', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'host',
        dstIp: '8.8.8.8',
        bytesTotal: BigInt(1024) * BigInt(1024) * BigInt(700),
      },
      {
        id: 'f-2',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'host',
        dstIp: '8.8.8.8',
        bytesTotal: BigInt(1024) * BigInt(1024) * BigInt(700),
      },
    ]);
    const findings = await highEgressVolumeDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    // Total > 1 GiB (700+700 = 1400 MiB).
    expect(BigInt(findings[0]?.metadata?.totalBytes as string)).toBeGreaterThan(
      GIB
    );
  });

  it('honors HIGH_EGRESS_BYTES_THRESHOLD env override', async () => {
    process.env.HIGH_EGRESS_BYTES_THRESHOLD = '1048576'; // 1 MiB
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'host',
        dstIp: '8.8.8.8',
        bytesTotal: BigInt(2 * 1024 * 1024),
      },
    ]);
    const findings = await highEgressVolumeDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
  });
});
