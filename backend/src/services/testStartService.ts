import { Device, TestRun } from '@prisma/client';
import prisma from './database';
import { mqttClient } from '../mqtt';
import logger from '../utils/logger';
import { Command, getTestDefinition } from './testDefinitions';
import { localTestExecutor } from './localTestExecutor';
import { getHoneypotExclusions, generateHoneypotValidationCommands } from './honeypotService';
import {
  analyzeMeshResults,
  generateDeviceToDeviceCommands,
  generateTopologyTestCommands,
} from './topologyTestGenerator';
import { mergeTestRunResultsJson } from './testRunResultsJson';

const SERVER_DEVICE_ID = 'server-local';

export class TestStartError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'TestStartError';
    this.code = code;
    this.status = status;
  }
}

export interface StartConfiguredTestInput {
  deviceId: string;
  testType: string;
  configId?: string;
  options?: Record<string, any>;
}

export interface StartCommandTestInput {
  deviceId: string;
  testType: string;
  commands: Command[];
  configId?: string;
  metadata?: Record<string, unknown>;
  honeypotExclusions?: Array<{ ip: string; port: number }>;
}

async function ensureDeviceCanStart(deviceId: string): Promise<Device> {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });

  if (!device) {
    throw new TestStartError('DEVICE_NOT_FOUND', 'Device not found', 404);
  }

  if (device.status !== 'ONLINE') {
    throw new TestStartError('DEVICE_OFFLINE', 'Device is not online');
  }

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
      throw new TestStartError(
        'TEST_IN_PROGRESS',
        `A test is already running on this device (${activeTest.testType})`,
        409
      );
    }
  }

  const blockingTest = await prisma.testRun.findFirst({
    where: {
      deviceId,
      status: { in: ['QUEUED', 'RUNNING'] },
    },
    orderBy: { startedAt: 'desc' },
  });

  if (blockingTest) {
    throw new TestStartError('TEST_IN_PROGRESS', 'A test is already running on this device', 409);
  }

  return device;
}

async function resolveConfigId(configId?: string): Promise<string | undefined> {
  if (configId) return configId;

  const activeConfig = await prisma.configuration.findFirst({
    where: { isActive: true },
    select: { id: true },
  });

  return activeConfig?.id;
}

async function createQueuedTestRun(
  deviceId: string,
  testType: string,
  configId?: string
): Promise<TestRun> {
  return prisma.testRun.create({
    data: {
      deviceId,
      testType,
      configId,
      status: 'QUEUED',
      progress: 0,
      currentStep: 'Initializing',
    },
  });
}

async function dispatchCommands(
  testRun: TestRun,
  device: Device,
  commands: Command[],
  honeypotExclusions: Array<{ ip: string; port: number }>
): Promise<void> {
  await prisma.device.update({
    where: { id: device.id },
    data: { status: 'TESTING' },
  });

  if (device.deviceId === SERVER_DEVICE_ID) {
    logger.info(`Running ${commands.length} commands locally on server`);
    localTestExecutor.executeBatch(testRun.id, commands, honeypotExclusions).catch((err) => {
      logger.error('Local test execution error:', err);
    });
    return;
  }

  mqttClient.sendCommand(device.deviceId, 'execute', {
    testId: testRun.id,
    commands,
    honeypotExclusions,
  });
  logger.info(`Sending ${commands.length} commands to device ${device.deviceId}`);
}

async function failAndRemoveQueuedTest(testRun: TestRun, deviceId: string): Promise<void> {
  await prisma.testRun.delete({ where: { id: testRun.id } });
  await prisma.device.update({ where: { id: deviceId }, data: { status: 'ONLINE' } });
}

