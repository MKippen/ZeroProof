import mqtt, { MqttClient, IClientOptions } from 'mqtt';
import config from '../config';
import prisma from '../services/database';
import logger from '../utils/logger';
import { TestCommand, TestProgress, TestResult } from '../types';
import { processTestResults } from '../services/testProcessor';
import { asJsonObject, buildStructuredResultsJson } from '../services/testRunResultsJson';
import {
  scheduleAutoValidation,
  cancelPendingValidation,
} from '../services/autoValidationService';

const TOPICS = {
  DEVICE_STATUS: 'zeroproof/devices/+/status',
  DEVICE_COMMAND: 'zeroproof/devices/{deviceId}/command',
  TEST_PROGRESS: 'zeroproof/devices/+/test/progress',
  TEST_RESULTS: 'zeroproof/devices/+/test/results',
  TEST_RESULTS_CHUNK: 'zeroproof/devices/+/test/results/chunk',
  HONEYPOT_LOGS: 'zeroproof/devices/+/honeypot',
  TEST_PROBE: 'zeroproof/devices/+/test_probe',
  TEST_PROBE_RESULTS: 'zeroproof/devices/+/test_results',
};

type ResultListener = (topic: string, message: any) => void;

interface ChunkedResultMessage {
  testId: string;
  chunkIndex: number;
  chunkCount: number;
  payload: string;
  success?: boolean;
  error?: string;
  duration?: number;
}

interface ResultChunkBuffer {
  deviceId: string;
  chunkCount: number;
  chunks: Array<string | null>;
  receivedChunks: Set<number>;
  success?: boolean;
  error?: string;
  duration?: number;
  updatedAt: number;
}

class MqttService {
  private client: MqttClient | null = null;
  private connected = false;
  private wsClients: Set<WebSocket> = new Set();
  private resultListeners: Set<ResultListener> = new Set();
  private resultChunkBuffers: Map<string, ResultChunkBuffer> = new Map();

