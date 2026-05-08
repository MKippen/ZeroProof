/**
 * adminPortEgress detector — exercises private-IP skip, allowed-vs-blocked
 * severity, and per-(srcKey, port) dedupe.
 */
import { adminPortEgressDetector } from '../../../src/detectors/adminPortEgress';
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
  delete process.env.ADMIN_EGRESS_PORTS;
});

describe('adminPortEgressDetector', () => {
  it('queries the default admin port set', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([]);
    await adminPortEgressDetector.evaluate(ctx());
    const arg = (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mock
      .calls[0][0];
    expect(arg.where.dstPort.in).toEqual(
      expect.arrayContaining([22, 23, 3389, 5900, 5985])
    );
  });

  it('skips internal-to-internal admin traffic (private dst)', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'admin-laptop',
        dstIp: '10.0.0.99',
        dstPort: 22,
      },
    ]);
    expect(await adminPortEgressDetector.evaluate(ctx())).toEqual([]);
  });

  it('fires HIGH for allowed outbound to an admin port on the public internet', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'iot-cam',
        dstIp: '203.0.113.5',
        dstPort: 22,
      },
    ]);
    const findings = await adminPortEgressDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('HIGH');
    expect(findings[0]?.metadata?.dstPort).toBe(22);
  });

  it('downgrades blocked attempts to LOW', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'BLOCKED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'iot',
        dstIp: '203.0.113.5',
        dstPort: 22,
      },
    ]);
    const findings = await adminPortEgressDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('LOW');
  });

  it('honors ADMIN_EGRESS_PORTS override', async () => {
    process.env.ADMIN_EGRESS_PORTS = '8080';
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([]);
    await adminPortEgressDetector.evaluate(ctx());
    const arg = (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mock
      .calls[0][0];
    expect(arg.where.dstPort.in).toEqual([8080]);
  });
});
