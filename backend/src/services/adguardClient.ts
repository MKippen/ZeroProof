import axios, { AxiosInstance } from 'axios';
import https from 'https';

export interface AdGuardCredentials {
  host: string;
  port: number;
  useHttps: boolean;
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

export class AdGuardClient {
  private client: AxiosInstance;

  constructor(credentials: AdGuardCredentials) {
    const protocol = credentials.useHttps ? 'https' : 'http';
    const httpsAgent = credentials.useHttps
      ? new https.Agent({ rejectUnauthorized: false })
      : undefined;

    const hasAuth = Boolean(credentials.username || credentials.password);
    this.client = axios.create({
      baseURL: `${protocol}://${credentials.host}:${credentials.port}/control`,
      ...(hasAuth
        ? {
            auth: {
              username: credentials.username || '',
              password: credentials.password || '',
            },
          }
        : {}),
      timeout: 15000,
      httpsAgent,
      validateStatus: (status) => status < 500,
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
    const response = await this.client.get('/status');
    this.assertOk(response.status, 'Failed to fetch AdGuard status');
    return response.data || {};
  }

  async getQueryLogConfig(): Promise<AdGuardQueryLogConfig> {
    const response = await this.client.get('/querylog/config');
    this.assertOk(response.status, 'Failed to fetch AdGuard query log configuration');
    return response.data;
  }

  async getQueryLog(params: QueryLogParams = {}): Promise<AdGuardQueryLogResponse> {
    const response = await this.client.get('/querylog', {
      params: {
        ...(params.limit ? { limit: params.limit } : {}),
        ...(params.olderThan ? { older_than: params.olderThan } : {}),
        ...(params.search ? { search: params.search } : {}),
        ...(params.responseStatus ? { response_status: params.responseStatus } : { response_status: 'all' }),
      },
    });
    this.assertOk(response.status, 'Failed to fetch AdGuard query log');
    return response.data || {};
  }
}
