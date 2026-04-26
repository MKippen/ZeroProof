import { Router, Request, Response } from 'express';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import { encrypt, decrypt, hashConfig } from '../../utils/encryption';
import { UniFiClient, UniFiCredentials, UniFiClient_t } from '../../services/unifiClient';
import { analyzeConfiguration } from '../../analyzers';
import {
  compareResources,
  detectConfigChanges,
  normalizeClientForTimeline,
} from '../../services/configChangeService';
import logger from '../../utils/logger';

const router = Router();

function buildConfigForAnalysis(fullConfig: any, connectionName: string): Record<string, unknown> {
  return {
    firewallRules: fullConfig.firewallRules,
    firewallPolicies: fullConfig.firewallPolicies,
    firewallGroups: fullConfig.firewallGroups,
    networkConf: fullConfig.networks,
    wlanConf: fullConfig.wlans,
    portForward: fullConfig.portForwards,
    trafficRules: fullConfig.trafficRules,
    routing: fullConfig.routingRules,
    settings: fullConfig.settings,
    site: fullConfig.sites?.[0],
    devices: fullConfig.devices,
    clients: fullConfig.clients,
    vpnServers: fullConfig.vpnServers,
    firewallZones: fullConfig.firewallZones,
    trafficMatchingLists: fullConfig.trafficMatchingLists,
    aclRules: fullConfig.aclRules,
    rawNetworkConfig: fullConfig.rawNetworkConfig,
    version: 'live',
    notes: `Synced from ${connectionName}`,
  };
}

function buildConfigForHash(fullConfig: any): Record<string, unknown> {
  // Exclude volatile client data from infra-change hash.
  return {
    firewallRules: fullConfig.firewallRules,
    firewallPolicies: fullConfig.firewallPolicies,
    firewallGroups: fullConfig.firewallGroups,
    networkConf: fullConfig.networks,
    wlanConf: fullConfig.wlans,
    portForward: fullConfig.portForwards,
    trafficRules: fullConfig.trafficRules,
    routing: fullConfig.routingRules,
    settings: fullConfig.settings,
    site: fullConfig.sites?.[0],
    devices: fullConfig.devices,
    vpnServers: fullConfig.vpnServers,
    firewallZones: fullConfig.firewallZones,
    trafficMatchingLists: fullConfig.trafficMatchingLists,
    aclRules: fullConfig.aclRules,
    version: 'live',
  };
}

async function syncNetworkClients(
  clients: UniFiClient_t[],
  networks: any[],
  previousConfigJson: any
): Promise<number> {
  let newDeviceCount = 0;

  const prevClientMacs = new Set<string>();
  for (const c of previousConfigJson?.clients || []) {
    if (c?.mac) prevClientMacs.add(c.mac);
  }

  const networkNameById = new Map<string, string>();
  for (const network of networks || []) {
    const id = network?._id || network?.id;
    if (id && network?.name) {
      networkNameById.set(id, network.name);
    }
  }

  for (const client of clients || []) {
    if (!client.mac) continue;

    await prisma.networkClient.upsert({
      where: { mac: client.mac },
      create: {
        mac: client.mac,
        hostname: client.hostname,
        displayName: client.name,
        oui: client.oui,
        lastIp: client.ip,
        lastNetworkId: client.network_id,
        lastNetworkName: client.network_id ? networkNameById.get(client.network_id) : undefined,
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
        lastNetworkName: client.network_id ? networkNameById.get(client.network_id) : undefined,
        isWired: client.is_wired || false,
        unifiLastSeen: client.last_seen ? new Date(client.last_seen * 1000) : undefined,
      },
    });

    if (!prevClientMacs.has(client.mac) && prevClientMacs.size > 0) {
      newDeviceCount++;
    }
  }

  return newDeviceCount;
}

// ============================================================================
// Legacy Settings Routes (for Settings page compatibility)
// These work with the first/active UniFi connection
// ============================================================================

