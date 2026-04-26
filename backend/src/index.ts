import config from './config';
import { closeServerResources, createServer } from './server';
import { connectDatabase, disconnectDatabase } from './services/database';
import { mqttClient } from './mqtt';
import { initializeDefaultUser } from './api/routes/auth';
import { ensureServerDevice } from './services/localTestExecutor';
import { ruleLoader } from './services/ruleLoader';
import logger from './utils/logger';

const PORT = parseInt(config.PORT);

async function main(): Promise<void> {
  logger.info('Starting ZeroProof...');

  try {
    // Connect to database
    await connectDatabase();

    // Initialize default user if needed
    await initializeDefaultUser();

    // Register server as a virtual device for local testing
    await ensureServerDevice();

    // Initialize rule loader (loads YAML rules from disk)
    const ruleLoadResult = await ruleLoader.initialize();
    if (ruleLoadResult.success) {
      logger.info(`✓ Rules loaded: ${ruleLoadResult.rulesLoaded} security, ${ruleLoadResult.testsLoaded} tests, ${ruleLoadResult.intentsLoaded} intents`);
      // Start watching for rule file changes in development
      if (config.NODE_ENV === 'development') {
        ruleLoader.startWatching();
      }
    } else {
      logger.warn('Rule loading had errors:', ruleLoadResult.errors);
    }

    // Connect to MQTT broker
    try {
      await mqttClient.connect();
    } catch (error) {
      logger.warn('MQTT connection failed, continuing without MQTT:', error);
    }

    // Create and start server
    const app = createServer();

    const server = app.listen(PORT, () => {
      logger.info(`✓ Server running on port ${PORT}`);
      logger.info(`  API: http://localhost:${PORT}/api/v1`);
      logger.info(`  Health: http://localhost:${PORT}/health`);
      logger.info(`  WebSocket: ws://localhost:${PORT}/ws`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully...`);

      server.close(async () => {
        ruleLoader.stopWatching();
        await closeServerResources(app);
        await mqttClient.disconnect();
        await disconnectDatabase();
        logger.info('Server shut down');
        process.exit(0);
      });

      // Force shutdown after 10 seconds
      setTimeout(() => {
        logger.error('Forced shutdown');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
