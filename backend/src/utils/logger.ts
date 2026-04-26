import winston from 'winston';
import fs from 'fs';
import { isDev } from '../config';

if (!isDev) {
  fs.mkdirSync('logs', { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  isDev
    ? winston.format.combine(winston.format.colorize(), winston.format.simple())
    : winston.format.json()
);

export const logger = winston.createLogger({
  level: isDev ? 'debug' : 'info',
  format: logFormat,
  defaultMeta: { service: 'zeroproof' },
  transports: [
    new winston.transports.Console(),
    ...(isDev
      ? []
      : [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]),
  ],
});

export default logger;
