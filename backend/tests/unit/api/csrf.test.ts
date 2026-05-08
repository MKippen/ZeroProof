/**
 * CSRF middleware behavior — exercised end-to-end through a tiny express
 * app with a stub session. We override NODE_ENV to non-test for the
 * duration of these tests since the middleware bypasses CSRF in test mode
 * (see middleware/csrf.ts for the rationale).
 */
import express from 'express';
import request from 'supertest';
import { csrfProtection, ensureCsrfToken } from '../../../src/api/middleware/csrf';

function buildApp(initialSession: Record<string, unknown> = {}): express.Express {
  const app = express();
  app.use(express.json());

  // Stub session middleware — keeps state per-app instance, no real cookies.
  const session: Record<string, unknown> = { ...initialSession };
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = session;
    next();
  });

  app.use('/api/v1', csrfProtection);

  app.get('/api/v1/auth/csrf', (req, res) => {
    res.json({ success: true, data: { csrfToken: ensureCsrfToken(req) } });
  });
  app.post('/api/v1/anything', (_req, res) => res.json({ success: true }));
  app.get('/api/v1/anything', (_req, res) => res.json({ success: true }));
  app.post('/api/v1/esp32/firmware', (_req, res) => res.json({ success: true }));

  return app;
}

describe('csrfProtection', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeAll(() => {
    process.env.NODE_ENV = 'production';
  });
  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('lets safe methods through with no token', async () => {
    const app = buildApp();
    await request(app).get('/api/v1/anything').expect(200);
  });

  it('exempts ESP32 device endpoints', async () => {
    const app = buildApp();
    await request(app).post('/api/v1/esp32/firmware').expect(200);
  });

  it('rejects mutating requests without an X-CSRF-Token header', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/v1/anything').expect(403);
    expect(res.body.error.code).toBe('CSRF_TOKEN_INVALID');
  });

  it('rejects mutating requests with the wrong token', async () => {
    const app = buildApp({ csrfToken: 'real-token' });
    await request(app)
      .post('/api/v1/anything')
      .set('X-CSRF-Token', 'wrong')
      .expect(403);
  });

  it('accepts mutating requests with the correct token', async () => {
    const app = buildApp({ csrfToken: 'real-token' });
    await request(app)
      .post('/api/v1/anything')
      .set('X-CSRF-Token', 'real-token')
      .expect(200);
  });

  it('mints a token on first GET /auth/csrf and validates it on subsequent POSTs', async () => {
    const app = buildApp();
    const agent = request.agent(app);

    const tokenRes = await agent.get('/api/v1/auth/csrf').expect(200);
    const token = tokenRes.body.data.csrfToken;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    await agent
      .post('/api/v1/anything')
      .set('X-CSRF-Token', token)
      .expect(200);
  });

  it('bypasses entirely when NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    try {
      const app = buildApp();
      await request(app).post('/api/v1/anything').expect(200);
    } finally {
      process.env.NODE_ENV = 'production';
    }
  });
});

describe('ensureCsrfToken', () => {
  it('mints a fresh token when none exists', () => {
    const session: Record<string, unknown> = {};
    const req = { session } as unknown as Parameters<typeof ensureCsrfToken>[0];
    const token = ensureCsrfToken(req);
    expect(typeof token).toBe('string');
    expect(token).toBe(session.csrfToken);
  });

  it('returns the existing token when one is already present', () => {
    const session: Record<string, unknown> = { csrfToken: 'existing' };
    const req = { session } as unknown as Parameters<typeof ensureCsrfToken>[0];
    expect(ensureCsrfToken(req)).toBe('existing');
  });
});
