/**
 * repeatingThreat detector — exercises threshold tiering and dedupe across
 * threat events from the same source.
 */
import { repeatingThreatDetector } from '../../../src/detectors/repeatingThreat';
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

function makeEvents(srcIp: string, count: number, category = 'IDS_ALERT') {
  return Array.from({ length: count }, (_, i) => ({
    id: `${srcIp}-${i}`,
    srcIp,
    category,
    subcategory: null,
    severity: 'medium',
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.REPEATING_THRESHOLD_MED;
  delete process.env.REPEATING_THRESHOLD_HIGH;
});

describe('repeatingThreatDetector', () => {
  it('emits nothing under the medium threshold', async () => {
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue(
      makeEvents('203.0.113.5', 4)
    );
    expect(await repeatingThreatDetector.evaluate(ctx())).toEqual([]);
  });

  it('fires MEDIUM at >= medium threshold but < high', async () => {
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue(
      makeEvents('203.0.113.5', 5)
    );
    const findings = await repeatingThreatDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('MEDIUM');
    expect(findings[0]?.fingerprint).toBe('repeating_threat:203.0.113.5');
  });

  it('escalates to HIGH at >= high threshold', async () => {
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue(
      makeEvents('203.0.113.5', 20)
    );
    const findings = await repeatingThreatDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('HIGH');
    expect(findings[0]?.evidence).toHaveLength(20);
  });

  it('groups separately by source IP', async () => {
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue([
      ...makeEvents('203.0.113.5', 6),
      ...makeEvents('198.51.100.7', 6),
    ]);
    const findings = await repeatingThreatDetector.evaluate(ctx());
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.fingerprint).sort()).toEqual([
      'repeating_threat:198.51.100.7',
      'repeating_threat:203.0.113.5',
    ]);
  });

  it('honors env-driven threshold overrides', async () => {
    process.env.REPEATING_THRESHOLD_MED = '2';
    process.env.REPEATING_THRESHOLD_HIGH = '3';
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue(
      makeEvents('203.0.113.5', 3)
    );
    const findings = await repeatingThreatDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('falls back to defaults when overrides are non-numeric', async () => {
    process.env.REPEATING_THRESHOLD_MED = 'banana';
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue(
      makeEvents('203.0.113.5', 5)
    );
    const findings = await repeatingThreatDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('MEDIUM');
  });

  it('captures distinct categories in the metadata', async () => {
    (mockedPrisma.firewallThreatEvent.findMany as jest.Mock).mockResolvedValue([
      ...makeEvents('203.0.113.5', 3, 'web_attack'),
      ...makeEvents('203.0.113.5', 3, 'brute_force'),
    ]);
    const findings = await repeatingThreatDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.metadata?.categories).toEqual(
      expect.arrayContaining(['web_attack', 'brute_force'])
    );
  });
});
