/**
 * Detector boot module. Registers built-in detectors and loads their YAML
 * rule metadata. Call `bootstrapDetectors()` once at server / scheduler
 * boot. Idempotent: safe to call again (e.g., from tests after a reset).
 */
import path from 'node:path';
import { registerDetector } from './registry';
import { loadDetectorRulesFromDirectory, resetDetectorRules } from './ruleLoader';
import { iocMatchDetector } from './iocMatch';
import { highRiskCountryEgressDetector } from './highRiskCountryEgress';
import { repeatingThreatDetector } from './repeatingThreat';
import { honeypotHitDetector } from './honeypotHit';
import { validatedCompromiseDetector } from './validatedCompromise';
import { dnsBypassDetector } from './dnsBypass';
import { adminPortEgressDetector } from './adminPortEgress';
import { highEgressVolumeDetector } from './highEgressVolume';
import { internalScanningDetector } from './internalScanning';
import { dnsTunnelingDetector } from './dnsTunneling';
import logger from '../utils/logger';

let booted = false;

const BUILT_IN_DETECTORS = [
  iocMatchDetector,
  highRiskCountryEgressDetector,
  repeatingThreatDetector,
  honeypotHitDetector,
  validatedCompromiseDetector,
  dnsBypassDetector,
  adminPortEgressDetector,
  highEgressVolumeDetector,
  internalScanningDetector,
  dnsTunnelingDetector,
];

/**
 * Resolve the YAML rules directory. Mounted at `/rules` in Docker; falls
 * back to `<repo>/rules/detection` for local dev.
 */
export function detectorRulesDir(): string {
  const override = process.env.DETECTION_RULES_DIR;
  if (override) return override;
  if (process.env.NODE_ENV === 'production') return '/rules/detection';
  return path.resolve(__dirname, '..', '..', '..', 'rules', 'detection');
}

export function bootstrapDetectors(): void {
  if (booted) return;
  for (const detector of BUILT_IN_DETECTORS) {
    registerDetector(detector);
  }
  const dir = detectorRulesDir();
  const result = loadDetectorRulesFromDirectory(dir);
  logger.info(
    `Detectors registered: ${BUILT_IN_DETECTORS.length}; rules loaded: ${result.loaded}` +
      (result.errors.length > 0 ? ` (${result.errors.length} errors)` : '')
  );
  booted = true;
}

/** Test-only — re-arm bootstrap so tests can register their own detectors. */
export function resetDetectorBootstrap(): void {
  booted = false;
  resetDetectorRules();
}

export {
  iocMatchDetector,
  highRiskCountryEgressDetector,
  repeatingThreatDetector,
  honeypotHitDetector,
  validatedCompromiseDetector,
  dnsBypassDetector,
  adminPortEgressDetector,
  highEgressVolumeDetector,
  internalScanningDetector,
  dnsTunnelingDetector,
};
