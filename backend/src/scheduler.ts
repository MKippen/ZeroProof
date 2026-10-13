import { connectDatabase, disconnectDatabase, prisma } from './services/database';
import { mqttClient } from './mqtt';
import { syncUniFiConfiguration } from './services/unifiSyncService';
import { JobLeaseBusyError } from './services/jobLease';
import { createSchedulerRuntime } from './services/schedulerRuntime';
import logger from './utils/logger';
import { runScheduledVlanValidation } from './services/autoValidationService';
import { cleanupOldNotifications } from './services/notificationService';
import { ensureServerDevice } from './services/localTestExecutor';
import { cleanupExpiredDnsProxyData, syncActiveDnsProxyConnections } from './services/dnsProxyService';
import {
  cleanupExpiredFirewallTelemetry,
  syncFirewallTelemetry,
} from './services/firewall/flowSync';
import { registerBaselineDnsIndicators } from './services/dnsIndicators';
import { registerBuiltinDnsProxyConfigAdapters } from './services/dnsProxyConfig';
import { bootstrapDetectors } from './detectors';
import { runAllDetectors } from './detectors/runner';
import { cleanupExpiredDetections } from './services/detection/detectionService';
import {
  bootstrapThreatIntel,
  refreshAllFeeds,
} from './services/threatIntel';

const INTERVALS = {
  DEVICE_CLEANUP: 5 * 60 * 1000, // 5 minutes
  STALE_TEST_CLEANUP: 10 * 60 * 1000, // 10 minutes
  RETRY_QUEUED_TESTS: 1 * 60 * 1000, // 1 minute
  DB_CLEANUP: 24 * 60 * 60 * 1000, // 24 hours
  UNIFI_SYNC_CHECK: 1 * 60 * 1000, // 1 minute (check if any connections need sync)
  DNS_PROXY_POLL: 60 * 1000, // 1 minute
  FIREWALL_TELEMETRY_POLL: 60 * 1000, // 1 minute
  VLAN_VALIDATION: 4 * 60 * 60 * 1000, // 4 hours
  SERVER_HEARTBEAT: 60 * 1000, // 1 minute - keep server-local device online
  DETECTOR_RUN: detectorRunIntervalMs(),
  IOC_FEED_REFRESH: 24 * 60 * 60 * 1000, // 24 hours
};

function detectorRunIntervalMs(): number {
  const raw = process.env.DETECTOR_RUN_INTERVAL_MS;
  if (!raw) return 5 * 60 * 1000; // default: every 5 minutes
  const n = Number(raw);
  return Number.isFinite(n) && n >= 30_000 ? n : 5 * 60 * 1000;
}

async function cleanupOfflineDevices(): Promise<void> {
  try {
    const threshold = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes

    const result = await prisma.device.updateMany({
      where: {
        status: 'ONLINE',
        lastSeen: { lt: threshold },
      },
      data: { status: 'OFFLINE' },
    });

    if (result.count > 0) {
      logger.info(`Marked ${result.count} devices as offline`);
    }
  } catch (error) {
    logger.error('Device cleanup error:', error);
  }
}

async function retryQueuedTests(): Promise<void> {
  try {
    // Retry tests that have been QUEUED for more than 2 minutes
    // This handles cases where the original MQTT command was lost
    const retryThreshold = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes
    const maxRetryAge = new Date(Date.now() - 15 * 60 * 1000); // Don't retry tests older than 15 minutes

    const queuedTests = await prisma.testRun.findMany({
      where: {
        status: 'QUEUED',
        startedAt: {
          lt: retryThreshold,
          gt: maxRetryAge,
        },
      },
      include: { device: true },
    });

    if (queuedTests.length === 0) return;

    // Import test definitions dynamically
    const { getTestDefinition } = await import('./services/testDefinitions');

    for (const test of queuedTests) {
      // Only retry if device is online
      if (test.device.status !== 'ONLINE' && test.device.status !== 'TESTING') {
        continue;
      }

      const testDef = getTestDefinition(test.testType);
      if (!testDef) {
        logger.warn(`No definition for test type ${test.testType}, cannot retry`);
        continue;
      }

      logger.info(`Retrying QUEUED test ${test.id} (${test.testType}) on device ${test.device.deviceId}`);

      mqttClient.sendCommand(test.device.deviceId, 'execute', {
        testId: test.id,
        commands: testDef.commands,
        honeypotExclusions: [],
      });
    }
  } catch (error) {
    logger.error('Retry queued tests error:', error);
  }
}

