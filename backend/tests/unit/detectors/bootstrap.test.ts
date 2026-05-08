/**
 * Detector bootstrap — verifies the boot wiring registers all 10 detectors
 * and is idempotent (safe to call twice).
 */
import path from 'node:path';
import {
  bootstrapDetectors,
  resetDetectorBootstrap,
  detectorRulesDir,
} from '../../../src/detectors';
import { listDetectors, resetDetectors } from '../../../src/detectors/registry';
import { listDetectorRules } from '../../../src/detectors/ruleLoader';

beforeEach(() => {
  resetDetectors();
  resetDetectorBootstrap();
});

describe('bootstrapDetectors', () => {
  it('registers all 10 built-in detectors', () => {
    bootstrapDetectors();
    const ids = listDetectors().map((d) => d.id).sort();
    expect(ids).toEqual([
      'admin_port_egress',
      'dns_bypass',
      'dns_tunneling',
      'high_egress_volume',
      'high_risk_country_egress',
      'honeypot_hit',
      'internal_scanning',
      'ioc_match',
      'repeating_threat',
      'validated_compromise',
    ]);
  });

  it('loads YAML rule metadata for each detector', () => {
    process.env.DETECTION_RULES_DIR = path.resolve(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'rules',
      'detection'
    );
    bootstrapDetectors();
    const ruleIds = listDetectorRules().map((r) => r.id).sort();
    // Every detector should have a corresponding rule file.
    expect(ruleIds).toContain('ioc_match');
    expect(ruleIds).toContain('honeypot_hit');
    expect(ruleIds).toContain('dns_tunneling');
    expect(ruleIds.length).toBe(listDetectors().length);
    delete process.env.DETECTION_RULES_DIR;
  });

  it('is idempotent (second call is a no-op)', () => {
    bootstrapDetectors();
    bootstrapDetectors();
    expect(listDetectors()).toHaveLength(10);
  });

  it('detectorRulesDir() honors DETECTION_RULES_DIR override', () => {
    process.env.DETECTION_RULES_DIR = '/custom/path';
    expect(detectorRulesDir()).toBe('/custom/path');
    delete process.env.DETECTION_RULES_DIR;
  });
});
