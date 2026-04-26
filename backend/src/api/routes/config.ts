import { Router, Request, Response } from 'express';
import multer from 'multer';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { ApiResponse, UniFiConfig, NetworkIntentProfile } from '../../types';
import { hashConfig } from '../../utils/encryption';
import { analyzeConfiguration } from '../../analyzers';
import { clearDeviceLookupCache } from '../../services/deviceLookup';
import { getHoneypots } from '../../services/honeypotService';
import { analyzeTopology } from '../../services/topologyAnalyzer';
import logger from '../../utils/logger';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only JSON files are allowed'));
    }
  },
});

// POST /api/v1/config/import
router.post(
  '/import',
  requireAuth,
  upload.single('config'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        const response: ApiResponse = {
          success: false,
          error: { code: 'NO_FILE', message: 'No configuration file provided' },
        };
        res.status(400).json(response);
        return;
      }

      let configData: UniFiConfig;
      try {
        configData = JSON.parse(req.file.buffer.toString('utf-8'));
      } catch {
        const response: ApiResponse = {
          success: false,
          error: { code: 'INVALID_JSON', message: 'Invalid JSON file' },
        };
        res.status(400).json(response);
        return;
      }

      // Calculate hash to detect duplicates
      const configHash = hashConfig(configData);

      // Check for existing config with same hash
      const existing = await prisma.configuration.findUnique({
        where: { configHash },
      });

      if (existing) {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'DUPLICATE_CONFIG',
            message: 'This configuration has already been imported',
          },
        };
        res.status(409).json(response);
        return;
      }

      // Extract site information
      const siteName = configData.site?.name || 'Unknown Site';
      const controllerVersion = configData.version || 'Unknown';

      // Set all other configs as inactive
      await prisma.configuration.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      });

      // Create new configuration
      const config = await prisma.configuration.create({
        data: {
          configHash,
          siteName,
          controllerVersion,
          configJson: configData as object,
          notes: req.body.notes || null,
          isActive: true,
        },
      });

      // Clear device lookup cache so new config data is used
      clearDeviceLookupCache();

      // Run static analysis
      const vulnerabilities = await analyzeConfiguration(configData, config.id);

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: req.session.userId,
          action: 'CONFIG_IMPORT',
          resource: config.id,
          details: { siteName, vulnerabilitiesFound: vulnerabilities.length },
          ipAddress: req.ip,
        },
      });

      logger.info(`Configuration imported: ${siteName}, found ${vulnerabilities.length} issues`);

      const response: ApiResponse = {
        success: true,
        data: {
          config: {
            id: config.id,
            siteName,
            controllerVersion,
            importedAt: config.importedAt,
          },
          analysis: {
            vulnerabilitiesFound: vulnerabilities.length,
            criticalCount: vulnerabilities.filter((v) => v.severity === 'CRITICAL').length,
            highCount: vulnerabilities.filter((v) => v.severity === 'HIGH').length,
            mediumCount: vulnerabilities.filter((v) => v.severity === 'MEDIUM').length,
            lowCount: vulnerabilities.filter((v) => v.severity === 'LOW').length,
          },
        },
      };
      res.json(response);
    } catch (error) {
      logger.error('Config import error:', error);
      const response: ApiResponse = {
        success: false,
        error: { code: 'IMPORT_ERROR', message: 'Failed to import configuration' },
      };
      res.status(500).json(response);
    }
  }
);