  async connect(): Promise<void> {
    const options: IClientOptions = {
      host: config.MQTT_BROKER,
      port: parseInt(config.MQTT_PORT),
      username: config.MQTT_USERNAME,
      password: config.MQTT_PASSWORD,
      clientId: `zeroproof-backend-${Date.now()}`,
      clean: true,
      reconnectPeriod: 5000,
    };

    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(options);

      this.client.on('connect', () => {
        this.connected = true;
        logger.info('✓ Connected to MQTT broker');
        this.subscribeToTopics();
        resolve();
      });

      this.client.on('error', (error) => {
        logger.error('MQTT error:', error);
        if (!this.connected) {
          reject(error);
        }
      });

      this.client.on('close', () => {
        this.connected = false;
        logger.warn('MQTT connection closed');
      });

      this.client.on('reconnect', () => {
        logger.info('Reconnecting to MQTT broker...');
      });

      this.client.on('message', this.handleMessage.bind(this));
    });
  }

  private subscribeToTopics(): void {
    if (!this.client) return;

    const topics = [
      TOPICS.DEVICE_STATUS,
      TOPICS.TEST_PROGRESS,
      TOPICS.TEST_RESULTS,
      TOPICS.TEST_RESULTS_CHUNK,
      TOPICS.HONEYPOT_LOGS,
      TOPICS.TEST_PROBE,
      TOPICS.TEST_PROBE_RESULTS,
    ];

    this.client.subscribe(topics, (err) => {
      if (err) {
        logger.error('Failed to subscribe to topics:', err);
      } else {
        logger.info('Subscribed to MQTT topics');
      }
    });
  }

  private async handleMessage(topic: string, payload: Buffer): Promise<void> {
    try {
      const message = JSON.parse(payload.toString());
      const topicParts = topic.split('/');
      const deviceId = topicParts[2];

      if (topic.match(/devices\/[^/]+\/status$/)) {
        await this.handleDeviceStatus(deviceId, message);
      } else if (topic.match(/devices\/[^/]+\/test\/progress$/)) {
        await this.handleTestProgress(deviceId, message);
      } else if (topic.match(/devices\/[^/]+\/test\/results\/chunk$/)) {
        await this.handleChunkedTestResults(deviceId, message as ChunkedResultMessage);
      } else if (topic.match(/devices\/[^/]+\/test\/results$/)) {
        await this.handleTestResults(deviceId, message);
      } else if (topic.match(/devices\/[^/]+\/honeypot$/)) {
        await this.handleHoneypotLogs(deviceId, message);
      } else if (topic.match(/devices\/[^/]+\/test_probe$/)) {
        await this.handleTestProbeResult(deviceId, message);
      } else if (topic.match(/devices\/[^/]+\/test_results$/)) {
        await this.handleDeviceTestResults(deviceId, message);
      }
    } catch (error) {
      logger.error('Error handling MQTT message:', error);
    }
  }

  private async handleDeviceStatus(
    deviceId: string,
    status: {
      name?: string;
      mac?: string;
      ip?: string;
      firmware?: string;
      online: boolean;
      honeypot?: {
        enabled: boolean;
        connections: number;
        testListener: boolean;
      };
    }
  ): Promise<void> {
    try {
      // Check if this is a new device or was previously offline
      const existingDevice = await prisma.device.findUnique({
        where: { deviceId },
      });
      const wasOffline = !existingDevice || existingDevice.status === 'OFFLINE';
      const isNowOnline = status.online;

      const device = await prisma.device.upsert({
        where: { deviceId },
        update: {
          name: status.name || deviceId,
          macAddress: status.mac,
          ipAddress: status.ip,
          firmwareVersion: status.firmware,
          status: status.online ? 'ONLINE' : 'OFFLINE',
          lastSeen: new Date(),
        },
        create: {
          deviceId,
          name: status.name || deviceId,
          macAddress: status.mac,
          ipAddress: status.ip,
          firmwareVersion: status.firmware,
          status: status.online ? 'ONLINE' : 'OFFLINE',
          lastSeen: new Date(),
        },
      });

      logger.debug(`Device ${deviceId} status: ${status.online ? 'online' : 'offline'}`);
      this.broadcastToWebSockets({
        type: 'device_status',
        deviceId,
        status: status.online ? 'ONLINE' : 'OFFLINE',
        honeypot: status.honeypot,
      });

      // If this is a new or recently online device, broadcast it to other devices
      // so they can add it to their whitelist
      if (status.online && status.mac && status.ip) {
        await this.registerDeviceAcrossFleet(deviceId, status.mac, status.ip);
      }

      // Auto-validation: Schedule tests when device comes online
      if (wasOffline && isNowOnline && status.ip) {
        // Schedule auto-validation tests after device settles
        scheduleAutoValidation(deviceId, device.id, status.ip);
      } else if (!isNowOnline) {
        // Device went offline - cancel any pending validation
        cancelPendingValidation(deviceId);
      }
    } catch (error) {
      logger.error('Error updating device status:', error);
    }
  }

  private async handleTestProgress(deviceId: string, progress: TestProgress): Promise<void> {
    try {
      await prisma.testRun.update({
        where: { id: progress.testId },
        data: {
          progress: progress.progress,
          currentStep: progress.currentStep,
          status: 'RUNNING',
        },
      });

      logger.debug(`Test ${progress.testId} progress: ${progress.progress}%`);
      this.broadcastToWebSockets({
        type: 'test_progress',
        testId: progress.testId,
        deviceId,
        progress: progress.progress,
        currentStep: progress.currentStep,
      });

      // If progress is 100%, set a timeout to complete the test if results don't arrive
      // This handles cases where MQTT packet size truncates the results message
      if (progress.progress === 100) {
        setTimeout(async () => {
          try {
            this.cleanupStaleChunkBuffers();
            const test = await prisma.testRun.findUnique({
              where: { id: progress.testId },
              select: { status: true, resultsJson: true },
            });
            if (test?.status === 'RUNNING') {
              const chunkBuffer = this.resultChunkBuffers.get(progress.testId);
              logger.warn(`Test ${progress.testId} hit 100% but results never arrived - completing with empty results`);
              const structuredResults = buildStructuredResultsJson(
                test.resultsJson,
                { results: [] },
                {
                  chunked: Boolean(chunkBuffer),
                  chunkCount: chunkBuffer?.chunkCount,
                  receivedChunks: chunkBuffer?.receivedChunks.size,
                  truncated: true,
                  incomplete: Boolean(chunkBuffer),
                  reason: chunkBuffer
                    ? 'Chunked MQTT results were incomplete when timeout elapsed.'
                    : 'Results payload likely truncated by MQTT packet size.',
                }
              );
              await prisma.testRun.update({
                where: { id: progress.testId },
                data: {
                  status: 'COMPLETED',
                  completedAt: new Date(),
                  resultsJson: structuredResults as object,
                },
              });
              this.resultChunkBuffers.delete(progress.testId);
              await prisma.device.update({
                where: { deviceId },
                data: { status: 'ONLINE' },
              });
              this.broadcastToWebSockets({
                type: 'test_completed',
                testId: progress.testId,
                deviceId,
                success: true,
              });
            }
          } catch (err) {
            logger.error('Error in 100% progress timeout handler:', err);
          }
        }, 5000); // Wait 5 seconds for results to arrive
      }
    } catch (error) {
      logger.error('Error updating test progress:', error);
    }
  }

  private async handleTestResults(deviceId: string, result: TestResult): Promise<void> {
    try {
      this.resultChunkBuffers.delete(result.testId);

      // Notify any registered listeners (e.g., mesh tests waiting for results)
      this.notifyResultListeners(`zeroproof/devices/${deviceId}/test/results`, result);

      // Check if this is a mesh test (don't update test run directly - mesh handler does that)
      const testRun = await prisma.testRun.findUnique({
        where: { id: result.testId },
        select: { testType: true, startedAt: true, resultsJson: true },
      });

      // Skip normal processing for mesh tests - they're handled by the mesh test coordinator
      if (testRun?.testType === 'device_mesh') {
        logger.debug(`Mesh test result from ${deviceId} for test ${result.testId}`);
        return;
      }

      const duration = testRun
        ? Math.floor((Date.now() - testRun.startedAt.getTime()) / 1000)
        : result.duration;
      const structuredResults = buildStructuredResultsJson(
        testRun?.resultsJson,
        result.results,
        result.transport
      );

      await prisma.testRun.update({
        where: { id: result.testId },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          progress: 100,
          completedAt: new Date(),
          duration,
          resultsJson: structuredResults as object,
          errorMessage: result.error,
        },
      });

      // Update device status back to online
      await prisma.device.update({
        where: { deviceId },
        data: { status: 'ONLINE' },
      });

      // Process test results to create vulnerabilities
      await processTestResults(result.testId, structuredResults);

      logger.info(`Test ${result.testId} completed: ${result.success ? 'success' : 'failed'}`);
      this.broadcastToWebSockets({
        type: 'test_completed',
        testId: result.testId,
        deviceId,
        success: result.success,
      });
    } catch (error) {
      logger.error('Error processing test results:', error);
    }
  }

  private async handleChunkedTestResults(
    deviceId: string,
    message: ChunkedResultMessage
  ): Promise<void> {
    const { testId, chunkIndex, chunkCount, payload } = message;
    if (!testId || typeof chunkIndex !== 'number' || typeof chunkCount !== 'number' || typeof payload !== 'string') {
      logger.warn(`Ignoring malformed chunked result from ${deviceId}`);
      return;
    }

    if (chunkIndex < 0 || chunkCount <= 0 || chunkIndex >= chunkCount) {
      logger.warn(`Ignoring invalid chunk index for test ${testId}: ${chunkIndex}/${chunkCount}`);
      return;
    }

    const existing = this.resultChunkBuffers.get(testId);
    const buffer: ResultChunkBuffer = existing && existing.chunkCount === chunkCount
      ? existing
      : {
          deviceId,
          chunkCount,
          chunks: Array.from({ length: chunkCount }, () => null),
          receivedChunks: new Set<number>(),
          updatedAt: Date.now(),
        };

    buffer.chunks[chunkIndex] = payload;
    buffer.receivedChunks.add(chunkIndex);
    buffer.success = message.success ?? buffer.success;
    buffer.error = message.error ?? buffer.error;
    buffer.duration = message.duration ?? buffer.duration;
    buffer.updatedAt = Date.now();
    this.resultChunkBuffers.set(testId, buffer);

    if (buffer.receivedChunks.size !== buffer.chunkCount) {
      return;
    }

    const rawPayload = buffer.chunks.join('');
    this.resultChunkBuffers.delete(testId);

    try {
      const parsedPayload = JSON.parse(rawPayload);
      const parsedObject = asJsonObject(parsedPayload);
      const payloadWithTransport = {
        ...parsedObject,
        transport: {
          ...asJsonObject(parsedObject.transport),
          chunked: true,
          chunkCount: buffer.chunkCount,
          receivedChunks: buffer.receivedChunks.size,
        },
      };

      const finalResult: TestResult = {
        testId,
        deviceId,
        success: buffer.success ?? true,
        results: payloadWithTransport,
        error: buffer.error,
        duration: buffer.duration ?? 0,
        transport: {
          chunked: true,
          chunkCount: buffer.chunkCount,
          receivedChunks: buffer.receivedChunks.size,
        },
      };

      await this.handleTestResults(deviceId, finalResult);
    } catch (error) {
      logger.error(`Failed to assemble chunked test result for ${testId}:`, error);

      const testRun = await prisma.testRun.findUnique({
        where: { id: testId },
        select: { resultsJson: true, status: true },
      });

      if (testRun?.status === 'RUNNING') {
        const structuredResults = buildStructuredResultsJson(
          testRun.resultsJson,
          { results: [] },
          {
            chunked: true,
            chunkCount: buffer.chunkCount,
            receivedChunks: buffer.receivedChunks.size,
            truncated: true,
            incomplete: true,
            reason: 'Received all chunks but JSON parsing failed during assembly.',
          }
        );

        await prisma.testRun.update({
          where: { id: testId },
          data: {
            status: 'FAILED',
            progress: 100,
            completedAt: new Date(),
            resultsJson: structuredResults as object,
            errorMessage: 'Failed to parse chunked test results',
          },
        });
      }
    }
  }

  private cleanupStaleChunkBuffers(): void {
    const now = Date.now();
    for (const [testId, buffer] of this.resultChunkBuffers.entries()) {
      if (now - buffer.updatedAt > 60000) {
        logger.warn(`Dropping stale chunk buffer for test ${testId}`);
        this.resultChunkBuffers.delete(testId);
      }
    }
  }

  sendCommand(deviceId: string, command: string, payload: object): void {
    logger.info(`Attempting to send MQTT command: ${command} to device: ${deviceId}`);

    if (!this.client || !this.connected) {
      logger.warn('MQTT not connected, cannot send command');
      return;
    }

    const topic = TOPICS.DEVICE_COMMAND.replace('{deviceId}', deviceId);
    const message = JSON.stringify({ command, ...payload });

    logger.info(`Publishing to topic: ${topic}, payload: ${message}`);

    this.client.publish(topic, message, { qos: 1 }, (err) => {
      if (err) {
        logger.error('Failed to send MQTT command:', err);
      } else {
        logger.info(`Sent command to ${deviceId}: ${command}`);
      }
    });
  }

  sendTestCommand(deviceId: string, testCommand: TestCommand): void {
    this.sendCommand(deviceId, 'start_test', testCommand);
  }

  sendWifiConfig(deviceId: string, ssid: string, password: string): void {
    this.sendCommand(deviceId, 'configure_wifi', { ssid, password });
  }

  // Broadcast methods for local test executor
  broadcastProgress(testId: string, deviceId: string, progress: number, step: string): void {
    this.broadcastToWebSockets({
      type: 'test_progress',
      testId,
      deviceId,
      progress,
      currentStep: step,
    });
  }

  broadcastTestComplete(testId: string, deviceId: string, success: boolean, results: object): void {
    this.broadcastToWebSockets({
      type: 'test_completed',
      testId,
      deviceId,
      success,
      results,
    });
  }

  addWebSocketClient(ws: WebSocket): void {
    this.wsClients.add(ws);
  }

  removeWebSocketClient(ws: WebSocket): void {
    this.wsClients.delete(ws);
  }

  /**
   * Public broadcast hook so other services (e.g. updaterService) can fan
   * out events to every connected dashboard client without needing their
   * own WebSocket plumbing. Same fire-and-forget semantics as the internal
   * MQTT broadcasts.
   */
  broadcast(message: object): void {
    this.broadcastToWebSockets(message);
  }

  private broadcastToWebSockets(message: object): void {
    const data = JSON.stringify(message);
    this.wsClients.forEach((ws) => {
      try {
        if (ws.readyState === 1) {
          // WebSocket.OPEN
          ws.send(data);
        }
      } catch (error) {
        logger.error('Error sending WebSocket message:', error);
      }
    });
  }

  // ============================================================================
  // Honeypot and Device-to-Device Testing
  // ============================================================================

  private async handleHoneypotLogs(
    deviceId: string,
    message: {
      deviceId: string;
      type: string;
      timestamp: number;
      totalConnections: number;
      logs: Array<{
        ts: number;
        srcIp: string;
        srcPort: number;
        dstPort: number;
        service: string;
        dataHex?: string;
        dataStr?: string;
        dataLen?: number;
      }>;
    }
  ): Promise<void> {
    try {
      logger.info(`Received ${message.logs?.length || 0} honeypot logs from device ${deviceId}`);

      // Store each log entry
      for (const log of message.logs || []) {
        // For now, we'll broadcast to WebSocket clients
        // In a production system, you'd store these in a database table
        this.broadcastToWebSockets({
          type: 'honeypot_alert',
          deviceId,
          timestamp: new Date(log.ts).toISOString(),
          sourceIp: log.srcIp,
          sourcePort: log.srcPort,
          destPort: log.dstPort,
          service: log.service,
          dataPreview: log.dataStr || (log.dataHex ? `[${log.dataLen} bytes]` : null),
        });

        logger.warn(`[HONEYPOT] ${deviceId}: Connection from ${log.srcIp}:${log.srcPort} to port ${log.dstPort} (${log.service})`);
      }

      // Also send a summary to WebSocket
      this.broadcastToWebSockets({
        type: 'honeypot_summary',
        deviceId,
        totalConnections: message.totalConnections,
        newLogs: message.logs?.length || 0,
      });
    } catch (error) {
      logger.error('Error processing honeypot logs:', error);
    }
  }

  private async handleTestProbeResult(
    deviceId: string,
    message: {
      command: string;
      testId: string;
      targetIp: string;
      port: number;
      success: boolean;
    }
  ): Promise<void> {
    try {
      logger.info(`Test probe result from ${deviceId}: ${message.targetIp}:${message.port} = ${message.success ? 'SUCCESS' : 'FAILED'}`);

      this.broadcastToWebSockets({
        type: 'test_probe_result',
        deviceId,
        testId: message.testId,
        targetIp: message.targetIp,
        port: message.port,
        success: message.success,
      });
    } catch (error) {
      logger.error('Error processing test probe result:', error);
    }
  }

  private async handleDeviceTestResults(
    deviceId: string,
    message: {
      deviceId: string;
      type: string;
      timestamp: number;
      results: Array<{
        ts: number;
        srcDevice: string;
        srcIp: string;
        tgtDevice: string;
        tgtIp: string;
        port: number;
        success: boolean;
        latencyMs: number;
      }>;
    }
  ): Promise<void> {
    try {
      logger.info(`Received ${message.results?.length || 0} device test results from ${deviceId}`);

      for (const result of message.results || []) {
        this.broadcastToWebSockets({
          type: 'device_test_result',
          timestamp: new Date(result.ts).toISOString(),
          sourceDevice: result.srcDevice,
          sourceIp: result.srcIp,
          targetDevice: result.tgtDevice,
          targetIp: result.tgtIp,
          port: result.port,
          success: result.success,
          latencyMs: result.latencyMs,
        });

        const status = result.success ? 'CONNECTED' : 'BLOCKED';
        logger.info(`[D2D Test] ${result.srcDevice} -> ${result.tgtDevice}: ${status} (${result.latencyMs}ms)`);
      }
    } catch (error) {
      logger.error('Error processing device test results:', error);
    }
  }

  // Register a device across all other ESP32 devices for whitelisting
  private async registerDeviceAcrossFleet(deviceId: string, mac: string, ip: string): Promise<void> {
    try {
      // Get all online devices
      const devices = await prisma.device.findMany({
        where: {
          status: 'ONLINE',
          deviceId: { not: deviceId }, // Exclude the device itself
        },
      });

      if (devices.length === 0) return;

      logger.info(`Registering device ${deviceId} (${ip}) across ${devices.length} other devices`);

      // Send registration command to each device
      for (const device of devices) {
        this.sendCommand(device.deviceId, 'register_zeroproof_device', {
          mac,
          deviceId,
          ip,
        });
      }
    } catch (error) {
      logger.error('Error registering device across fleet:', error);
    }
  }

  // Send a test probe command from one device to another
  sendTestProbe(sourceDeviceId: string, targetIp: string, targetPort: number, testId: string): void {
    this.sendCommand(sourceDeviceId, 'send_test_probe', {
      targetIp,
      port: targetPort,
      testId,
    });
  }

  // Configure honeypot on a device
  configureHoneypot(
    deviceId: string,
    config: {
      enabled: boolean;
      ports: Array<{ port: number; service: string }>;
    }
  ): void {
    this.sendCommand(deviceId, 'configure_honeypot', { config });
  }

  // Enable/disable honeypot on a device
  setHoneypotEnabled(deviceId: string, enabled: boolean): void {
    this.sendCommand(deviceId, 'honeypot_enable', { enabled });
  }

  // Add a result listener for mesh tests
  addResultListener(listener: ResultListener): void {
    this.resultListeners.add(listener);
  }

  // Remove a result listener
  removeResultListener(listener: ResultListener): void {
    this.resultListeners.delete(listener);
  }

  // Notify result listeners
  private notifyResultListeners(topic: string, message: any): void {
    this.resultListeners.forEach(listener => {
      try {
        listener(topic, message);
      } catch (error) {
        logger.error('Error in result listener:', error);
      }
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.end();
      this.connected = false;
      logger.info('Disconnected from MQTT broker');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}

export const mqttClient = new MqttService();
export default mqttClient;
