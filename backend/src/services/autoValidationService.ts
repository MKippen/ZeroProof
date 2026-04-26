import prisma from './database';
import { mqttClient } from '../mqtt';
import logger from '../utils/logger';
import {
  getVlanCoverage,
  getDevicesOnOtherVlans,
  mapDeviceToNetwork,
  NetworkInfo,
} from './vlanCoverageService';
import { Command, getTestDefinition } from './testDefinitions';
import { generateDeviceToDeviceCommands, generateTopologyTestCommands } from './topologyTestGenerator';
import { mergeTestRunResultsJson } from './testRunResultsJson';
import { localTestExecutor } from './localTestExecutor';

const SERVER_DEVICE_ID = 'server-local';

// Delay before running auto-validation after device comes online
const AUTO_VALIDATION_DELAY_MS = 30 * 1000; // 30 seconds

// Track pending auto-validations to avoid duplicates
const pendingValidations = new Map<string, NodeJS.Timeout>();

// Cancel any pending validation for a device
export function cancelPendingValidation(deviceId: string): void {
  const existing = pendingValidations.get(deviceId);
  if (existing) {
    clearTimeout(existing);
    pendingValidations.delete(deviceId);
    logger.debug(`Cancelled pending validation for device ${deviceId}`);
  }
}

// Schedule auto-validation for a device that just came online
export async function scheduleAutoValidation(
  deviceId: string,
  dbDeviceId: string,
  ipAddress: string
): Promise<void> {
  // Cancel any existing pending validation
  cancelPendingValidation(deviceId);

  logger.info(
    `Scheduling auto-validation for device ${deviceId} (${ipAddress}) in ${AUTO_VALIDATION_DELAY_MS / 1000}s`
  );

  const timeout = setTimeout(async () => {
    pendingValidations.delete(deviceId);
    await runAutoValidation(deviceId, dbDeviceId, ipAddress);
  }, AUTO_VALIDATION_DELAY_MS);

  pendingValidations.set(deviceId, timeout);
}

// Run auto-validation tests for a device
async function runAutoValidation(
  deviceId: string,
  dbDeviceId: string,
  ipAddress: string
): Promise<void> {
  try {
    // Verify device is still online
    const device = await prisma.device.findUnique({
      where: { id: dbDeviceId },
    });

    if (!device || device.status !== 'ONLINE') {
      logger.debug(
        `Device ${deviceId} no longer online, skipping auto-validation`
      );
      return;
    }

    // Get network info
    const coverage = await getVlanCoverage();
    const networks: NetworkInfo[] = coverage.vlans.map((v) => ({
      id: v.networkId,
      name: v.name,
      vlanId: v.vlanId,
      subnet: v.subnet,
      purpose: '',
    }));

    const deviceNetwork = mapDeviceToNetwork(ipAddress, networks);

    logger.info(
      `Running auto-validation for device ${deviceId} on network ${deviceNetwork?.name || 'unknown'}`
    );

    // 1. Schedule connectivity test
    await scheduleTest(dbDeviceId, deviceId, 'connectivity');

    // 2. Check if there are devices on other VLANs for cross-VLAN testing
    if (deviceNetwork) {
      const otherVlanDevices = await getDevicesOnOtherVlans(deviceNetwork.id);

      if (otherVlanDevices.length > 0) {
        logger.info(
          `Found ${otherVlanDevices.length} devices on other VLANs, scheduling device-to-device test`
        );
        // Schedule device-to-device test with a delay to let connectivity complete
        setTimeout(async () => {
          await scheduleTest(dbDeviceId, deviceId, 'device_to_device');
        }, 15000); // 15 second delay after connectivity test
      }
    }
  } catch (error) {
    logger.error(`Auto-validation error for device ${deviceId}:`, error);
  }
}

