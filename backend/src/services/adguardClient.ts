import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';

export interface AdGuardCredentials {
  host: string;
  port: number;
  useHttps: boolean;
  /**
   * Opt-in: skip TLS certificate validation. Required for AdGuard Home
   * installs using self-signed certs (common in home labs). Defaults to
   * strict verification — never set to true silently.
   */
  allowSelfSigned?: boolean;
  username?: string;
  password?: string;
}

export interface AdGuardStatusResponse {
  version?: string;
  dns_addresses?: string[];
  dns_port?: number;
  protection_enabled?: boolean;
  running?: boolean;
  language?: string;
  [key: string]: unknown;
}

export interface AdGuardQueryLogConfig {
  enabled: boolean;
  interval: number;
  anonymize_client_ip: boolean;
  ignored?: string[];
  ignored_enabled?: boolean;
}

export interface AdGuardDnsAnswer {
  type?: string;
  value?: string;
  ttl?: number;
  [key: string]: unknown;
}

export interface AdGuardQueryLogItem {
  answer?: AdGuardDnsAnswer[];
  original_answer?: AdGuardDnsAnswer[];
  cached?: boolean;
  upstream?: string;
  answer_dnssec?: boolean;
  client?: string;
  client_id?: string;
  client_info?: {
    name?: string;
    disallowed?: boolean;
    disallowed_rule?: string;
    whois?: Record<string, unknown>;
  };
  client_proto?: string;
  ecs?: string;
  elapsedMs?: string;
  question?: {
    class?: string;
    host?: string;
    name?: string;
    type?: string;
  };
  filterId?: number;
  rule?: string;
  rules?: Array<{ filter_list_id?: number; text?: string }>;
  reason?: string;
  service_name?: string;
  status?: string;
  time?: string;
  [key: string]: unknown;
}

export interface AdGuardQueryLogResponse {
  oldest?: string;
  data?: AdGuardQueryLogItem[];
}

export interface QueryLogParams {
  limit?: number;
  olderThan?: string;
  search?: string;
  responseStatus?: string;
}

export interface AdGuardPersistentClient {
  name?: string;
  ids?: string[];
  tags?: string[];
  use_global_settings?: boolean;
  filtering_enabled?: boolean;
  parental_enabled?: boolean;
  safebrowsing_enabled?: boolean;
  safesearch_enabled?: boolean;
  use_global_blocked_services?: boolean;
  blocked_services?: string[];
  upstreams?: string[];
}

export interface AdGuardAutoClient {
  name?: string;
  ip?: string;
  source?: string;
  whois_info?: Record<string, unknown>;
}

export interface AdGuardClientsResponse {
  clients?: AdGuardPersistentClient[];
  auto_clients?: AdGuardAutoClient[];
  supported_tags?: string[];
}

interface HttpResult<T> {
  status: number;
  data: T;
}

export class AdGuardClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | null;
  private readonly httpsAgent: https.Agent | undefined;
  private readonly timeoutMs = 15_000;

  constructor(credentials: AdGuardCredentials) {
    const protocol = credentials.useHttps ? 'https' : 'http';
    this.baseUrl = `${protocol}://${credentials.host}:${credentials.port}/control`;

    // Strict TLS by default. Only relax when the user has explicitly opted in
    // via the `allowSelfSigned` flag persisted on AdGuardConnection.
    this.httpsAgent =
      credentials.useHttps && credentials.allowSelfSigned === true
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    const hasAuth = Boolean(credentials.username || credentials.password);
    if (hasAuth) {
      const token = Buffer.from(
        `${credentials.username ?? ''}:${credentials.password ?? ''}`
      ).toString('base64');
      this.authHeader = `Basic ${token}`;
    } else {
      this.authHeader = null;
    }
  }

  /** Issue a JSON GET request — pure stdlib, no external deps. */
  private async get<T>(path: string, params?: Record<string, string | number>): Promise<HttpResult<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    }

    const transport = url.protocol === 'http:' ? http : https;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (this.authHeader) headers.Authorization = this.authHeader;

    const requestOptions: https.RequestOptions = {
      method: 'GET',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: this.timeoutMs,
    };
    if (url.protocol === 'https:' && this.httpsAgent) requestOptions.agent = this.httpsAgent;

    return new Promise<HttpResult<T>>((resolve, reject) => {
      const req = transport.request(requestOptions, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          const ct = String(res.headers['content-type'] ?? '');
          let data: unknown;
          if (ct.includes('application/json') && body.length > 0) {
            try {
              data = JSON.parse(body);
            } catch (err) {
              reject(new Error(`AdGuard returned malformed JSON from ${path}: ${(err as Error).message}`));
              return;
            }
          } else if (body.length === 0 && ct.includes('application/json')) {
            data = {};
          } else {
            data = body;
          }
          resolve({ status: res.statusCode ?? 0, data: data as T });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`AdGuard request timed out after ${this.timeoutMs}ms: ${path}`));
      });
      req.end();
    });
  }

  private assertOk(status: number, message: string): void {
    if (status === 401 || status === 403) {
      throw new Error('AdGuard authentication failed');
    }
    if (status < 200 || status >= 300) {
      throw new Error(message);
    }
  }

  async getStatus(): Promise<AdGuardStatusResponse> {
    const response = await this.get<AdGuardStatusResponse>('/status');
    this.assertOk(response.status, 'Failed to fetch AdGuard status');
    return response.data || {};
  }

  async getQueryLogConfig(): Promise<AdGuardQueryLogConfig> {
    const response = await this.get<AdGuardQueryLogConfig>('/querylog/config');
    this.assertOk(response.status, 'Failed to fetch AdGuard query log configuration');
    return response.data;
  }

  async getPersistentClients(): Promise<AdGuardClientsResponse> {
    const response = await this.get<AdGuardClientsResponse>('/clients');
    this.assertOk(response.status, 'Failed to fetch AdGuard clients');
    return response.data || { clients: [], auto_clients: [] };
  }

  async getQueryLog(params: QueryLogParams = {}): Promise<AdGuardQueryLogResponse> {
    const queryParams: Record<string, string | number> = {};
    if (params.limit) queryParams.limit = params.limit;
    if (params.olderThan) queryParams.older_than = params.olderThan;
    if (params.search) queryParams.search = params.search;
    queryParams.response_status = params.responseStatus ?? 'all';
    const response = await this.get<AdGuardQueryLogResponse>('/querylog', queryParams);
    this.assertOk(response.status, 'Failed to fetch AdGuard query log');
    return response.data || {};
  }
}
