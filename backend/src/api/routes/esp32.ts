import { Router, Request, Response } from 'express';
import { readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import os from 'os';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ApiResponse, ESP32ProvisionSchema, FirmwareInfo, WlanInfo } from '../../types';
import logger from '../../utils/logger';
import { getVlanCoverage } from '../../services/vlanCoverageService';
import config from '../../config';

// Extended WLAN info with VLAN coverage
interface EnhancedWlanInfo extends WlanInfo {
  networkId?: string;
  vlanId?: number;
  vlanName?: string;
  intentCategory?: string;
  isVlanCovered: boolean;
  isCaptivePortal?: boolean;
}

const router = Router();

const FIRMWARE_DIR = path.join(__dirname, '../../../firmware');
const FIRMWARE_JSON = path.join(FIRMWARE_DIR, 'firmware.json');

function getAdvertisedHostIp(): string {
  const hostIp = process.env.HOST_IP?.trim();
  if (hostIp) return hostIp;

  const interfaces = os.networkInterfaces();
  let serverIp = '127.0.0.1';

  // Find the first non-internal IPv4 address
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        serverIp = iface.address;
        break;
      }
    }
    if (serverIp !== '127.0.0.1') break;
  }

  return serverIp;
}

function isDockerInternalBrokerHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === '' ||
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'mosquitto' ||
    normalized === 'host.docker.internal'
  );
}

