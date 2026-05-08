/**
 * DNS-proxy auto-discovery.
 *
 * Reads the host's resolv.conf to find what DNS resolver(s) DHCP told us
 * to use. For each LAN-side resolver IP, probes a small set of well-known
 * AdGuard Home and Pi-hole HTTP fingerprints. Returns candidates so the
 * frontend can offer "Looks like AdGuard Home at X.X.X.X:Y — use this?"
 * with one-click prefill.
 *
 * Design constraints (security tool — autoscan is a footgun):
 *   - We never sweep the LAN. The only IPs we probe are the ones DHCP
 *     already advertised to us as resolvers, plus the default gateway.
 *   - We always *show* what we found and let the operator confirm or
 *     edit; we never silently apply a discovered config.
 *   - All probes use stdlib `node:http` — no axios, no undici.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';

const RESOLV_CONF_PATHS = ['/etc/resolv.conf'];

/** Default ports we probe for each known product. */
const ADGUARD_PORTS = [3000, 80, 8080];
const PIHOLE_PORTS = [80, 8080];

/** Single discovered proxy candidate. */
export interface DnsProxyCandidate {
  product: 'adguard_home' | 'pihole';
  host: string;
  port: number;
  /** True if the discovered service answered cleanly with the right shape. */
  confidence: 'high' | 'medium';
  /** Free-form details — version, hostname, etc. — for surfacing in the UI. */
  details?: Record<string, unknown>;
}

export interface DiscoverOptions {
  /** Override the resolv.conf path (test seam). */
  resolvConfPath?: string;
  /** Inject a probe function (test seam). */
  probe?: (host: string, port: number) => Promise<DnsProxyCandidate | null>;
  /** Timeout per probe (ms). Default 1500. */
  probeTimeoutMs?: number;
}

/** Top-level entry point: returns all proxy candidates we could find. */
export async function discoverDnsProxies(
  options: DiscoverOptions = {}
): Promise<DnsProxyCandidate[]> {
  const candidates = await collectResolverCandidates(
    options.resolvConfPath ?? RESOLV_CONF_PATHS[0]!
  );
  if (candidates.length === 0) return [];

  const probe = options.probe ?? defaultProbe;
  const timeoutMs = options.probeTimeoutMs ?? 1500;

  const targets: Array<{ host: string; port: number }> = [];
  for (const host of candidates) {
    for (const port of new Set([...ADGUARD_PORTS, ...PIHOLE_PORTS])) {
      targets.push({ host, port });
    }
  }

  const results = await Promise.all(
    targets.map(({ host, port }) =>
      probe(host, port, timeoutMs).catch(() => null)
    )
  );

  // Deduplicate (host, port, product) — sometimes the same product answers
  // on multiple ports and we want to surface each match once.
  const seen = new Set<string>();
  const out: DnsProxyCandidate[] = [];
  for (const r of results) {
    if (!r) continue;
    const key = `${r.product}@${r.host}:${r.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Pull `nameserver X.X.X.X` lines from resolv.conf, dropping non-LAN. */
async function collectResolverCandidates(
  path: string
): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path, 'utf8');
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*nameserver\s+(\S+)/i);
    if (!m) continue;
    const ip = m[1]!;
    if (!isPrivateIpv4(ip)) continue; // skip 127.0.0.53, public resolvers, etc.
    if (!out.includes(ip)) out.push(ip);
  }
  return out;
}

/** RFC1918 + link-local. We deliberately exclude 127.0.0.0/8. */
export function isPrivateIpv4(ip: string): boolean {
  // IPv4 dotted-quad only — IPv6 resolvers are rare in homes and the
  // probe ports we care about are HTTP-on-IPv4 in practice.
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
  timeoutMs = 1500
): Promise<DnsProxyCandidate | null> {
  // AdGuard first — its endpoint is more distinctive (and the JSON shape
  // gives us a version string for the UI).
  const ag = await tryAdGuard(host, port, timeoutMs);
  if (ag) return ag;
  const ph = await tryPihole(host, port, timeoutMs);
  if (ph) return ph;
  return null;
}

async function tryAdGuard(
  host: string,
  port: number,
  timeoutMs: number
): Promise<DnsProxyCandidate | null> {
  const body = await httpGetJson(host, port, '/control/status', timeoutMs);
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  // AdGuard Home's /control/status returns { version, running, dns_addresses, ... }
  if (typeof obj.version !== 'string') return null;
  if (typeof obj.running !== 'boolean') return null;
  return {
    product: 'adguard_home',
    host,
    port,
    confidence: 'high',
    details: { version: obj.version, running: obj.running },
  };
}

async function tryPihole(
  host: string,
  port: number,
  timeoutMs: number
): Promise<DnsProxyCandidate | null> {
  const body = await httpGetJson(
    host,
    port,
    '/admin/api.php?summaryRaw',
    timeoutMs
  );
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  // Pi-hole's summaryRaw response always includes these distinctive fields.
  if (typeof obj.domains_being_blocked !== 'number') return null;
  if (typeof obj.dns_queries_today !== 'number') return null;
  return {
    product: 'pihole',
    host,
    port,
    confidence: 'high',
    details: {
      blocked: obj.domains_being_blocked,
      queriesToday: obj.dns_queries_today,
    },
  };
}

/** Plain-stdlib JSON GET. Returns null on any error or non-2xx. */
function httpGetJson(
  host: string,
  port: number,
  path: string,
  timeoutMs: number
): Promise<unknown> {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host,
        port,
        path,
        timeout: timeoutMs,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          res.resume();
          resolve(null);
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(null);
          }
        });
        res.on('error', () => resolve(null));
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}