// Schedule a specific test for a device
async function scheduleTest(
  dbDeviceId: string,
  mqttDeviceId: string,
  testType: string
): Promise<string | null> {
  try {
    // Check device status
    const device = await prisma.device.findUnique({
      where: { id: dbDeviceId },
    });

    if (!device || device.status !== 'ONLINE') {
      logger.debug(`Device ${mqttDeviceId} not online, cannot schedule test`);
      return null;
    }

    // Avoid duplicate active tests for the same device.
    const activeTest = await prisma.testRun.findFirst({
      where: {
        deviceId: dbDeviceId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (activeTest) {
      logger.info(
        `Skipping ${testType} schedule for ${mqttDeviceId}: active test ${activeTest.id} is ${activeTest.status}`
      );
      return activeTest.id;
    }

    let commands: Command[] = [];
    let metadataPatch: Record<string, unknown> | null = null;

    if (testType === 'topology_validation') {
      const { commands: topoCommands, metadata } = await generateTopologyTestCommands(
        device.ipAddress || undefined
      );
      if (topoCommands.length <= 1) {
        logger.warn(
          `Skipping topology_validation for ${mqttDeviceId}: ${metadata.error || 'no topology data'}`
        );
        return null;
      }
      commands = topoCommands;
      metadataPatch = {
        metadata: { topologyMetadata: metadata },
        topologyMetadata: metadata,
        schemaVersion: 2,
      };
    } else if (testType === 'device_to_device') {
      const { commands: d2dCommands, metadata } = await generateDeviceToDeviceCommands(mqttDeviceId);
      if (metadata.error || metadata.targetDevices.length === 0) {
        logger.warn(
          `Skipping device_to_device for ${mqttDeviceId}: ${metadata.error || 'no target devices'}`
        );
        return null;
      }
      commands = d2dCommands;
      metadataPatch = {
        metadata: { deviceToDeviceMetadata: metadata },
        deviceToDeviceMetadata: metadata,
        schemaVersion: 2,
      };
    } else {
      const testDef = getTestDefinition(testType);
      if (!testDef) {
        logger.warn(`No definition for test type ${testType}`);
        return null;
      }
      commands = testDef.commands;
    }

    // Get active config
    const activeConfig = await prisma.configuration.findFirst({
      where: { isActive: true },
    });

    // Create test run
    const testRun = await prisma.testRun.create({
      data: {
        deviceId: dbDeviceId,
        testType,
        status: 'QUEUED',
        progress: 0,
        currentStep: 'Initializing',
        configId: activeConfig?.id,
      },
    });

    if (metadataPatch) {
      await mergeTestRunResultsJson(testRun.id, metadataPatch);
    }

    // Update device status
    await prisma.device.update({
      where: { id: dbDeviceId },
      data: { status: 'TESTING' },
    });

    // Server-local runs locally, not over MQTT.
    if (mqttDeviceId === SERVER_DEVICE_ID) {
      localTestExecutor.executeBatch(testRun.id, commands, []).catch((err) => {
        logger.error(`Local auto-validation execution error for ${testRun.id}:`, err);
      });
    } else {
      mqttClient.sendCommand(mqttDeviceId, 'execute', {
        testId: testRun.id,
        commands,
        honeypotExclusions: [],
      });
    }

    logger.info(
      `Scheduled ${testType} test (${testRun.id}) for device ${mqttDeviceId}`
    );

    return testRun.id;
  } catch (error) {
    logger.error(`Error scheduling test for device ${mqttDeviceId}:`, error);
    return null;
  }
}

// Run scheduled VLAN validation for all covered VLANs
export async function runScheduledVlanValidation(): Promise<void> {
  try {
    logger.info('Running scheduled VLAN validation');

    const coverage = await getVlanCoverage();

    for (const vlan of coverage.vlans) {
      if (!vlan.hasCoverage && !vlan.hasHostValidation) continue;

      // Prefer an online ESP32 on this VLAN; fall back to server-local for host-based validation.
      const onlineEsp32Device = vlan.testDevices.find((d) => d.status === 'ONLINE');
      const onlineHostDevice =
        vlan.hostValidationDevice?.status === 'ONLINE' ? vlan.hostValidationDevice : null;
      const runner = onlineEsp32Device || onlineHostDevice;
      if (!runner) continue;

      // Check if validation is needed (no test in last 4 hours)
      const needsValidation = await shouldRunVlanValidation(vlan.networkId);
      if (!needsValidation) continue;

      logger.info(
        `Scheduling topology_validation for VLAN ${vlan.name} via device ${runner.deviceId}`
      );

      await scheduleTest(
        runner.id,
        runner.deviceId,
        'topology_validation'
      );
    }
  } catch (error) {
    logger.error('Error running scheduled VLAN validation:', error);
  }
}

// Check if a VLAN needs validation
async function shouldRunVlanValidation(networkId: string): Promise<boolean> {
  try {
    const coverage = await getVlanCoverage();
    const vlan = coverage.vlans.find((v) => v.networkId === networkId);

    if (!vlan || (!vlan.hasCoverage && !vlan.hasHostValidation)) return false;

    // No previous validation - should run
    if (!vlan.validation?.lastTestDate) return true;

    // Check if last test was more than 4 hours ago
    const lastTestDate = new Date(vlan.validation.lastTestDate);
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    return lastTestDate < fourHoursAgo;
  } catch (error) {
    logger.error('Error checking if VLAN validation needed:', error);
    return false;
  }
}

// Get stats about auto-validation
export function getAutoValidationStats(): {
  pendingCount: number;
  pendingDevices: string[];
} {
  return {
    pendingCount: pendingValidations.size,
    pendingDevices: Array.from(pendingValidations.keys()),
  };
}
