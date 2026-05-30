import { connectDatabase, disconnectDatabase, prisma } from './services/database';
import { mqttClient } from './mqtt';
import { UniFiClient, UniFiCredentials, UniFiClient_t } from './services/unifiClient';
import { analyzeConfiguration } from './analyzers';
import { decrypt, hashConfig } from './utils/encryption';
import logger from './utils/logger';
import { runScheduledVlanValidation } from './services/autoValidationService';
import { detectConfigChanges } from './services/configChangeService';
import { createNotification, cleanupOldNotifications } from './services/notificationService';
import { bootstrapHistoricalTimeline } from './services/historyBootstrapService';
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
  try {
    // Find connections that need syncing
    const connections = await prisma.uniFiConnection.findMany({
      where: {
        isActive: true,
        autoSync: true,
      },
    });

    for (const connection of connections) {
      // Check if it's time to sync
      const lastSync = connection.lastSyncAt?.getTime() || 0;
      const syncIntervalMs = connection.syncIntervalMin * 60 * 1000;
      const nextSyncTime = lastSync + syncIntervalMs;

      if (Date.now() < nextSyncTime) {
        continue; // Not time yet
      }

      // Skip if already syncing
      if (connection.lastSyncStatus === 'IN_PROGRESS') {
        continue;
      }

      logger.info(`Auto-syncing UniFi connection: ${connection.name}`);

      // Create sync history entry
      const syncRecord = await prisma.uniFiSyncHistory.create({
        data: {
          connectionId: connection.id,
          status: 'IN_PROGRESS',
        },
      });

      await prisma.uniFiConnection.update({
        where: { id: connection.id },
        data: { lastSyncStatus: 'IN_PROGRESS' },
      });

      try {
        // Decrypt credentials
        const credentials: UniFiCredentials = {
          host: connection.host,
          port: connection.port,
          username: decrypt(connection.usernameEnc),
          password: decrypt(connection.passwordEnc),
          siteId: connection.siteId,
        };

        const client = new UniFiClient(credentials);
        const loggedIn = await client.login();

        if (!loggedIn) {
          throw new Error('Failed to login to UniFi Controller');
        }

        // Fetch full configuration
        const fullConfig = await client.getFullConfig();

        // Convert to analysis format (clients excluded from hash - they're volatile)
        const configForAnalysis: any = {
          firewallRules: fullConfig.firewallRules,
          firewallGroups: fullConfig.firewallGroups,
          networkConf: fullConfig.networks,
          wlanConf: fullConfig.wlans,
          portForward: fullConfig.portForwards,
          routing: fullConfig.routingRules,
          settings: fullConfig.settings,
          site: fullConfig.sites[0],
          devices: fullConfig.devices,
          clients: fullConfig.clients,
          trafficRules: fullConfig.trafficRules,
          firewallPolicies: fullConfig.firewallPolicies,
          vpnServers: fullConfig.vpnServers,
          firewallZones: fullConfig.firewallZones,
          trafficMatchingLists: fullConfig.trafficMatchingLists,
          aclRules: fullConfig.aclRules,
          rawNetworkConfig: fullConfig.rawNetworkConfig,
          sysInfo: fullConfig.sysInfo
            ? {
                version: fullConfig.sysInfo.version,
                udm_version: fullConfig.sysInfo.udm_version,
                build: fullConfig.sysInfo.build,
              }
            : null,
          version: 'live',
        };

        // Hash based on infrastructure config only (exclude volatile client data)
        const configForHash = {
          firewallRules: fullConfig.firewallRules,
          firewallPolicies: fullConfig.firewallPolicies,
          firewallGroups: fullConfig.firewallGroups,
          networkConf: fullConfig.networks,
          wlanConf: fullConfig.wlans,
          portForward: fullConfig.portForwards,
          trafficRules: fullConfig.trafficRules,
          routing: fullConfig.routingRules,
          settings: fullConfig.settings,
          site: fullConfig.sites[0],
          devices: fullConfig.devices,
          vpnServers: fullConfig.vpnServers,
          firewallZones: fullConfig.firewallZones,
          trafficMatchingLists: fullConfig.trafficMatchingLists,
          aclRules: fullConfig.aclRules,
          version: 'live',
        };

        const configHash = hashConfig(configForHash);

        // Check for existing config
        let existingConfig = await prisma.configuration.findUnique({
          where: { configHash },
        });

        let vulnCount = 0;
        let changesDetected = 0;

        // Get previous config for change detection
        const previousConfig = await prisma.configuration.findFirst({
          where: { isActive: true },
          orderBy: { importedAt: 'desc' },
        });

        if (!existingConfig) {
          // Config changed - create new one
          await prisma.configuration.updateMany({
            where: { isActive: true },
            data: { isActive: false },
          });

          existingConfig = await prisma.configuration.create({
            data: {
              configHash,
              siteName: fullConfig.sites[0]?.desc || connection.name,
              controllerVersion: 'live',
              configJson: configForAnalysis as object,
              notes: `Auto-synced from ${connection.name}`,
              isActive: true,
            },
          });

          // Run analysis
          const vulnerabilities = await analyzeConfiguration(configForAnalysis as any, existingConfig.id);
          vulnCount = vulnerabilities.length;

          // Detect specific changes against previous config
          if (previousConfig && previousConfig.id !== existingConfig.id) {
            changesDetected = await detectConfigChanges(
              connection.id,
              previousConfig.configJson as any,
              configForAnalysis
            );
          } else if (!previousConfig) {
            // First sync — bootstrap historical timeline from UniFi data
            const bootstrapped = await bootstrapHistoricalTimeline(
              connection.id,
              fullConfig,
              client
            );
            if (bootstrapped > 0) {
              changesDetected = bootstrapped;
            }
          }

          // Notify about config changes
          if (changesDetected > 0) {
            await createNotification({
              type: 'CONFIG_CHANGED',
              severity: 'INFO',
              title: 'Configuration Changed',
              message: `${changesDetected} change(s) detected during sync of ${connection.name}.`,
              resourceType: 'connection',
              resourceId: connection.id,
            });
          }

          // Notify about vulnerabilities
          if (vulnCount > 0) {
            const critCount = vulnerabilities.filter((v: any) => v.severity === 'CRITICAL').length;
            const highCount = vulnerabilities.filter((v: any) => v.severity === 'HIGH').length;
            if (critCount > 0 || highCount > 0) {
              await createNotification({
                type: 'NEW_VULNERABILITIES',
                severity: critCount > 0 ? 'CRITICAL' : 'HIGH',
                title: 'Security Issues Found',
                message: `Found ${vulnCount} vulnerabilities (${critCount} critical, ${highCount} high) in ${connection.name}.`,
                resourceType: 'configuration',
                resourceId: existingConfig.id,
              });
            }
          }
        } else {
          // Infrastructure hash matches — update the stored config with fresh client data
          // so future comparisons have accurate client lists
          await prisma.configuration.update({
            where: { id: existingConfig.id },
            data: {
              configJson: configForAnalysis as object,
            },
          });

          // Detect client changes even when infrastructure hasn't changed
          if (previousConfig) {
            const prevConfigJson = previousConfig.configJson as any;
            const { compareResources, normalizeClientForTimeline } = await import('./services/configChangeService');
            changesDetected += await compareResources(
              connection.id,
              'client',
              (prevConfigJson.clients || []).map(normalizeClientForTimeline),
              (fullConfig.clients || []).map(normalizeClientForTimeline),
              (r) => r.mac,
              (r) => r.name || r.hostname || r.mac
            );
          }
        }

        // Sync network clients (always, regardless of config hash)
        const newDeviceCount = await syncNetworkClients(connection.id, fullConfig.clients, previousConfig);

        if (newDeviceCount > 5) {
          await createNotification({
            type: 'NEW_DEVICES',
            severity: 'INFO',
            title: 'New Devices Detected',
            message: `${newDeviceCount} new device(s) joined the network on ${connection.name}.`,
            resourceType: 'connection',
            resourceId: connection.id,
          });
        }

        // Update sync record
        await prisma.uniFiSyncHistory.update({
          where: { id: syncRecord.id },
          data: {
            status: 'SUCCESS',
            completedAt: new Date(),
            devicesFound: fullConfig.devices.length,
            networksFound: fullConfig.networks.length,
            rulesFound: fullConfig.firewallRules.length,
            wlansFound: fullConfig.wlans.length,
            changesDetected,
            vulnerabilitiesFound: vulnCount,
            configId: existingConfig.id,
          },
        });

        await prisma.uniFiConnection.update({
          where: { id: connection.id },
          data: {
            lastSyncAt: new Date(),
            lastSyncStatus: 'SUCCESS',
            lastSyncError: null,
          },
        });

        await client.logout();

        // Notify sync completed
        await createNotification({
          type: 'SYNC_COMPLETED',
          severity: 'INFO',
          title: 'Sync Completed',
          message: `Auto-sync of ${connection.name} completed. ${fullConfig.devices.length} devices, ${changesDetected} changes.`,
          resourceType: 'connection',
          resourceId: connection.id,
        });

        logger.info(`Auto-sync completed for ${connection.name}`);
      } catch (syncError: any) {
        await prisma.uniFiSyncHistory.update({
          where: { id: syncRecord.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: syncError.message,
          },
        });

        await prisma.uniFiConnection.update({
          where: { id: connection.id },
          data: {
            lastSyncAt: new Date(),
            lastSyncStatus: 'FAILED',
            lastSyncError: syncError.message,
          },
        });

        logger.error(`Auto-sync failed for ${connection.name}:`, syncError.message);

        await createNotification({
          type: 'SYNC_FAILED',
          severity: 'HIGH',
          title: 'Sync Failed',
          message: `Auto-sync of ${connection.name} failed: ${syncError.message}`,
          resourceType: 'connection',
          resourceId: connection.id,
        });
      }
    }
  } catch (error) {
    logger.error('UniFi sync check error:', error);
  }
}

