import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import expressWs from 'express-ws';
import type { WebsocketRequestHandler } from 'express-ws';
import config, { isDev, isProd } from './config';
import routes from './api/routes';
import { errorHandler, notFoundHandler } from './api/middleware/error';
import { mqttClient } from './mqtt';
import logger from './utils/logger';

export function createServer(): Express {
  const app = express();
  expressWs(app);

  if (isProd) {
    app.set('trust proxy', 1);
  }

  // Security middleware
  app.use(
    helmet({
      contentSecurityPolicy: isDev ? false : undefined,
    })
  );

  // CORS
  const corsOrigin = config.CORS_ORIGIN
    ? config.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
    : (isDev ? 'http://localhost:5173' : false);
  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    })
  );

  // Body parsing
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Session management with PostgreSQL store (survives restarts)
  const PgStore = connectPgSimple(session);
  const sessionStore = new PgStore({
    conString: config.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15, // Prune expired sessions every 15 min
  });
  app.locals.sessionStore = sessionStore;

  app.use(
    session({
      store: sessionStore,
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: !isDev,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: isDev ? 'lax' : 'strict',
      },
    })
  );

  // Request logging
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      mqtt: mqttClient.isConnected(),
    });
  });

  // API routes
  app.use('/api/v1', routes);

  // WebSocket endpoint
  const wsHandler: WebsocketRequestHandler = (ws, _req) => {
    logger.debug('WebSocket client connected');
    mqttClient.addWebSocketClient(ws as unknown as WebSocket);

    ws.on('message', (msg: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on('close', () => {
      logger.debug('WebSocket client disconnected');
      mqttClient.removeWebSocketClient(ws as unknown as WebSocket);
    });

    ws.on('error', (error: Error) => {
      logger.error('WebSocket error:', error);
      mqttClient.removeWebSocketClient(ws as unknown as WebSocket);
    });
  };
  (app as unknown as expressWs.Application).ws('/ws', wsHandler);

  // Error handling
  app.use(notFoundHandler as express.RequestHandler);
  app.use(errorHandler as express.ErrorRequestHandler);

  return app;
}

export async function closeServerResources(app: Express): Promise<void> {
  const sessionStore = app.locals.sessionStore as { close?: () => Promise<void> } | undefined;
  if (sessionStore?.close) {
    await sessionStore.close();
  }
}

export default createServer;
