/**
 * System update notifications.
 *
 * Reads the running version from CHANGELOG.md, fetches GitHub releases for
 * the project, filters by user's selected channel (stable | beta), and
 * surfaces "vX.Y.Z available" if a newer release exists.
 *
 * Notify-and-confirm only — this module is visibility, never apply. The
 * actual upgrade is still a CLI step (`./scripts/upgrade.sh`) until the
 * sidecar pattern lands.
 *
 * Channel semantics (mapped to GitHub release flags):
 *   - stable: only releases where prerelease=false
 *   - beta:   releases where prerelease=true OR false (so a stable
 *             release always supersedes a beta in beta channel — semver-
 *             descending sort handles that naturally)
 *
 * Caching: GitHub anon API is 60 req/hr per IP. We cache 5 minutes
 * server-side, so even with a tab refresh storm we stay well under.
 */
import https from 'node:https';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import prisma from './database';

export type ReleaseChannel = 'stable' | 'beta';

export interface UpdateStatus {
  current: string;
  latest: string | null;
  channel: ReleaseChannel;
  hasUpdate: boolean;
  htmlUrl: string | null;
  notes: string | null;
  publishedAt: string | null;
  /** Set when we couldn't reach GitHub. UI surfaces this as "couldn't check". */
  error?: string;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  body: string | null;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string | null;
}

const CHANNEL_SETTING_KEY = 'system.releaseChannel';
const VERSION_CACHE_TTL_MS = 60_000;
const RELEASES_CACHE_TTL_MS = 5 * 60_000;
const GITHUB_OWNER = 'MKippen';
const GITHUB_REPO = 'ZeroProof';

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

let versionCache: CacheEntry<string | null> | null = null;
let releasesCache: CacheEntry<GithubRelease[]> | null = null;

export interface UpdateServiceOptions {
  /** Override CHANGELOG path (test seam). */
  changelogPath?: string;
  /** Override GitHub fetcher (test seam). */
  fetchReleases?: () => Promise<GithubRelease[]>;
  /** Override now() for cache testing. */
  now?: () => number;
}

export async function getReleaseChannel(): Promise<ReleaseChannel> {
  const row = await prisma.setting.findUnique({ where: { key: CHANNEL_SETTING_KEY } });
  const value = row?.value as { channel?: string } | string | null | undefined;
  let channel: string | undefined;
  if (typeof value === 'string') channel = value;
  else if (value && typeof value === 'object') channel = value.channel;
  return channel === 'beta' ? 'beta' : 'stable';
}

export async function setReleaseChannel(channel: ReleaseChannel): Promise<void> {
  await prisma.setting.upsert({
    where: { key: CHANNEL_SETTING_KEY },
    create: { key: CHANNEL_SETTING_KEY, value: { channel } },
    update: { value: { channel } },
  });
  // Invalidate the releases cache so the next /system/update call sees
  // the new channel-filtered result immediately, not after the TTL.
  releasesCache = null;
}

export async function getUpdateStatus(
  options: UpdateServiceOptions = {}
): Promise<UpdateStatus> {
  const channel = await getReleaseChannel();
  const current = await readCurrentVersion(options);
  let releases: GithubRelease[] = [];
  let error: string | undefined;
  try {
    releases = await loadReleases(options);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to fetch releases';
  }
  const eligible = releases.filter((r) =>
    channel === 'beta' ? !r.draft : !r.draft && !r.prerelease
  );
  // Sort semver-descending; the newest applicable release wins.
  eligible.sort((a, b) => compareTags(b.tag_name, a.tag_name));
  const latest = eligible[0] ?? null;

  const status: UpdateStatus = {
    current: current ?? 'unknown',
    latest: latest?.tag_name ?? null,
    channel,
    hasUpdate:
      !!current && !!latest && compareTags(latest.tag_name, current) > 0,
    htmlUrl: latest?.html_url ?? null,
    notes: latest?.body ?? null,
    publishedAt: latest?.published_at ?? null,
  };
  if (error) status.error = error;
  return status;
}

/** Read the most-recent `## [x.y.z]` heading from CHANGELOG.md. */
export async function readCurrentVersion(
  options: UpdateServiceOptions = {}
): Promise<string | null> {
  const now = (options.now ?? Date.now)();
  if (
    !options.changelogPath &&
    versionCache &&
    now - versionCache.fetchedAt < VERSION_CACHE_TTL_MS
  ) {
    return versionCache.value;
  }
  const changelogPath =
    options.changelogPath ??
    path.resolve(process.cwd(), '..', 'CHANGELOG.md');
  let text: string;
  try {
    text = await fs.readFile(changelogPath, 'utf8');
  } catch {
    if (!options.changelogPath) {
      versionCache = { value: null, fetchedAt: now };
    }
    return null;
  }
  const match = text.match(/^##\s*\[(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\]/m);
  const value = match ? `v${match[1]}` : null;
  if (!options.changelogPath) {
    versionCache = { value, fetchedAt: now };
  }
  return value;
}

async function loadReleases(
  options: UpdateServiceOptions
): Promise<GithubRelease[]> {
  const now = (options.now ?? Date.now)();
  if (
    !options.fetchReleases &&
    releasesCache &&
    now - releasesCache.fetchedAt < RELEASES_CACHE_TTL_MS
  ) {
    return releasesCache.value;
  }
  const fetched = options.fetchReleases
    ? await options.fetchReleases()
    : await fetchReleasesFromGithub();
  if (!options.fetchReleases) {
    releasesCache = { value: fetched, fetchedAt: now };
  }
  return fetched;
}

function fetchReleasesFromGithub(): Promise<GithubRelease[]> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: 'api.github.com',
        path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=20`,
        method: 'GET',
        timeout: 8_000,
        headers: {
          'User-Agent': 'ZeroProof-System-Update/1.0',
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      },
      (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          res.resume();
          reject(new Error(`GitHub returned ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(
              Buffer.concat(chunks).toString('utf8')
            ) as GithubRelease[];
            resolve(parsed);
          } catch {
            reject(new Error('Failed to parse GitHub response'));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('GitHub request timed out'));
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Compare two semver-shaped tags. Returns >0 if a > b, <0 if a < b, 0 if equal.
 * Tolerates leading "v" and standard semver pre-release suffixes (`-beta.1`).
 * Numeric majors/minors/patches are compared numerically; pre-release tags
 * compare lexicographically per semver spec (good enough for our purposes —
 * `beta.1 < beta.2 < rc.1 < (release)`).
 */
export function compareTags(a: string, b: string): number {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (!av && !bv) return 0;
  if (!av) return -1;
  if (!bv) return 1;
  for (let i = 0; i < 3; i++) {
    const diff = (av.parts[i] ?? 0) - (bv.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }
  // Same numeric core. A release (no prerelease) is greater than a prerelease.
  if (!av.pre && bv.pre) return 1;
  if (av.pre && !bv.pre) return -1;
  if (!av.pre && !bv.pre) return 0;
  return (av.pre ?? '').localeCompare(bv.pre ?? '');
}

function parseSemver(
  tag: string
): { parts: number[]; pre: string | null } | null {
  const cleaned = tag.replace(/^v/, '');
  const m = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return {
    parts: [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)],
    pre: m[4] ?? null,
  };
}

/** Test seam: clear cached values. */
export function _resetUpdateCaches(): void {
  versionCache = null;
  releasesCache = null;
}