/**
 * Sync network client inventory from UniFi to the NetworkClient table.
 * Returns the count of newly discovered clients.
 */
async function syncNetworkClients(
  _connectionId: string,
  clients: UniFiClient_t[],
  previousConfig: any
): Promise<number> {
  let newDeviceCount = 0;

  // Build set of previous client MACs for new device detection
  const prevClientMacs = new Set<string>();
  if (previousConfig) {
    const prevClients = (previousConfig.configJson as any)?.clients || [];
    for (const c of prevClients) {
      prevClientMacs.add(c.mac);
    }
  }

  for (const client of clients) {
    if (!client.mac) continue;

    // Find network name from active config for display
    let networkName: string | undefined;
    if (client.network_id) {
      try {
        const activeConfig = await prisma.configuration.findFirst({
          where: { isActive: true },
          select: { configJson: true },
        });
        if (activeConfig) {
          const nets = (activeConfig.configJson as any)?.networkConf || [];
          const net = nets.find((n: any) => n._id === client.network_id);
          if (net) networkName = net.name;
        }
      } catch {
        // ignore enrichment errors
      }
    }

    await prisma.networkClient.upsert({
      where: { mac: client.mac },
      create: {
        mac: client.mac,
        hostname: client.hostname,
        displayName: client.name,
        oui: client.oui,
        lastIp: client.ip,
        lastNetworkId: client.network_id,
        lastNetworkName: networkName,
        isWired: client.is_wired || false,
        unifiFirstSeen: client.first_seen ? new Date(client.first_seen * 1000) : undefined,
        unifiLastSeen: client.last_seen ? new Date(client.last_seen * 1000) : undefined,
      },
      update: {
        hostname: client.hostname,
        displayName: client.name,
        oui: client.oui,
        lastIp: client.ip,
        lastNetworkId: client.network_id,
        lastNetworkName: networkName,
        isWired: client.is_wired || false,
        unifiLastSeen: client.last_seen ? new Date(client.last_seen * 1000) : undefined,
      },
    });

    // Track if this is a new device
    if (!prevClientMacs.has(client.mac) && prevClientMacs.size > 0) {
      newDeviceCount++;
    }
  }

  if (newDeviceCount > 0) {
    logger.info(`Synced ${clients.length} network clients, ${newDeviceCount} new`);
  }

  return newDeviceCount;
}

