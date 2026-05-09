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
import { promises as fs, createWriteStream, readFileSync } from 'node:fs';
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
const HEALTH_URL = process.env.UPDATER_HEALTH_URL ?? 'http://127.0.0.1:3000/health';
const HEALTH_TIMEOUT_MS = Number(process.env.UPDATER_HEALTH_TIMEOUT_MS ?? 90_000);
const MAX_BODY_BYTES = Number(process.env.UPDATER_MAX_BODY_BYTES ?? 16_384);

interface ApplyRequest {
  /** Target ref (tag, branch, or SHA). Falls back to upgrade.sh's "latest tag" default if empty. */
  target?: string;
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
}

let active: RunState | null = null;

const log = (...args: unknown[]) => {
  // Single-line JSON so the host log collector can parse if it wants.
  console.log(JSON.stringify({ ts: new Date().toISOString(), msg: args }));
};

const server = http.createServer(async (req, res) => {
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
        parsed = JSON.parse(body) as ApplyRequest;
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
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
        req.destroy();
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
  if (!signature) return false;
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
  await fs.mkdir(PROGRESS_DIR, { recursive: true });
  const progressPath = path.join(
    PROGRESS_DIR,
    `upgrade-${Date.now()}.log`
  );
  // Truncate the file so the backend's tail starts clean.
  await fs.writeFile(progressPath, '');

  const args = ['scripts/upgrade.sh'];
  if (op === 'rollback') args.push('--rollback');
  else if (target) args.push(target);

  log(`starting ${op} run target=${target ?? '(latest)'} progress=${progressPath}`);

  const child = spawn('bash', args, {
    cwd: WORKTREE,
    env: {
      ...process.env,
      // Disable interactive confirm so upgrade.sh runs unattended.
      // upgrade.sh already skips the confirm when stdin isn't a TTY,
      // but the spawn() default is "no TTY" so this is just belt+braces.
      CI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const out = createWriteStream(progressPath, { flags: 'a' });
  child.stdout.pipe(out, { end: false });
  child.stderr.pipe(out, { end: false });

  const run: RunState = {
    pid: child.pid ?? -1,
    startedAt: Date.now(),
    target,
    progressPath,
  };
  active = run;

  child.on('exit', async (code) => {
    run.exitCode = code ?? -1;
    run.finishedAt = Date.now();
    out.end();
    log(`run exited code=${code ?? '?'} elapsedMs=${run.finishedAt - run.startedAt}`);

    if (op === 'apply' && code === 0) {
      // upgrade.sh polls /health for ~90s itself, but only inside its own
      // process. We re-verify here so a slow-starting service that came up
      // after upgrade.sh's poll window doesn't trigger an auto-rollback,
      // and a service that crashed just-after-OK does.
      const healthy = await waitForHealthy(HEALTH_TIMEOUT_MS, progressPath);
      if (!healthy) {
        await appendProgress(
          progressPath,
          'Health check failed after upgrade — rolling back automatically.\n'
        );
        log('triggering auto-rollback');
        await runRollback(progressPath);
        run.rolledBack = true;
      }
    }
  });

  return run;
}

async function runRollback(progressPath: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['scripts/upgrade.sh', '--rollback'], {
      cwd: WORKTREE,
      env: { ...process.env, CI: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const out = createWriteStream(progressPath, { flags: 'a' });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on('exit', () => {
      out.end();
      resolve();
    });
  });
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
        const ok = (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 400;
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

process.on('SIGTERM', () => {
  log('SIGTERM received');
  server.close(() => process.exit(0));
});
