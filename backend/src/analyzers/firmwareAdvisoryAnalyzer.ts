/**
 * Firmware advisory analyzer.
 *
 * Compares the UniFi OS version of the controller and its consoles against
 * known security advisories (see ./firmwareAdvisory/advisories.ts) and emits a
 * vulnerability finding for any device still running an affected version.
 *
 * Version sources, in order of precision:
 *   1. Per-device `version` of a UniFi OS console in the devices list — the
 *      device model lets us pick the exact per-family fix threshold.
 *   2. `sysInfo.udm_version` — the UniFi OS version of the console ZeroProof is
 *      connected to. Used as a fallback when the console isn't represented as a
 *      device row; matched against the advisory's default console family.
 *
 * UniFi OS versioning (5.x) is independent of the Network Application version
 * (9.x/10.x). Advisories are evaluated strictly against the UniFi OS track.
 */
import { UniFiConfig, VulnerabilityFinding } from '../types';
import {
  FIRMWARE_ADVISORIES,
  FirmwareAdvisory,
  AffectedFamily,
  matchFamily,
  defaultFamily,
} from './firmwareAdvisory/advisories';
import { isAtOrBelow, isParseableVersion } from './firmwareAdvisory/versions';

interface EvalTarget {
  /** Display name for the affected resource. */
  label: string;
  model?: string;
  version: string;
  /** Dedupe key. */
  key: string;
}

/** Build the set of distinct UniFi OS versions to evaluate against advisories. */
function collectTargets(config: UniFiConfig): EvalTarget[] {
  const targets = new Map<string, EvalTarget>();
  const consoleModelHints: string[] = [];

  // 1. Console devices in the devices list (precise model + version).
  for (const device of config.devices || []) {
    if (!isParseableVersion(device.version)) continue;
    // Only consoles can be matched to a family; APs/switches won't match and
    // are skipped (their firmware is a separate track, not covered here).
    const matchesAnyAdvisory = FIRMWARE_ADVISORIES.some((a) => matchFamily(a, device.model));
    if (!matchesAnyAdvisory) continue;
    if (device.model) consoleModelHints.push(device.model);
    const key = `${(device.model || '').toUpperCase()}|${device.version}`;
    if (!targets.has(key)) {
      targets.set(key, {
        label: device.name ? `${device.name} (${device.model})` : device.model || 'UniFi OS console',
        model: device.model,
        version: device.version,
        key,
      });
    }
  }

  // 2. sysinfo UniFi OS version (the connected console). Skip if a device row
  //    already covers this exact version — the device row is more precise.
  const osVersion = config.sysInfo?.udm_version;
  if (isParseableVersion(osVersion)) {
    const alreadyCovered = [...targets.values()].some((t) => t.version === osVersion);
    if (!alreadyCovered) {
      // Attribute the model from a console device if we found one, so we can
      // pick the right per-family threshold; otherwise fall back to default.
      const model = consoleModelHints[0];
      const key = `SYSINFO|${osVersion}`;
      targets.set(key, {
        label: model ? `UniFi OS console (${model})` : 'UniFi OS (this controller)',
        model,
        version: osVersion,
        key,
      });
    }
  }

  return [...targets.values()];
}

function buildFinding(
  advisory: FirmwareAdvisory,
  family: AffectedFamily,
  target: EvalTarget
): VulnerabilityFinding {
  const topCves = advisory.cves
    .map((c) => (c.cvss ? `${c.id} (CVSS ${c.cvss.toFixed(1)})` : c.id))
    .join(', ');

  return {
    type: 'OUTDATED_FIRMWARE_ADVISORY',
    severity: advisory.severity,
    title: `${advisory.id}: UniFi OS ${target.version} is affected by critical vulnerabilities`,
    description:
      `${target.label} is running UniFi OS ${target.version}, which is affected by ${advisory.id}. ` +
      `${advisory.summary}\n\nBundled CVEs: ${topCves}.`,
    impact:
      `An actor with network access to this device can exploit these flaws (max CVSS ${advisory.maxCvss.toFixed(1)}) ` +
      `to execute commands, read or manipulate files on the underlying system, and make unauthorized changes — ` +
      `a full compromise of the device that sits at the center of your network.`,
    remediation:
      `Update UniFi OS on this ${family.label} to ${family.fixedVersion} or later.\n\n` +
      `1. Open the UniFi console / UniFi OS dashboard\n` +
      `2. Go to System > Updates (or Console Settings > Firmware)\n` +
      `3. Install the latest UniFi OS update (${family.fixedVersion}+)\n` +
      `4. Re-run a ZeroProof sync to confirm the finding clears\n\n` +
      `Advisory: ${advisory.url}`,
    affectedResource: `${target.label} — UniFi OS ${target.version}`,
    cveId: advisory.cves[0]?.id,
  };
}

export function analyzeFirmwareAdvisories(config: UniFiConfig): VulnerabilityFinding[] {
  const findings: VulnerabilityFinding[] = [];
  const targets = collectTargets(config);

  for (const advisory of FIRMWARE_ADVISORIES) {
    for (const target of targets) {
      const family = matchFamily(advisory, target.model) ?? defaultFamily(advisory);
      if (!family) continue;
      if (isAtOrBelow(target.version, family.affectedThrough)) {
        findings.push(buildFinding(advisory, family, target));
      }
    }
  }

  return findings;
}