async function runScheduledTasks(): Promise<void> {
  logger.info('Running scheduled tasks...');
  await cleanupOfflineDevices();
  await retryQueuedTests();
  await cleanupStaleTests();
  await syncUniFiConnections();
  await syncActiveDnsProxyConnections();
  await pollFirewallTelemetry();
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

async function main(): Promise<void> {
  logger.info('Starting scheduler...');

  try {
    await connectDatabase();

    // Register baseline DNS indicators (campaigns register their own at load)
    registerBaselineDnsIndicators();

    // Register built-in DNS proxy config adapters (AdGuard Home today; more later)
    registerBuiltinDnsProxyConfigAdapters();

    // Wire up the detection engine (detectors + their YAML rule metadata)
    // and the threat-intel feed registry. Both are idempotent.
    bootstrapDetectors();
    bootstrapThreatIntel();

    try {
      await mqttClient.connect();
    } catch {
      logger.warn('MQTT connection failed, scheduler continuing without MQTT');
    }

    // Run initial tasks
    await runScheduledTasks();
    await serverHeartbeat(); // Keep server-local device online immediately

    // Set up intervals
    setInterval(cleanupOfflineDevices, INTERVALS.DEVICE_CLEANUP);
    setInterval(retryQueuedTests, INTERVALS.RETRY_QUEUED_TESTS);
    setInterval(cleanupStaleTests, INTERVALS.STALE_TEST_CLEANUP);
    setInterval(cleanupOldData, INTERVALS.DB_CLEANUP);
    setInterval(syncUniFiConnections, INTERVALS.UNIFI_SYNC_CHECK);
    setInterval(syncActiveDnsProxyConnections, INTERVALS.DNS_PROXY_POLL);
    setInterval(pollFirewallTelemetry, INTERVALS.FIREWALL_TELEMETRY_POLL);
    setInterval(runScheduledVlanValidation, INTERVALS.VLAN_VALIDATION);
    setInterval(serverHeartbeat, INTERVALS.SERVER_HEARTBEAT);
    setInterval(runDetectors, INTERVALS.DETECTOR_RUN);
    setInterval(refreshIocFeeds, INTERVALS.IOC_FEED_REFRESH);

    // Refresh IOC feeds on boot so detectors have a populated cache before
    // their first run; do not block startup if it fails.
    void refreshIocFeeds();

    logger.info('Scheduler running with UniFi auto-sync, DNS proxy polling, VLAN validation, server heartbeat, and detection engine enabled');

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down scheduler...`);
      await mqttClient.disconnect();
      await disconnectDatabase();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Scheduler failed to start:', error);
    process.exit(1);
  }
}

main();
