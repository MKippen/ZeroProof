import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

dotenvConfig();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  DATABASE_URL: z.string(),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  MQTT_BROKER: z.string().default('localhost'),
  MQTT_PORT: z.string().default('1883'),
  MQTT_USERNAME: z.string().optional(),
  MQTT_PASSWORD: z.string().optional(),
  DEFAULT_ADMIN_PASSWORD: z.string().min(8).optional(),
  CORS_ORIGIN: z.string().optional(),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }

  const parsed = result.data;
  if (parsed.NODE_ENV === 'production') {
    const unsafeProductionValues = new Set([
      'admin123!',
      'dev_password',
      'mqtt_password',
      'dev-session-secret-change-me',
      'dev-session-secret-change-me-32chars',
      'dev-encryption-key-32-bytes-min',
      'dev-encryption-key-32-bytes-minimum',
      'sandbox-session-secret-32-characters-minimum',
      'sandbox-encryption-key-32-characters-min',
    ]);

    const unsafeKeys = [
      ['SESSION_SECRET', parsed.SESSION_SECRET],
      ['ENCRYPTION_KEY', parsed.ENCRYPTION_KEY],
      ['DEFAULT_ADMIN_PASSWORD', parsed.DEFAULT_ADMIN_PASSWORD],
      ['MQTT_PASSWORD', parsed.MQTT_PASSWORD],
    ].filter(([, value]) => value && unsafeProductionValues.has(value));

    if (unsafeKeys.length > 0) {
      console.error('Invalid production environment variables: replace development placeholder secrets.');
      console.error(unsafeKeys.map(([key]) => `- ${key}`).join('\n'));
      process.exit(1);
    }
  }

  return parsed;
}

export const config = loadConfig();

export const isDev = config.NODE_ENV === 'development';
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

export default config;
