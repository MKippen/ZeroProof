/**
 * honeypotHit detector — exercises env-driven configuration, the OR
 * (IP|MAC) match condition, and per-(srcKey,target) dedupe.
 */
import { honeypotHitDetector } from '../../../src/detectors/honeypotHit';
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
  delete process.env.HONEYPOT_IPS;
  delete process.env.HONEYPOT_MACS;
});

describe('honeypotHitDetector', () => {
  it('emits nothing and does not query when no honeypots are configured', async () => {
    const findings = await honeypotHitDetector.evaluate(ctx());
    expect(findings).toEqual([]);
    expect(mockedPrisma.firewallFlowEvent.findMany).not.toHaveBeenCalled();
  });

  it('queries with both IP and MAC OR-clauses when both env vars are set', async () => {
    process.env.HONEYPOT_IPS = '10.0.99.10,10.0.99.11';
    process.env.HONEYPOT_MACS = 'DE:AD:BE:EF:00:01';
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([]);

    await honeypotHitDetector.evaluate(ctx());

    const arg = (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mock
      .calls[0][0];
    const orClauses = arg.where.OR;
    expect(orClauses).toEqual(
      expect.arrayContaining([
        { dstIp: { in: ['10.0.99.10', '10.0.99.11'] } },
        { dstMac: { in: ['de:ad:be:ef:00:01'] } },
      ])
    );
  });

  it('fires CRITICAL on a hit, with honeypot target in metadata', async () => {
    process.env.HONEYPOT_IPS = '10.0.99.10';
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'iot-cam',
        dstIp: '10.0.99.10',
        dstMac: null,
        dstPort: 22,
      },
    ]);

    const findings = await honeypotHitDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('CRITICAL');
    expect(findings[0]?.affectedResource).toBe('iot-cam');
    expect(findings[0]?.metadata?.target).toBe('10.0.99.10');
    expect(findings[0]?.metadata?.port).toBe(22);
  });

  it('coalesces multiple flows from same src to same honeypot into one finding', async () => {
    process.env.HONEYPOT_IPS = '10.0.99.10';
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'iot',
        dstIp: '10.0.99.10',
        dstMac: null,
        dstPort: 22,
      },
      {
        id: 'f-2',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.1',
        srcClientName: 'iot',
        dstIp: '10.0.99.10',
        dstMac: null,
        dstPort: 23,
      },
    ]);

    const findings = await honeypotHitDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toHaveLength(2);
  });
});
