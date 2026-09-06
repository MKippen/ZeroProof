/**
 * ZeroProof updater sidecar.
 *
 * A privileged container that orchestrates ZeroProof self-upgrades on
 * behalf of the backend. Receives HMAC-signed apply requests on a
 * loopback-only HTTP port, runs scripts/upgrade.sh in a child process,
 * streams stdout to a shared progress file the backend tails, and triggers
 * auto-rollback if the post-apply health check fails.
 *
 * Trust model:
 *   - Listens on 127.0.0.1:9090 only (network_mode: host means loopback
 *     is loopback on the actual host).
 *   - Requires HMAC-SHA256 over the request body using the shared
 *     UPDATER_SECRET. Backend signs with the same secret. Even though
 *     localhost-only, defense in depth — a leaked backend can't be coerced
 *     into pushing arbitrary refs without the secret.
 *   - Mounted: /var/run/docker.sock (for upgrade.sh's docker compose calls)
 *     plus the project worktree (for git checkout / docker compose up).
 *
 * Why not implement upgrade logic in TypeScript:
 *   We already have scripts/upgrade.sh — annotated-tag SHA dereference,
 *   bootstrap untracked-file handling, --rollback support, health polling.
 *   Reimplementing in TS would diverge over time. Single source of truth
 *   wins. The sidecar is thin glue: HMAC + child_process + file streaming.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Read the running version from CHANGELOG.md (same source of truth as
// the backend) so a single CHANGELOG entry stamps both components on
// release. The Dockerfile copies CHANGELOG.md into /app/CHANGELOG.md.
// We resolve eagerly so /version is a hot endpoint with no fs hits.
const SIDECAR_VERSION: string = (() => {
  for (const candidate of [
    path.join(__dirname, '..', 'CHANGELOG.md'),
    '/app/CHANGELOG.md',
    '/repo/CHANGELOG.md',
  ]) {
    try {
      const text = readFileSync(candidate, 'utf8');
      const m = text.match(/^##\s*\[(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\]/m);
      if (m) return `v${m[1]}`;
    } catch {
      // try next candidate
    }
  }
  return 'unknown';
})();

const PORT = Number(process.env.UPDATER_PORT ?? 9090);
const HOST = process.env.UPDATER_HOST ?? '127.0.0.1';
const SECRET = process.env.UPDATER_SECRET ?? '';
const PROGRESS_DIR = process.env.UPDATER_PROGRESS_DIR ?? '/var/run/zeroproof';
const WORKTREE = process.env.UPDATER_WORKTREE ?? '/repo';
const HEALTH_URL = process.env.UPDATER_HEALTH_URL ?? 'http://127.0.0.1:3000/api/v1/auth/setup-status';
const HEALTH_TIMEOUT_MS = Number(process.env.UPDATER_HEALTH_TIMEOUT_MS ?? 90_000);
const MAX_BODY_BYTES = Number(process.env.UPDATER_MAX_BODY_BYTES ?? 16_384);

interface ApplyRequest {
  /** Target ref (tag, branch, or SHA). Falls back to upgrade.sh's "latest tag" default if empty. */
  target?: string | null;
  /** Operation type — `apply` runs upgrade.sh; `rollback` runs upgrade.sh --rollback. */
  op?: 'apply' | 'rollback';
}

interface RunState {
  pid: number;
  startedAt: number;
  target: string | null;
  progressPath: string;
  finishedAt?: number;
  exitCode?: number;
  rolledBack?: boolean;
  rollbackExitCode?: number;
}

let active: RunState | null = null;

const log = (...args: unknown[]) => {
  // Single-line JSON so the host log collector can parse if it wants.
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: args }));
};

export const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, configured: !!SECRET, active: !!active }));
      return;
    }

    if (req.method === 'GET' && req.url === '/version') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ version: SIDECAR_VERSION }));
      return;
    }

    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ active }));
      return;
    }

    if (req.method === 'POST' && req.url === '/apply') {
      if (!SECRET) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'updater is not configured' }));
        return;
      }

      let body: string;
      try {
        body = await readBody(req);
      } catch (error) {
        if (error instanceof RequestBodyTooLargeError) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'request body too large' }));
          return;
        }
        throw error;
      }
      const sig = (req.headers['x-zp-signature'] as string) ?? '';
      if (!verifyHmac(body, sig, SECRET)) {
        log('rejected apply request: bad signature');
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad signature' }));
        return;
      }

      let parsed: ApplyRequest;
      try {
        const input: unknown = JSON.parse(body);
        if (!isApplyRequest(input)) throw new Error('invalid apply request');
        parsed = input;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid apply request' }));
        return;
      }

      if (active && active.finishedAt === undefined) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'an upgrade is already in progress', active }));
        return;
      }

      const op = parsed.op === 'rollback' ? 'rollback' : 'apply';
      const target = op === 'rollback' ? null : parsed.target?.trim() || null;
      if (target && !isValidTargetRef(target)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid target ref' }));
        return;
      }
      const run = await startRun(op, target);
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ accepted: true, run }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  } catch (e) {
    log('handler error', e instanceof Error ? e.message : String(e));
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error' }));
  }
});