// GET /api/v1/unifi/settings - Get current UniFi settings
router.get('/settings', requireAuth, async (_req: Request, res: Response) => {
  try {
    const connection = await prisma.uniFiConnection.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!connection) {
      const response: ApiResponse = {
        success: true,
        data: { settings: null, configured: false },
      };
      res.json(response);
      return;
    }

    // Decrypt username for display
    const username = decrypt(connection.usernameEnc);

    const response: ApiResponse = {
      success: true,
      data: {
        settings: {
          host: connection.host,
          port: connection.port,
          username,
          hasPassword: !!connection.passwordEnc,
          verifySsl: true, // Not stored, default to true
          autoSync: connection.autoSync,
          syncInterval: connection.syncIntervalMin === 60 ? 'hourly' : connection.syncIntervalMin === 1440 ? 'daily' : 'manual',
          selectedSite: connection.siteId,
          lastSyncAt: connection.lastSyncAt?.toISOString(),
          lastSyncStatus: connection.lastSyncStatus === 'SUCCESS' ? 'success' : connection.lastSyncStatus === 'FAILED' ? 'error' : undefined,
          lastSyncError: connection.lastSyncError,
        },
        configured: true,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get UniFi settings error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch settings' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/unifi/test - Test connection with provided credentials
router.post('/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const { host, port, username, password } = req.body;

    if (!host || !username) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Host and username are required' },
      };
      res.status(400).json(response);
      return;
    }

    // If no password provided, try to use existing connection's password
    let testPassword = password;
    if (!testPassword) {
      const existing = await prisma.uniFiConnection.findFirst({
        where: { host, isActive: true },
      });
      if (existing?.passwordEnc) {
        testPassword = decrypt(existing.passwordEnc);
      }
    }

    if (!testPassword) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Password is required' },
      };
      res.status(400).json(response);
      return;
    }

    const credentials: UniFiCredentials = {
      host,
      port: port || 443,
      username,
      password: testPassword,
      siteId: 'default',
    };

    const client = new UniFiClient(credentials);
    await client.login();
    const sites = await client.getSites();
    const settings = await client.getSettings();

    const response: ApiResponse = {
      success: true,
      data: {
        connected: true,
        sites: sites || [],
        controllerVersion: settings?.controller_version || 'Unknown',
      },
    };
    res.json(response);
  } catch (error: any) {
    logger.error('Test connection error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'CONNECTION_FAILED', message: error.message || 'Failed to connect to UniFi controller' },
    };
    res.status(400).json(response);
  }
});

