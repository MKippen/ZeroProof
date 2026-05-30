/**
 * Firmware Advisory Analyzer tests.
 *
 * Verifies SAB-064 detection across the version sources (per-device console
 * version and sysinfo udm_version), per-family fix thresholds, and that
 * patched / non-applicable devices produce no findings.
 */

import { analyzeFirmwareAdvisories } from '../../../src/analyzers/firmwareAdvisoryAnalyzer';
import { compareVersions, isAtOrBelow, parseVersion } from '../../../src/analyzers/firmwareAdvisory/versions';
import { UniFiConfig } from '../../../src/types';

describe('version comparison', () => {
  it('parses leading numeric components and ignores build suffixes', () => {
    expect(parseVersion('5.1.12')).toEqual([5, 1, 12]);
    expect(parseVersion('v5.0.16')).toEqual([5, 0, 16]);
    expect(parseVersion('5.1.12.1234')).toEqual([5, 1, 12, 1234]);
    expect(parseVersion('5.1.12-beta')).toEqual([5, 1, 12]);
  });

  it('orders versions correctly', () => {
    expect(compareVersions('5.0.16', '5.1.12')).toBeLessThan(0);
    expect(compareVersions('5.1.12', '5.0.16')).toBeGreaterThan(0);
    expect(compareVersions('5.1', '5.1.0')).toBe(0);
    expect(compareVersions('4.2.7', '5.0.6')).toBeLessThan(0);
  });

  it('treats threshold as inclusive', () => {
    expect(isAtOrBelow('5.0.16', '5.0.16')).toBe(true);
    expect(isAtOrBelow('5.0.15', '5.0.16')).toBe(true);
    expect(isAtOrBelow('5.1.12', '5.0.16')).toBe(false);
  });
});

describe('analyzeFirmwareAdvisories — SAB-064', () => {
  it('flags a UDM-Pro console on an affected UniFi OS version', () => {
    const config: UniFiConfig = {
      devices: [{ mac: 'aa:bb:cc:dd:ee:ff', name: 'Dream Machine', model: 'UDMPRO', type: 'ugw', version: '5.0.16' }],
    };
    const findings = analyzeFirmwareAdvisories(config);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('OUTDATED_FIRMWARE_ADVISORY');
    expect(findings[0].severity).toBe('CRITICAL');
    expect(findings[0].title).toContain('SAB-064');
    expect(findings[0].cveId).toBe('CVE-2026-34908');
    expect(findings[0].remediation).toContain('5.1.12');
  });

  it('does not flag a UDM-Pro already on the fixed version', () => {
    const config: UniFiConfig = {
      devices: [{ mac: 'aa', name: 'Dream Machine', model: 'UDMPRO', type: 'ugw', version: '5.1.12' }],
    };
    expect(analyzeFirmwareAdvisories(config)).toHaveLength(0);
  });

  it('uses the UNAS-specific threshold (fixed 5.1.10)', () => {
    const affected: UniFiConfig = {
      devices: [{ mac: 'aa', name: 'NAS', model: 'UNASPRO', type: 'unas', version: '5.1.8' }],
    };
    const patched: UniFiConfig = {
      devices: [{ mac: 'aa', name: 'NAS', model: 'UNASPRO', type: 'unas', version: '5.1.10' }],
    };
    const affectedFindings = analyzeFirmwareAdvisories(affected);
    expect(affectedFindings).toHaveLength(1);
    expect(affectedFindings[0].remediation).toContain('5.1.10');
    // A UNAS on 5.1.9 (above the broad-console 5.0.16 default) is still flagged
    // because the UNAS family threshold is 5.1.8 → fixed 5.1.10.
    expect(analyzeFirmwareAdvisories(patched)).toHaveLength(0);
  });

  it('detects an affected version from sysinfo udm_version when no console device row exists', () => {
    const config: UniFiConfig = {
      devices: [{ mac: 'aa', name: 'Office AP', model: 'U7PRO', type: 'uap', version: '7.0.0' }],
      sysInfo: { version: '9.1.120', udm_version: '5.0.16' },
    };
    const findings = analyzeFirmwareAdvisories(config);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain('5.0.16');
  });

  it('ignores access points / switches whose firmware is on a different track', () => {
    const config: UniFiConfig = {
      devices: [
        { mac: 'aa', name: 'Office AP', model: 'U7PRO', type: 'uap', version: '7.0.0' },
        { mac: 'bb', name: 'Switch', model: 'USW24POE', type: 'usw', version: '6.6.55' },
      ],
    };
    expect(analyzeFirmwareAdvisories(config)).toHaveLength(0);
  });

  it('does not double-report when sysinfo and the device row agree', () => {
    const config: UniFiConfig = {
      devices: [{ mac: 'aa', name: 'Dream Machine', model: 'UDMPRO', type: 'ugw', version: '5.0.16' }],
      sysInfo: { version: '9.1.120', udm_version: '5.0.16' },
    };
    expect(analyzeFirmwareAdvisories(config)).toHaveLength(1);
  });

  it('returns nothing for an empty config', () => {
    expect(analyzeFirmwareAdvisories({})).toHaveLength(0);
    expect(analyzeFirmwareAdvisories({ devices: [] })).toHaveLength(0);
  });
});
