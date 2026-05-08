/**
 * detectionAnalytics — unit tests over the aggregations the dashboard
 * relies on. Prisma is mocked at the global setup level.
 */
import {
  getDetectionSummary,
  listDetections,
} from '../../../src/services/detection/detectionAnalytics';
import prisma from '../../../src/services/database';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

beforeEach(() => jest.clearAllMocks());

describe('getDetectionSummary', () => {
  it('aggregates totals, statuses, severity, and detector breakdowns', async () => {
    (mockedPrisma.detection.count as jest.Mock)
      .mockResolvedValueOnce(20) // total
      .mockResolvedValueOnce(15) // open
      .mockResolvedValueOnce(3) // resolved
      .mockResolvedValueOnce(2); // dismissed
    (mockedPrisma.detection.groupBy as jest.Mock)
      .mockResolvedValueOnce([
        { severity: 'HIGH', _count: { _all: 8 } },
        { severity: 'MEDIUM', _count: { _all: 12 } },
      ])
      .mockResolvedValueOnce([
        { detectorId: 'ioc_match', _count: { _all: 10 } },
        { detectorId: 'dns_bypass', _count: { _all: 5 } },
      ]);
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([
      { affectedResource: 'iot-cam', severity: 'HIGH' },
      { affectedResource: 'iot-cam', severity: 'CRITICAL' },
      { affectedResource: 'iot-cam', severity: 'MEDIUM' },
      { affectedResource: 'laptop', severity: 'LOW' },
    ]);

    const summary = await getDetectionSummary({ windowHours: 24 });
    expect(summary.total).toBe(20);
    expect(summary.open).toBe(15);
    expect(summary.resolved).toBe(3);
    expect(summary.dismissed).toBe(2);
    expect(summary.bySeverity).toEqual([
      { severity: 'HIGH', count: 8 },
      { severity: 'MEDIUM', count: 12 },
    ]);
    expect(summary.byDetector[0]).toEqual({ detectorId: 'ioc_match', count: 10 });
    expect(summary.topAffected[0]).toEqual({
      resource: 'iot-cam',
      count: 3,
      maxSeverity: 'CRITICAL',
    });
  });

  it('uses windowHours to compute the since timestamp', async () => {
    (mockedPrisma.detection.count as jest.Mock).mockResolvedValue(0);
    (mockedPrisma.detection.groupBy as jest.Mock).mockResolvedValue([]);
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([]);

    const before = Date.now();
    const summary = await getDetectionSummary({ windowHours: 12 });
    const after = Date.now();

    const sinceMs = new Date(summary.since).getTime();
    expect(sinceMs).toBeLessThanOrEqual(before - 12 * 60 * 60 * 1000 + 1000);
    expect(sinceMs).toBeGreaterThanOrEqual(after - 12 * 60 * 60 * 1000 - 1000);
  });
});

describe('listDetections', () => {
  it('orders by severity then lastSeen and respects limit', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([]);
    await listDetections({ windowHours: 24, limit: 25 });
    const arg = (mockedPrisma.detection.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.take).toBe(25);
    expect(arg.orderBy).toEqual([
      { severity: 'desc' },
      { lastSeen: 'desc' },
    ]);
  });

  it('expands severityAtLeast into a tier-inclusive `in` filter', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([]);
    await listDetections({ windowHours: 24, severityAtLeast: 'HIGH' });
    const arg = (mockedPrisma.detection.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.severity).toEqual({ in: ['HIGH', 'CRITICAL'] });
  });

  it('threads status + detectorId straight into the where clause', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([]);
    await listDetections({
      windowHours: 24,
      status: 'OPEN',
      detectorId: 'ioc_match',
    });
    const arg = (mockedPrisma.detection.findMany as jest.Mock).mock.calls[0][0];
    expect(arg.where.status).toBe('OPEN');
    expect(arg.where.detectorId).toBe('ioc_match');
  });

  it('serializes Date fields to ISO strings', async () => {
    (mockedPrisma.detection.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'd-1',
        detectorId: 'ioc_match',
        fingerprint: 'fp',
        severity: 'HIGH',
        status: 'OPEN',
        title: 't',
        description: 'd',
        affectedResource: 'h',
        srcMac: null,
        occurrences: 1,
        firstSeen: new Date('2026-05-01T00:00:00Z'),
        lastSeen: new Date('2026-05-06T00:00:00Z'),
        expiresAt: new Date('2026-05-20T00:00:00Z'),
        remediation: null,
        references: null,
        evidence: [],
        metadata: null,
      },
    ]);

    const rows = await listDetections({ windowHours: 24 });
    expect(rows[0]?.firstSeen).toBe('2026-05-01T00:00:00.000Z');
    expect(rows[0]?.lastSeen).toBe('2026-05-06T00:00:00.000Z');
  });
});