// POST /api/v1/unifi/settings - Save UniFi settings (create or update connection)
router.post('/settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const { host, port, username, password, autoSync, syncInterval, selectedSite } = req.body;

    if (!host || !username) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Host and username are required' },
      };
      res.status(400).json(response);
      return;
    }

    // Find existing connection or create new one
    const existing = await prisma.uniFiConnection.findFirst({
      where: { isActive: true },
    });

    const syncIntervalMin = syncInterval === 'hourly' ? 60 : syncInterval === 'daily' ? 1440 : 0;

    if (existing) {
      // Update existing connection
      const updateData: any = {
        host,
        port: port || 443,
        usernameEnc: encrypt(username),
        siteId: selectedSite || 'default',
        autoSync: autoSync || false,
        syncIntervalMin,
      };

      if (password) {
        updateData.passwordEnc = encrypt(password);
      }

      await prisma.uniFiConnection.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      // Create new connection
      if (!password) {
        const response: ApiResponse = {
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Password is required for new connection' },
        };
        res.status(400).json(response);
        return;
      }

      await prisma.uniFiConnection.create({
        data: {
          name: `UniFi Controller (${host})`,
          host,
          port: port || 443,
          usernameEnc: encrypt(username),
          passwordEnc: encrypt(password),
          siteId: selectedSite || 'default',
          isActive: true,
          autoSync: autoSync || false,
          syncIntervalMin,
          canWrite: false,
        },
      });
    }

    const response: ApiResponse = {
      success: true,
      data: { saved: true },
    };
    res.json(response);
  } catch (error) {
    logger.error('Save UniFi settings error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SAVE_ERROR', message: 'Failed to save settings' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/unifi/sync - Sync configuration from active connection
router.post('/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const { site } = req.body;

    const connection = await prisma.uniFiConnection.findFirst({
      where: { isActive: true },
    });

    if (!connection) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'No UniFi connection configured' },
      };
      res.status(400).json(response);
      return;
    }

    // Decrypt credentials
    const username = decrypt(connection.usernameEnc);
    const password = decrypt(connection.passwordEnc);

    const credentials: UniFiCredentials = {
      host: connection.host,
      port: connection.port,
      username,
      password,
      siteId: site || connection.siteId,
    };

    // Create sync history record
    const syncHistory = await prisma.uniFiSyncHistory.create({
      data: {
        connectionId: connection.id,
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      },
    });

    try {
      const client = new UniFiClient(credentials);
      await client.login();
      const fullConfig = await client.getFullConfig();
      const configForAnalysis = buildConfigForAnalysis(fullConfig, connection.name);
      const configForHash = buildConfigForHash(fullConfig);
      const configHash = hashConfig(configForHash);

      // Check if config has changed
      const existingConfig = await prisma.configuration.findFirst({
        where: { isActive: true },
      });
      const previousConfigJson = (existingConfig?.configJson as any) || {};

      if (existingConfig?.configHash === configHash) {
        // Infra config unchanged. Still detect client churn and refresh client inventory.
        const clientChanges = await compareResources(
          connection.id,
          'client',
          (previousConfigJson.clients || []).map(normalizeClientForTimeline),
          (fullConfig.clients || []).map(normalizeClientForTimeline),
          (r) => r.mac,
          (r) => r.name || r.hostname || r.mac
        );
        const newClients = await syncNetworkClients(
          fullConfig.clients || [],
          fullConfig.networks || [],
          previousConfigJson
        );

        await prisma.configuration.update({
          where: { id: existingConfig.id },
          data: { configJson: configForAnalysis as any },
        });

        await prisma.uniFiSyncHistory.update({
          where: { id: syncHistory.id },
          data: {
            status: 'SUCCESS',
            completedAt: new Date(),
            devicesFound: fullConfig.devices?.length || 0,
            networksFound: fullConfig.networks?.length || 0,
            rulesFound: fullConfig.firewallRules?.length || 0,
            wlansFound: fullConfig.wlans?.length || 0,
            changesDetected: clientChanges,
            configId: existingConfig.id,
          },
        });

        await prisma.uniFiConnection.update({
          where: { id: connection.id },
          data: { lastSyncAt: new Date(), lastSyncStatus: 'SUCCESS', lastSyncError: null },
        });

        const response: ApiResponse = {
          success: true,
          data: {
            synced: false,
            message: 'Configuration unchanged',
            changesDetected: clientChanges,
            clientsDiscovered: newClients,
          },
        };
        res.json(response);
        return;
      }

      // Get IDs of old configs to clean up their vulnerabilities
      const oldConfigs = await prisma.configuration.findMany({
        where: { isActive: true },
        select: { id: true },
      });
      const oldConfigIds = oldConfigs.map((c) => c.id);

      // Delete vulnerabilities from old configs
      if (oldConfigIds.length > 0) {
        await prisma.vulnerability.deleteMany({
          where: { configId: { in: oldConfigIds } },
        });
      }

      // Deactivate old configs
      await prisma.configuration.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      // Delete old inactive configurations (keep only the most recent 5)
      const configsToKeep = await prisma.configuration.findMany({
        orderBy: { importedAt: 'desc' },
        take: 5,
        select: { id: true },
      });
      const keepIds = configsToKeep.map((c) => c.id);
      await prisma.configuration.deleteMany({
        where: { id: { notIn: keepIds } },
      });

      // Save new configuration
      const newConfig = await prisma.configuration.create({
        data: {
          siteName: fullConfig.sites?.[0]?.desc || fullConfig.sites?.[0]?.name || site || connection.siteId,
          controllerVersion: fullConfig.settings?.controller_version || 'Unknown',
          configHash,
          configJson: configForAnalysis as any,
          isActive: true,
        },
      });

      // Run security analysis (this also saves vulnerabilities to DB)
      const vulnerabilities = await analyzeConfiguration(configForAnalysis as any, newConfig.id);
      const changesDetected = await detectConfigChanges(
        connection.id,
        previousConfigJson,
        configForAnalysis
      );
      const newClients = await syncNetworkClients(
        fullConfig.clients || [],
        fullConfig.networks || [],
        previousConfigJson
      );

      // Update sync history
      await prisma.uniFiSyncHistory.update({
        where: { id: syncHistory.id },
        data: {
          status: 'SUCCESS',
          completedAt: new Date(),
          devicesFound: fullConfig.devices?.length || 0,
          networksFound: fullConfig.networks?.length || 0,
          rulesFound: fullConfig.firewallRules?.length || 0,
          wlansFound: fullConfig.wlans?.length || 0,
          changesDetected,
          vulnerabilitiesFound: vulnerabilities.length,
          configId: newConfig.id,
        },
      });

      await prisma.uniFiConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'SUCCESS', lastSyncError: null },
      });

      const response: ApiResponse = {
        success: true,
        data: {
          synced: true,
          config: { id: newConfig.id, siteName: newConfig.siteName },
          changesDetected,
          clientsDiscovered: newClients,
          analysis: { vulnerabilitiesFound: vulnerabilities.length },
        },
      };
      res.json(response);
    } catch (syncError: any) {
      await prisma.uniFiSyncHistory.update({
        where: { id: syncHistory.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: syncError.message,
        },
      });

      await prisma.uniFiConnection.update({
        where: { id: connection.id },
        data: { lastSyncAt: new Date(), lastSyncStatus: 'FAILED', lastSyncError: syncError.message },
      });

      throw syncError;
    }
  } catch (error: any) {
    logger.error('Sync error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SYNC_FAILED', message: error.message || 'Failed to sync configuration' },
    };
    res.status(500).json(response);
  }
});

