import { Router, Request, Response } from 'express';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ApiResponse, DeviceWifiSchema } from '../../types';
import { encrypt } from '../../utils/encryption';
import { mqttClient } from '../../mqtt';
import logger from '../../utils/logger';
import { getVlanCoverage } from '../../services/vlanCoverageService';
import { getNetworkAccessRules } from '../../services/deviceAccessRules';

const router = Router();

// GET /api/v1/devices/vlan-coverage - Get VLAN coverage information
router.get('/vlan-coverage', requireAuth, async (_req: Request, res: Response) => {
  try {
    const coverage = await getVlanCoverage();

    // Enrich with access rules for each VLAN
    const vlansWithRules = await Promise.all(
      coverage.vlans.map(async (vlan) => {
        const accessRules = await getNetworkAccessRules(vlan.networkId);
        return {
          ...vlan,
          accessRules,
        };
      })
    );

    const response: ApiResponse = {
      success: true,
      data: {
        vlans: vlansWithRules,
        summary: coverage.summary,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get VLAN coverage error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch VLAN coverage' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/devices
router.get('/', requireAuth, async (_req: Request, res: Response) => {
  try {
    const devices = await prisma.device.findMany({
      orderBy: { name: 'asc' },
      include: {
        credentials: {
          select: { ssid: true, configured: true },
        },
        _count: { select: { testRuns: true } },
      },
    });

    const response: ApiResponse = {
      success: true,
      data: {
        devices: devices.map((d) => ({
          id: d.id,
          deviceId: d.deviceId,
          name: d.name,
          macAddress: d.macAddress,
          ipAddress: d.ipAddress,
          firmwareVersion: d.firmwareVersion,
          status: d.status,
          lastSeen: d.lastSeen,
          configuredNetworks: d.credentials.filter((c) => c.configured).map((c) => c.ssid),
          testRunCount: d._count.testRuns,
        })),
      },
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

// GET /api/v1/devices/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
      include: {
        credentials: {
          select: { ssid: true, configured: true },
        },
        testRuns: {
          orderBy: { startedAt: 'desc' },
          take: 10,
          select: {
            id: true,
            testType: true,
            status: true,
            startedAt: true,
            completedAt: true,
          },
        },
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

    const response: ApiResponse = {
      success: true,
      data: { device },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get device error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch device' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/devices/:id/wifi
router.post(
  '/:id/wifi',
  requireAuth,
  validate(DeviceWifiSchema),
  async (req: Request, res: Response) => {
    try {
      const device = await prisma.device.findUnique({
        where: { id: req.params.id },
      });

      if (!device) {
        const response: ApiResponse = {
          success: false,
          error: { code: 'NOT_FOUND', message: 'Device not found' },
        };
        res.status(404).json(response);
        return;
      }

      const { ssid, password } = req.body;
      const encryptedPassword = encrypt(password);

      await prisma.wifiCredential.upsert({
        where: {
          deviceId_ssid: { deviceId: device.id, ssid },
        },
        update: {
          passwordEnc: encryptedPassword,
          configured: false,
        },
        create: {
          deviceId: device.id,
          ssid,
          passwordEnc: encryptedPassword,
          configured: false,
        },
      });

      // Send configuration to device via MQTT
      mqttClient.sendWifiConfig(device.deviceId, ssid, password);

      await prisma.auditLog.create({
        data: {
          userId: req.session.userId,
          action: 'DEVICE_WIFI_CONFIG',
          resource: device.id,
          details: { ssid },
          ipAddress: req.ip,
        },
      });

      const response: ApiResponse = { success: true };
      res.json(response);
    } catch (error) {
      logger.error('Configure WiFi error:', error);
      const response: ApiResponse = {
        success: false,
        error: { code: 'CONFIG_ERROR', message: 'Failed to configure WiFi' },
      };
      res.status(500).json(response);
    }
  }
);

// PATCH /api/v1/devices/:id - Update device name
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INVALID_NAME', message: 'Device name is required' },
      };
      res.status(400).json(response);
      return;
    }

    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
    });

    if (!device) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      };
      res.status(404).json(response);
      return;
    }

    const updatedDevice = await prisma.device.update({
      where: { id: req.params.id },
      data: { name: name.trim() },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'DEVICE_RENAME',
        resource: device.deviceId,
        details: { oldName: device.name, newName: name.trim() },
        ipAddress: req.ip,
      },
    });

    const response: ApiResponse<{ device: { id: string; name: string } }> = {
      success: true,
      data: { device: { id: updatedDevice.id, name: updatedDevice.name } },
    };
    res.json(response);
  } catch (error) {
    logger.error('Update device error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update device' },
    };
    res.status(500).json(response);
  }
});

// DELETE /api/v1/devices/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
    });

    if (!device) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      };
      res.status(404).json(response);
      return;
    }

    // Delete related records first (TestRun doesn't have cascade delete)
    await prisma.testRun.deleteMany({
      where: { deviceId: req.params.id },
    });

    await prisma.device.delete({
      where: { id: req.params.id },
    });

    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'DEVICE_DELETE',
        resource: device.deviceId,
        ipAddress: req.ip,
      },
    });

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Delete device error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete device' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/devices/:id/reboot
router.post('/:id/update', requireAuth, async (req: Request, res: Response) => {
  try {
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
    });

    if (!device) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      };
      res.status(404).json(response);
      return;
    }

    if (device.deviceId === 'server-local') {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INVALID_DEVICE', message: 'Server device cannot be updated via firmware flash' },
      };
      res.status(400).json(response);
      return;
    }

    // OTA is not implemented in probe firmware yet.
    const response: ApiResponse = {
      success: false,
      error: {
        code: 'OTA_NOT_SUPPORTED',
        message: 'OTA update is not available. Use "Flash via USB" on the device card (All Devices) or "Setup New Device".',
      },
    };
    res.status(501).json(response);
  } catch (error) {
    logger.error('Update device error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to start device update' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/devices/:id/reboot
router.post('/:id/reboot', requireAuth, async (req: Request, res: Response) => {
  try {
    const device = await prisma.device.findUnique({
      where: { id: req.params.id },
    });

    if (!device) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Device not found' },
      };
      res.status(404).json(response);
      return;
    }

    mqttClient.sendCommand(device.deviceId, 'reboot', {});

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Reboot device error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'REBOOT_ERROR', message: 'Failed to reboot device' },
    };
    res.status(500).json(response);
  }
});

export default router;
