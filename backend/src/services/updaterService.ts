/**
 * Backend ↔ updater sidecar bridge.
 *
 * Three responsibilities:
 *   1. Sign apply requests with HMAC-SHA256 over the JSON body using the
 *      shared UPDATER_SECRET, POST them to the updater sidecar over the
 *      host loopback.
 *   2. Tail the sidecar's progress file (sidecar streams scripts/upgrade.sh
 *      stdout/stderr there) and forward each line to all connected
 *      dashboard WebSocket clients as `updater_progress` events.
 *   3. Detect run completion and broadcast a `updater_complete` event so
 *      the UI can transition from "Installing…" to either "Restarting…"
 *      (waiting for a server-side restart and a reconnect) or "Done."
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import logger from '../utils/logger';
import mqttClient from '../mqtt';

const UPDATER_SECRET = process.env.UPDATER_SECRET ?? '';
const UPDATER_URL = process.env.UPDATER_URL ?? 'http://127.0.0.1:9090';
const PROGRESS_DIR = process.env.UPDATER_PROGRESS_DIR ?? '/var/run/zeroproof';

export interface ApplyResult {
  accepted: boolean;
  run: {
    pid: number;
    startedAt: number;
    target: string | null;
    progressPath: string;
  };
}

export function isUpdaterConfigured(): boolean {
  return UPDATER_SECRET.length > 0;
}

export async function getUpdaterStatus(): Promise<unknown> {
  return httpJson('GET', '/status');
}

/**
 * Get the running sidecar's reported version. Returns null if the sidecar
 * isn't reachable (not configured, crashed, or pre-v1.1.6 without /version).
 * Caller surfaces this so the UI can flag a backend/updater version mismatch.
 */
export async function getUpdaterVersion(): Promise<string | null> {
  try {
    const res = (await httpJson('GET', '/version')) as { version?: string };
    return typeof res?.version === 'string' ? res.version : null;
  } catch {
    return null;
  }
}

export async function postApply(
  target: string | null,
  op: 'apply' | 'rollback' = 'apply'
): Promise<ApplyResult> {
  const body = JSON.stringify({ target, op });
  const signature = crypto
    .createHmac('sha256', UPDATER_SECRET)
    .update(body, 'utf8')
    .digest('hex');
  const result = (await httpJson('POST', '/apply', body, {
    'x-zp-signature': signature,
    'content-type': 'application/json',
  })) as ApplyResult;
  if (result.run?.progressPath) {
    startTailing(result.run.progressPath, op);
  }
  return result;
}

const tailing = new Set<string>();

function startTailing(progressPath: string, op: 'apply' | 'rollback'): void {
  // Sidecar writes progress files in /var/run/zeroproof inside its
  // container; backend mounts the same volume read-only at the same path.
  // If the path looks bogus, fall back to PROGRESS_DIR + basename.
  const localPath = progressPath.startsWith(PROGRESS_DIR)
    ? progressPath
    : path.join(PROGRESS_DIR, path.basename(progressPath));

  if (tailing.has(localPath)) return;
  tailing.add(localPath);
  logger.info(`updater: tailing progress at ${localPath} (op=${op})`);

  let position = 0;
  let lastSize = 0;
  let stableTicks = 0;
  const interval = setInterval(async () => {
    try {
      const stat = await fs.promises.stat(localPath);
      if (stat.size > position) {
        const delta = stat.size - position;
        const buf = Buffer.alloc(delta);
        const fd = await fs.promises.open(localPath, 'r');
        try {
          await fd.read(buf, 0, delta, position);
        } finally {
          await fd.close();
        }
        position = stat.size;
        const text = buf.toString('utf8');
        for (const line of text.split('\n')) {
          if (!line) continue;
          mqttClient.broadcast({
            type: 'updater_progress',
            op,
            line,
          });
        }
      }
      // Treat the run as "finished" when no new bytes for ~6 polls (~6s)
      // AND the sidecar /status reports no active run.
      if (stat.size === lastSize) stableTicks++;
      else stableTicks = 0;
      lastSize = stat.size;
      if (stableTicks >= 6) {
        const status = (await getUpdaterStatus().catch(() => null)) as
          | { active: { finishedAt?: number; exitCode?: number; rolledBack?: boolean } | null }
          | null;
        if (!status?.active || status.active.finishedAt !== undefined) {
          clearInterval(interval);
          tailing.delete(localPath);
          mqttClient.broadcast({
            type: 'updater_complete',
            op,
            exitCode: status?.active?.exitCode ?? null,
            rolledBack: status?.active?.rolledBack ?? false,
          });
          logger.info(
            `updater: run complete exitCode=${status?.active?.exitCode ?? '?'} rolledBack=${status?.active?.rolledBack ?? false}`
          );
        }
      }
    } catch (err) {
      // File doesn't exist yet — keep polling. Sidecar may still be
      // creating it. After 30 ticks (~30s) of misses, give up.
      stableTicks++;
      if (stableTicks >= 30) {
        clearInterval(interval);
        tailing.delete(localPath);
        logger.warn(
          `updater: gave up tailing ${localPath}: ${err instanceof Error ? err.message : 'unknown'}`
        );
        mqttClient.broadcast({
          type: 'updater_complete',
          op,
          error: 'progress file not available — check sidecar logs',
        });
      }
    }
  }, 1000);
}

function httpJson(
  method: 'GET' | 'POST',
  pathname: string,
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(UPDATER_URL);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port ? Number(url.port) : 80,
        path: pathname,
        method,
        timeout: 5_000,
        headers: {
          accept: 'application/json',
          ...extraHeaders,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`updater returned ${res.statusCode}: ${text}`));
            return;
          }
          try {
            resolve(text ? JSON.parse(text) : {});
          } catch {
            reject(new Error(`updater returned non-JSON: ${text}`));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('updater request timed out'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