async function cleanupStaleTests(): Promise<void> {
  try {
    const threshold = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes

    const staleTests = await prisma.testRun.findMany({
      where: {
        status: { in: ['QUEUED', 'RUNNING'] },
        startedAt: { lt: threshold },
      },
      include: { device: true },
    });

    for (const test of staleTests) {
      await prisma.testRun.update({
        where: { id: test.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: 'Test timed out',
        },
      });

      // Reset device status
      await prisma.device.update({
        where: { id: test.deviceId },
        data: { status: 'ONLINE' },
      });

      logger.info(`Marked stale test ${test.id} as failed`);
    }
  } catch (error) {
    logger.error('Stale test cleanup error:', error);
  }
}

async function cleanupOldData(): Promise<void> {
  try {
    const auditLogThreshold = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days
    const testRunThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days

    // Clean up old audit logs
    const auditResult = await prisma.auditLog.deleteMany({
      where: { timestamp: { lt: auditLogThreshold } },
    });

    if (auditResult.count > 0) {
      logger.info(`Deleted ${auditResult.count} old audit logs`);
    }

    // Clean up old completed test runs (keep vulnerabilities)
    const testResult = await prisma.testRun.deleteMany({
      where: {
        status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] },
        startedAt: { lt: testRunThreshold },
      },
    });

    if (testResult.count > 0) {
      logger.info(`Deleted ${testResult.count} old test runs`);
    }

    // Clean up old notifications
    await cleanupOldNotifications();

    const dnsProxyDeleted = await cleanupExpiredDnsProxyData();
    if (dnsProxyDeleted > 0) {
      logger.info(`Deleted ${dnsProxyDeleted} expired DNS proxy records`);
    }

    const firewall = await cleanupExpiredFirewallTelemetry();
    if (firewall.flowsDeleted > 0 || firewall.threatsDeleted > 0) {
      logger.info(
        `Deleted ${firewall.flowsDeleted} expired firewall flow rows, ${firewall.threatsDeleted} threat rows`
      );
    }

    const detectionsDeleted = await cleanupExpiredDetections();
    if (detectionsDeleted > 0) {
      logger.info(`Deleted ${detectionsDeleted} expired detection rows`);
    }
  } catch (error) {
    logger.error('Old data cleanup error:', error);
  }
}

/**
 * Periodic detector run. All registered detectors evaluate over their
 * default windows; results land in the Detection table via the dedupe
 * upsert path.
 */
async function runDetectors(): Promise<void> {
  try {
    await runAllDetectors();
  } catch (error) {
    logger.error(`runDetectors error: ${(error as Error).message}`);
  }
}

/**
 * Refresh the IOC cache from external feeds. Failure of any individual
 * feed is logged inside the service and does not stop the others.
 */
async function refreshIocFeeds(): Promise<void> {
  try {
    const outcome = await refreshAllFeeds();
    const totalUpserted = outcome.feeds.reduce((sum, f) => sum + f.upserted, 0);
    if (totalUpserted > 0) {
      logger.info(
        `IOC feed refresh: ${outcome.feeds.length} feed(s), ${totalUpserted} entries upserted, ${outcome.prunedStale} stale removed`
      );
    }
  } catch (error) {
    logger.error(`refreshIocFeeds error: ${(error as Error).message}`);
  }
}

async function serverHeartbeat(): Promise<void> {
  try {
    // Ensure the server-local device exists and stays online.
    // ensureServerDevice uses upsert so it creates the device on first run
    // and updates IP/status on subsequent runs.
    await ensureServerDevice();
  } catch (error) {
    logger.error('Server heartbeat error:', error);
  }
}

