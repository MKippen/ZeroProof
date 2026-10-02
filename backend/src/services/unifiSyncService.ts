import type { Prisma, UniFiConnection } from '@prisma/client';
import { collectConfigurationFindings, persistConfigurationFindings } from '../analyzers';
import type { UniFiConfig, VulnerabilityFinding } from '../types';
import { decrypt, hashConfig } from '../utils/encryption';
import logger from '../utils/logger';
import { detectConfigChanges } from './configChangeService';
import { collectHistoricalTimeline, persistHistoricalTimeline } from './historyBootstrapService';
import { withJobLease, type JobLease } from './jobLease';
import { UniFiClient, type UniFiClient_t, type UniFiCredentials, type UniFiFullConfig } from './unifiClient';

// Configuration.isActive is currently global. Per-connection locks would still
// allow two controllers to overwrite the application's active snapshot.
export const UNIFI_CONFIGURATION_SYNC_LEASE_KEY = 'unifi:configuration-sync';

export class UniFiSyncError extends Error {
  constructor(public readonly code: 'NOT_FOUND' | 'NOT_CONFIGURED' | 'CONNECTION_CHANGED', message: string) {
    super(message);
    this.name = 'UniFiSyncError';
  }
}

export interface UniFiSyncOptions {
  connectionId?: string;
  siteId?: string;
  trigger: 'manual' | 'scheduled';
}

export interface UniFiSyncResult {
  connectionId: string;
  connectionName: string;
  syncId: string;
  configId: string;
  siteName: string;
  changed: boolean;
  clientsDiscovered: number;
  stats: {
    devicesFound: number;
    networksFound: number;
    rulesFound: number;
    wlansFound: number;
    changesDetected: number;
    vulnerabilitiesFound: number;
  };
}

type SyncClient = Pick<UniFiClient, 'login' | 'logout' | 'getFullConfig' | 'getEvents' | 'getAlarms'>;
export interface UniFiSyncDependencies {
  createClient?: (credentials: UniFiCredentials) => SyncClient;
}

function sameConnection(a: UniFiConnection, b: UniFiConnection): boolean {
  return a.host === b.host && a.port === b.port && a.siteId === b.siteId &&
    a.usernameEnc === b.usernameEnc && a.passwordEnc === b.passwordEnc &&
    a.allowSelfSigned === b.allowSelfSigned && a.isActive === b.isActive;
}

function configurationInputs(full: UniFiFullConfig) {
  const { version, udm_version, build } = full.sysInfo ?? {};
  const infrastructure = {
    firewallRules: full.firewallRules, firewallPolicies: full.firewallPolicies,
    firewallGroups: full.firewallGroups, networkConf: full.networks,
    wlanConf: full.wlans, portForward: full.portForwards, trafficRules: full.trafficRules,
    routing: full.routingRules, settings: full.settings, site: full.sites?.[0],
    devices: full.devices, vpnServers: full.vpnServers, firewallZones: full.firewallZones,
    trafficMatchingLists: full.trafficMatchingLists, aclRules: full.aclRules,
    version: 'live',
  };
  return { configHash: hashConfig(infrastructure), analysis: {
    ...infrastructure, clients: full.clients, rawNetworkConfig: full.rawNetworkConfig,
    sysInfo: full.sysInfo ? { version, udm_version, build } : null,
  } };
}

async function publishNetworkClients(
  tx: Prisma.TransactionClient, clients: UniFiClient_t[], networks: UniFiFullConfig['networks'], previous: any
): Promise<number> {
  const prior = new Set<string>((previous?.clients || []).flatMap((client: UniFiClient_t | null) => client?.mac ? [client.mac] : []));
  const names = new Map((networks || []).flatMap((network: { _id?: string; id?: string; name?: string } | null) => {
    const id = network?._id || network?.id;
    return id && network?.name ? [[id, network.name] as const] : [];
  }));
  let discovered = 0;
  for (const client of clients || []) {
    if (!client.mac) continue;
    const data = {
      hostname: client.hostname, displayName: client.name, oui: client.oui,
      lastIp: client.ip, lastNetworkId: client.network_id,
      lastNetworkName: client.network_id ? names.get(client.network_id) : undefined,
      isWired: client.is_wired || false,
      unifiLastSeen: client.last_seen ? new Date(client.last_seen * 1000) : undefined,
    };
    await tx.networkClient.upsert({
      where: { mac: client.mac },
      create: { ...data, mac: client.mac,
        unifiFirstSeen: client.first_seen ? new Date(client.first_seen * 1000) : undefined },
      update: data,
    });
    if (prior.size && !prior.has(client.mac)) discovered += 1;
  }
  return discovered;
}

