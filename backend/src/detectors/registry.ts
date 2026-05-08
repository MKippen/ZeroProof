/**
 * Detector registry — a singleton in-memory map of detectorId → Detector
 * instance, populated at boot. Mirrors the dnsIndicators / dnsProxyConfig
 * adapter pattern: registration is idempotent, listing is read-only,
 * and `resetDetectors()` is exposed only for tests.
 */
import type { Detector } from './framework';

const detectors = new Map<string, Detector>();

/** Register a detector. Returns an unregister function. */
export function registerDetector(detector: Detector): () => void {
  detectors.set(detector.id, detector);
  return () => {
    if (detectors.get(detector.id) === detector) {
      detectors.delete(detector.id);
    }
  };
}

export function getDetector(id: string): Detector | undefined {
  return detectors.get(id);
}

export function listDetectors(): Detector[] {
  return Array.from(detectors.values());
}

/** Test-only. */
export function resetDetectors(): void {
  detectors.clear();
}
