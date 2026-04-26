/**
 * Local Test Executor - Runs network tests directly from the server
 * Mirrors ESP32 command executor functionality for server-side testing
 */

import * as net from 'net';
import * as dgram from 'dgram';
import * as dns from 'dns';
import * as os from 'os';
import { promisify } from 'util';
import { Prisma } from '@prisma/client';
import logger from '../utils/logger';
import { mqttClient } from '../mqtt';
import prisma from './database';
import { buildStructuredResultsJson } from './testRunResultsJson';

const dnsLookup = promisify(dns.lookup);

interface CommandResult {
  op: string;
  index: number;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface Command {
  op: string;
  [key: string]: unknown;
}

const SERVER_DEVICE_ID = 'server-local';

export class LocalTestExecutor {
  private running = false;
  private cancelled = false;
  private currentTestId: string | null = null;

  /**
   * Get network info for the server
   */
  getNetworkInfo(): Record<string, unknown> {
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    let gateway = '';
    let mac = '';

    // Find primary network interface
    for (const addrs of Object.values(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          localIP = addr.address;
          mac = addr.mac;
          // Guess gateway (usually .1 on the subnet)
          const parts = localIP.split('.');
          gateway = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
          break;
        }
      }
      if (localIP !== '127.0.0.1') break;
    }

    return {
      localIP,
      gateway,
      subnet: '255.255.255.0',
      mac,
      hostname: os.hostname(),
      platform: os.platform(),
      uptime: os.uptime(),
      freeMemory: os.freemem(),
    };
  }