// DELETE /api/v1/unifi/settings - Remove UniFi connection
router.delete('/settings', requireAuth, async (_req: Request, res: Response) => {
  try {
    const connection = await prisma.uniFiConnection.findFirst({
      where: { isActive: true },
    });

    if (connection) {
      await prisma.uniFiConnection.delete({
        where: { id: connection.id },
      });
    }

    const response: ApiResponse = {
      success: true,
      data: { deleted: true },
    };
    res.json(response);
  } catch (error) {
    logger.error('Delete UniFi settings error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete settings' },
    };
    res.status(500).json(response);
  }
});

// ============================================================================
// Connection-based Routes (for UniFi page)
// ============================================================================

// GET /api/v1/unifi/connections - List all connections
router.get('/connections', requireAuth, async (_req: Request, res: Response) => {
  try {
    const connections = await prisma.uniFiConnection.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        host: true,
        port: true,
        siteId: true,
        isActive: true,
        autoSync: true,
        syncIntervalMin: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncError: true,
        canWrite: true,
        createdAt: true,
        _count: { select: { syncHistory: true, configChanges: true } },
      },
    });

    const response: ApiResponse = {
      success: true,
      data: { connections },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get UniFi connections error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch connections' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/unifi/connections - Create new connection
router.post('/connections', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, host, port, username, password, siteId, autoSync, syncIntervalMin, canWrite } = req.body;

    if (!name || !host || !username || !password) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Name, host, username, and password are required' },
      };
      res.status(400).json(response);
      return;
    }

    // Encrypt credentials
    const usernameEnc = encrypt(username);
    const passwordEnc = encrypt(password);

    const connection = await prisma.uniFiConnection.create({
      data: {
        name,
        host,
        port: port || 443,
        usernameEnc,
        passwordEnc,
        siteId: siteId || 'default',
        autoSync: autoSync || false,
        syncIntervalMin: syncIntervalMin || 1440,
        canWrite: canWrite || false,
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'UNIFI_CONNECTION_CREATE',
        resource: connection.id,
        details: { name, host },
        ipAddress: req.ip,
      },
    });

    logger.info(`UniFi connection created: ${name} (${host})`);

    const response: ApiResponse = {
      success: true,
      data: {
        connection: {
          id: connection.id,
          name: connection.name,
          host: connection.host,
          port: connection.port,
          siteId: connection.siteId,
          isActive: connection.isActive,
          autoSync: connection.autoSync,
          syncIntervalMin: connection.syncIntervalMin,
          canWrite: connection.canWrite,
        },
      },
    };
    res.status(201).json(response);
  } catch (error) {
    logger.error('Create UniFi connection error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'CREATE_ERROR', message: 'Failed to create connection' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/unifi/connections/:id/test - Test connection
router.post('/connections/:id/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const connection = await prisma.uniFiConnection.findUnique({
      where: { id: req.params.id },
    });

    if (!connection) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Connection not found' },
      };
      res.status(404).json(response);
      return;
    }

    // Decrypt credentials
    const credentials: UniFiCredentials = {
      host: connection.host,
      port: connection.port,
      username: decrypt(connection.usernameEnc),
      password: decrypt(connection.passwordEnc),
      siteId: connection.siteId,
    };

    const client = new UniFiClient(credentials);
    const result = await client.testConnection();

    const response: ApiResponse = {
      success: true,
      data: result,
    };
    res.json(response);
  } catch (error: any) {
    logger.error('Test UniFi connection error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'CONNECTION_ERROR', message: error.message || 'Connection test failed' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/unifi/connections/:id/sync - Sync configuration
router.post('/connections/:id/sync', requireAuth, async (req: Request, res: Response) => {
  try {
    const connection = await prisma.uniFiConnection.findUnique({
      where: { id: req.params.id },
    });

    if (!connection) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Connection not found' },
      };
      res.status(404).json(response);
      return;
    }

    // Create sync history entry
    const syncRecord = await prisma.uniFiSyncHistory.create({
      data: {
        connectionId: connection.id,
        status: 'IN_PROGRESS',
      },
    });

    // Update connection status
    await prisma.uniFiConnection.update({
      where: { id: connection.id },
      data: { lastSyncStatus: 'IN_PROGRESS' },
    });

    // Decrypt credentials
    const credentials: UniFiCredentials = {
      host: connection.host,
      port: connection.port,
      username: decrypt(connection.usernameEnc),
      password: decrypt(connection.passwordEnc),
      siteId: connection.siteId,
    };

    let client: UniFiClient | null = null;

    try {
      client = new UniFiClient(credentials);
      const loggedIn = await client.login();

      if (!loggedIn) {
        throw new Error('Failed to login to UniFi Controller');
      }

      // Fetch full configuration
      const fullConfig = await client.getFullConfig();

      // Convert to our config format for analysis
      const configForAnalysis = {
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
        clients: fullConfig.clients,
        vpnServers: fullConfig.vpnServers,
        firewallZones: fullConfig.firewallZones,
        trafficMatchingLists: fullConfig.trafficMatchingLists,
        aclRules: fullConfig.aclRules,
        rawNetworkConfig: fullConfig.rawNetworkConfig,
        version: 'live',
      };

      const configHash = hashConfig(configForAnalysis);

      // Check for existing config with same hash
      let config = await prisma.configuration.findUnique({
        where: { configHash },
      });

      let changesDetected = 0;

      if (!config) {
        // Get IDs of old configs to clean up their vulnerabilities
        const oldConfigs = await prisma.configuration.findMany({
          where: { isActive: true },
          select: { id: true },
        });
        const oldConfigIds = oldConfigs.map((c) => c.id);

        // Delete vulnerabilities from old configs
        if (oldConfigIds.length > 0) {
          await prisma.vulnerability.deleteMany({
            where: { configId: { in: oldConfigIds } },
          });
        }

        // New configuration - deactivate others and create new
        await prisma.configuration.updateMany({
          where: { isActive: true },
          data: { isActive: false },
        });

        // Delete old inactive configurations (keep only the most recent 5)
        const configsToKeep = await prisma.configuration.findMany({
          orderBy: { importedAt: 'desc' },
          take: 5,
          select: { id: true },
        });
        const keepIds = configsToKeep.map((c) => c.id);
        await prisma.configuration.deleteMany({
          where: { id: { notIn: keepIds } },
        });

        config = await prisma.configuration.create({
          data: {
            configHash,
            siteName: fullConfig.sites[0]?.desc || fullConfig.sites[0]?.name || connection.name,
            controllerVersion: 'live',
            configJson: configForAnalysis as object,
            notes: `Synced from ${connection.name}`,
            isActive: true,
          },
        });

        changesDetected = 1;

        // Detect specific changes (compare with previous config if exists)
        const previousConfig = await prisma.configuration.findFirst({
          where: { id: { not: config.id } },
          orderBy: { importedAt: 'desc' },
        });

        if (previousConfig) {
          changesDetected = await detectConfigChanges(
            connection.id,
            previousConfig.configJson as any,
            configForAnalysis
          );
        }
      }

      // Run analysis
      const vulnerabilities = await analyzeConfiguration(configForAnalysis as any, config.id);

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
          vulnerabilitiesFound: vulnerabilities.length,
          configId: config.id,
        },
      });

      // Update connection
      await prisma.uniFiConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'SUCCESS',
          lastSyncError: null,
        },
      });

      await client.logout();

      logger.info(`UniFi sync completed for ${connection.name}: ${vulnerabilities.length} vulnerabilities found`);

      const response: ApiResponse = {
        success: true,
        data: {
          syncId: syncRecord.id,
          configId: config.id,
          stats: {
            devicesFound: fullConfig.devices.length,
            networksFound: fullConfig.networks.length,
            rulesFound: fullConfig.firewallRules.length,
            wlansFound: fullConfig.wlans.length,
            changesDetected,
            vulnerabilitiesFound: vulnerabilities.length,
          },
        },
      };
      res.json(response);
    } catch (syncError: any) {
      if (client) {
        try { await client.logout(); } catch { /* ignore logout errors during cleanup */ }
      }

      // Update sync record with error
      await prisma.uniFiSyncHistory.update({
        where: { id: syncRecord.id },
        data: {
          status: 'FAILED',
          completedAt: new Date(),
          errorMessage: syncError.message,
        },
      });

      // Update connection
      await prisma.uniFiConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: 'FAILED',
          lastSyncError: syncError.message,
        },
      });

      throw syncError;
    }
  } catch (error: any) {
    logger.error('Sync UniFi config error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'SYNC_ERROR', message: error.message || 'Sync failed' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/unifi/connections/:id/history - Get sync history
router.get('/connections/:id/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [history, total] = await Promise.all([
      prisma.uniFiSyncHistory.findMany({
        where: { connectionId: req.params.id },
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.uniFiSyncHistory.count({ where: { connectionId: req.params.id } }),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        history,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get sync history error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch sync history' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/unifi/connections/:id/changes - Get detected changes
router.get('/connections/:id/changes', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    const [changes, total] = await Promise.all([
      prisma.uniFiConfigChange.findMany({
        where: { connectionId: req.params.id },
        orderBy: { detectedAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.uniFiConfigChange.count({ where: { connectionId: req.params.id } }),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        changes,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get config changes error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch changes' },
    };
    res.status(500).json(response);
  }
});

// PATCH /api/v1/unifi/connections/:id - Update connection
router.patch('/connections/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, host, port, username, password, siteId, autoSync, syncIntervalMin, canWrite, isActive } = req.body;

    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (host !== undefined) updateData.host = host;
    if (port !== undefined) updateData.port = port;
    if (siteId !== undefined) updateData.siteId = siteId;
    if (autoSync !== undefined) updateData.autoSync = autoSync;
    if (syncIntervalMin !== undefined) updateData.syncIntervalMin = syncIntervalMin;
    if (canWrite !== undefined) updateData.canWrite = canWrite;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (username) updateData.usernameEnc = encrypt(username);
    if (password) updateData.passwordEnc = encrypt(password);

    const connection = await prisma.uniFiConnection.update({
      where: { id: req.params.id },
      data: updateData,
    });

    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'UNIFI_CONNECTION_UPDATE',
        resource: connection.id,
        details: { updated: Object.keys(updateData) },
        ipAddress: req.ip,
      },
    });

    const response: ApiResponse = {
      success: true,
      data: {
        connection: {
          id: connection.id,
          name: connection.name,
          host: connection.host,
          port: connection.port,
          siteId: connection.siteId,
          isActive: connection.isActive,
          autoSync: connection.autoSync,
          syncIntervalMin: connection.syncIntervalMin,
          canWrite: connection.canWrite,
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Update UniFi connection error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update connection' },
    };
    res.status(500).json(response);
  }
});

// DELETE /api/v1/unifi/connections/:id - Delete connection
router.delete('/connections/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    await prisma.uniFiConnection.delete({
      where: { id: req.params.id },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'UNIFI_CONNECTION_DELETE',
        resource: req.params.id,
        ipAddress: req.ip,
      },
    });

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Delete UniFi connection error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete connection' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/unifi/connections/:id/apply-rule - Apply a remediation rule
router.post('/connections/:id/apply-rule', requireAuth, async (req: Request, res: Response) => {
  try {
    const connection = await prisma.uniFiConnection.findUnique({
      where: { id: req.params.id },
    });

    if (!connection) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Connection not found' },
      };
      res.status(404).json(response);
      return;
    }

    if (!connection.canWrite) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'PERMISSION_DENIED', message: 'This connection does not have write permissions' },
      };
      res.status(403).json(response);
      return;
    }

    const { action, ruleData, vulnerabilityId } = req.body;

    if (!action || !ruleData) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Action and ruleData are required' },
      };
      res.status(400).json(response);
      return;
    }

    // Decrypt credentials
    const credentials: UniFiCredentials = {
      host: connection.host,
      port: connection.port,
      username: decrypt(connection.usernameEnc),
      password: decrypt(connection.passwordEnc),
      siteId: connection.siteId,
    };

    const client = new UniFiClient(credentials);
    await client.login();

    let result: any;

    try {
      switch (action) {
        case 'create_firewall_rule':
          result = await client.createFirewallRule(ruleData);
          break;
        case 'update_firewall_rule':
          result = await client.updateFirewallRule(ruleData._id, ruleData);
          break;
        case 'delete_firewall_rule':
          result = await client.deleteFirewallRule(ruleData._id);
          break;
        case 'create_firewall_group':
          result = await client.createFirewallGroup(ruleData);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      // Log the remediation action
      await prisma.remediationAction.create({
        data: {
          vulnerabilityId: vulnerabilityId || 'manual',
          actionType: action,
          description: `Applied ${action} via UniFi API`,
          resourceType: action.includes('group') ? 'firewallGroup' : 'firewallRule',
          resourceId: result?.data?.[0]?._id || ruleData._id,
          changeData: ruleData,
          status: 'APPLIED',
          appliedAt: new Date(),
          appliedBy: req.session.userId,
        },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.session.userId,
          action: 'UNIFI_RULE_APPLIED',
          resource: connection.id,
          details: { action, ruleData },
          ipAddress: req.ip,
        },
      });

      await client.logout();

      logger.info(`Applied ${action} to UniFi Controller ${connection.name}`);

      const response: ApiResponse = {
        success: true,
        data: { result },
      };
      res.json(response);
    } catch (applyError) {
      await client.logout();
      throw applyError;
    }
  } catch (error: any) {
    logger.error('Apply rule error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'APPLY_ERROR', message: error.message || 'Failed to apply rule' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/unifi/debug/network-config - Get raw network config for debugging ACL/isolation fields
router.get('/debug/network-config', requireAuth, async (_req: Request, res: Response) => {
  try {
    const connection = await prisma.uniFiConnection.findFirst({
      where: { isActive: true },
    });

    if (!connection) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_CONFIGURED', message: 'No UniFi connection configured' },
      };
      res.status(400).json(response);
      return;
    }

    // Decrypt credentials
    const credentials: UniFiCredentials = {
      host: connection.host,
      port: connection.port,
      username: decrypt(connection.usernameEnc),
      password: decrypt(connection.passwordEnc),
      siteId: connection.siteId,
    };

    const client = new UniFiClient(credentials);
    await client.login();

    // Fetch raw data
    const [rawNetworkConfig, aclRules] = await Promise.all([
      client.getRawNetworkConfig(),
      client.getAclRules(),
    ]);

    await client.logout();

    // Extract all unique keys from network configs
    const allKeys = new Set<string>();
    const isolationRelatedFields: Record<string, any>[] = [];

    for (const network of rawNetworkConfig) {
      Object.keys(network).forEach(key => allKeys.add(key));

      // Extract isolation-related fields
      const isolationFields: Record<string, any> = {
        name: network.name,
        _id: network._id,
      };

      for (const key of Object.keys(network)) {
        if (key.includes('isolation') || key.includes('acl') || key.includes('l3') ||
            key.includes('device') || key.includes('intra') || key.includes('inter')) {
          isolationFields[key] = network[key];
        }
      }

      isolationRelatedFields.push(isolationFields);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        allNetworkConfigKeys: Array.from(allKeys).sort(),
        isolationRelatedFields,
        aclRulesCount: aclRules.length,
        aclRules: aclRules.slice(0, 10), // First 10 ACL rules
        sampleNetworkConfig: rawNetworkConfig[0], // Full sample for one network
      },
    };
    res.json(response);
  } catch (error: any) {
    logger.error('Debug network config error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: error.message || 'Failed to fetch debug data' },
    };
    res.status(500).json(response);
  }
});

export default router;
