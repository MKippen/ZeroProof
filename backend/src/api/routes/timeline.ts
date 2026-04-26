import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { ApiResponse } from '../../types';
import {
  getTimelineEvents,
  getTimelineEventDetail,
  getTimelineStats,
  getTimelineHistogram,
  getClients,
  getClientDetail,
  getClientsByNetwork,
} from '../../services/timelineService';
import prisma from '../../services/database';
import { objectIdToDate } from '../../utils/objectId';
import logger from '../../utils/logger';

const router = Router();

function normalizeConfigForDiff(config: any): any {
  return {
    firewallRules: config?.firewallRules || [],
    networkConf: config?.networkConf || config?.networks || [],
    wlanConf: config?.wlanConf || config?.wlans || [],
    portForward: config?.portForward || config?.portForwards || [],
    trafficRules: config?.trafficRules || [],
    firewallPolicies: config?.firewallPolicies || [],
    aclRules: config?.aclRules || [],
    vpnServers: config?.vpnServers || [],
    clients: config?.clients || config?.user || config?.sta || [],
    devices: config?.devices || [],
  };
}

function resolveHistoricalDetectedAt(item: any, fallback: Date): Date {
  if (item?.first_seen !== undefined && item?.first_seen !== null) {
    const firstSeen = new Date(Number(item.first_seen) * 1000);
    if (!isNaN(firstSeen.getTime())) return firstSeen;
  }

  const objectIdCandidate = typeof item?._id === 'string'
    ? item._id
    : typeof item?.id === 'string'
      ? item.id
      : null;
  if (objectIdCandidate) {
    const objectIdDate = objectIdToDate(objectIdCandidate);
    if (objectIdDate) return objectIdDate;
  }

  return fallback;
}