// GET /api/v1/config/current
router.get('/current', requireAuth, async (_req: Request, res: Response) => {
  try {
    const config = await prisma.configuration.findFirst({
      where: { isActive: true },
      include: {
        _count: { select: { vulnerabilities: true, testRuns: true } },
      },
    });

    if (!config) {
      const response: ApiResponse = {
        success: true,
        data: { config: null },
      };
      res.json(response);
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: {
        config: {
          id: config.id,
          siteName: config.siteName,
          controllerVersion: config.controllerVersion,
          importedAt: config.importedAt,
          notes: config.notes,
          vulnerabilityCount: config._count.vulnerabilities,
          testRunCount: config._count.testRuns,
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get current config error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch configuration' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/config/history
router.get('/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [configs, total] = await Promise.all([
      prisma.configuration.findMany({
        orderBy: { importedAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          siteName: true,
          controllerVersion: true,
          importedAt: true,
          isActive: true,
          notes: true,
          _count: { select: { vulnerabilities: true } },
        },
      }),
      prisma.configuration.count(),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        configs: configs.map((c) => ({
          ...c,
          vulnerabilityCount: c._count.vulnerabilities,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get config history error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch configuration history' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/config/honeypots
// NOTE: This must be defined BEFORE /:id route
router.get('/honeypots', requireAuth, async (_req: Request, res: Response) => {
  try {
    const honeypots = await getHoneypots();

    const response: ApiResponse = {
      success: true,
      data: { honeypots },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get honeypots error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch honeypots' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/config/topology
// NOTE: This must be defined BEFORE /:id route
router.get('/topology', requireAuth, async (_req: Request, res: Response) => {
  try {
    const config = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    logger.debug(`Topology: found config = ${config ? config.id : 'null'}`);

    if (!config) {
      const response: ApiResponse = {
        success: true,
        data: { config: null },
      };
      res.json(response);
      return;
    }

    const configJson = config.configJson as any;
    logger.debug(`Topology: configJson keys = ${Object.keys(configJson).join(', ')}`);

    // Extract VLANs from networks (synced) or networkconf (backup file) or networkConf (connection sync)
    const networkconf = (configJson.networks || configJson.networkConf || configJson.networkconf || configJson.data?.networkconf || []) as any[];
    const vlans = networkconf.map((n: any) => ({
      id: n._id || n.id,
      name: n.name || 'Unnamed',
      vlanId: n.vlan || n.vlan_id || null,
      subnet: n.ip_subnet || null,
      dhcpEnabled: n.dhcpd_enabled || n.dhcp_enabled || false,
      purpose: n.purpose || 'default',
      networkGroup: n.networkgroup || n.network_group || 'LAN',
    }));

    // Extract WLANs from wlans (synced) or wlanconf (backup file) or wlanConf (connection sync)
    const wlanconf = (configJson.wlans || configJson.wlanConf || configJson.wlanconf || configJson.data?.wlanconf || []) as any[];
    const wlans = wlanconf.map((w: any) => ({
      id: w._id || w.id,
      name: w.name || 'Unnamed',
      ssid: w.name || w.ssid || 'Unknown SSID',
      security: w.security || w.wpa_mode || 'open',
      networkId: w.networkconf_id || null,
      vlanId: w.vlan || null,
      enabled: w.enabled !== false,
      isGuest: w.is_guest || w.guest_policy === 'allow' || false,
    }));

    // Extract legacy firewall rules (synced uses firewallRules, backup uses firewallrule)
    const firewallrule = (configJson.firewallRules || configJson.firewallrule || configJson.data?.firewallrule || []) as any[];
    const legacyRules = firewallrule.map((r: any) => ({
      id: r._id || r.id,
      name: r.name || r.description || 'Unnamed',
      action: r.action || 'drop',
      enabled: r.enabled !== false,
      srcNetwork: r.src_network || r.src_networkconf_id || null,
      dstNetwork: r.dst_network || r.dst_networkconf_id || null,
      protocol: r.protocol || 'all',
      dstPort: r.dst_port || null,
      ruleIndex: r.rule_index || 0,
    }));

    // Extract V2 firewall policies (UniFi Network 7.x+)
    const firewallpolicy = (configJson.firewallPolicies || configJson.firewallpolicy || []) as any[];
    const policyRules = firewallpolicy.map((p: any) => ({
      id: p._id || p.id,
      name: p.name || p.description || 'Unnamed Policy',
      action: (p.action || 'BLOCK').toLowerCase(),
      enabled: p.enabled !== false,
      srcNetwork: p.source?.zone_id || null,
      dstNetwork: p.destination?.zone_id || null,
      protocol: p.protocol || 'all',
      dstPort: p.destination?.port_ranges?.join(',') || null,
      ruleIndex: p.index || 0,
    }));

    // Combine legacy rules and policies
    const firewallRules = [...legacyRules, ...policyRules];

    logger.debug(`Topology: ${legacyRules.length} legacy rules, ${policyRules.length} policies = ${firewallRules.length} total`);

    // Extract port forwards (synced uses portForwards, connection sync uses portForward, backup uses portforward)
    const portforward = (configJson.portForwards || configJson.portForward || configJson.portforward || configJson.data?.portforward || []) as any[];
    logger.debug(`Topology: ${portforward.length} port forwards found`);
    const portForwards = portforward.map((p: any) => ({
      id: p._id || p.id,
      name: p.name || 'Unnamed',
      enabled: p.enabled !== false,
      srcPort: p.src_port || p.dst_port || '',
      dstPort: p.fwd_port || p.dst_port || '',
      fwdIp: p.fwd || p.fwd_ip || '',
      protocol: p.proto || 'tcp',
    }));

    // Extract devices (synced uses devices, backup uses device)
    const devices = (configJson.devices || configJson.device || configJson.data?.device || []) as any[];
    const deviceList = devices.map((d: any) => ({
      id: d._id || d.id,
      name: d.name || d.hostname || 'Unknown',
      model: d.model || 'Unknown',
      type: d.type || 'unknown',
    }));

    // Count clients (synced uses clients, backup uses sta)
    const clients = (configJson.clients || configJson.sta || configJson.data?.sta || []) as any[];

    const response: ApiResponse = {
      success: true,
      data: {
        config: {
          vlans,
          wlans,
          firewallRules,
          portForwards,
          devices: deviceList,
          clients: clients.length,
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get topology error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch topology' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/config/topology/connectivity - Get network connectivity matrix
// NOTE: This must be defined BEFORE /:id route
router.get('/topology/connectivity', requireAuth, async (_req: Request, res: Response) => {
  try {
    const config = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!config) {
      const response: ApiResponse = {
        success: true,
        data: { connectivity: null },
      };
      res.json(response);
      return;
    }

    // Get intent profile to check for isolation requirements
    const intentSetting = await prisma.setting.findUnique({
      where: { key: 'network_intent_profile' },
    });
    const intentProfile = intentSetting?.value as NetworkIntentProfile | null;

    // Use the topology analyzer service
    logger.debug(`Topology connectivity: analyzing config with keys: ${Object.keys(config.configJson as object).join(', ')}`);
    const analysis = analyzeTopology(config.configJson, intentProfile);

    // Log what we're returning
    logger.info(`Topology connectivity result: ${analysis.networks.length} networks, ${analysis.connections.length} connections, ${analysis.explicitRoutes.length} explicit routes, ${analysis.deviceGroups.length} device groups`);
    if (analysis.explicitRoutes.length > 0) {
      logger.debug(`Explicit routes: ${JSON.stringify(analysis.explicitRoutes.slice(0, 3))}`);
    }
    if (analysis.deviceGroups.length > 0) {
      logger.debug(`Device groups: ${analysis.deviceGroups.map(g => `${g.label}(${g.devices.length})`).join(', ')}`);
    }

    const response: ApiResponse = {
      success: true,
      data: {
        connectivity: {
          networks: analysis.networks,
          connections: analysis.connections,
          explicitRoutes: analysis.explicitRoutes,
          warnings: analysis.warnings,
          deviceGroups: analysis.deviceGroups,
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get topology connectivity error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch connectivity data' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/config/:id
// NOTE: This catch-all route MUST be after all specific routes like /topology, /honeypots
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await prisma.configuration.findUnique({
      where: { id: req.params.id },
      include: {
        vulnerabilities: {
          where: { status: 'OPEN' },
          orderBy: [{ severity: 'asc' }, { firstSeen: 'desc' }],
          take: 10,
        },
      },
    });

    if (!config) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Configuration not found' },
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: { config },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get config error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch configuration' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/config/:id/activate
router.post('/:id/activate', requireAuth, async (req: Request, res: Response) => {
  try {
    const config = await prisma.configuration.findUnique({
      where: { id: req.params.id },
    });

    if (!config) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Configuration not found' },
      };
      res.status(404).json(response);
      return;
    }

    // Deactivate all, activate this one
    await prisma.$transaction([
      prisma.configuration.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      }),
      prisma.configuration.update({
        where: { id: req.params.id },
        data: { isActive: true },
      }),
    ]);

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Activate config error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'ACTIVATE_ERROR', message: 'Failed to activate configuration' },
    };
    res.status(500).json(response);
  }
});

export default router;
