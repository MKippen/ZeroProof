/**
 * Env validator tests. Most importantly, pins the regression where
 * DEFAULT_ADMIN_PASSWORD="" (the docker-compose-default for an unset
 * .env value) must be treated as "unset", not as "present-but-too-short".
 */
import { envSchema } from '../../../src/config';

const VALID_BASE = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://postgres:pw@postgres:5432/zeroproof',
  SESSION_SECRET: 'a'.repeat(32),
  ENCRYPTION_KEY: 'b'.repeat(32),
};

describe('envSchema', () => {
  describe('DEFAULT_ADMIN_PASSWORD', () => {
    it('accepts an empty string and coerces it to undefined', () => {
      const result = envSchema.safeParse({
        ...VALID_BASE,
        DEFAULT_ADMIN_PASSWORD: '',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DEFAULT_ADMIN_PASSWORD).toBeUndefined();
      }
    });

    it('accepts a missing field as undefined', () => {
      const result = envSchema.safeParse({ ...VALID_BASE });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DEFAULT_ADMIN_PASSWORD).toBeUndefined();
      }
    });

    it('rejects a non-empty value that is too short (less than 8 chars)', () => {
      const result = envSchema.safeParse({
        ...VALID_BASE,
        DEFAULT_ADMIN_PASSWORD: 'short',
      });
      expect(result.success).toBe(false);
    });

    it('accepts a non-empty value that meets the length requirement', () => {
      const result = envSchema.safeParse({
        ...VALID_BASE,
        DEFAULT_ADMIN_PASSWORD: 'longenoughpw',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.DEFAULT_ADMIN_PASSWORD).toBe('longenoughpw');
      }
    });
  });

  describe('SESSION_SECRET / ENCRYPTION_KEY length floors', () => {
    it('rejects a SESSION_SECRET shorter than 32 chars', () => {
      const result = envSchema.safeParse({
        ...VALID_BASE,
        SESSION_SECRET: 'too-short',
      });
      expect(result.success).toBe(false);
    });

    it('rejects an ENCRYPTION_KEY shorter than 32 chars', () => {
      const result = envSchema.safeParse({
        ...VALID_BASE,
        ENCRYPTION_KEY: 'too-short',
      });
      expect(result.success).toBe(false);
    });
  });
});