  /**
   * TCP connect test
   */
  private async tcpConnect(host: string, port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
        }
      };

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        cleanup();
        resolve(true);
      });

      socket.on('timeout', () => {
        cleanup();
        resolve(false);
      });

      socket.on('error', () => {
        cleanup();
        resolve(false);
      });

      socket.connect(port, host);
    });
  }

  /**
   * TCP banner grab
   */
  private async tcpBanner(host: string, port: number, timeout: number): Promise<string> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let banner = '';
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          socket.destroy();
          resolve(banner);
        }
      };

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        // Wait for banner data
        setTimeout(cleanup, timeout / 2);
      });

      socket.on('data', (data) => {
        banner += data.toString().substring(0, 256);
        cleanup();
      });

      socket.on('timeout', cleanup);
      socket.on('error', cleanup);

      socket.connect(port, host);
    });
  }

  /**
   * DNS lookup
   */
  private async dnsLookupOp(hostname: string): Promise<{ resolved: boolean; ip?: string }> {
    try {
      const result = await dnsLookup(hostname);
      return { resolved: true, ip: result.address };
    } catch {
      return { resolved: false };
    }
  }

  /**
   * ARP/Host scan - scans subnet for live hosts
   */
  private async arpScan(
    startHost: number,
    endHost: number,
    timeout: number,
    onProgress: (scanned: number, total: number) => void
  ): Promise<string[]> {
    const networkInfo = this.getNetworkInfo();
    const localIP = networkInfo.localIP as string;
    const parts = localIP.split('.');
    const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
    const hosts: string[] = [];
    const total = endHost - startHost + 1;
    const foundSet = new Set<string>();

    // Common ports to check for host discovery
    const discoveryPorts = [80, 443, 22, 445, 139, 21, 23, 53, 8080];

    // Scan in batches for speed
    const batchSize = 10;
    for (let i = startHost; i <= endHost && !this.cancelled; i += batchSize) {
      const batch: Promise<void>[] = [];

      for (let j = i; j < i + batchSize && j <= endHost; j++) {
        const target = `${subnet}.${j}`;
        if (target === localIP) continue;

        // Check multiple ports in parallel for each host
        batch.push(
          (async () => {
            for (const port of discoveryPorts) {
              if (foundSet.has(target)) break;
              const connected = await this.tcpConnect(target, port, timeout);
              if (connected && !foundSet.has(target)) {
                foundSet.add(target);
                hosts.push(target);
                logger.info(`Found host: ${target} (port ${port})`);
                break;
              }
            }
          })()
        );
      }

      await Promise.all(batch);
      onProgress(Math.min(i + batchSize - startHost, total), total);
    }

    return hosts;
  }

  /**
   * Execute a single command
   */
  private async executeCommand(cmd: Command, index: number): Promise<CommandResult> {
    const result: CommandResult = {
      op: cmd.op,
      index,
      success: true,
    };

    try {
      switch (cmd.op) {
        case 'get_network_info':
          result.data = this.getNetworkInfo();
          break;

        case 'tcp_connect': {
          const host = cmd.host as string;
          const port = (cmd.port as number) || 80;
          const timeout = (cmd.timeout as number) || 1000;
          const connected = await this.tcpConnect(host, port, timeout);
          result.data = { host, port, open: connected };
          break;
        }

        case 'tcp_banner': {
          const host = cmd.host as string;
          const port = (cmd.port as number) || 80;
          const timeout = (cmd.timeout as number) || 2000;
          const banner = await this.tcpBanner(host, port, timeout);
          const open = banner.length > 0 || await this.tcpConnect(host, port, timeout);
          result.data = { host, port, open, banner };
          break;
        }

        case 'dns_lookup': {
          const hostname = cmd.hostname as string;
          const lookup = await this.dnsLookupOp(hostname);
          result.data = { hostname, ...lookup };
          break;
        }

        case 'arp_scan': {
          const startHost = (cmd.startHost as number) || 1;
          const endHost = (cmd.endHost as number) || 254;
          const timeout = (cmd.timeout as number) || 50;
          const networkInfo = this.getNetworkInfo();
          const localIP = networkInfo.localIP as string;
          const parts = localIP.split('.');

          const hosts = await this.arpScan(startHost, endHost, timeout, (scanned, total) => {
            const progress = Math.floor((scanned / total) * 50) + 25; // 25-75% range
            this.reportProgress(progress, `Scanning: ${scanned}/${total} hosts`);
          });

          result.data = {
            subnet: `${parts[0]}.${parts[1]}.${parts[2]}.0/24`,
            hosts,
            count: hosts.length,
          };
          break;
        }

        case 'ping': {
          const host = cmd.host as string;
          const timeout = (cmd.timeout as number) || 1000;
          // Use TCP connect as ping substitute (ICMP requires root)
          const start = Date.now();
          const reachable = await this.tcpConnect(host, 80, timeout) ||
                           await this.tcpConnect(host, 443, timeout);
          const latency = Date.now() - start;
          result.data = { host, reachable, latency };
          break;
        }

        default:
          result.success = false;
          result.error = `Unknown operation: ${cmd.op}`;
      }
    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
    }

    return result;
  }

  /**
   * Report progress via MQTT (for WebSocket broadcast)
   */
  private reportProgress(progress: number, step: string): void {
    if (!this.currentTestId) return;

    mqttClient.broadcastProgress(this.currentTestId, SERVER_DEVICE_ID, progress, step);
  }

  /**
   * Check if IP:port should be excluded (honeypot)
   */
  private shouldExclude(ip: string, port: number, exclusions: Array<{ ip: string; port: number }>): boolean {
    return exclusions.some(ex => ex.ip === ip && (ex.port === 0 || ex.port === port));
  }

  /**
   * Execute a batch of commands
   */
  async executeBatch(
    testId: string,
    commands: Command[],
    honeypotExclusions: Array<{ ip: string; port: number }> = []
  ): Promise<void> {
    if (this.running) {
      logger.warn('Local executor already running');
      return;
    }

    this.running = true;
    this.cancelled = false;
    this.currentTestId = testId;

    logger.info(`Starting local test execution: ${testId} with ${commands.length} commands`);
    if (honeypotExclusions.length > 0) {
      logger.info(`Excluding ${honeypotExclusions.length} honeypot targets`);
    }
    this.reportProgress(0, 'Starting');

    const results: CommandResult[] = [];

    try {
      for (let i = 0; i < commands.length && !this.cancelled; i++) {
        const cmd = commands[i];

        // Check if this command should be skipped (honeypot exclusion)
        if (honeypotExclusions.length > 0 && (cmd.op === 'tcp_connect' || cmd.op === 'tcp_banner')) {
          const host = cmd.host as string;
          const port = cmd.port as number;
          if (this.shouldExclude(host, port, honeypotExclusions)) {
            logger.debug(`Skipping honeypot: ${host}:${port}`);
            results.push({
              op: cmd.op,
              index: i,
              success: true,
              data: { host, port, skipped: true, reason: 'honeypot' },
            });
            continue;
          }
        }

        const progress = Math.floor((i / commands.length) * 100);
        this.reportProgress(progress, `Executing: ${cmd.op} (${i + 1}/${commands.length})`);

        const result = await this.executeCommand(cmd, i);
        results.push(result);

        logger.debug(`Command ${cmd.op} completed: ${result.success}`);
      }

      // Update test run with results
      const success = !this.cancelled && results.every((r) => r.success);
      const existingTestRun = await prisma.testRun.findUnique({
        where: { id: testId },
        select: { resultsJson: true },
      });
      const structuredResults = buildStructuredResultsJson(
        existingTestRun?.resultsJson,
        { results, metadata: { executor: 'server-local' } },
        { chunked: false }
      );

      await prisma.testRun.update({
        where: { id: testId },
        data: {
          status: this.cancelled ? 'CANCELLED' : success ? 'COMPLETED' : 'FAILED',
          progress: 100,
          completedAt: new Date(),
          resultsJson: structuredResults as unknown as Prisma.InputJsonValue,
        },
      });

      // Update device status
      await prisma.device.update({
        where: { deviceId: SERVER_DEVICE_ID },
        data: { status: 'ONLINE' },
      });

      this.reportProgress(100, this.cancelled ? 'Cancelled' : 'Complete');

      // Broadcast completion
      mqttClient.broadcastTestComplete(testId, SERVER_DEVICE_ID, success, structuredResults);

      logger.info(`Local test ${testId} completed: ${success ? 'success' : 'failed'}`);
    } catch (error) {
      logger.error('Local test execution error:', error);

      await prisma.testRun.update({
        where: { id: testId },
        data: {
          status: 'FAILED',
          progress: 100,
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });

      await prisma.device.update({
        where: { deviceId: SERVER_DEVICE_ID },
        data: { status: 'ONLINE' },
      });
    } finally {
      this.running = false;
      this.currentTestId = null;
    }
  }

  /**
   * Cancel running test
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * Check if running
   */
  isRunning(): boolean {
    return this.running;
  }
}

