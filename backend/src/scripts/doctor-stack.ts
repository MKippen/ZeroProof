import { execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';

type CheckStatus = 'PASS' | 'FAIL' | 'WARN';

interface CheckResult {
  name: string;
  status: CheckStatus;
  details: string;
}

function runCommand(command: string): { ok: boolean; output: string } {
  try {
    const output = execSync(command, { stdio: 'pipe', encoding: 'utf8' }).trim();
    return { ok: true, output };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown command failure';
    return { ok: false, output: message.trim() };
  }
}

function parseHostPort(value: string): { host: string; port: number } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(':');
  if (parts.length < 2) return null;
  const host = parts.slice(0, parts.length - 1).join(':').replace(/^\[|\]$/g, '');
  const port = Number(parts[parts.length - 1]);
  if (!host || Number.isNaN(port)) return null;
  return { host, port };
}

async function tcpCheck(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;

    const finish = (value: boolean): void => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

async function main(): Promise<void> {
  const requestedComposeFile = process.env.ZEROPROOF_COMPOSE_FILE;
  const composeCandidates = requestedComposeFile
    ? [requestedComposeFile]
    : [
        'docker-compose.dev.yml',
        path.join('..', 'docker-compose.dev.yml'),
      ];
  const composeFile = composeCandidates.find((candidate) =>
    fs.existsSync(path.resolve(process.cwd(), candidate))
  );
  if (!composeFile) {
    printAndExit(
      [
        {
          name: 'Docker Compose',
          status: 'FAIL',
          details: `No compose file found. Tried: ${composeCandidates.join(', ')}`,
        },
      ],
      1
    );
    return;
  }

  const composePrefix = `docker compose -f ${composeFile}`;
  const checks: CheckResult[] = [];

  const composePs = runCommand(`${composePrefix} ps`);
  if (!composePs.ok) {
    checks.push({
      name: 'Docker Compose',
      status: 'FAIL',
      details: `Unable to query compose services: ${composePs.output}`,
    });
    printAndExit(checks, 1);
    return;
  }
  checks.push({
    name: 'Docker Compose',
    status: 'PASS',
    details: 'Compose services are discoverable.',
  });

  const postgresReady = runCommand(`${composePrefix} exec -T postgres pg_isready -U postgres`);
  checks.push({
    name: 'Postgres container health',
    status: postgresReady.ok ? 'PASS' : 'FAIL',
    details: postgresReady.ok ? postgresReady.output : `pg_isready failed: ${postgresReady.output}`,
  });

  const dbPort = runCommand(`${composePrefix} port postgres 5432`);
  if (!dbPort.ok) {
    checks.push({
      name: 'Host -> DB TCP',
      status: 'FAIL',
      details: `Unable to resolve mapped Postgres port: ${dbPort.output}`,
    });
  } else {
    const parsed = parseHostPort(dbPort.output.split('\n')[0] || '');
    if (!parsed) {
      checks.push({
        name: 'Host -> DB TCP',
        status: 'FAIL',
        details: `Could not parse mapped port output: ${dbPort.output}`,
      });
    } else {
      const reachable = await tcpCheck(parsed.host, parsed.port);
      checks.push({
        name: 'Host -> DB TCP',
        status: reachable ? 'PASS' : 'FAIL',
        details: reachable
          ? `Connected to ${parsed.host}:${parsed.port}`
          : `Cannot connect to ${parsed.host}:${parsed.port}`,
      });
    }
  }

  const backendDbCheck = runCommand(
    `${composePrefix} exec -T backend node -e "const net=require('net');const s=net.createConnection({host:'postgres',port:5432},()=>{console.log('ok');s.end();process.exit(0)});s.on('error',(e)=>{console.error(e.message);process.exit(1)});setTimeout(()=>{console.error('timeout');process.exit(1)},2500);"`
  );
  checks.push({
    name: 'Backend container -> DB TCP',
    status: backendDbCheck.ok ? 'PASS' : 'FAIL',
    details: backendDbCheck.ok ? backendDbCheck.output || 'ok' : backendDbCheck.output,
  });

  const failed = checks.filter((check) => check.status === 'FAIL');
  if (failed.length === 0) {
    checks.push({
      name: 'Failure classification',
      status: 'PASS',
      details: 'No DB outage detected.',
    });
    printAndExit(checks, 0);
    return;
  }

  const healthFailed = checks.find((check) => check.name === 'Postgres container health')?.status === 'FAIL';
  const hostFailed = checks.find((check) => check.name === 'Host -> DB TCP')?.status === 'FAIL';
  const backendFailed = checks.find((check) => check.name === 'Backend container -> DB TCP')?.status === 'FAIL';

  if (healthFailed) {
    checks.push({
      name: 'Failure classification',
      status: 'FAIL',
      details: 'Database service is unhealthy in Docker Compose.',
    });
  } else if (hostFailed && !backendFailed) {
    checks.push({
      name: 'Failure classification',
      status: 'WARN',
      details: 'Host network path to DB is blocked, but backend-to-DB is healthy (likely local/sandbox issue).',
    });
  } else if (!hostFailed && backendFailed) {
    checks.push({
      name: 'Failure classification',
      status: 'FAIL',
      details: 'Backend container cannot reach Postgres network endpoint.',
    });
  } else {
    checks.push({
      name: 'Failure classification',
      status: 'FAIL',
      details: 'Multiple stack checks failed. Inspect compose logs and network bindings.',
    });
  }

  printAndExit(checks, failed.length > 0 ? 1 : 0);
}

function printAndExit(checks: CheckResult[], exitCode: number): void {
  // eslint-disable-next-line no-console
  console.log('ZeroProof stack diagnostics');
  for (const check of checks) {
    // eslint-disable-next-line no-console
    console.log(`[${check.status}] ${check.name}: ${check.details}`);
  }
  process.exit(exitCode);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[FAIL] doctor:stack crashed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
