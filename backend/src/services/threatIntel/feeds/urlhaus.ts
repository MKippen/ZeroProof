/**
 * URLhaus feed (abuse.ch). Public, CC0-licensed list of malware-distribution
 * URLs. The `recent` JSON dump covers the last 30 days; we extract the host
 * IP/domain so detectors can match against UniFi flow `dstIp` / DNS query
 * `domain` fields.
 *
 * https://urlhaus.abuse.ch/api/
 *
 * The transport layer is the lib's pattern — pure stdlib `node:https`, no
 * external HTTP deps.
 */
import https from 'node:https';
import { URL } from 'node:url';
import type { IocFeed, IocRecord } from '../feed';

const URLHAUS_RECENT_URL = 'https://urlhaus.abuse.ch/downloads/json_recent/';

export interface UrlhausFeedOptions {
  /** Override the upstream URL (test injection). */
  url?: string;
  /** Inject a fetch implementation (test injection). */
  fetcher?: (url: string) => Promise<string>;
}

/** Internal shape of the response body — only the fields we care about. */
interface UrlhausPayload {
  [id: string]: Array<{
    id?: string;
    url?: string;
    host?: string;
    threat?: string;
    tags?: string[];
    date_added?: string;
    url_status?: string;
    urlhaus_reference?: string;
  }>;
}

export function createUrlhausFeed(options: UrlhausFeedOptions = {}): IocFeed {
  const url = options.url ?? URLHAUS_RECENT_URL;
  const fetcher = options.fetcher ?? defaultFetcher;

  return {
    id: 'urlhaus',
    name: 'abuse.ch URLhaus',
    homepage: 'https://urlhaus.abuse.ch/',
    license: 'CC0-1.0',
    async fetch(): Promise<IocRecord[]> {
      const body = await fetcher(url);
      const parsed = JSON.parse(body) as UrlhausPayload;
      const out: IocRecord[] = [];

      // The recent dump is keyed by an opaque id, not a sequence — flatten.
      for (const entries of Object.values(parsed)) {
        for (const entry of entries) {
          if (!entry.host || !entry.url) continue;
          if (entry.url_status && entry.url_status !== 'online') continue;

          const host = entry.host.trim().toLowerCase();
          const kind = isIpAddress(host) ? 'ip' : 'domain';
          out.push({
            kind,
            value: host,
            category: classify(entry.threat ?? '', entry.tags ?? []),
            severity: 'HIGH',
            context: {
              sampleUrl: entry.url,
              dateAdded: entry.date_added,
              tags: entry.tags ?? [],
              reference: entry.urlhaus_reference,
            },
          });
        }
      }

      return dedupe(out);
    },
  };
}

function isIpAddress(value: string): boolean {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return true;
  // Bare IPv6 — host field can contain bracketless v6.
  if (/^[0-9a-fA-F:]+$/.test(value) && value.includes(':')) return true;
  return false;
}

function classify(threat: string, tags: ReadonlyArray<string>): string {
  const all = [threat, ...tags].join(' ').toLowerCase();
  if (all.includes('cobaltstrike') || all.includes('c2')) return 'malware-c2';
  if (all.includes('phish')) return 'phishing';
  if (all.includes('miner') || all.includes('coin')) return 'cryptominer';
  return 'malware-distribution';
}

function dedupe(records: ReadonlyArray<IocRecord>): IocRecord[] {
  const seen = new Map<string, IocRecord>();
  for (const r of records) {
    const key = `${r.kind}:${r.value}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return Array.from(seen.values());
}

function defaultFetcher(target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(target);
    const req = https.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        headers: { 'User-Agent': 'ZeroProof/1.0 (+https://github.com/MKippen/ZeroProof)' },
        timeout: 30_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`URLhaus returned status ${res.statusCode}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('URLhaus request timed out'));
    });
    req.end();
  });
}
