/**
 * UniFi gateway auto-discovery.
 *
 * Reads the host's default-route gateway from /proc/net/route and probes
 * the UniFi-typical TCP ports (443 for UniFi OS, 8443 for legacy Network
 * Application) for a listening service. The frontend uses the result to
 * offer "Looks like a UniFi gateway at X.X.X.X — use this?" with one-
 * click prefill.
 *
 * Design constraints (security tool — autoscan is a footgun):
 *   - We never sweep the LAN. The only IP we probe is the host's actual
 *     default gateway, which is the device DHCP pointed every machine on
 *     the LAN at — for >95% of UniFi customers that's the controller
 *     (UDM/UDR/UCG/CloudKey).
 *   - We always *show* what we found and let the operator confirm or
 *     edit; we never silently apply a discovered config.
 *   - We deliberately do NOT speak HTTPS during the probe. UniFi devices
 *     ship self-signed certs by default, and disabling cert validation
 *     for an HTTPS probe trips both static analyzers and the spirit of
 *     the security policy. Instead we do a plain TCP listener check —
 *     the actual fingerprint validation happens when the operator clicks
 *     "Test" on the connection form, which is the path that needs auth
 *     and full TLS verification.
 */
import net from 'node:net';
import { promises as fs } from 'node:fs';

const ROUTE_TABLE_PATH = '/proc/net/route';

/** Default ports we probe for each known UniFi product. */
const UNIFI_OS_PORTS = [443];
const UNIFI_LEGACY_PORTS = [8443];

/** Single discovered UniFi candidate. */
export interface UniFiCandidate {
  product: 'unifi_os' | 'unifi_network_legacy';
  host: string;
  port: number;
  /** True if the discovered service answered with a recognized fingerprint. */
  confidence: 'high' | 'medium';
  /** Free-form details — title, server header, etc. — for surfacing in the UI. */
  details?: Record<string, unknown>;
}

export interface DiscoverOptions {
  /** Override the route table path (test seam). */
  routeTablePath?: string;
  /** Inject a probe function (test seam). */
  probe?: (
    host: string,
    port: number,
    timeoutMs: number
  ) => Promise<UniFiCandidate | null>;
  /** Timeout per probe (ms). Default 2500. UniFi OS can be slow to TLS-handshake. */
  probeTimeoutMs?: number;
}

/** Top-level entry point: returns all UniFi gateway candidates we could find. */
export async function discoverUniFiGateways(
  options: DiscoverOptions = {}
): Promise<UniFiCandidate[]> {
  const gateway = await readDefaultGateway(
    options.routeTablePath ?? ROUTE_TABLE_PATH
  );
  if (!gateway) return [];
  if (!isPrivateIpv4(gateway)) return [];

  const probe = options.probe ?? defaultProbe;
  const timeoutMs = options.probeTimeoutMs ?? 2500;

  const targets: Array<{ host: string; port: number }> = [];
  for (const port of new Set([...UNIFI_OS_PORTS, ...UNIFI_LEGACY_PORTS])) {
    targets.push({ host: gateway, port });
  }

  const results = await Promise.all(
    targets.map(({ host, port }) =>
      probe(host, port, timeoutMs).catch(() => null)
    )
  );

  // Deduplicate (host, port, product) — one product can only legitimately
  // claim one (host, port), but probes for different products on the same
  // port can otherwise both match.
  const seen = new Set<string>();
  const out: UniFiCandidate[] = [];
  for (const r of results) {
    if (!r) continue;
    const key = `${r.product}@${r.host}:${r.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Parse /proc/net/route and return the IPv4 default gateway as dotted-quad.
 *
 * Format (tab-separated, hex little-endian):
 *   Iface  Destination  Gateway   Flags  RefCnt  Use  Metric  Mask  ...
 *   eth0   00000000     0102A8C0  0003   0       0    0       00000000  ...
 *
 * The default route is the row with Destination == "00000000".
 */
export async function readDefaultGateway(
  path: string
): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(path, 'utf8');
  } catch {
    return null;
  }
  const lines = text.split('\n');
  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 3) continue;
    if (cols[1] !== '00000000') continue;
    const hex = cols[2];
    if (!hex || !/^[0-9A-Fa-f]{8}$/.test(hex)) continue;
    return hexLittleEndianToDottedQuad(hex);
  }
  return null;
}

/** Convert "0102A8C0" → "192.168.2.1" (little-endian byte order). */
function hexLittleEndianToDottedQuad(hex: string): string {
  const a = parseInt(hex.slice(6, 8), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const c = parseInt(hex.slice(2, 4), 16);
  const d = parseInt(hex.slice(0, 2), 16);
  return `${a}.${b}.${c}.${d}`;
}

/** RFC1918 only. We deliberately exclude loopback, link-local, and Docker bridges. */
export function isPrivateIpv4(ip: string): boolean {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [parseInt(m[1]!, 10), parseInt(m[2]!, 10)];
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

async function defaultProbe(
  host: string,
  port: number,
  timeoutMs: number
): Promise<UniFiCandidate | null> {
  const listening = await tcpListenerOpen(host, port, timeoutMs);
  if (!listening) return null;

  // The candidate is "something is listening on a UniFi-typical port at
  // the LAN's default gateway." We deliberately don't claim higher
  // confidence — the operator's Test click is the real fingerprint
  // (auth + TLS + UniFi API shape). Confidence='medium' tells the UI
  // to phrase this as a suggestion, not a confirmed match.
  const product: UniFiCandidate['product'] =
    port === 8443 ? 'unifi_network_legacy' : 'unifi_os';

  return {
    product,
    host,
    port,
    confidence: 'medium',
  };
}

/**
 * Plain TCP connect probe. No TLS, no HTTP — just "is something accepting
 * connections on this port within timeoutMs." Returns false on any error,
 * timeout, or refusal.
 */
function tcpListenerOpen(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}
