/**
 * Detector runner. Iterates registered detectors, evaluates each over its
 * configured time window, and persists results. Failure of one detector
 * never blocks the others.
 *
 * Detectors are run sequentially today — the volume is small and serial
 * keeps the DB load predictable. If any detector becomes hot we can swap to
 * `Promise.allSettled` without changing the public surface.
 */
import logger from '../utils/logger';
import { listDetectors } from './registry';
import type { Detector, DetectorContext } from './framework';
import { persistDetectionResults } from '../services/detection/detectionService';
import { getDetectorRule } from './ruleLoader';

export interface RunSummary {
  evaluated: number;
  inserted: number;
  refreshed: number;
  failed: number;
}

/**
 * Run every registered detector. Returns aggregate counts; per-detector
 * results land in the Detection table via the dedupe/upsert path.
 */
export async function runAllDetectors(now: () => number = Date.now): Promise<RunSummary> {
  const summary: RunSummary = { evaluated: 0, inserted: 0, refreshed: 0, failed: 0 };
  const detectors = listDetectors();

  for (const detector of detectors) {
    try {
      const result = await runDetector(detector, now);
      summary.inserted += result.inserted;
      summary.refreshed += result.refreshed;
      summary.evaluated += 1;
    } catch (err) {
      summary.failed += 1;
      logger.error(`Detector ${detector.id} failed: ${(err as Error).message}`);
    }
  }

  if (summary.evaluated > 0 || summary.failed > 0) {
    logger.info(
      `Detector run: ${summary.evaluated} ran, +${summary.inserted} new, ${summary.refreshed} refreshed, ${summary.failed} failed`
    );
  }
  return summary;
}

/** Run a single detector. Exposed for targeted re-runs / dev scripts. */
export async function runDetector(
  detector: Detector,
  now: () => number = Date.now
): Promise<{ inserted: number; refreshed: number }> {
  const endTime = now();
  const beginTime = endTime - detector.defaultWindowMinutes * 60 * 1000;

  const ctx: DetectorContext = {
    beginTime,
    endTime,
    log: {
      debug: (msg, meta) => logger.debug(`[detector ${detector.id}] ${msg}`, meta),
      info: (msg, meta) => logger.info(`[detector ${detector.id}] ${msg}`, meta),
      warn: (msg, meta) => logger.warn(`[detector ${detector.id}] ${msg}`, meta),
    },
    tz: 'UTC',
    now,
  };

  const results = await detector.evaluate(ctx);
  if (results.length === 0) return { inserted: 0, refreshed: 0 };

  const rule = getDetectorRule(detector.id);
  return persistDetectionResults(results, {
    detectorId: detector.id,
    remediation: rule?.remediation,
    references: rule?.references,
    retentionDays: rule?.retentionDays,
  });
}
