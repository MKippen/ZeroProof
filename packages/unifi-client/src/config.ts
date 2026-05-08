/**
 * Logger interface — caller provides one or accepts the silent default.
 * Compatible with `console` and most third-party loggers.
 */
export interface UnifiLogger {
  debug?: (message: string, meta?: unknown) => void;
  info?: (message: string, meta?: unknown) => void;
  warn?: (message: string, meta?: unknown) => void;
  error?: (message: string, meta?: unknown) => void;
}

/**
 * Configuration for a single UnifiClient instance. All knobs are explicit —
 * the library never reads environment variables, never assumes a default
 * controller location, and never logs unless given a logger.
 */
export interface UnifiClientConfig {
  /** Hostname or IP of the UniFi controller. */
  host: string;
  /** Port the controller's HTTPS API is bound to (typically 443 for UniFi OS, 8443 for legacy). */
  port: number;
  /** Local admin username. */
  username: string;
  /** Local admin password. */
  password: string;
  /** Site identifier. Defaults to "default" when omitted. */
  siteId?: string;
  /**
   * When true, the library does not validate the controller's TLS certificate.
   * Required for self-signed certs (UniFi default). Strict verification by default.
   */
  allowSelfSigned?: boolean;
  /**
   * Override the API base path. Useful for non-UniFi-OS controllers that don't
   * sit behind /proxy/network. Default: '/proxy/network' (UniFi OS) with a
   * legacy fallback to '' for paths that fail.
   */
  basePath?: string;
  /** Per-request timeout in ms. Default: 30000. */
  timeoutMs?: number;
  /** Logger. Default: silent. */
  logger?: UnifiLogger;
  /** Time provider for testing. Default: Date.now. */
  now?: () => number;
}

export interface ResolvedConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  siteId: string;
  allowSelfSigned: boolean;
  basePath: string;
  timeoutMs: number;
  logger: Required<UnifiLogger>;
  now: () => number;
}

const NOOP = (): void => {};

const SILENT_LOGGER: Required<UnifiLogger> = {
  debug: NOOP,
  info: NOOP,
  warn: NOOP,
  error: NOOP,
};

export function resolveConfig(config: UnifiClientConfig): ResolvedConfig {
  if (!config.host) throw new Error('UnifiClient: host is required');
  if (!config.username) throw new Error('UnifiClient: username is required');
  if (!config.password) throw new Error('UnifiClient: password is required');

  const logger: Required<UnifiLogger> = config.logger
    ? {
        debug: config.logger.debug ?? NOOP,
        info: config.logger.info ?? NOOP,
        warn: config.logger.warn ?? NOOP,
        error: config.logger.error ?? NOOP,
      }
    : SILENT_LOGGER;

  return {
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    siteId: config.siteId ?? 'default',
    allowSelfSigned: config.allowSelfSigned === true,
    basePath: config.basePath ?? '/proxy/network',
    timeoutMs: config.timeoutMs ?? 30_000,
    logger,
    now: config.now ?? Date.now,
  };
}