if (require.main === module) {
  if (!SECRET) {
    log('UPDATER_SECRET is not set; updater is running in disabled mode');
  }
  server.listen(PORT, HOST, () => {
    log(`updater listening on ${HOST}:${PORT}`);
  });
  process.on('SIGTERM', () => {
    log('SIGTERM received');
    server.close(() => process.exit(0));
  });
}

class RequestBodyTooLargeError extends Error {}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        reject(new RequestBodyTooLargeError('request body too large'));
        // Keep draining so the handler can send an actual HTTP 413 response.
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function verifyHmac(body: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  // Validate bytes before timingSafeEqual: equal JS string lengths can encode
  // to different UTF-8 buffer lengths and otherwise throw on malformed input.
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(body, 'utf8')
    .digest('hex');
  // timingSafeEqual requires equal-length inputs; bail early if not.
  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expected, 'utf8')
  );
}

function isApplyRequest(input: unknown): input is ApplyRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const request = input as Record<string, unknown>;
  return (request.op === undefined || request.op === 'apply' || request.op === 'rollback') &&
    (request.target === undefined || request.target === null || typeof request.target === 'string');
}

export function isValidTargetRef(target: string): boolean {
  const trimmed = target.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._/@+-]*$/.test(trimmed) &&
    !trimmed.includes('..') &&
    !trimmed.includes('@{') &&
    !trimmed.includes('//') &&
    !trimmed.endsWith('/') &&
    !trimmed.endsWith('.')
  );
}

async function startRun(
  op: 'apply' | 'rollback',
  target: string | null
): Promise<RunState> {
  const progressPath = path.join(
    PROGRESS_DIR,
    `upgrade-${Date.now()}-${crypto.randomUUID()}.log`
  );
  const run: RunState = {
    pid: -1,
    startedAt: Date.now(),
    target,
    progressPath,
  };
  // Reserve synchronously, before any filesystem awaits. Another request must
  // not start a second privileged upgrade while the first is preparing its log.
  active = run;

  try {
    await fs.mkdir(PROGRESS_DIR, { recursive: true });
    await fs.writeFile(progressPath, '');
  } catch (error) {
    run.exitCode = -1;
    run.finishedAt = Date.now();
    throw error;
  }

  log(`starting ${op} run target=${target ?? '(latest)'} progress=${progressPath}`);
  void (async () => {
    try {
      run.exitCode = await runScript(op, target, progressPath, (pid) => { run.pid = pid; });
      // upgrade.sh reserves exit 3 for readiness failure AFTER deployment;
      // ordinary nonzero preflight/build failures must not trigger rollback.
      const needsRollback = op === 'apply' && (run.exitCode === 3 ||
        (run.exitCode === 0 && !await waitForHealthy(HEALTH_TIMEOUT_MS, progressPath)));
      if (needsRollback) {
        await appendProgress(progressPath, 'Health check failed after upgrade — rolling back automatically.\n');
        log('triggering auto-rollback');
        run.rollbackExitCode = await runScript('rollback', null, progressPath);
        run.rolledBack = run.rollbackExitCode === 0 && await waitForHealthy(HEALTH_TIMEOUT_MS, progressPath);
        // A recovered rollback still means the requested upgrade failed.
        run.exitCode = 1;
      }
      if (op === 'rollback' && run.exitCode === 0 && !await waitForHealthy(HEALTH_TIMEOUT_MS, progressPath)) {
        run.exitCode = 1;
      }
    } catch (error) {
      run.exitCode = -1;
      const message = error instanceof Error ? error.message : String(error);
      log('run failed', message);
      await appendProgress(progressPath, `Run failed: ${message}\n`);
    } finally {
      // Hold the reservation through health verification AND rollback.
      run.finishedAt = Date.now();
      log(`run finished code=${run.exitCode} elapsedMs=${run.finishedAt - run.startedAt}`);
    }
  })();

  return run;
}

async function runScript(
  op: 'apply' | 'rollback', target: string | null, progressPath: string,
  onSpawn?: (pid: number) => void
): Promise<number> {
  // Open before spawning and write directly to the fd: no unhandled log-stream
  // errors, and child close waits for all output before we verify or roll back.
  const output = await fs.open(progressPath, 'a');
  try {
    return await new Promise<number>((resolve, reject) => {
      const args = ['scripts/upgrade.sh'];
      if (op === 'rollback') args.push('--rollback');
      else if (target) args.push(target);
      const child = spawn('bash', args, {
        cwd: WORKTREE,
        env: { ...process.env, CI: '1' },
        stdio: ['ignore', output.fd, output.fd],
      });
      child.once('error', reject);
      child.once('close', (code) => resolve(code ?? -1));
      onSpawn?.(child.pid ?? -1);
    });
  } finally {
    await output.close();
  }
}

async function waitForHealthy(
  timeoutMs: number,
  progressPath: string
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHealth()) return true;
    await sleep(2_000);
  }
  await appendProgress(
    progressPath,
    `Health check timed out after ${timeoutMs}ms.\n`
  );
  return false;
}

function checkHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const url = new URL(HEALTH_URL);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port ? Number(url.port) : 80,
        path: url.pathname,
        method: 'GET',
        timeout: 3_000,
      },
      (res) => {
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
        res.resume();
        resolve(ok);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function appendProgress(progressPath: string, line: string): Promise<void> {
  try {
    await fs.appendFile(progressPath, line);
  } catch {
    // Best-effort.
  }
}
