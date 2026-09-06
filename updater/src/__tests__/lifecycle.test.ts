import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const secret = 'isolated-updater-test-secret';
let directory: string;
let updater: http.Server;
let health: http.Server;
let baseUrl: string;
let healthy = true;
let rollbackHealthy = true;
const originalEnv = { ...process.env };

async function listen(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function apply(payload: unknown) {
  const body = JSON.stringify(payload);
  return fetch(`${baseUrl}/apply`, {
    method: 'POST', body,
    headers: { 'x-zp-signature': crypto.createHmac('sha256', secret).update(body).digest('hex') },
  });
}

async function status(): Promise<{ active: { finishedAt?: number; exitCode?: number; rolledBack?: boolean; rollbackExitCode?: number } }> {
  return await (await fetch(`${baseUrl}/status`)).json() as Awaited<ReturnType<typeof status>>;
}

async function until(predicate: () => Promise<boolean>, timeout = 5_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for updater fixture');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function exists(filename: string): Promise<boolean> {
  return fs.access(path.join(directory, 'worktree', filename)).then(() => true, () => false);
}

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zeroproof-updater-test-'));
  const worktree = path.join(directory, 'worktree');
  await fs.mkdir(path.join(worktree, 'scripts'), { recursive: true });
  // This fixture only writes inside its temporary directory. It never invokes
  // Docker, git, the real upgrade script, or the user's worktree.
  await fs.writeFile(path.join(worktree, 'scripts', 'upgrade.sh'), `#!/usr/bin/env bash
set -eu
echo "fixture operation \${1:-latest}"
if [ "\${1:-}" = "readiness-failure" ]; then exit 3; fi
if [ "\${1:-}" = "preflight-failure" ]; then exit 1; fi
if [ "\${1:-}" = "blocked" ]; then
  touch apply-started
  while [ ! -f allow-apply ]; do sleep 0.02; done
fi
if [ "\${1:-}" = "--rollback" ]; then
  touch rollback-started
  while [ ! -f allow-rollback ]; do sleep 0.02; done
  if [ -f rollback-fails ]; then exit 7; fi
  touch rollback-complete
fi
`);
  health = http.createServer(async (_req, res) => {
    const recovered = rollbackHealthy && await exists('rollback-complete');
    res.writeHead(healthy || recovered ? 200 : 503);
    res.end();
  });
  process.env.UPDATER_HEALTH_URL = `${await listen(health)}/api/v1/auth/setup-status`;
  process.env.UPDATER_HEALTH_TIMEOUT_MS = '50';
  process.env.UPDATER_SECRET = secret;
  process.env.UPDATER_WORKTREE = worktree;
  process.env.UPDATER_PROGRESS_DIR = path.join(directory, 'progress');
  updater = (await import('../index')).server;
  baseUrl = await listen(updater);
});

afterAll(async () => {
  if (directory) {
    await Promise.all(['allow-apply', 'allow-rollback'].map((file) =>
      fs.writeFile(path.join(directory, 'worktree', file), '').catch(() => undefined)
    ));
    if (baseUrl) await until(async () => (await status()).active?.finishedAt !== undefined).catch(() => undefined);
  }
  for (const server of [updater, health]) {
    if (!server) continue;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('UPDATER_') && !(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
  if (directory) await fs.rm(directory, { recursive: true, force: true });
}, 10_000);

it.each([null, [], 42, { target: 42 }, { op: 'unexpected' }])(
  'rejects signed malformed request payloads with 400 (%p)', async (payload) => {
    expect((await apply(payload)).status).toBe(400);
  }
);

it('returns HTTP 413 for an oversized body without destroying the response socket', async () => {
  expect((await apply({ target: 'x'.repeat(20_000) })).status).toBe(413);
});

it('accepts only one simultaneous privileged run, including during log creation', async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => apply({ target: 'blocked' })));
  expect(responses.filter((res) => res.status === 202)).toHaveLength(1);
  expect(responses.filter((res) => res.status === 409)).toHaveLength(7);
  await until(() => exists('apply-started'));
  expect((await status()).active.finishedAt).toBeUndefined();
  await fs.writeFile(path.join(directory, 'worktree', 'allow-apply'), '');
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active.exitCode).toBe(0);
});

it('holds the run through health verification and rollback and reports upgrade failure', async () => {
  healthy = false;
  expect((await apply({ target: 'health-failure' })).status).toBe(202);
  expect((await apply({ op: 'rollback' })).status).toBe(409);
  await until(() => exists('rollback-started'));
  expect((await status()).active.finishedAt).toBeUndefined();
  expect((await apply({ target: 'second-upgrade' })).status).toBe(409);
  await fs.writeFile(path.join(directory, 'worktree', 'allow-rollback'), '');
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active).toMatchObject({ exitCode: 1, rollbackExitCode: 0, rolledBack: true });
});

it('does not claim rollback succeeded when the rollback script failed', async () => {
  await fs.rm(path.join(directory, 'worktree', 'rollback-complete'));
  await fs.writeFile(path.join(directory, 'worktree', 'rollback-fails'), '');
  expect((await apply({ target: 'rollback-failure' })).status).toBe(202);
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active).toMatchObject({ exitCode: 1, rollbackExitCode: 7, rolledBack: false });
});

it('rolls back an explicit post-deployment readiness failure from upgrade.sh', async () => {
  await fs.rm(path.join(directory, 'worktree', 'rollback-fails'));
  expect((await apply({ target: 'readiness-failure' })).status).toBe(202);
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active).toMatchObject({ exitCode: 1, rollbackExitCode: 0, rolledBack: true });
});

it('does not report recovery when rollback exits zero but the API is still unhealthy', async () => {
  rollbackHealthy = false;
  expect((await apply({ target: 'readiness-failure' })).status).toBe(202);
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active).toMatchObject({ exitCode: 1, rollbackExitCode: 0, rolledBack: false });
});

it('does not roll back preflight failures that never deployed a new version', async () => {
  expect((await apply({ target: 'preflight-failure' })).status).toBe(202);
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active.exitCode).toBe(1);
  expect((await status()).active.rollbackExitCode).toBeUndefined();
});

it('reports explicit rollback failure when its script exits zero but readiness fails', async () => {
  expect((await apply({ op: 'rollback' })).status).toBe(202);
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active.exitCode).toBe(1);
});

it('records a spawn failure and permits the next request instead of crashing or staying busy', async () => {
  const worktree = path.join(directory, 'worktree');
  await fs.rename(worktree, `${worktree}-missing`);
  try {
    expect((await apply({ target: 'spawn-failure' })).status).toBe(202);
    await until(async () => (await status()).active.finishedAt !== undefined);
    expect((await status()).active.exitCode).toBe(-1);
  } finally {
    await fs.rename(`${worktree}-missing`, worktree);
  }
  healthy = true;
  expect((await apply({ target: 'retry' })).status).toBe(202);
  await until(async () => (await status()).active.finishedAt !== undefined);
  expect((await status()).active.exitCode).toBe(0);
});