// GET /api/v1/esp32/firmware - Serve merged firmware binary (for initial flash via USB)
// No auth required - ESP32 devices need to download without session cookies
router.get('/firmware', async (_req: Request, res: Response) => {
  try {
    // Read firmware metadata
    const metadataPath = FIRMWARE_JSON;
    if (!existsSync(metadataPath)) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Firmware metadata not found' },
      };
      res.status(404).json(response);
      return;
    }

    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8')) as FirmwareInfo;
    const firmwarePath = path.join(FIRMWARE_DIR, metadata.filename);

    if (!existsSync(firmwarePath)) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Firmware binary not found' },
      };
      res.status(404).json(response);
      return;
    }

    const firmware = await readFile(firmwarePath);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${metadata.filename}"`,
      'Content-Length': firmware.length.toString(),
      'X-Firmware-Version': metadata.version,
      'X-Firmware-Checksum': metadata.checksum,
    });
    res.send(firmware);
  } catch (error) {
    logger.error('Get firmware error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch firmware' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/esp32/firmware/info - Firmware metadata
router.get('/firmware/info', requireAuth, async (_req: Request, res: Response) => {
  try {
    const metadataPath = FIRMWARE_JSON;
    if (!existsSync(metadataPath)) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Firmware metadata not found' },
      };
      res.status(404).json(response);
      return;
    }

    const metadata = JSON.parse(await readFile(metadataPath, 'utf-8')) as FirmwareInfo;
    const firmwarePath = path.join(FIRMWARE_DIR, metadata.filename);

    // Get actual file size if firmware exists
    let actualSize = 0;
    if (existsSync(firmwarePath)) {
      const stats = await stat(firmwarePath);
      actualSize = stats.size;
    }

    const response: ApiResponse<{ firmware: FirmwareInfo; available: boolean }> = {
      success: true,
      data: {
        firmware: {
          ...metadata,
          size: actualSize,
        },
        available: actualSize > 0,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get firmware info error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch firmware info' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/esp32/wlans - List SSIDs from active UniFi config
// Query params:
//   includePassword=true - include passwords (for ESP32 setup)
//   includeVlanCoverage=true - include VLAN coverage info
router.get('/wlans', requireAuth, async (req: Request, res: Response) => {
  try {
    const includePassword = req.query.includePassword === 'true';
    const includeVlanCoverage = req.query.includeVlanCoverage === 'true';

    // Get active configuration
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    if (!activeConfig || !activeConfig.configJson) {
      const response: ApiResponse<{ wlans: (WlanInfo | EnhancedWlanInfo)[] }> = {
        success: true,
        data: { wlans: [] },
      };
      res.json(response);
      return;
    }

    // Parse config and extract WLANs
    // Support various key formats from different UniFi config sources
    const configJson = activeConfig.configJson as Record<string, unknown>;
    const wlanConf =
      (configJson.wlans as Array<Record<string, unknown>>) ||
      (configJson.wlanConf as Array<Record<string, unknown>>) ||
      (configJson.wlanconf as Array<Record<string, unknown>>) ||
      (configJson.data as Record<string, unknown>)?.wlanconf ||
      [];

    // Get VLAN coverage if requested
    let vlanCoverage: Awaited<ReturnType<typeof getVlanCoverage>> | null = null;
    if (includeVlanCoverage) {
      vlanCoverage = await getVlanCoverage();
    }

    // Get networks for VLAN info
    const networks =
      (configJson.networks as Array<Record<string, unknown>>) ||
      (configJson.networkConf as Array<Record<string, unknown>>) ||
      (configJson.networkconf as Array<Record<string, unknown>>) ||
      [];

    // Build network lookup
    const networkById = new Map<string, { name: string; vlanId: number | null }>();
    for (const n of networks) {
      const id = (n._id as string) || (n.id as string);
      if (id) {
        networkById.set(id, {
          name: (n.name as string) || 'Unknown',
          vlanId: (n.vlan as number) ?? (n.vlan_id as number) ?? null,
        });
      }
    }

    const wlans: (WlanInfo | EnhancedWlanInfo)[] = (Array.isArray(wlanConf) ? wlanConf : [])
      .filter((w) => w.enabled !== false)
      .map((w) => {
        const networkId = w.networkconf_id as string | undefined;
        const networkInfo = networkId ? networkById.get(networkId) : null;

        const wlan: WlanInfo | EnhancedWlanInfo = {
          ssid: (w.name as string) || (w.ssid as string) || 'Unknown SSID',
          security: (w.security as string) || (w.wpa_mode as string) || 'open',
          isGuest: Boolean(w.is_guest) || w.guest_policy === 'allow',
        };

        // Only include password when explicitly requested (for ESP32 provisioning)
        if (includePassword) {
          wlan.password = (w.x_passphrase as string) || (w.passphrase as string) || '';
        }

        // Add VLAN coverage info if requested
        if (includeVlanCoverage && vlanCoverage) {
          const enhancedWlan = wlan as EnhancedWlanInfo;
          enhancedWlan.networkId = networkId;
          enhancedWlan.vlanId = networkInfo?.vlanId ?? undefined;
          enhancedWlan.vlanName = networkInfo?.name;

          // Check if this VLAN is covered
          const vlanInfo = networkId
            ? vlanCoverage.vlans.find((v) => v.networkId === networkId)
            : null;

          enhancedWlan.isVlanCovered = vlanInfo?.hasCoverage ?? true; // Default to covered if not in mapped VLANs
          enhancedWlan.intentCategory = vlanInfo?.intentCategory ?? undefined;
          enhancedWlan.isCaptivePortal = vlanInfo?.isCaptivePortal ?? false;
        }

        return wlan;
      });

    // Log access to passwords for security auditing
    if (includePassword) {
      await prisma.auditLog.create({
        data: {
          userId: req.session.userId,
          action: 'ESP32_WLAN_PASSWORD_ACCESS',
          resource: 'wlans',
          details: { ssids: wlans.map((w) => w.ssid) },
          ipAddress: req.ip,
        },
      });
    }

    const response: ApiResponse<{
      wlans: (WlanInfo | EnhancedWlanInfo)[];
      vlanCoverageSummary?: { totalVlans: number; coveredVlans: number };
    }> = {
      success: true,
      data: {
        wlans,
        ...(includeVlanCoverage && vlanCoverage
          ? { vlanCoverageSummary: vlanCoverage.summary }
          : {}),
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get WLANs error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch WLANs' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/esp32/provision - Pre-register device with name and deviceId
router.post(
  '/provision',
  requireAuth,
  validate(ESP32ProvisionSchema),
  async (req: Request, res: Response) => {
    try {
      const { deviceId, name, macAddress } = req.body;

      // Check if device already exists
      const existing = await prisma.device.findUnique({
        where: { deviceId },
      });

      if (existing) {
        // Update existing device
        await prisma.device.update({
          where: { deviceId },
          data: {
            name,
            macAddress,
            status: 'OFFLINE',
          },
        });
      } else {
        // Create new device
        await prisma.device.create({
          data: {
            deviceId,
            name,
            macAddress,
            status: 'OFFLINE',
          },
        });
      }

      await prisma.auditLog.create({
        data: {
          userId: req.session.userId,
          action: 'ESP32_PROVISION',
          resource: deviceId,
          details: { name, macAddress },
          ipAddress: req.ip,
        },
      });

      const response: ApiResponse<{ deviceId: string }> = {
        success: true,
        data: { deviceId },
      };
      res.json(response);
    } catch (error) {
      logger.error('Provision device error:', error);
      const response: ApiResponse = {
        success: false,
        error: { code: 'PROVISION_ERROR', message: 'Failed to provision device' },
      };
      res.status(500).json(response);
    }
  }
);

// GET /api/v1/esp32/mqtt-config - Get MQTT connection settings for device setup
router.get('/mqtt-config', requireAuth, async (_req: Request, res: Response) => {
  try {
    const serverIp = getAdvertisedHostIp();
    const configuredBroker = (config.MQTT_BROKER || '').trim();
    const broker = isDockerInternalBrokerHost(configuredBroker)
      ? serverIp
      : configuredBroker || serverIp;

    // Get MQTT settings from environment
    const mqttConfig = {
      broker,
      port: parseInt(process.env.MQTT_PORT || '1883'),
      username: process.env.MQTT_USERNAME || '',
      password: process.env.MQTT_PASSWORD || '',
    };

    const response: ApiResponse<typeof mqttConfig> = {
      success: true,
      data: mqttConfig,
    };
    res.json(response);
  } catch (error) {
    logger.error('Get MQTT config error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to get MQTT configuration' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/esp32/debug - Log debug messages from frontend WebSerial
router.post('/debug', requireAuth, async (req: Request, res: Response) => {
  try {
    const { level, message, data } = req.body;
    const logLevel = level || 'debug';
    const logMessage = `[WebSerial] ${message}`;

    // Log based on level
    if (logLevel === 'error') {
      logger.error(logMessage, data || {});
    } else if (logLevel === 'warn') {
      logger.warn(logMessage, data || {});
    } else {
      logger.info(logMessage, data || {});
    }

    res.json({ success: true });
  } catch {
    res.json({ success: true }); // Don't fail on debug logging
  }
});

// GET /api/v1/esp32/verify/:deviceId - Check if device connected via MQTT
router.get('/verify/:deviceId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { deviceId } = req.params;

    const device = await prisma.device.findUnique({
      where: { deviceId },
      select: {
        deviceId: true,
        name: true,
        status: true,
        ipAddress: true,
        firmwareVersion: true,
        lastSeen: true,
      },
    });

    if (!device) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      };
      res.status(404).json(response);
      return;
    }

    const isOnline = device.status === 'ONLINE';
    const response: ApiResponse<{
      deviceId: string;
      name: string;
      isOnline: boolean;
      ipAddress: string | null;
      firmwareVersion: string | null;
      lastSeen: Date | null;
    }> = {
      success: true,
      data: {
        deviceId: device.deviceId,
        name: device.name,
        isOnline,
        ipAddress: device.ipAddress,
        firmwareVersion: device.firmwareVersion,
        lastSeen: device.lastSeen,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Verify device error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'VERIFY_ERROR', message: 'Failed to verify device' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/esp32/validate-connectivity/:ssid - Check if a WLAN can reach the server (by SSID)
router.get('/validate-connectivity/:ssid', requireAuth, async (req: Request, res: Response) => {
  try {
    const { ssid } = req.params;

    // Dynamically import to avoid circular dependencies
    const { validateNetworkConnectivity } = await import('../../services/networkConnectivityService');

    const result = await validateNetworkConnectivity(ssid, true);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
    };
    res.json(response);
  } catch (error) {
    logger.error('Validate connectivity error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Failed to validate network connectivity' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/esp32/validate-device-connectivity - Check if a device IP/MAC can reach the server
router.post('/validate-device-connectivity', requireAuth, async (req: Request, res: Response) => {
  try {
    const { deviceIp, deviceMac } = req.body;

    if (!deviceIp) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Device IP is required' },
      };
      res.status(400).json(response);
      return;
    }

    // Dynamically import to avoid circular dependencies
    const { validateDeviceConnectivity } = await import('../../services/networkConnectivityService');

    const result = await validateDeviceConnectivity(deviceIp, deviceMac);

    const response: ApiResponse<typeof result> = {
      success: true,
      data: result,
    };
    res.json(response);
  } catch (error) {
    logger.error('Validate device connectivity error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Failed to validate device connectivity' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/esp32/server-info - Get server IP and network info
router.get('/server-info', requireAuth, async (_req: Request, res: Response) => {
  try {
    const { getServerIp } = await import('../../services/networkConnectivityService');

    const serverIp = getServerIp();

    // Get MQTT port from environment
    const mqttPort = parseInt(config.MQTT_PORT || '1883', 10);
    const apiPort = parseInt(config.PORT || '3000', 10);

    const response: ApiResponse<{
      serverIp: string;
      mqttPort: number;
      apiPort: number;
    }> = {
      success: true,
      data: {
        serverIp,
        mqttPort,
        apiPort,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get server info error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to get server info' },
    };
    res.status(500).json(response);
  }
});

export default router;
