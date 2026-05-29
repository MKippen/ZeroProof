/**
 * DNS allowlist — domains that DNS-based detectors should treat as
 * known-safe and skip when fingerprinting findings.
 *
 * Two layers:
 *   1. Built-in defaults — shipped as `rules/detection/dns_allowlist.yaml`,
 *      grouped into categories so users can browse and selectively disable.
 *   2. User overrides — `DnsAllowlistEntry` table (global or per-device)
 *      plus a `Setting` row that lists which built-in entries the user
 *      has disabled.
 *
 * Public surface:
 *   - getBuiltInAllowlist()      → categorized defaults (read-only)
 *   - getDisabledBuiltins()      → string[] of disabled "category:domain" keys
 *   - setDisabledBuiltins(...)   → persist toggle state
 *   - isAllowlisted(parent, mac) → effective check used by detectors
 *   - getUserEntries()           → user-managed CRUD list
 *
 * `parentDomain` matches with simple suffix logic — `foo.bar.com` matches
 * an allowlist entry of `bar.com`. This is intentional: most noise comes
 * from the eTLD+1 (a2z.com, fbcdn.net), and we want users to add
 * `weirdsite.com` once and have it cover every subdomain.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import yaml from 'js-yaml';
import prisma from './database';
import logger from '../utils/logger';

const DISABLED_BUILTINS_KEY = 'dns_allowlist.disabled_builtins';

const BuiltInCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  domains: z.array(z.string().min(1)).min(1),
});

const BuiltInFileSchema = z.object({
  id: z.literal('dns_allowlist'),
  description: z.string().optional(),
  categories: z.array(BuiltInCategorySchema).min(1),
});

export type BuiltInCategory = z.infer<typeof BuiltInCategorySchema>;
export interface BuiltInAllowlist {
  categories: BuiltInCategory[];
}

let cachedBuiltIn: BuiltInAllowlist | null = null;

/** Resolve the rules directory the same way the detector framework does. */
function rulesDir(): string {
  const override = process.env.DETECTION_RULES_DIR;
  if (override) return override;
  if (process.env.NODE_ENV === 'production') return '/rules/detection';
  return path.resolve(__dirname, '..', '..', '..', 'rules', 'detection');
}

