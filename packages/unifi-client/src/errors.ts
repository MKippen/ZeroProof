/**
 * Typed error hierarchy. Consumers should catch UnifiError to opt into all
 * library-thrown errors, or catch specific subclasses for finer control.
 */

export class UnifiError extends Error {
  override readonly name: string = 'UnifiError';
  override readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.cause = options?.cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Login failed, session expired, or 401/403 from the controller. */
export class UnifiAuthError extends UnifiError {
  override readonly name = 'UnifiAuthError';
  readonly statusCode?: number;

  constructor(message: string, options?: { cause?: unknown; statusCode?: number }) {
    super(message, options);
    this.statusCode = options?.statusCode;
  }
}

/** 404 / endpoint not present on this controller version. */
export class UnifiNotFoundError extends UnifiError {
  override readonly name = 'UnifiNotFoundError';
  readonly path: string;

  constructor(path: string, options?: { cause?: unknown }) {
    super(`Endpoint not found: ${path}`, options);
    this.path = path;
  }
}

/** Network error, timeout, TLS failure, etc. */
export class UnifiTransportError extends UnifiError {
  override readonly name = 'UnifiTransportError';
  readonly statusCode?: number;
  readonly path?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; statusCode?: number; path?: string }
  ) {
    super(message, options);
    this.statusCode = options?.statusCode;
    this.path = options?.path;
  }
}

/**
 * Controller responded with an unexpected shape — the body could not be parsed
 * into the expected schema. Suggests a controller version we don't yet support
 * or a regression upstream.
 */
export class UnifiResponseError extends UnifiError {
  override readonly name = 'UnifiResponseError';
  readonly path: string;
  readonly issues: ReadonlyArray<{ path: string; message: string }>;

  constructor(
    path: string,
    issues: ReadonlyArray<{ path: string; message: string }>,
    options?: { cause?: unknown }
  ) {
    super(
      `Unexpected response shape from ${path}: ${issues
        .slice(0, 3)
        .map((i) => `${i.path}: ${i.message}`)
        .join('; ')}${issues.length > 3 ? '; …' : ''}`,
      options
    );
    this.path = path;
    this.issues = issues;
  }
}
