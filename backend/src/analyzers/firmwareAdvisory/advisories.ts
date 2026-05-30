/**
 * Known UniFi security advisories that ZeroProof evaluates a controller's
 * firmware against. Each advisory is pure data — adding a future bulletin is a
 * new entry here, not a code change.
 *
 * Advisories are versioned against the **UniFi OS** firmware track (the `5.x`
 * scheme reported as `sysinfo.udm_version` and as the `version` of a UniFi OS
 * console device), NOT the UniFi Network Application track (the `9.x`/`10.x`
 * scheme). The two are independent — see SAB-064.
 */
import { Severity } from '../../types';

export interface AffectedFamily {
  /** Human label for the affected product family. */
  label: string;
  /**
   * Uppercased model-code substrings. A device matches this family when its
   * (uppercased) `model` contains one of these. Families are matched in array
   * order, so list more specific families before broader ones. The family
   * flagged `isDefault` is used when a console's exact model can't be resolved.
   */
  models: string[];
  /** Inclusive upper bound of vulnerable UniFi OS versions. */
  affectedThrough: string;
  /** First fixed UniFi OS version. */
  fixedVersion: string;
  /** Used as the fallback family when only a bare UniFi OS version is known. */
  isDefault?: boolean;
}

export interface AdvisoryCve {
  id: string;
  cvss?: number;
  type: string;
}

export interface FirmwareAdvisory {
  /** Bulletin id, e.g. "SAB-064". */
  id: string;
  title: string;
  url: string;
  /** ISO date the bulletin was published. */
  publishedAt: string;
  /** One-line human summary. */
  summary: string;
  severity: Severity;
  /** Highest CVSS among the bundled CVEs. */
  maxCvss: number;
  cves: AdvisoryCve[];
  /** Documents which version track `families[].affectedThrough` refers to. */
  versionTrack: 'unifi_os';
  families: AffectedFamily[];
}

export const FIRMWARE_ADVISORIES: FirmwareAdvisory[] = [
  {
    id: 'SAB-064',
    title: 'Multiple critical UniFi OS vulnerabilities (command injection, path traversal, access control)',
    url: 'https://community.ui.com/releases/Security-Advisory-Bulletin-064-064/84811c09-4cf4-42ab-bd61-cc994445963b',
    publishedAt: '2026-05-21',
    summary:
      'Five vulnerabilities in UniFi OS — three rated CVSS 10.0 — allow an actor with network access to inject commands, traverse the filesystem, and make unauthorized changes to the underlying system. Update UniFi OS immediately.',
    severity: 'CRITICAL',
    maxCvss: 10.0,
    versionTrack: 'unifi_os',
    cves: [
      { id: 'CVE-2026-34908', cvss: 10.0, type: 'Improper access control → unauthorized system changes' },
      { id: 'CVE-2026-34909', cvss: 10.0, type: 'Path traversal → underlying account compromise' },
      { id: 'CVE-2026-34910', cvss: 10.0, type: 'Command injection (improper input validation)' },
      { id: 'CVE-2026-33000', cvss: 9.1, type: 'Command injection (requires high privilege)' },
      { id: 'CVE-2026-34911', cvss: undefined, type: 'Path traversal → information disclosure (low privilege)' },
    ],
    // Ordered specific → general. First match wins.
    families: [
      {
        label: 'UniFi OS Server (software)',
        models: ['UNIFIOSSERVER', 'UOS-SERVER'],
        affectedThrough: '5.0.6',
        fixedVersion: '5.0.8',
      },
      {
        label: 'UNAS (UNAS-2/4/Pro/Pro-4/Pro-8)',
        models: ['UNAS'],
        affectedThrough: '5.1.8',
        fixedVersion: '5.1.10',
      },
      {
        label: 'UDM-Beast',
        models: ['BEAST'],
        affectedThrough: '5.1.8',
        fixedVersion: '5.1.11',
      },
      {
        label: 'UNVR-G2 / UNVR-G2-Pro',
        models: ['UNVRG2', 'UNVR-G2'],
        affectedThrough: '5.1.11',
        fixedVersion: '5.1.12',
      },
      {
        label: 'UCG-Industrial',
        models: ['UCGINDUSTRIAL', 'UCG-INDUSTRIAL'],
        affectedThrough: '5.0.13',
        fixedVersion: '5.1.12',
      },
      {
        label: 'Cloud Key / UDR-5G / ENVR-Core',
        models: ['UCKP', 'UCK', 'UDR5G', 'UDR-5G', 'ENVRCORE', 'ENVR-CORE'],
        affectedThrough: '5.0.17',
        fixedVersion: '5.1.12',
      },
      {
        // Broad UniFi OS console family — also the fallback when the exact
        // console model can't be resolved (e.g. version known only from sysinfo).
        label: 'UniFi OS console (UDM / UDR / UNVR / ENVR / UCG / EFG / UDW / Express)',
        models: ['UDMPRO', 'UDM', 'UDR7', 'UDR', 'UNVRPRO', 'UNVR', 'ENVR', 'UCG', 'EFG', 'UDW', 'EXPRESS'],
        affectedThrough: '5.0.16',
        fixedVersion: '5.1.12',
        isDefault: true,
      },
    ],
  },
];

/** Find the affected-family entry for a device model within an advisory. */
export function matchFamily(advisory: FirmwareAdvisory, model: string | undefined): AffectedFamily | null {
  if (!model) return null;
  const upper = model.toUpperCase().replace(/[\s_]/g, '');
  for (const family of advisory.families) {
    if (family.models.some((m) => upper.includes(m.replace(/[\s_-]/g, '')))) {
      return family;
    }
  }
  return null;
}

/** The fallback family used when only a bare UniFi OS version is known. */
export function defaultFamily(advisory: FirmwareAdvisory): AffectedFamily | null {
  return advisory.families.find((f) => f.isDefault) ?? null;
}