async function syncUniFiConnections(): Promise<void> {
  const connections = await prisma.uniFiConnection.findMany({
    where: { isActive: true, autoSync: true },
    select: { id: true, name: true },
  });
  for (const connection of connections) {
    try {
      // The shared service re-reads due/active settings after claiming ownership;
      // this list is not an authority to start a stale or duplicate run.
      await syncUniFiConfiguration({ connectionId: connection.id, trigger: 'scheduled' });
    } catch (error) {
      // All UniFi config syncs share one active snapshot. A manual/other-process
      // owner gets to finish; a later timer tick will recheck remaining work.
      if (error instanceof JobLeaseBusyError) return;
      logger.error(`Auto-sync failed for ${connection.name}`, error);
    }
  }
}

/**
 * Pull flow + threat events for every active UniFi connection. Each
 * connection is independent — failure on one doesn't block the others.
 */
async function pollFirewallTelemetry(): Promise<void> {
  try {
    const connections = await prisma.uniFiConnection.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    for (const conn of connections) {
      try {
        const result = await syncFirewallTelemetry(conn.id);
        if (result.flowsInserted > 0 || result.threatsInserted > 0) {
          logger.info(
            `Firewall telemetry sync (${conn.name}): +${result.flowsInserted} flows, +${result.threatsInserted} threats`
          );
        }
      } catch (err) {
        logger.error(
          `Firewall telemetry sync failed for ${conn.name}: ${(err as Error).message}`
        );
      }
    }
  } catch (err) {
    logger.error(`pollFirewallTelemetry: ${(err as Error).message}`);
  }
}

function main(): void {
  logger.info('Starting scheduler...');
  const runtime = createSchedulerRuntime({
    connect: connectDatabase,
    initialize: () => {
      registerBaselineDnsIndicators();
      registerBuiltinDnsProxyConfigAdapters();
      bootstrapDetectors();
      bootstrapThreatIntel();
    },
    jobs: [
      { name: 'mqtt-connect', run: () => mqttClient.connect(), runOnStart: true },
      { name: 'device-cleanup', run: cleanupOfflineDevices, intervalMs: INTERVALS.DEVICE_CLEANUP, runOnStart: true },
      { name: 'queued-tests', run: retryQueuedTests, intervalMs: INTERVALS.RETRY_QUEUED_TESTS, runOnStart: true },
      { name: 'stale-tests', run: cleanupStaleTests, intervalMs: INTERVALS.STALE_TEST_CLEANUP, runOnStart: true },
      { name: 'data-cleanup', run: cleanupOldData, intervalMs: INTERVALS.DB_CLEANUP },
      { name: 'unifi-sync', run: syncUniFiConnections, intervalMs: INTERVALS.UNIFI_SYNC_CHECK, runOnStart: true },
      { name: 'dns-poll', run: syncActiveDnsProxyConnections, intervalMs: INTERVALS.DNS_PROXY_POLL, runOnStart: true },
      { name: 'firewall-telemetry', run: pollFirewallTelemetry, intervalMs: INTERVALS.FIREWALL_TELEMETRY_POLL, runOnStart: true },
      { name: 'vlan-validation', run: runScheduledVlanValidation, intervalMs: INTERVALS.VLAN_VALIDATION },
      { name: 'server-heartbeat', run: serverHeartbeat, intervalMs: INTERVALS.SERVER_HEARTBEAT, runOnStart: true },
      { name: 'detectors', run: runDetectors, intervalMs: INTERVALS.DETECTOR_RUN },
      { name: 'ioc-refresh', run: refreshIocFeeds, intervalMs: INTERVALS.IOC_FEED_REFRESH, runOnStart: true },
    ],
    disconnect: async () => {
      await mqttClient.disconnect();
      await disconnectDatabase();
    },
    exit: (code) => process.exit(code),
    log: logger,
  });
  // Install lifecycle handling before connecting or starting controller work.
  process.once('SIGTERM', () => { void runtime.shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void runtime.shutdown('SIGINT'); });
  void runtime.start();
}

if (require.main === module) main();