async function publishNotifications(lease: JobLease, rows: Prisma.NotificationCreateManyInput[]): Promise<void> {
  if (!rows.length) return;
  try { await lease.publish(async (tx) => { await tx.notification.createMany({ data: rows }); }); }
  catch (error) { logger.warn('UniFi sync notification could not be published:', error); }
}

/** Shared manual/scheduled lifecycle. Controller traffic never holds a DB transaction. */
export async function syncUniFiConfiguration(
  options: UniFiSyncOptions,
  dependencies: UniFiSyncDependencies = {}
): Promise<UniFiSyncResult | null> {
  return withJobLease(UNIFI_CONFIGURATION_SYNC_LEASE_KEY, async (lease) => {
    const prepared = await lease.publish(async (tx) => {
      const connection = options.connectionId
        ? await tx.uniFiConnection.findUnique({ where: { id: options.connectionId } })
        : await tx.uniFiConnection.findFirst({ where: { isActive: true } });
      if (!connection) {
        if (options.trigger === 'scheduled') return null;
        throw new UniFiSyncError(options.connectionId ? 'NOT_FOUND' : 'NOT_CONFIGURED',
          options.connectionId ? 'Connection not found' : 'No UniFi connection configured');
      }
      if (options.trigger === 'scheduled' && (!connection.isActive || !connection.autoSync ||
          (connection.lastSyncStatus !== 'IN_PROGRESS' &&
            Date.now() < (connection.lastSyncAt?.getTime() ?? 0) + connection.syncIntervalMin * 60_000))) return null;

      const needsHistory = (await tx.uniFiConfigChange.count({ where: { connectionId: connection.id } })) === 0;
      // Owning the global lease proves there is no other compliant config sync.
      // Preserve interrupted histories and terminalize them rather than delete.
      await tx.uniFiSyncHistory.updateMany({
        where: { connectionId: connection.id, status: 'IN_PROGRESS' },
        data: { status: 'FAILED', completedAt: new Date(), errorMessage: 'Previous sync was interrupted before completion' },
      });
      const history = await tx.uniFiSyncHistory.create({ data: { connectionId: connection.id, status: 'IN_PROGRESS' } });
      await tx.uniFiConnection.update({ where: { id: connection.id }, data: { lastSyncStatus: 'IN_PROGRESS', lastSyncError: null } });
      return { connection, needsHistory, history };
    });
    if (!prepared) return null;

    const { connection, history } = prepared;
    let client: SyncClient | undefined;
    try {
      lease.signal.throwIfAborted();
      const credentials: UniFiCredentials = {
        host: connection.host, port: connection.port, siteId: options.siteId ?? connection.siteId,
        username: decrypt(connection.usernameEnc), password: decrypt(connection.passwordEnc),
        allowSelfSigned: connection.allowSelfSigned,
      };
      client = (dependencies.createClient ?? ((value) => new UniFiClient(value)))(credentials);
      if (!await client.login()) throw new Error('Failed to login to UniFi Controller');
      const full = await client.getFullConfig();
      lease.signal.throwIfAborted();
      const { configHash, analysis } = configurationInputs(full);
      const knownConfig = await lease.publish((tx) => tx.configuration.findUnique({ where: { configHash } }));
      let findings: VulnerabilityFinding[] | undefined;
      if (!knownConfig) findings = await collectConfigurationFindings(analysis as unknown as UniFiConfig);
      const historicalRows = prepared.needsHistory
        ? await collectHistoricalTimeline(connection.id, full, client) : [];
      lease.signal.throwIfAborted();

      const result = await lease.publish(async (tx): Promise<UniFiSyncResult> => {
        // Settings updates do not take the sync lease. Lock the connection row
        // so a retarget cannot commit between this check and publication.
        await tx.$queryRaw`SELECT "id" FROM "UniFiConnection" WHERE "id" = ${connection.id} FOR UPDATE`;
        const current = await tx.uniFiConnection.findUnique({ where: { id: connection.id } });
        if (!current || !sameConnection(connection, current)) {
          throw new UniFiSyncError('CONNECTION_CHANGED', 'Connection changed while syncing. Retry with its current settings.');
        }
        const previous = await tx.configuration.findFirst({ where: { isActive: true }, orderBy: { importedAt: 'desc' } });
        let config = await tx.configuration.findUnique({ where: { configHash } });
        const changed = previous?.configHash !== configHash;
        if (!config) {
          if (!findings) throw new UniFiSyncError('CONNECTION_CHANGED', 'Configuration changed while syncing. Please retry.');
          config = await tx.configuration.create({ data: {
            configHash, configJson: analysis as unknown as Prisma.InputJsonValue, isActive: true,
            siteName: full.sites?.[0]?.desc || full.sites?.[0]?.name || options.siteId || connection.siteId,
            controllerVersion: full.sysInfo?.version || 'live', notes: `Synced from ${connection.name}`,
          } });
          await persistConfigurationFindings(config.id, findings, tx);
        } else {
          // Preserve historical findings and operator dispositions on reuse.
          config = await tx.configuration.update({ where: { id: config.id }, data: { isActive: true, configJson: analysis as unknown as Prisma.InputJsonValue } });
        }
        await tx.configuration.updateMany({ where: { isActive: true, id: { not: config.id } }, data: { isActive: false } });
        let changesDetected = await persistHistoricalTimeline(connection.id, historicalRows, tx);
        if (!changesDetected) {
          changesDetected = await detectConfigChanges(connection.id, previous?.configJson || {}, analysis, undefined, tx);
        }
        const clientsDiscovered = await publishNetworkClients(tx, full.clients, full.networks, previous?.configJson);
        const stats = {
          devicesFound: full.devices.length, networksFound: full.networks.length,
          rulesFound: full.firewallRules.length, wlansFound: full.wlans.length,
          changesDetected, vulnerabilitiesFound: await tx.vulnerability.count({ where: { configId: config.id } }),
        };
        await tx.uniFiSyncHistory.update({ where: { id: history.id }, data: {
          status: 'SUCCESS', completedAt: new Date(), configId: config.id, ...stats,
        } });
        await tx.uniFiConnection.update({ where: { id: connection.id }, data: {
          lastSyncAt: new Date(), lastSyncStatus: 'SUCCESS', lastSyncError: null,
        } });
        return { connectionId: connection.id, connectionName: connection.name, syncId: history.id,
          configId: config.id, siteName: config.siteName || options.siteId || connection.siteId, changed, clientsDiscovered, stats };
      });

      if (options.trigger === 'scheduled') {
        const notifications: Prisma.NotificationCreateManyInput[] = [{
          type: 'SYNC_COMPLETED', severity: 'INFO', title: 'Sync Completed',
          message: `Auto-sync of ${connection.name} completed. ${result.stats.devicesFound} devices, ${result.stats.changesDetected} changes.`,
          resourceType: 'connection', resourceId: connection.id,
        }];
        if (result.stats.changesDetected) notifications.push({
          type: 'CONFIG_CHANGED', severity: 'INFO', title: 'Configuration Changed',
          message: `${result.stats.changesDetected} change(s) detected during sync of ${connection.name}.`,
          resourceType: 'connection', resourceId: connection.id,
        });
        if (result.clientsDiscovered > 5) notifications.push({
          type: 'NEW_DEVICES', severity: 'INFO', title: 'New Devices Detected',
          message: `${result.clientsDiscovered} new device(s) joined the network on ${connection.name}.`,
          resourceType: 'connection', resourceId: connection.id,
        });
        const critical = findings?.filter((finding) => finding.severity === 'CRITICAL').length ?? 0;
        const high = findings?.filter((finding) => finding.severity === 'HIGH').length ?? 0;
        if (critical || high) notifications.push({
          type: 'NEW_VULNERABILITIES', severity: critical ? 'CRITICAL' : 'HIGH', title: 'Security Issues Found',
          message: `Found ${result.stats.vulnerabilitiesFound} vulnerabilities (${critical} critical, ${high} high) in ${connection.name}.`,
          resourceType: 'configuration', resourceId: result.configId,
        });
        await publishNotifications(lease, notifications);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UniFi sync failed';
      try {
        await lease.publish(async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "UniFiConnection" WHERE "id" = ${connection.id} FOR UPDATE`;
          await tx.uniFiSyncHistory.updateMany({ where: { id: history.id, status: 'IN_PROGRESS' },
            data: { status: 'FAILED', completedAt: new Date(), errorMessage: message } });
          const current = await tx.uniFiConnection.findUnique({ where: { id: connection.id } });
          if (current) await tx.uniFiConnection.updateMany({
            where: { id: connection.id, lastSyncStatus: 'IN_PROGRESS' },
            data: { lastSyncStatus: 'FAILED', lastSyncError: message,
              ...(sameConnection(connection, current) ? { lastSyncAt: new Date() } : {}) },
          });
        });
      } catch (finalizeError) { logger.warn('UniFi sync failure could not be finalized by its owner:', finalizeError); }
      if (options.trigger === 'scheduled') await publishNotifications(lease, [{
        type: 'SYNC_FAILED', severity: 'HIGH', title: 'Sync Failed',
        message: `Auto-sync of ${connection.name} failed: ${message}`,
        resourceType: 'connection', resourceId: connection.id,
      }]);
      throw error;
    } finally {
      if (client) {
        try { await client.logout(); }
        catch (error) { logger.warn('UniFi sync logout failed after work finished:', error); }
      }
    }
  });
}
