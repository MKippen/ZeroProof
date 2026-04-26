import { Router, Request, Response } from 'express';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import {
  ApiResponse,
  NetworkIntentProfile,
  NetworkIntentProfileSchema,
  IntentAnalysisResult,
} from '../../types';
import { analyzeAgainstIntent, IntentDismissalInfo } from '../../analyzers/intentAnalyzer';
import { lookupByIp, lookupByMac, getAllDevices } from '../../services/deviceLookup';
import logger from '../../utils/logger';
import { getRawNetworks, getRawClients } from '../../utils/configNormalizer';

// Helper to fetch active intent gap dismissals
async function getActiveIntentDismissals(): Promise<IntentDismissalInfo[]> {
  const dismissals = await prisma.findingDismissal.findMany({
    where: {
      findingType: 'INTENT_GAP',
      isActive: true,
    },
  });
  return dismissals.map((d) => ({
    id: d.id,
    findingId: d.findingId,
    affectedResource: d.affectedResource,
    reason: d.reason,
  }));
}

const router = Router();

const INTENT_SETTINGS_KEY = 'network_intent_profile';
const INTENT_VERSION = 1;

// GET /api/v1/intent - Get current intent profile
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: INTENT_SETTINGS_KEY },
    });

    logger.info(`Intent profile lookup: ${setting ? 'FOUND' : 'NOT FOUND'}`);

    if (!setting) {
      const response: ApiResponse = {
        success: true,
        data: { profile: null, configured: false },
      };
      res.json(response);
      return;
    }

    const profile = setting.value as unknown as NetworkIntentProfile;

    const response: ApiResponse = {
      success: true,
      data: { profile, configured: true },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get intent profile error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch intent profile' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/intent - Save intent profile
router.post(
  '/',
  requireAuth,
  validate(NetworkIntentProfileSchema),
  async (req: Request, res: Response) => {
    try {
      const profile: NetworkIntentProfile = {
        ...req.body,
        workIsolationMode: req.body.workIsolationMode || 'phased',
        reachabilityOverrides: Array.isArray(req.body.reachabilityOverrides)
          ? req.body.reachabilityOverrides
          : [],
        completedAt: new Date().toISOString(),
        version: INTENT_VERSION,
      };

      await prisma.setting.upsert({
        where: { key: INTENT_SETTINGS_KEY },
        create: { key: INTENT_SETTINGS_KEY, value: profile as object },
        update: { value: profile as object },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: req.session.userId,
          action: 'INTENT_PROFILE_UPDATE',
          details: { securityLevel: profile.securityLevel },
          ipAddress: req.ip,
        },
      });

      logger.info(`Intent profile updated: security level ${profile.securityLevel}`);

      // Trigger re-analysis if there's an active config
      const activeConfig = await prisma.configuration.findFirst({
        where: { isActive: true },
      });

      let analysisResult: IntentAnalysisResult | null = null;
      if (activeConfig) {
        const dismissals = await getActiveIntentDismissals();
        analysisResult = analyzeAgainstIntent(
          activeConfig.configJson as object,
          profile,
          dismissals
        );
      }

      const response: ApiResponse = {
        success: true,
        data: {
          profile,
          analysis: analysisResult,
        },
      };
      res.json(response);
    } catch (error) {
      logger.error('Save intent profile error:', error);
      const response: ApiResponse = {
        success: false,
        error: { code: 'SAVE_ERROR', message: 'Failed to save intent profile' },
      };
      res.status(500).json(response);
    }
  }
);

// GET /api/v1/intent/analysis - Get intent vs config analysis
router.get('/analysis', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Get intent profile
    const intentSetting = await prisma.setting.findUnique({
      where: { key: INTENT_SETTINGS_KEY },
    });

    if (!intentSetting) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NO_INTENT',
          message: 'No intent profile configured. Complete the wizard first.',
        },
      };
      res.status(400).json(response);
      return;
    }

    // Get active configuration, or most recent if none is active
    let activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    // If no active config, get the most recent one
    if (!activeConfig) {
      activeConfig = await prisma.configuration.findFirst({
        orderBy: { importedAt: 'desc' },
      });
    }

    if (!activeConfig) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NO_CONFIG',
          message: 'No active configuration. Import or sync a UniFi config first.',
        },
      };
      res.status(400).json(response);
      return;
    }

    const profile = intentSetting.value as unknown as NetworkIntentProfile;
    const dismissals = await getActiveIntentDismissals();
    const analysisResult = analyzeAgainstIntent(
      activeConfig.configJson as object,
      profile,
      dismissals
    );

    const response: ApiResponse = {
      success: true,
      data: {
        ...analysisResult,
        configImportedAt: activeConfig.importedAt.toISOString(),
        configSiteName: activeConfig.siteName,
        analyzedAt: new Date().toISOString(),
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Intent analysis error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'ANALYSIS_ERROR', message: 'Failed to analyze intent compliance' },
    };
    res.status(500).json(response);
  }
});


