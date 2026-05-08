/**
 * dnsBypass detector — exercises allowlist filtering, RFC1918 dst skipping,
 * and severity by action.
 */
import { dnsBypassDetector } from '../../../src/detectors/dnsBypass';
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
  delete process.env.KNOWN_DNS_RESOLVERS;
});

describe('dnsBypassDetector', () => {
  it('queries flows with dstPort=53', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([]);
    await dnsBypassDetector.evaluate(ctx());
    const arg = (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mock
      .calls[0][0];
    expect(arg.where.dstPort).toBe(53);
  });

  it('skips known public resolvers in the default allowlist', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'tv',
        dstIp: '8.8.8.8',
      },
    ]);
    expect(await dnsBypassDetector.evaluate(ctx())).toEqual([]);
  });

  it('skips RFC1918 destinations (internal resolver, not a bypass)', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'tv',
        dstIp: '10.0.0.53',
      },
    ]);
    expect(await dnsBypassDetector.evaluate(ctx())).toEqual([]);
  });

  it('fires MEDIUM for an allowed external resolver outside the allowlist', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'tv',
        dstIp: '76.76.2.0',
      },
    ]);
    const findings = await dnsBypassDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('MEDIUM');
    expect(findings[0]?.metadata?.resolver).toBe('76.76.2.0');
  });

  it('fires INFO for blocked external DNS', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'BLOCKED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'tv',
        dstIp: '76.76.2.0',
      },
    ]);
    const findings = await dnsBypassDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('INFO');
  });

  it('honors KNOWN_DNS_RESOLVERS env override', async () => {
    process.env.KNOWN_DNS_RESOLVERS = '76.76.2.0';
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'f-1',
        action: 'ALLOWED',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'tv',
        dstIp: '76.76.2.0',
      },
    ]);
    expect(await dnsBypassDetector.evaluate(ctx())).toEqual([]);
  });
});