async function buildConfiguredCommands(
  testRun: TestRun,
  device: Device,
  testType: string,
  options?: Record<string, any>
): Promise<{ commands: Command[]; honeypotExclusions: Array<{ ip: string; port: number }> }> {
  const testDef = getTestDefinition(testType);

  if (!testDef) {
    return { commands: [], honeypotExclusions: [] };
  }

  let commands: Command[] = testDef.commands.map((cmd) => ({ ...cmd }));

  if (testType === 'topology_validation') {
    const { commands: topoCommands, metadata } = await generateTopologyTestCommands(
      device.ipAddress || undefined
    );
    if (topoCommands.length <= 1) {
      throw new TestStartError(
        'NO_TOPOLOGY_DATA',
        metadata.error || 'No topology data available for validation'
      );
    }
    commands = topoCommands;
    await mergeTestRunResultsJson(testRun.id, {
      metadata: { topologyMetadata: metadata },
      topologyMetadata: metadata,
      schemaVersion: 2,
    });
    logger.info(`Topology validation test with ${commands.length} test commands`);
  }

  if (testType === 'honeypot_validation') {
    const honeypotCommands = await generateHoneypotValidationCommands(options?.honeypotIds);
    if (honeypotCommands.length === 0) {
      throw new TestStartError('NO_HONEYPOTS', 'No honeypots configured to validate');
    }
    commands = [...commands, ...honeypotCommands];
    logger.info(`Honeypot validation test with ${honeypotCommands.length} honeypot targets`);
  }

  if (testType === 'device_to_device') {
    const { commands: d2dCommands, metadata } = await generateDeviceToDeviceCommands(device.deviceId);
    if (metadata.error || metadata.targetDevices.length === 0) {
      throw new TestStartError(
        'NO_DEVICES',
        metadata.error || 'No other ESP32 devices available for testing'
      );
    }
    commands = d2dCommands;
    await mergeTestRunResultsJson(testRun.id, {
      metadata: { deviceToDeviceMetadata: metadata },
      deviceToDeviceMetadata: metadata,
      schemaVersion: 2,
    });
    logger.info(
      `Device-to-device test: ${metadata.sourceDevice.name} (${metadata.sourceDevice.network || 'unknown'}) -> ${metadata.targetDevices.map(t => `${t.name} (${t.network || 'unknown'})`).join(', ')}`
    );
  }

  let honeypotExclusions: Array<{ ip: string; port: number }> = [];
  if (options?.excludeHoneypots && testType !== 'honeypot_validation') {
    honeypotExclusions = await getHoneypotExclusions();
    if (honeypotExclusions.length > 0) {
      logger.info(`Excluding ${honeypotExclusions.length} honeypot targets from scan`);
      await mergeTestRunResultsJson(testRun.id, {
        metadata: { honeypotExclusions },
        honeypotExclusions,
        schemaVersion: 2,
      });
    }
  }

  return { commands, honeypotExclusions };
}

export async function startConfiguredTest(input: StartConfiguredTestInput): Promise<TestRun> {
  const device = await ensureDeviceCanStart(input.deviceId);
  const targetConfigId = await resolveConfigId(input.configId);
  const testRun = await createQueuedTestRun(input.deviceId, input.testType, targetConfigId);

  try {
    const testDef = getTestDefinition(input.testType);

    if (testDef) {
      const { commands, honeypotExclusions } = await buildConfiguredCommands(
        testRun,
        device,
        input.testType,
        input.options
      );
      await dispatchCommands(testRun, device, commands, honeypotExclusions);
    } else {
      await prisma.device.update({
        where: { id: input.deviceId },
        data: { status: 'TESTING' },
      });
      mqttClient.sendTestCommand(device.deviceId, {
        testId: testRun.id,
        deviceId: device.deviceId,
        testType: input.testType,
        options: input.options,
      });
    }

    logger.info(`Test started: ${input.testType} on device ${device.deviceId}`);
    return testRun;
  } catch (error) {
    await failAndRemoveQueuedTest(testRun, input.deviceId);
    throw error;
  }
}

export async function startCommandTest(input: StartCommandTestInput): Promise<TestRun> {
  if (input.commands.length === 0) {
    throw new TestStartError('NO_COMMANDS', 'No commands were provided for this test');
  }

  const device = await ensureDeviceCanStart(input.deviceId);
  const targetConfigId = await resolveConfigId(input.configId);
  const testRun = await createQueuedTestRun(input.deviceId, input.testType, targetConfigId);

  try {
    if (input.metadata) {
      await mergeTestRunResultsJson(testRun.id, {
        metadata: input.metadata,
        schemaVersion: 2,
      });
    }

    await dispatchCommands(testRun, device, input.commands, input.honeypotExclusions || []);
    logger.info(`Command test started: ${input.testType} on device ${device.deviceId}`);
    return testRun;
  } catch (error) {
    await failAndRemoveQueuedTest(testRun, input.deviceId);
    throw error;
  }
}

export async function waitForTestCompletion(
  testRunId: string,
  timeoutMs = 120_000,
  intervalMs = 1000
): Promise<TestRun> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const testRun = await prisma.testRun.findUnique({ where: { id: testRunId } });
    if (!testRun) {
      throw new TestStartError('TEST_NOT_FOUND', 'Validation test was not found', 404);
    }

    if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(testRun.status)) {
      return testRun;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new TestStartError('TEST_TIMEOUT', 'Validation test did not finish before timeout');
}

export { analyzeMeshResults };