/** Load the built-in allowlist YAML. Cached after first read. */
export function getBuiltInAllowlist(): BuiltInAllowlist {
  if (cachedBuiltIn) return cachedBuiltIn;
  const file = path.join(rulesDir(), 'dns_allowlist.yaml');
  if (!existsSync(file)) {
    logger.warn(`DNS allowlist YAML missing at ${file}; defaulting to empty.`);
    cachedBuiltIn = { categories: [] };
    return cachedBuiltIn;
  }
  try {
    const raw = readFileSync(file, 'utf8');
    const parsed = yaml.load(raw);
    const validated = BuiltInFileSchema.parse(parsed);
    cachedBuiltIn = { categories: validated.categories };
    return cachedBuiltIn;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to parse dns_allowlist.yaml: ${msg}. Treating as empty.`);
    cachedBuiltIn = { categories: [] };
    return cachedBuiltIn;
  }
}

/** Test-only — force a re-read on next access. */
export function resetBuiltInAllowlistCache(): void {
  cachedBuiltIn = null;
}

/** Read the set of disabled built-in keys. */
export async function getDisabledBuiltins(): Promise<string[]> {
  const row = await prisma.setting.findUnique({
    where: { key: DISABLED_BUILTINS_KEY },
  });
  if (!row) return [];
  const value = row.value as unknown;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/** Persist disabled built-in keys (full replace). */
export async function setDisabledBuiltins(keys: string[]): Promise<void> {
  const deduped = Array.from(new Set(keys));
  await prisma.setting.upsert({
    where: { key: DISABLED_BUILTINS_KEY },
    create: { key: DISABLED_BUILTINS_KEY, value: deduped },
    update: { value: deduped },
  });
}

/** Build a "category:domain" key — also accepts "category:*" to mean whole category. */
export function builtinKey(categoryId: string, domain: string): string {
  return `${categoryId}:${domain}`;
}
export function builtinCategoryKey(categoryId: string): string {
  return `${categoryId}:*`;
}

/**
 * Effective set of active built-in domains, given the disabled list.
 * Returns lowercased SLDs ready for suffix matching.
 */
export function activeBuiltInDomains(
  builtIn: BuiltInAllowlist,
  disabledKeys: ReadonlyArray<string>
): Set<string> {
  const disabled = new Set(disabledKeys);
  const domains = new Set<string>();
  for (const cat of builtIn.categories) {
    if (disabled.has(builtinCategoryKey(cat.id))) continue;
    for (const d of cat.domains) {
      if (disabled.has(builtinKey(cat.id, d))) continue;
      domains.add(d.toLowerCase());
    }
  }
  return domains;
}

/**
 * User-managed entries (CRUD).
 *
 * `deviceKey` for DEVICE-scoped entries: the DNS client identity our
 * detector sees. In practice that's the client IP from the DNS proxy
 * (e.g. AdGuard), since DNS events don't carry MAC addresses. Friendly
 * names from the proxy ride on the row separately as `deviceLabel` so
 * the UI can show "Kids Photo Frame (192.168.2.148)" while still keying
 * off the stable identifier.
 */
export interface UserEntryRow {
  id: string;
  parentDomain: string;
  scope: 'GLOBAL' | 'DEVICE';
  deviceKey: string | null;
  deviceLabel: string | null;
  sourceDetectionId: string | null;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
}

export async function listUserEntries(): Promise<UserEntryRow[]> {
  const rows = await prisma.dnsAllowlistEntry.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    parentDomain: r.parentDomain,
    scope: r.scope as 'GLOBAL' | 'DEVICE',
    // Surface the empty-string GLOBAL sentinel as null for API consumers.
    deviceKey: r.scope === 'DEVICE' ? r.deviceKey : null,
    deviceLabel: r.deviceLabel,
    sourceDetectionId: r.sourceDetectionId,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: r.createdBy,
  }));
}

export interface CreateUserEntryInput {
  parentDomain: string;
  scope: 'GLOBAL' | 'DEVICE';
  deviceKey?: string | null;
  deviceLabel?: string | null;
  sourceDetectionId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

export async function createUserEntry(input: CreateUserEntryInput): Promise<{
  id: string;
  parentDomain: string;
  scope: 'GLOBAL' | 'DEVICE';
  deviceKey: string;
}> {
  const parentDomain = input.parentDomain.toLowerCase().replace(/\.$/, '');
  const scope = input.scope;
  if (scope === 'DEVICE' && !input.deviceKey) {
    throw new Error('DEVICE scope requires deviceKey');
  }
  // Empty-string sentinel for GLOBAL keeps the (parentDomain, scope, deviceKey)
  // unique index well-defined — NULL is distinct in Postgres unique indexes.
  const deviceKey = scope === 'DEVICE' ? input.deviceKey! : '';
  const row = await prisma.dnsAllowlistEntry.upsert({
    where: {
      parentDomain_scope_deviceKey: { parentDomain, scope, deviceKey },
    },
    create: {
      parentDomain,
      scope,
      deviceKey,
      deviceLabel: input.deviceLabel ?? null,
      sourceDetectionId: input.sourceDetectionId ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    },
    update: {
      deviceLabel: input.deviceLabel ?? null,
      sourceDetectionId: input.sourceDetectionId ?? null,
      note: input.note ?? null,
    },
  });
  return {
    id: row.id,
    parentDomain: row.parentDomain,
    scope: row.scope as 'GLOBAL' | 'DEVICE',
    deviceKey: row.deviceKey,
  };
}

export async function deleteUserEntry(id: string): Promise<{ deleted: boolean }> {
  const deleted = await prisma.dnsAllowlistEntry
    .delete({ where: { id } })
    .then(() => true)
    .catch(() => false);
  return { deleted };
}

/**
 * Cache-busting in-memory snapshot for the hot detector path. Recomputed
 * on each detector run (cheap — small tables, no hot loop).
 */
export interface AllowlistSnapshot {
  globalDomains: Set<string>;
  deviceDomains: Map<string, Set<string>>;
}

export async function loadAllowlistSnapshot(): Promise<AllowlistSnapshot> {
  const builtIn = getBuiltInAllowlist();
  const [disabledBuiltins, userEntries] = await Promise.all([
    getDisabledBuiltins(),
    prisma.dnsAllowlistEntry.findMany(),
  ]);
  const globalDomains = activeBuiltInDomains(builtIn, disabledBuiltins);
  const deviceDomains = new Map<string, Set<string>>();
  for (const e of userEntries) {
    const dom = e.parentDomain.toLowerCase();
    if (e.scope === 'DEVICE' && e.deviceKey) {
      const bucket = deviceDomains.get(e.deviceKey.toLowerCase()) ?? new Set<string>();
      bucket.add(dom);
      deviceDomains.set(e.deviceKey.toLowerCase(), bucket);
    } else {
      globalDomains.add(dom);
    }
  }
  return { globalDomains, deviceDomains };
}

/**
 * True if `parentDomain` is allowlisted globally, or for the given device.
 * Suffix-match: `parent` ends with `entry` (preceded by `.` or equal).
 */
export function isAllowlisted(
  parent: string,
  deviceKey: string | null | undefined,
  snapshot: AllowlistSnapshot
): boolean {
  const p = parent.toLowerCase().replace(/\.$/, '');
  if (matchesSuffix(p, snapshot.globalDomains)) return true;
  if (deviceKey) {
    const deviceSet = snapshot.deviceDomains.get(deviceKey.toLowerCase());
    if (deviceSet && matchesSuffix(p, deviceSet)) return true;
  }
  return false;
}

function matchesSuffix(parent: string, domains: Set<string>): boolean {
  if (domains.has(parent)) return true;
  for (const d of domains) {
    if (parent.endsWith(`.${d}`)) return true;
  }
  return false;
}