export const localTestExecutor = new LocalTestExecutor();

/**
 * Detect the host's LAN IP by probing the route to a known destination.
 * Creates a UDP socket aimed at the target — the OS fills in the source
 * address that would reach it, giving us the real LAN IP even from inside Docker.
 */
async function detectLanIP(): Promise<string | null> {
  // Try to find the UniFi controller host to use as a route target
  let targetHost = '1.1.1.1'; // fallback: any routable IP works
  try {
    const connection = await prisma.uniFiConnection.findFirst({
      where: { isActive: true },
      select: { host: true },
    });
    if (connection?.host) {
      targetHost = connection.host;
    }
  } catch {
    // DB not ready, use fallback
  }

  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    socket.connect(53, targetHost, () => {
      try {
        const addr = socket.address();
        socket.close();
        const ip = typeof addr === 'string' ? addr : addr.address;
        // Ignore Docker-internal IPs (172.x bridge networks)
        if (ip.startsWith('172.')) {
          resolve(null);
        } else {
          resolve(ip);
        }
      } catch {
        socket.close();
        resolve(null);
      }
    });
    socket.on('error', () => {
      socket.close();
      resolve(null);
    });
  });
}

/**
 * Ensure server device exists in database
 */
export async function ensureServerDevice(): Promise<void> {
  const networkInfo = localTestExecutor.getNetworkInfo();

  // Priority: HOST_IP env var > UDP route detection > interface scan
  let serverIP = process.env.HOST_IP || '';
  if (!serverIP) {
    const lanIP = await detectLanIP();
    serverIP = lanIP || networkInfo.localIP as string;
  }

  await prisma.device.upsert({
    where: { deviceId: SERVER_DEVICE_ID },
    update: {
      ipAddress: serverIP,
      status: 'ONLINE',
      lastSeen: new Date(),
    },
    create: {
      deviceId: SERVER_DEVICE_ID,
      name: 'Server (Local)',
      macAddress: networkInfo.mac as string,
      ipAddress: serverIP,
      firmwareVersion: 'server',
      status: 'ONLINE',
    },
  });

  logger.info(`Server device registered: ${serverIP}`);
}
