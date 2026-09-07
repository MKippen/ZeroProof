import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

export type DetectorSourceKind = 'unifi' | 'adguard';

/** Machine identity from the observed event, never a mutable display label. */
export interface DetectorIdentity {
  version: 2;
  sourceKind: DetectorSourceKind;
  connectionId: string | null;
  scopeId: string | null;
  srcIp: string | null;
  srcMac: string | null;
  eventId: string;
  observedAt: string | null;
}

export interface DetectorIdentityInput {
  sourceKind: DetectorSourceKind;
  connectionId?: string | null;
  scopeId?: string | null;
  srcIp?: string | null;
  srcMac?: string | null;
  eventId: string;
  observedAt?: Date | string | number | null;
}

function nonempty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function normalizeMac(value: unknown): string | null {
  const mac = nonempty(value);
  if (!mac || !/^(?:[\da-f]{12}|(?:[\da-f]{2}:){5}[\da-f]{2}|(?:[\da-f]{2}-){5}[\da-f]{2}|(?:[\da-f]{4}\.){2}[\da-f]{4})$/i.test(mac)) return null;
  const digits = mac.replace(/[:.-]/g, '').toLowerCase();
  // Common placeholders do not identify an endpoint.
  if (digits === '000000000000' || digits === 'ffffffffffff') return null;
  return digits.match(/.{2}/g)!.join(':');
}

export function normalizeIp(value: unknown): string | null {
  const ip = nonempty(value);
  if (!ip) return null;
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6 || ip.includes('%')) return null;
  // WHATWG canonicalization expands/compresses equivalent IPv6 spellings.
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16);
    const low = parseInt(mapped[2]!, 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return canonical;
}

function timestamp(value: DetectorIdentityInput['observedAt']): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function createDetectorIdentity(input: DetectorIdentityInput): DetectorIdentity {
  const eventId = nonempty(input.eventId);
  if (!eventId) throw new Error('Detector identity requires an event ID');
  return {
    version: 2,
    sourceKind: input.sourceKind,
    connectionId: nonempty(input.connectionId),
    scopeId: nonempty(input.scopeId),
    srcIp: normalizeIp(input.srcIp),
    srcMac: normalizeMac(input.srcMac),
    eventId,
    observedAt: timestamp(input.observedAt),
  };
}

/** Legacy/untyped metadata is not sufficient evidence for correlation. */
export function parseDetectorIdentity(value: unknown): DetectorIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const identity = value as Record<string, unknown>;
  if (identity.version !== 2 || (identity.sourceKind !== 'unifi' && identity.sourceKind !== 'adguard') || !nonempty(identity.eventId)) return null;
  for (const field of ['connectionId', 'scopeId', 'srcIp', 'srcMac', 'observedAt'] as const) {
    if (identity[field] !== null && typeof identity[field] !== 'string') return null;
  }
  const parsed = createDetectorIdentity(identity as unknown as DetectorIdentityInput);
  if ((identity.srcIp !== null && !parsed.srcIp) || (identity.srcMac !== null && !parsed.srcMac) ||
      (identity.observedAt !== null && !parsed.observedAt)) return null;
  return parsed;
}

export function deviceIdentityKey(identity: DetectorIdentity): string {
  if (identity.srcMac) return `mac:${identity.srcMac}`;
  if (identity.srcIp) return `ip:${identity.srcIp}`;
  return `event:${identity.eventId}`;
}

export function identityScopeKey(identity: DetectorIdentity): string {
  // Legacy UniFi rows have no immutable site provenance. Keep them isolated
  // rather than merge overlapping IP space across historical site changes.
  const incomplete = !identity.connectionId || (identity.sourceKind === 'unifi' && !identity.scopeId);
  return JSON.stringify([identity.sourceKind, identity.connectionId, identity.scopeId, incomplete ? identity.eventId : null]);
}

export function scopedDeviceKey(identity: DetectorIdentity): string {
  return JSON.stringify([identityScopeKey(identity), deviceIdentityKey(identity)]);
}

export function detectorFingerprint(detectorId: string, identity: DetectorIdentity, indicator?: string): string {
  const key = JSON.stringify([scopedDeviceKey(identity), indicator ?? null]);
  return `${detectorId}:v2:${createHash('sha256').update(key).digest('hex')}`;
}