// GET /api/v1/intent/networks - Get available networks for mapping
router.get('/networks', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Get active configuration, or most recent if none is active
    let activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    // If no active config, get the most recent one
    if (!activeConfig) {
      activeConfig = await prisma.configuration.findFirst({
        orderBy: { importedAt: 'desc' },
      });
    }

    if (!activeConfig) {
      const response: ApiResponse = {
        success: true,
        data: { networks: [], hasConfig: false },
      };
      res.json(response);
      return;
    }

    const config = activeConfig.configJson as any;

    // Networks might be under different keys depending on UniFi version
    const rawNetworks = getRawNetworks(config);

    const networks = rawNetworks.map((n: any) => ({
      _id: n._id || n.id || n.network_id,
      name: n.name || n.network_name || 'Unknown',
      purpose: n.purpose || n.network_purpose || 'corporate',
      vlan: n.vlan || n.vlan_id,
      vlan_enabled: n.vlan_enabled ?? (n.vlan ? true : false),
      subnet: n.subnet || n.ip_subnet,
    }));

    logger.debug(`Found ${networks.length} networks in config`);

    const response: ApiResponse = {
      success: true,
      data: { networks, hasConfig: true },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get networks error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch networks' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/intent/devices - Get discovered devices for mapping
router.get('/devices', requireAuth, async (_req: Request, res: Response) => {
  try {
    // Get active configuration, or most recent if none is active
    let activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig) {
      activeConfig = await prisma.configuration.findFirst({
        orderBy: { importedAt: 'desc' },
      });
    }

    if (!activeConfig) {
      const response: ApiResponse = {
        success: true,
        data: { devices: [], hasConfig: false },
      };
      res.json(response);
      return;
    }

    const config = activeConfig.configJson as any;

    // Get networks for name lookup
    const rawNetworks2 = getRawNetworks(config);
    const networkMap = new Map<string, string>();
    rawNetworks2.forEach((n: any) => {
      const id = n._id || n.id;
      if (id) networkMap.set(id, n.name || 'Unknown');
    });

    // Clients/devices might be under different keys
    const rawClients = getRawClients(config);

    const devices = rawClients.map((c: any) => ({
      mac: c.mac || c._id,
      ip: c.ip || c.last_ip || c.fixed_ip,
      name: c.name || c.hostname || c.display_name,
      hostname: c.hostname,
      networkId: c.network_id || c.usergroup_id,
      networkName: c.network_id ? networkMap.get(c.network_id) : undefined,
      oui: c.oui,
      isWired: c.is_wired ?? (c.connection_type === 'wired'),
      lastSeen: c.last_seen ? new Date(c.last_seen * 1000).toISOString() : undefined,
    }));

    // Sort by name, then by IP
    devices.sort((a: any, b: any) => {
      if (a.name && b.name) return a.name.localeCompare(b.name);
      if (a.name) return -1;
      if (b.name) return 1;
      if (a.ip && b.ip) return a.ip.localeCompare(b.ip);
      return 0;
    });

    logger.debug(`Found ${devices.length} devices in config`);

    const response: ApiResponse = {
      success: true,
      data: { devices, hasConfig: true },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get devices error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch devices' },
    };
    res.status(500).json(response);
  }
});

// PATCH /api/v1/intent/mappings - Update network and device mappings
router.patch('/mappings', requireAuth, async (req: Request, res: Response) => {
  try {
    const intentSetting = await prisma.setting.findUnique({
      where: { key: INTENT_SETTINGS_KEY },
    });

    if (!intentSetting) {
      const response: ApiResponse = {
        success: false,
        error: {
          code: 'NO_INTENT',
          message: 'No intent profile configured. Complete the wizard first.',
        },
      };
      res.status(400).json(response);
      return;
    }

    const profile = intentSetting.value as unknown as NetworkIntentProfile;
    const { deviceMappings: newDeviceMappings, ...networkMappings } = req.body;

    const updatedProfile: NetworkIntentProfile = {
      ...profile,
      networkMappings: {
        ...profile.networkMappings,
        ...networkMappings,
      },
      deviceMappings: newDeviceMappings
        ? {
            ...profile.deviceMappings,
            ...newDeviceMappings,
          }
        : profile.deviceMappings,
    };

    await prisma.setting.update({
      where: { key: INTENT_SETTINGS_KEY },
      data: { value: updatedProfile as object },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'INTENT_MAPPINGS_UPDATE',
        details: req.body,
        ipAddress: req.ip,
      },
    });

    logger.info('Intent network mappings updated');

    // Re-analyze with updated mappings
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    let analysisResult: IntentAnalysisResult | null = null;
    if (activeConfig) {
      const dismissals = await getActiveIntentDismissals();
      analysisResult = analyzeAgainstIntent(
        activeConfig.configJson as object,
        updatedProfile,
        dismissals
      );
    }

    const response: ApiResponse = {
      success: true,
      data: {
        profile: updatedProfile,
        analysis: analysisResult,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Update mappings error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update network mappings' },
    };
    res.status(500).json(response);
  }
});

// DELETE /api/v1/intent - Delete intent profile
router.delete('/', requireAuth, async (req: Request, res: Response) => {
  try {
    await prisma.setting.delete({
      where: { key: INTENT_SETTINGS_KEY },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'INTENT_PROFILE_DELETE',
        ipAddress: req.ip,
      },
    });

    logger.info('Intent profile deleted');

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Delete intent profile error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete intent profile' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/intent/device-lookup/:ipOrMac - Look up device by IP or MAC
router.get('/device-lookup/:ipOrMac', requireAuth, async (req: Request, res: Response) => {
  try {
    const { ipOrMac } = req.params;

    // Determine if it's IP or MAC and look up accordingly
    let device;
    if (ipOrMac.includes(':') || ipOrMac.length === 12) {
      device = await lookupByMac(ipOrMac);
    } else {
      device = await lookupByIp(ipOrMac);
    }

    if (!device) {
      const response: ApiResponse = {
        success: true,
        data: { device: null, found: false },
      };
      res.json(response);
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: { device, found: true },
    };
    res.json(response);
  } catch (error) {
    logger.error('Device lookup error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'LOOKUP_ERROR', message: 'Failed to lookup device' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/intent/all-devices - Get all known devices from UniFi config
router.get('/all-devices', requireAuth, async (_req: Request, res: Response) => {
  try {
    const devices = await getAllDevices();

    const response: ApiResponse = {
      success: true,
      data: { devices, count: devices.length },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get all devices error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch devices' },
    };
    res.status(500).json(response);
  }
});

export default router;