// GET /api/v1/timeline - Grouped events
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const groupBy = (req.query.groupBy as string) || 'day';
    const filter = (req.query.filter as string) || 'all';
    const timezone = typeof req.query.tz === 'string' ? req.query.tz : undefined;
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const result = await getTimelineEvents({
      page,
      limit,
      groupBy: groupBy as any,
      filter: filter as any,
      from,
      to,
      timezone,
    });

    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  } catch (error) {
    logger.error('Get timeline events error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch timeline events' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/timeline/stats - Overall timeline statistics
router.get('/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const stats = await getTimelineStats();
    const response: ApiResponse = { success: true, data: stats };
    res.json(response);
  } catch (error) {
    logger.error('Get timeline stats error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch timeline stats' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/timeline/histogram - Daily counts for chart
router.get('/histogram', requireAuth, async (req: Request, res: Response) => {
  try {
    const daysParam = req.query.days as string;
    const days = daysParam === '0' || daysParam === 'all' ? 0 : (parseInt(daysParam) || 90);
    const timezone = typeof req.query.tz === 'string' ? req.query.tz : undefined;
    const data = await getTimelineHistogram(days, timezone);
    const response: ApiResponse = { success: true, data };
    res.json(response);
  } catch (error) {
    logger.error('Get timeline histogram error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch timeline histogram' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/timeline/events/:id - Single change detail
router.get('/events/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const event = await getTimelineEventDetail(req.params.id);
    if (!event) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Event not found' },
      };
      res.status(404).json(response);
      return;
    }
    const response: ApiResponse = { success: true, data: event };
    res.json(response);
  } catch (error) {
    logger.error('Get timeline event detail error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch event detail' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/timeline/clients - All tracked clients
router.get('/clients', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const search = req.query.search as string | undefined;

    const result = await getClients({ page, limit, search });
    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  } catch (error) {
    logger.error('Get clients error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch clients' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/timeline/clients/by-network - Clients grouped by network/VLAN
router.get('/clients/by-network', requireAuth, async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const result = await getClientsByNetwork({ search });
    const response: ApiResponse = { success: true, data: result };
    res.json(response);
  } catch (error) {
    logger.error('Get clients by network error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch clients by network' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/timeline/clients/:mac - Client detail with context
router.get('/clients/:mac', requireAuth, async (req: Request, res: Response) => {
  try {
    const detail = await getClientDetail(req.params.mac);
    if (!detail) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Client not found' },
      };
      res.status(404).json(response);
      return;
    }
    const response: ApiResponse = { success: true, data: detail };
    res.json(response);
  } catch (error) {
    logger.error('Get client detail error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch client detail' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/timeline/bootstrap - Generate change history from stored config snapshots
router.post('/bootstrap', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Check if already bootstrapped
    const existingChanges = await prisma.uniFiConfigChange.count();
    if (existingChanges > 0) {
      const response: ApiResponse = {
        success: true,
        data: { message: 'Timeline already has data', existingChanges },
      };
      res.json(response);
      return;
    }

    // Get all stored configs ordered by import time
    const allConfigs = await prisma.configuration.findMany({
      orderBy: { importedAt: 'asc' },
    });

    if (allConfigs.length === 0) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NO_DATA', message: 'No stored configurations found' },
      };
      res.status(404).json(response);
      return;
    }

    // Ignore synthetic sandbox fixtures when bootstrapping historical timeline.
    // If filtering removes everything, fall back to all configs.
    const configs = allConfigs.filter((cfg) => !(cfg.siteName || '').toLowerCase().includes('sandbox'));
    const configsForBootstrap = configs.length > 0 ? configs : allConfigs;

    // Get the connection ID (use first available)
    const connection = await prisma.uniFiConnection.findFirst();
    const connectionId = connection?.id || 'bootstrap';

    let totalChanges = 0;

    // For the first config, create CREATED entries for all resources
    const firstConfig = normalizeConfigForDiff(configsForBootstrap[0].configJson as any);
    const resourceTypes = [
      { key: 'firewallRules', type: 'firewallRule', getId: (r: any) => r._id, getName: (r: any) => r.name },
      { key: 'networkConf', type: 'network', getId: (r: any) => r._id, getName: (r: any) => r.name },
      { key: 'wlanConf', type: 'wlan', getId: (r: any) => r._id, getName: (r: any) => r.name },
      { key: 'portForward', type: 'portForward', getId: (r: any) => r._id, getName: (r: any) => r.name },
      { key: 'trafficRules', type: 'trafficRule', getId: (r: any) => r._id, getName: (r: any) => r.name || r._id },
      { key: 'firewallPolicies', type: 'firewallPolicy', getId: (r: any) => r._id, getName: (r: any) => r.name },
      { key: 'aclRules', type: 'aclRule', getId: (r: any) => r._id, getName: (r: any) => r.name || r._id },
    ];

    for (const rt of resourceTypes) {
      const items = firstConfig[rt.key] || [];
      for (const item of items) {
        await prisma.uniFiConfigChange.create({
          data: {
            connectionId,
            changeType: 'CREATED',
            resourceType: rt.type,
            resourceId: rt.getId(item),
            resourceName: rt.getName(item),
            newValue: item,
            detectedAt: resolveHistoricalDetectedAt(item, configsForBootstrap[0].importedAt),
          },
        });
        totalChanges++;
      }
    }

    // Create CREATED entries for devices in first config
    const firstDevices = firstConfig.devices || [];
    for (const dev of firstDevices) {
      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'CREATED',
          resourceType: 'device',
          resourceId: dev.mac,
          resourceName: dev.name || dev.mac,
          newValue: dev,
          detectedAt: resolveHistoricalDetectedAt(dev, configsForBootstrap[0].importedAt),
        },
      });
      totalChanges++;
    }

    // Create CREATED entries for clients in first config using first_seen/ObjectId dates.
    const firstClients = firstConfig.clients || [];
    for (const client of firstClients) {
      if (!client.mac) continue;

      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'CREATED',
          resourceType: 'client',
          resourceId: client.mac,
          resourceName: client.name || client.hostname || client.mac,
          newValue: client,
          detectedAt: resolveHistoricalDetectedAt(client, configsForBootstrap[0].importedAt),
        },
      });
      totalChanges++;
    }

    // Do not infer MODIFIED/DELETED history from imported snapshots here.
    // Snapshot import times reflect when we imported data, not when changes occurred.
    // Historical accuracy comes from resource creation timestamps (ObjectId/first_seen)
    // plus UniFi events/alarms collected by the scheduler/bootstrap service.

    // Also bootstrap NetworkClient records from the active config
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    let clientsBootstrapped = 0;
    if (activeConfig) {
      const clients = (activeConfig.configJson as any)?.clients || [];
      const networks = (activeConfig.configJson as any)?.networkConf || [];

      for (const client of clients) {
        if (!client.mac) continue;

        let networkName: string | undefined;
        if (client.network_id) {
          const net = networks.find((n: any) => n._id === client.network_id);
          if (net) networkName = net.name;
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
        clientsBootstrapped++;
      }
    }

    logger.info(`Timeline bootstrapped: ${totalChanges} changes, ${clientsBootstrapped} clients`);

    const response: ApiResponse = {
      success: true,
      data: {
        message: 'Timeline bootstrapped from stored configurations',
        configsCompared: configsForBootstrap.length,
        changesGenerated: totalChanges,
        clientsBootstrapped,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Bootstrap timeline error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'BOOTSTRAP_ERROR', message: 'Failed to bootstrap timeline' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/timeline/bootstrap-clients - Seed client CREATED entries from NetworkClient records
router.post('/bootstrap-clients', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Check if client entries already exist
    const existingClientChanges = await prisma.uniFiConfigChange.count({
      where: { resourceType: 'client' },
    });
    if (existingClientChanges > 0) {
      const response: ApiResponse = {
        success: true,
        data: { message: 'Client history already exists', existingClientChanges },
      };
      res.json(response);
      return;
    }

    const connection = await prisma.uniFiConnection.findFirst();
    const connectionId = connection?.id || 'bootstrap';

    const clients = await prisma.networkClient.findMany();
    let seeded = 0;

    for (const client of clients) {
      const detectedAt = client.unifiFirstSeen || client.lastUpdatedAt;

      await prisma.uniFiConfigChange.create({
        data: {
          connectionId,
          changeType: 'CREATED',
          resourceType: 'client',
          resourceId: client.mac,
          resourceName: client.displayName || client.hostname || client.mac,
          newValue: {
            mac: client.mac,
            hostname: client.hostname,
            displayName: client.displayName,
            oui: client.oui,
            lastIp: client.lastIp,
            lastNetworkName: client.lastNetworkName,
            isWired: client.isWired,
          },
          detectedAt,
        },
      });
      seeded++;
    }

    logger.info(`Bootstrapped ${seeded} client history entries`);
    const response: ApiResponse = {
      success: true,
      data: { message: `Seeded ${seeded} client history entries`, seeded },
    };
    res.json(response);
  } catch (error) {
    logger.error('Bootstrap clients error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'BOOTSTRAP_ERROR', message: 'Failed to bootstrap client history' },
    };
    res.status(500).json(response);
  }
});

export default router;
