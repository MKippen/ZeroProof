import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../../services/database';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { ApiResponse, StartTestSchema } from '../../types';
import { mqttClient } from '../../mqtt';
import logger from '../../utils/logger';
import { getTestDefinition, getAvailableTests, Command } from '../../services/testDefinitions';
import { localTestExecutor } from '../../services/localTestExecutor';
import { enrichWithDeviceNames } from '../../services/deviceLookup';
import { getHoneypotExclusions, generateHoneypotValidationCommands } from '../../services/honeypotService';
import { generateTopologyTestCommands, generateDeviceToDeviceCommands, generateMeshTestData, analyzeMeshResults } from '../../services/topologyTestGenerator';
import { mergeTestRunResultsJson } from '../../services/testRunResultsJson';

const SERVER_DEVICE_ID = 'server-local';

const router = Router();

// GET /api/v1/tests/types - List available test types
router.get('/types', requireAuth, (_req: Request, res: Response) => {
  const response: ApiResponse = {
    success: true,
    data: { tests: getAvailableTests() },
  };
  res.json(response);
});

// POST /api/v1/tests/start
router.post('/start', requireAuth, validate(StartTestSchema), async (req: Request, res: Response) => {
  try {
    const { deviceId, testType, configId, options } = req.body;

    // Verify device exists and is online
    const device = await prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'DEVICE_NOT_FOUND', message: 'Device not found' },
      };
      res.status(404).json(response);
      return;
    }

    if (device.status !== 'ONLINE') {
      const response: ApiResponse = {
        success: false,
        error: { code: 'DEVICE_OFFLINE', message: 'Device is not online' },
      };
      res.status(400).json(response);
      return;
    }

    // Check for active test on this device
    const activeTest = await prisma.testRun.findFirst({
      where: {
        deviceId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (activeTest) {
      const now = Date.now();
      const startedAt = activeTest.startedAt?.getTime() ?? now;
      const ageMs = now - startedAt;
      const staleQueued = activeTest.status === 'QUEUED' && ageMs > 2 * 60 * 1000;
      const staleRunning = activeTest.status === 'RUNNING' && ageMs > 30 * 60 * 1000;

      if (staleQueued || staleRunning) {
        logger.warn(
          `Auto-clearing stale ${activeTest.status} test ${activeTest.id} on device ${device.deviceId} before starting new test`
        );

        await prisma.testRun.update({
          where: { id: activeTest.id },
          data: {
            status: 'FAILED',
            completedAt: new Date(),
            errorMessage: `Auto-cleared stale ${activeTest.status.toLowerCase()} test before new run`,
          },
        });

        await prisma.device.update({
          where: { id: deviceId },
          data: { status: 'ONLINE' },
        });
      } else {
        const response: ApiResponse = {
          success: false,
          error: {
            code: 'TEST_IN_PROGRESS',
            message: `A test is already running on this device (${activeTest.testType})`,
          },
        };
        res.status(409).json(response);
        return;
      }
    }

    // Recheck active test after stale cleanup (if any)
    const blockingTest = await prisma.testRun.findFirst({
      where: {
        deviceId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      orderBy: { startedAt: 'desc' },
    });

    if (blockingTest) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'TEST_IN_PROGRESS', message: 'A test is already running on this device' },
      };
      res.status(409).json(response);
      return;
    }

    // Get active config if not specified
    let targetConfigId = configId;
    if (!targetConfigId) {
      const activeConfig = await prisma.configuration.findFirst({
        where: { isActive: true },
      });
      targetConfigId = activeConfig?.id;
    }

    // Create test run
    const testRun = await prisma.testRun.create({
      data: {
        deviceId,
        testType,
        configId: targetConfigId,
        status: 'QUEUED',
        progress: 0,
        currentStep: 'Initializing',
      },
    });

    // Update device status
    await prisma.device.update({
      where: { id: deviceId },
      data: { status: 'TESTING' },
    });

    // Get test definition
    const testDef = getTestDefinition(testType);

    if (testDef) {
      // New command-based execution
      let commands: Command[] = testDef.commands.map(cmd => {
        // Clone command and resolve any template variables
        const resolved = { ...cmd };
        // ${gateway} will be resolved by the device from get_network_info
        return resolved;
      });

      // Handle topology validation test - generate commands dynamically
      if (testType === 'topology_validation') {
        const { commands: topoCommands, metadata } = await generateTopologyTestCommands(device.ipAddress || undefined);
        if (topoCommands.length <= 1) {
          const response: ApiResponse = {
            success: false,
            error: { code: 'NO_TOPOLOGY_DATA', message: metadata.error || 'No topology data available for validation' },
          };
          // Clean up test run
          await prisma.testRun.delete({ where: { id: testRun.id } });
          await prisma.device.update({ where: { id: deviceId }, data: { status: 'ONLINE' } });
          res.status(400).json(response);
          return;
        }
        commands = topoCommands;
        // Store metadata in test run for result processing
        await mergeTestRunResultsJson(testRun.id, {
          metadata: { topologyMetadata: metadata },
          topologyMetadata: metadata,
          schemaVersion: 2,
        });
        logger.info(`Topology validation test with ${commands.length} test commands`);
      }

      // Handle honeypot validation test - add commands for each honeypot
      if (testType === 'honeypot_validation') {
        const honeypotCommands = await generateHoneypotValidationCommands(options?.honeypotIds);
        if (honeypotCommands.length === 0) {
          const response: ApiResponse = {
            success: false,
            error: { code: 'NO_HONEYPOTS', message: 'No honeypots configured to validate' },
          };
          // Clean up test run
          await prisma.testRun.delete({ where: { id: testRun.id } });
          await prisma.device.update({ where: { id: deviceId }, data: { status: 'ONLINE' } });
          res.status(400).json(response);
          return;
        }
        commands = [...commands, ...honeypotCommands];
        logger.info(`Honeypot validation test with ${honeypotCommands.length} honeypot targets`);
      }

      // Handle device-to-device test - test connectivity between ESP32 devices
      if (testType === 'device_to_device') {
        const { commands: d2dCommands, metadata } = await generateDeviceToDeviceCommands(device.deviceId);
        if (metadata.error || metadata.targetDevices.length === 0) {
          const response: ApiResponse = {
            success: false,
            error: { code: 'NO_DEVICES', message: metadata.error || 'No other ESP32 devices available for testing' },
          };
          // Clean up test run
          await prisma.testRun.delete({ where: { id: testRun.id } });
          await prisma.device.update({ where: { id: deviceId }, data: { status: 'ONLINE' } });
          res.status(400).json(response);
          return;
        }
        commands = d2dCommands;
        // Store metadata in test run for result processing
        await mergeTestRunResultsJson(testRun.id, {
          metadata: { deviceToDeviceMetadata: metadata },
          deviceToDeviceMetadata: metadata,
          schemaVersion: 2,
        });
        logger.info(`Device-to-device test: ${metadata.sourceDevice.name} (${metadata.sourceDevice.network || 'unknown'}) -> ${metadata.targetDevices.map(t => `${t.name} (${t.network || 'unknown'})`).join(', ')}`);
      }

      // Handle honeypot exclusion for other tests
      let honeypotExclusions: Array<{ ip: string; port: number }> = [];
      if (options?.excludeHoneypots && testType !== 'honeypot_validation') {
        honeypotExclusions = await getHoneypotExclusions();
        if (honeypotExclusions.length > 0) {
          logger.info(`Excluding ${honeypotExclusions.length} honeypot targets from scan`);
          // Store exclusions in test run for result processing
          await mergeTestRunResultsJson(testRun.id, {
            metadata: { honeypotExclusions },
            honeypotExclusions,
            schemaVersion: 2,
          });
        }
      }

      // Check if this is the server device - run locally instead of via MQTT
      if (device.deviceId === SERVER_DEVICE_ID) {
        logger.info(`Running ${commands.length} commands locally on server`);
        // Execute asynchronously so we can return immediately
        localTestExecutor.executeBatch(testRun.id, commands, honeypotExclusions).catch((err) => {
          logger.error('Local test execution error:', err);
        });
      } else {
        mqttClient.sendCommand(device.deviceId, 'execute', {
          testId: testRun.id,
          commands,
          honeypotExclusions, // Send to device so it can skip honeypot IPs
        });
        logger.info(`Sending ${commands.length} commands to device ${device.deviceId}`);
      }
    } else {
      // Fallback to legacy test executor for backward compatibility
      mqttClient.sendTestCommand(device.deviceId, {
        testId: testRun.id,
        deviceId: device.deviceId,
        testType,
        options,
      });
    }

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'TEST_START',
        resource: testRun.id,
        details: { testType, deviceId: device.deviceId },
        ipAddress: req.ip,
      },
    });

    logger.info(`Test started: ${testType} on device ${device.deviceId}`);

    const response: ApiResponse = {
      success: true,
      data: { testRun },
    };
    res.json(response);
  } catch (error) {
    logger.error('Start test error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'TEST_START_ERROR', message: 'Failed to start test' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/tests
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const deviceId = req.query.deviceId as string | undefined;

    const where = {
      ...(status && { status: status as any }),
      ...(deviceId && { deviceId }),
    };

    const [tests, total] = await Promise.all([
      prisma.testRun.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
        include: {
          device: { select: { name: true, deviceId: true } },
          _count: { select: { vulnerabilities: true, discoveredServices: true } },
        },
      }),
      prisma.testRun.count({ where }),
    ]);

    const response: ApiResponse = {
      success: true,
      data: {
        tests: tests.map((t) => ({
          ...t,
          vulnerabilityCount: t._count.vulnerabilities,
          serviceCount: t._count.discoveredServices,
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
    logger.error('Get tests error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch tests' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/tests/:id
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const test = await prisma.testRun.findUnique({
      where: { id: req.params.id },
      include: {
        device: { select: { name: true, deviceId: true } },
        configuration: { select: { siteName: true } },
        vulnerabilities: {
          orderBy: [{ severity: 'asc' }, { firstSeen: 'desc' }],
        },
        discoveredServices: {
          orderBy: [{ ipAddress: 'asc' }, { port: 'asc' }],
        },
      },
    });

    if (!test) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Test not found' },
      };
      res.status(404).json(response);
      return;
    }

    // Enrich discovered services with device names from UniFi config
    const enrichedServices = await enrichWithDeviceNames(test.discoveredServices, 'ipAddress');

    const response: ApiResponse = {
      success: true,
      data: {
        test: {
          ...test,
          discoveredServices: enrichedServices,
        },
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get test error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch test' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/tests/:id/results
router.get('/:id/results', requireAuth, async (req: Request, res: Response) => {
  try {
    const test = await prisma.testRun.findUnique({
      where: { id: req.params.id },
      include: {
        vulnerabilities: true,
        discoveredServices: true,
      },
    });

    if (!test) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Test not found' },
      };
      res.status(404).json(response);
      return;
    }

    // Enrich discovered services with device names from UniFi config
    const enrichedServices = await enrichWithDeviceNames(test.discoveredServices, 'ipAddress');

    const response: ApiResponse = {
      success: true,
      data: {
        results: test.resultsJson,
        vulnerabilities: test.vulnerabilities,
        discoveredServices: enrichedServices,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get test results error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch test results' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/tests/:id/cancel
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response) => {
  try {
    const test = await prisma.testRun.findUnique({
      where: { id: req.params.id },
      include: { device: true },
    });

    if (!test) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Test not found' },
      };
      res.status(404).json(response);
      return;
    }

    if (!['QUEUED', 'RUNNING'].includes(test.status)) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INVALID_STATE', message: 'Test cannot be cancelled' },
      };
      res.status(400).json(response);
      return;
    }

    // Send cancel command
    mqttClient.sendCommand(test.device.deviceId, 'cancel_test', { testId: test.id });

    // Update test status
    await prisma.testRun.update({
      where: { id: test.id },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    // Update device status
    await prisma.device.update({
      where: { id: test.deviceId },
      data: { status: 'ONLINE' },
    });

    const response: ApiResponse = { success: true };
    res.json(response);
  } catch (error) {
    logger.error('Cancel test error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'CANCEL_ERROR', message: 'Failed to cancel test' },
    };
    res.status(500).json(response);
  }
});

// POST /api/v1/tests/start-mesh - Start mesh connectivity test across multiple devices
router.post('/start-mesh', requireAuth, async (req: Request, res: Response) => {
  try {
    const { deviceIds } = req.body; // Optional array of device IDs, defaults to all

    // Generate mesh test data
    const meshData = await generateMeshTestData(deviceIds);

    if (meshData.error) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'MESH_TEST_ERROR', message: meshData.error },
      };
      res.status(400).json(response);
      return;
    }

    if (meshData.devices.length < 2) {
      const response: ApiResponse = {
        success: false,
        error: { code: 'INSUFFICIENT_DEVICES', message: 'Need at least 2 online ESP32 devices for mesh testing' },
      };
      res.status(400).json(response);
      return;
    }

    // Use the first device as the "primary" for tracking, but test all
    const primaryDevice = meshData.devices[0];

    // Create a single test run to track the mesh test
    const testRun = await prisma.testRun.create({
      data: {
        deviceId: primaryDevice.dbId,
        testType: 'device_mesh',
        status: 'RUNNING',
        progress: 0,
        currentStep: 'Initializing mesh test',
        resultsJson: {
          meshDevices: meshData.devices.map(d => ({
            deviceId: d.deviceId,
            name: d.name,
            ip: d.ip,
            network: d.network,
            targets: d.targets,
            status: 'pending',
          })),
          networks: meshData.networks,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    logger.info(`Starting mesh test ${testRun.id} with ${meshData.devices.length} devices`);

    // Execute tests on all devices (async - results will come back via MQTT)
    // We'll send commands to each device and collect results
    const meshResults: Array<{
      sourceDevice: { deviceId: string; name: string; ip: string; network?: string };
      targets: Array<{ deviceId: string; name: string; ip: string; network?: string }>;
      results: any[];
      error?: string;
    }> = [];

    // Set all devices to TESTING
    await prisma.device.updateMany({
      where: { deviceId: { in: meshData.devices.map(d => d.deviceId) } },
      data: { status: 'TESTING' },
    });

    // Run tests sequentially to avoid overwhelming the network
    // Each device will run its commands and we collect results
    let completedDevices = 0;
    const totalDevices = meshData.devices.length;

    const runDeviceTest = async (device: typeof meshData.devices[0]): Promise<void> => {
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          // Device didn't respond in time
          meshResults.push({
            sourceDevice: { deviceId: device.deviceId, name: device.name, ip: device.ip, network: device.network },
            targets: device.targets,
            results: [],
            error: 'Device timeout - no response',
          });
          resolve();
        }, 30000); // 30 second timeout per device

        // Set up a one-time listener for this device's results
        const resultHandler = async (topic: string, message: any) => {
          if (topic.includes(device.deviceId) && message.testId === testRun.id) {
            clearTimeout(timeout);
            meshResults.push({
              sourceDevice: { deviceId: device.deviceId, name: device.name, ip: device.ip, network: device.network },
              targets: device.targets,
              results: message.results || [],
              error: message.error,
            });
            mqttClient.removeResultListener(resultHandler);
            completedDevices++;

            // Update progress
            await prisma.testRun.update({
              where: { id: testRun.id },
              data: {
                progress: Math.round((completedDevices / totalDevices) * 100),
                currentStep: `Testing from ${device.name} (${completedDevices}/${totalDevices})`,
              },
            });

            resolve();
          }
        };

        mqttClient.addResultListener(resultHandler);

        // Send commands to device
        mqttClient.sendCommand(device.deviceId, 'execute', {
          testId: testRun.id,
          commands: device.commands,
        });
      });
    };

    // Run all device tests sequentially
    (async () => {
      for (const device of meshData.devices) {
        await runDeviceTest(device);
      }

      // All devices done - analyze and save results
      const analysis = analyzeMeshResults(meshResults);

      // Update test run with final results
      await prisma.testRun.update({
        where: { id: testRun.id },
        data: {
          status: 'COMPLETED',
          progress: 100,
          currentStep: 'Complete',
          completedAt: new Date(),
          duration: Math.round((Date.now() - testRun.startedAt.getTime()) / 1000),
          resultsJson: {
            meshDevices: meshData.devices.map(d => ({
              deviceId: d.deviceId,
              name: d.name,
              ip: d.ip,
              network: d.network,
              targets: d.targets,
              status: 'complete',
            })),
            networks: meshData.networks,
            rawResults: meshResults,
            matrix: analysis.matrix,
            summary: analysis.summary,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      // Reset device statuses
      await prisma.device.updateMany({
        where: { deviceId: { in: meshData.devices.map(d => d.deviceId) } },
        data: { status: 'ONLINE' },
      });

      logger.info(`Mesh test ${testRun.id} completed: ${analysis.summary.successfulPaths}/${analysis.summary.totalPaths} paths successful`);
    })().catch(async (err) => {
      logger.error('Mesh test execution error:', err);
      await prisma.testRun.update({
        where: { id: testRun.id },
        data: {
          status: 'FAILED',
          errorMessage: err.message,
          completedAt: new Date(),
        },
      });
      await prisma.device.updateMany({
        where: { deviceId: { in: meshData.devices.map(d => d.deviceId) } },
        data: { status: 'ONLINE' },
      });
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: req.session.userId,
        action: 'MESH_TEST_START',
        resource: testRun.id,
        details: { deviceCount: meshData.devices.length, deviceIds: meshData.devices.map(d => d.deviceId) },
        ipAddress: req.ip,
      },
    });

    const response: ApiResponse = {
      success: true,
      data: {
        testRun,
        devices: meshData.devices.map(d => ({ deviceId: d.deviceId, name: d.name, network: d.network })),
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Start mesh test error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'MESH_TEST_START_ERROR', message: 'Failed to start mesh test' },
    };
    res.status(500).json(response);
  }
});

// GET /api/v1/tests/mesh-devices - Get available devices for mesh testing
router.get('/mesh-devices', requireAuth, async (_req: Request, res: Response) => {
  try {
    const meshData = await generateMeshTestData();

    const response: ApiResponse = {
      success: true,
      data: {
        devices: meshData.devices.map(d => ({
          deviceId: d.deviceId,
          name: d.name,
          ip: d.ip,
          network: d.network,
        })),
        networks: meshData.networks,
        canRunTest: meshData.devices.length >= 2,
        error: meshData.error,
      },
    };
    res.json(response);
  } catch (error) {
    logger.error('Get mesh devices error:', error);
    const response: ApiResponse = {
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch mesh devices' },
    };
    res.status(500).json(response);
  }
});

export default router;
