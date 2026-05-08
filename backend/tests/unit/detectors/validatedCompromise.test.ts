/**
 * validatedCompromise detector — fires only when the same source has BOTH
 * an ioc_match Detection AND a UniFi IDS event in the window.
 */
import { validatedCompromiseDetector } from '../../../src/detectors/validatedCompromise';
import type { DetectorContext } from '../../../src/detectors/framework';
import prisma from '../../../src/services/database';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

function ctx(): DetectorContext {
  const now = Date.UTC(2026, 4, 7, 12, 0, 0);
  return {
    beginTime: now - 120 * 60 * 1000,
    endTime: now,
    log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
    tz: 'UTC',
    now: () => now,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([]);
  (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue([]);
});

describe('validatedCompromiseDetector', () => {
  it('emits nothing when there are no IOC findings', async () => {
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
    // Short-circuit — should not query threats either.
    expect(mockedPrisma.firewallThreatEvent.findMany).not.toHaveBeenCalled();
  });

  it('emits nothing when there are IOC findings but no IDS hits', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'd-1',
        srcMac: 'aa:bb:cc:dd:ee:ff',
        affectedResource: 'iot-cam',
        evidence: [],
      },
    ]);
    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it('matches on srcMac (preferred over affectedResource)', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'd-1',
        srcMac: 'AA:BB:CC:DD:EE:FF',
        affectedResource: 'iot-cam',
        evidence: [],
      },
    ]);
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 't-1',
        srcIp: '10.0.0.5',
        deviceMac: 'aa:bb:cc:dd:ee:ff',
        category: 'web_attack',
      },
    ]);

    const findings = await validatedCompromiseDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('CRITICAL');
    expect(findings[0]?.fingerprint).toBe('validated_compromise:aa:bb:cc:dd:ee:ff');
    expect(findings[0]?.evidence).toContainEqual({ kind: 'threat', id: 't-1' });
  });

  it('falls back to matching on affectedResource (srcIp) when no MAC', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([
      { id: 'd-1', srcMac: null, affectedResource: '10.0.0.5', evidence: [] },
    ]);
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue([
      { id: 't-1', srcIp: '10.0.0.5', deviceMac: null, category: 'scan' },
    ]);

    const findings = await validatedCompromiseDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.fingerprint).toBe('validated_compromise:10.0.0.5');
  });

  it('does not fire when the IOC and IDS hits are different devices', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'd-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        affectedResource: 'host-a',
        evidence: [],
      },
    ]);
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 't-1',
        srcIp: '10.0.0.99',
        deviceMac: 'bb:bb:bb:bb:bb:bb',
        category: 'scan',
      },
    ]);

    expect(await validatedCompromiseDetector.evaluate(ctx())).toEqual([]);
  });

  it('captures distinct threat categories in metadata', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'd-1',
        srcMac: 'aa:bb:cc:dd:ee:ff',
        affectedResource: 'h',
        evidence: [],
      },
    ]);
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 't-1',
        srcIp: '10.0.0.5',
        deviceMac: 'aa:bb:cc:dd:ee:ff',
        category: 'scan',
      },
      {
        id: 't-2',
        srcIp: '10.0.0.5',
        deviceMac: 'aa:bb:cc:dd:ee:ff',
        category: 'web_attack',
      },
    ]);

    const findings = await validatedCompromiseDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.metadata?.threatCount).toBe(2);
    expect(findings[0]?.metadata?.threatCategories).toEqual(
      expect.arrayContaining(['scan', 'web_attack'])
    );
  });
});
