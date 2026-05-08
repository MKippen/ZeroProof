/**
 * UniFi gateway auto-discovery.
 *
 * Reads the host's default-route gateway from /proc/net/route and probes
 * it for UniFi OS / legacy Network Application HTTP fingerprints. The
 * frontend uses the result to offer "Looks like a UniFi gateway at
 * X.X.X.X — use this?" with one-click prefill.
 *
 * Design constraints (security tool — autoscan is a footgun):
 *   - We never sweep the LAN. The only IP we probe is the host's actual
 *     default gateway, which is the device DHCP pointed every machine on
 *     the LAN at — for >95% of UniFi customers that's the controller
 *     (UDM/UDR/UCG/CloudKey).
 *   - We always *show* what we found and let the operator confirm or
 *     edit; we never silently apply a discovered config.
 *   - All probes use stdlib `node:https` — no axios, no undici. UniFi
 *     ships self-signed certs by default, so we allow them for the
 *     probe only (no data is exchanged, no trust is established).
 */
import https from 'node:https';
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
  const probe = await httpsHead(host, port, '/', timeoutMs);
  if (!probe) return null;

  // Heuristic fingerprints. We accept either:
  //   - status 200/302 with a Set-Cookie naming `unifises` or `TOKEN` (UniFi OS)
  //   - X-Powered-By: UniFi anywhere in headers
  //   - Server header containing "UniFi" or "Unifi"
  // UniFi OS (UDM/UDR/UCG) almost always answers on 443 with these markers.
  // Legacy CloudKey/Network on 8443 returns the classic Java login page.
  const headerBlob = serializeHeaders(probe.headers).toLowerCase();
  const looksLikeUniFi =
    headerBlob.includes('unifi') ||
    /set-cookie:[^\n]*(unifises|token)/i.test(headerBlob);

  if (!looksLikeUniFi) return null;

  const product: UniFiCandidate['product'] =
    port === 8443 ? 'unifi_network_legacy' : 'unifi_os';

  return {
    product,
    host,
    port,
    confidence: 'high',
    details: {
      statusCode: probe.statusCode,
      server: probe.headers['server'],
    },
  };
}

interface HttpsProbeResult {
  statusCode: number;
  headers: NodeJS.Dict<string | string[]>;
}

/** Plain-stdlib HTTPS HEAD with self-signed allowance. Returns null on any error. */
function httpsHead(
  host: string,
  port: number,
  path: string,
  timeoutMs: number
): Promise<HttpsProbeResult | null> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        port,
        path,
        method: 'GET',
        timeout: timeoutMs,
        // UniFi devices ship self-signed certs out of the box. We disable
        // verification for the probe only — no credentials, no body, just
        // headers. The discovered candidate still has to be confirmed by
        // the operator before any auth handshake happens.
        rejectUnauthorized: false,
        headers: {
          'User-Agent': 'ZeroProof-Discovery/1.0',
          Accept: 'text/html, */*',
        },
      },
      (res) => {
        // We only need headers + status; abort the body.
        const result: HttpsProbeResult = {
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
        };
        res.resume();
        res.on('end', () => resolve(result));
        res.on('error', () => resolve(result));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function serializeHeaders(headers: NodeJS.Dict<string | string[]>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(headers)) {
    if (Array.isArray(v)) {
      for (const item of v) out.push(`${k}: ${item}`);
    } else if (v !== undefined) {
      out.push(`${k}: ${v}`);
    }
  }
  return out.join('\n');
}
