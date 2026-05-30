/**
 * Dotted-numeric version comparison for UniFi OS firmware strings.
 *
 * UniFi firmware versions look like "5.0.16", "5.1.12", and occasionally carry
 * a build suffix ("5.1.12.1234" or "5.1.12-beta"). We compare only the leading
 * numeric dotted components; non-numeric trailing segments are ignored for the
 * purposes of "is this at or below the affected-through threshold".
 */

/** Parse a version string into its leading numeric components. */
export function parseVersion(version: string): number[] {
  const cleaned = version.trim().replace(/^v/i, '');
  const parts: number[] = [];
  for (const segment of cleaned.split(/[.\-+]/)) {
    const n = Number.parseInt(segment, 10);
    if (Number.isNaN(n)) break; // stop at first non-numeric segment (build hash, "beta", etc.)
    parts.push(n);
  }
  return parts;
}

/**
 * Compare two versions. Returns negative if a < b, 0 if equal, positive if a > b.
 * Missing components are treated as 0 (so "5.1" === "5.1.0").
 */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when `version` is at or below `threshold` (i.e. still affected). */
export function isAtOrBelow(version: string, threshold: string): boolean {
  return compareVersions(version, threshold) <= 0;
}

/** True when `version` looks like a parseable dotted version we can reason about. */
export function isParseableVersion(version: string | undefined | null): version is string {
  return typeof version === 'string' && parseVersion(version).length > 0;
}
