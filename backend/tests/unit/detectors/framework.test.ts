/**
 * Framework + persistence tests.
 *
 * The framework layer should be testable with no DB and no detectors —
 * each piece (registry, runner, persistence) is exercised in isolation.
 */
import { Severity } from '@prisma/client';
import {
  registerDetector,
  listDetectors,
  getDetector,
  resetDetectors,
} from '../../../src/detectors/registry';
import type { Detector, DetectorContext } from '../../../src/detectors/framework';
import { runAllDetectors, runDetector } from '../../../src/detectors/runner';
import {
  persistDetectionResults,
  cleanupExpiredDetections,
} from '../../../src/services/detection/detectionService';
import { resetDetectorRules } from '../../../src/detectors/ruleLoader';
import prisma from '../../../src/services/database';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

function makeDetector(id: string, results: Parameters<Detector['evaluate']>[0] extends DetectorContext ? Awaited<ReturnType<Detector['evaluate']>> : never): Detector {
  return {
    id,
    description: 'test',
    defaultWindowMinutes: 60,
    evaluate: async () => results,
  };
}

describe('detector registry', () => {
  beforeEach(() => resetDetectors());

  it('registers and retrieves detectors by id', () => {
    const detector = makeDetector('a', []);
    registerDetector(detector);
    expect(getDetector('a')).toBe(detector);
    expect(listDetectors()).toEqual([detector]);
  });

  it('register returns an unregister callback that only removes its own instance', () => {
    const original = makeDetector('a', []);
    const replacement = makeDetector('a', []);
    const off = registerDetector(original);

    // Replacement registers under same id — original's unregister callback
    // should NOT remove the replacement.
    registerDetector(replacement);
    off();

    expect(getDetector('a')).toBe(replacement);
  });

  it('overwrites when re-registering with same id', () => {
    const a = makeDetector('a', []);
    const b = makeDetector('a', []);
    registerDetector(a);
    registerDetector(b);
    expect(getDetector('a')).toBe(b);
  });
});

describe('persistDetectionResults', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts when no existing fingerprint', async () => {
    (mockedPrisma.detection.findUnique as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.detection.create as jest.Mock).mockResolvedValue({});

    const out = await persistDetectionResults(
      [
        {
          fingerprint: 'fp-1',
          severity: 'HIGH' as Severity,
          title: 'Test',
          description: 'desc',
          evidence: [{ kind: 'flow', id: 'flow-1' }],
        },
      ],
      { detectorId: 'test_detector' }
    );

    expect(out).toEqual({ inserted: 1, refreshed: 0 });
    expect(mockedPrisma.detection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          detectorId: 'test_detector',
          fingerprint: 'fp-1',
          severity: 'HIGH',
        }),
      })
    );
  });

  it('refreshes when fingerprint already exists, incrementing occurrences', async () => {
    (mockedPrisma.detection.findUnique as jest.Mock).mockResolvedValue({
      id: 'existing',
      severity: 'MEDIUM',
      occurrences: 3,
      firstSeen: new Date('2026-05-01'),
    });
    (mockedPrisma.detection.update as jest.Mock).mockResolvedValue({});

    const out = await persistDetectionResults(
      [
        {
          fingerprint: 'fp-1',
          severity: 'HIGH' as Severity,
          title: 'Test',
          description: 'desc',
          evidence: [],
        },
      ],
      { detectorId: 'test' }
    );

    expect(out).toEqual({ inserted: 0, refreshed: 1 });
    expect(mockedPrisma.detection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fingerprint: 'fp-1' },
        data: expect.objectContaining({
          occurrences: { increment: 1 },
          severity: 'HIGH', // escalated from MEDIUM
        }),
      })
    );
  });

  it('preserves the higher severity when refresh attempts to downgrade', async () => {
    (mockedPrisma.detection.findUnique as jest.Mock).mockResolvedValue({
      id: 'x',
      severity: 'CRITICAL',
      occurrences: 1,
      firstSeen: new Date(),
    });
    (mockedPrisma.detection.update as jest.Mock).mockResolvedValue({});

    await persistDetectionResults(
      [
        {
          fingerprint: 'fp-1',
          severity: 'LOW' as Severity,
          title: 't',
          description: 'd',
          evidence: [],
        },
      ],
      { detectorId: 'test' }
    );

    expect(mockedPrisma.detection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ severity: 'CRITICAL' }),
      })
    );
  });

  it('threads remediation and references from rule context', async () => {
    (mockedPrisma.detection.findUnique as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.detection.create as jest.Mock).mockResolvedValue({});

    await persistDetectionResults(
      [
        {
          fingerprint: 'fp-1',
          severity: 'HIGH' as Severity,
          title: 't',
          description: 'd',
          evidence: [],
        },
      ],
      {
        detectorId: 'test',
        remediation: 'fix it',
        references: ['https://example.com/'],
      }
    );

    expect(mockedPrisma.detection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          remediation: 'fix it',
          references: ['https://example.com/'],
        }),
      })
    );
  });
});

describe('cleanupExpiredDetections', () => {
  it('deletes both expired and resolved-then-stale detections', async () => {
    (mockedPrisma.detection.deleteMany as jest.Mock).mockResolvedValue({ count: 7 });
    const count = await cleanupExpiredDetections();
    expect(count).toBe(7);
    expect(mockedPrisma.detection.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            expect.objectContaining({ expiresAt: { lt: expect.any(Date) } }),
            expect.objectContaining({
              status: { in: ['RESOLVED', 'DISMISSED'] },
              lastSeen: { lt: expect.any(Date) },
            }),
          ],
        }),
      })
    );
  });
});

describe('runner', () => {
  beforeEach(() => {
    resetDetectors();
    resetDetectorRules();
    jest.clearAllMocks();
  });

  it('runs every registered detector and aggregates results', async () => {
    registerDetector(
      makeDetector('a', [
        {
          fingerprint: 'fp-a',
          severity: 'LOW' as Severity,
          title: 't',
          description: 'd',
          evidence: [],
        },
      ])
    );
    registerDetector(
      makeDetector('b', [
        {
          fingerprint: 'fp-b',
          severity: 'HIGH' as Severity,
          title: 't',
          description: 'd',
          evidence: [],
        },
      ])
    );
    (mockedPrisma.detection.findUnique as jest.Mock).mockResolvedValue(null);
    (mockedPrisma.detection.create as jest.Mock).mockResolvedValue({});

    const summary = await runAllDetectors();
    expect(summary.evaluated).toBe(2);
    expect(summary.inserted).toBe(2);
    expect(summary.refreshed).toBe(0);
    expect(summary.failed).toBe(0);
  });

  it('isolates per-detector failures so others continue', async () => {
    const broken: Detector = {
      id: 'broken',
      description: 'x',
      defaultWindowMinutes: 60,
      evaluate: async () => {
        throw new Error('detector blew up');
      },
    };
    registerDetector(broken);
    registerDetector(makeDetector('healthy', []));

    const summary = await runAllDetectors();
    expect(summary.failed).toBe(1);
    expect(summary.evaluated).toBe(1);
  });

  it('runDetector windows the context based on defaultWindowMinutes', async () => {
    const captured: DetectorContext[] = [];
    const detector: Detector = {
      id: 'spy',
      description: 'x',
      defaultWindowMinutes: 30,
      evaluate: async (ctx) => {
        captured.push(ctx);
        return [];
      },
    };
    await runDetector(detector, () => 1_700_000_000_000);
    expect(captured[0]?.endTime).toBe(1_700_000_000_000);
    expect(captured[0]?.beginTime).toBe(1_700_000_000_000 - 30 * 60 * 1000);
  });
});
