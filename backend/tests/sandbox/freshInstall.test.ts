import request from 'supertest';
import { closeServerResources, createServer } from '../../src/server';
import prisma, { connectDatabase, disconnectDatabase } from '../../src/services/database';
import { ruleLoader } from '../../src/services/ruleLoader';
import { SANDBOX_IMPORT_CONFIGS } from './fixtures/unifiNetworkApi_9_2_17';

async function resetDatabase(): Promise<void> {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  if (!tables.length) return;

  const tableList = tables
    .map(({ tablename }) => `"${tablename.replace(/"/g, '""')}"`)
    .join(', ');

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE;`);
}

describe('Fresh Install Experience', () => {
  const app = createServer();
  const agent = request.agent(app);
  const setupUsername = 'mike';
  const setupPassword = 'CorrectHorseBattery42!';

  beforeAll(async () => {
    await connectDatabase();
    await resetDatabase();
    // Deliberately skip initializeDefaultUser() — these tests model a fresh
    // install where no operator-supplied seed password is set, so the DB
    // stays empty until /setup is hit.

    const loadResult = await ruleLoader.initialize();
    if (!loadResult.success) {
      throw new Error(`Failed to load rules for fresh install harness: ${loadResult.errors.join('; ')}`);
    }
  });

  afterAll(async () => {
    ruleLoader.stopWatching();
    await closeServerResources(app);
    await disconnectDatabase();
  });

  it('reports initialized=false on a truly fresh install', async () => {
    const res = await request(app).get('/api/v1/auth/setup-status');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.initialized).toBe(false);
  });

  it('refuses login before setup has been completed', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      username: 'admin',
      password: 'admin123!',
    });
    expect(login.status).toBe(401);
    expect(login.body.success).toBe(false);
  });

  it('rejects setup with weak password', async () => {
    const res = await request(app).post('/api/v1/auth/setup').send({
      username: setupUsername,
      password: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects setup with invalid username characters', async () => {
    const res = await request(app).post('/api/v1/auth/setup').send({
      username: 'has spaces',
      password: setupPassword,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('completes setup and creates the admin user', async () => {
    const res = await request(app).post('/api/v1/auth/setup').send({
      username: setupUsername,
      password: setupPassword,
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.username).toBe(setupUsername);
  });

  it('reports initialized=true after setup', async () => {
    const res = await request(app).get('/api/v1/auth/setup-status');
    expect(res.status).toBe(200);
    expect(res.body.data.initialized).toBe(true);
  });

  it('refuses to run setup a second time', async () => {
    const res = await request(app).post('/api/v1/auth/setup').send({
      username: 'someone-else',
      password: 'AnotherStrongP@ss123',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_INITIALIZED');
  });

  it('logs in with the credentials chosen during setup', async () => {
    const login = await agent.post('/api/v1/auth/login').send({
      username: setupUsername,
      password: setupPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);
    // No "must change password" because the user just chose it themselves.
    expect(login.body.data.mustChangePassword).toBe(false);
  });

  it('returns empty state for dashboard with no config', async () => {
    const dashboard = await agent.get('/api/v1/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.success).toBe(true);
    expect(dashboard.body.data.hasConfig).toBe(false);
    // securityScore is null until something has been scanned — see
    // dashboard.ts; "100" would falsely advertise a clean network.
    expect(dashboard.body.data.securityScore).toBeNull();
  });

  it('returns empty state for security analysis with no config', async () => {
    const analyze = await agent.post('/api/v1/security/analyze').send({});
    expect(analyze.status).toBe(400);
    expect(analyze.body.success).toBe(false);
    expect(analyze.body.error.code).toBe('NO_CONFIG');
  });

  it('returns empty state for intent with no config', async () => {
    const networks = await agent.get('/api/v1/intent/networks');
    expect(networks.status).toBe(200);
    expect(networks.body.success).toBe(true);
    expect(networks.body.data.hasConfig).toBe(false);
    expect(networks.body.data.networks).toEqual([]);
  });

  it('returns empty state for timeline with no config', async () => {
    const stats = await agent.get('/api/v1/timeline/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.success).toBe(true);
    expect(stats.body.data.totalChanges).toBe(0);
    expect(stats.body.data.totalSyncs).toBe(0);

    const histogram = await agent.get('/api/v1/timeline/histogram?days=90');
    expect(histogram.status).toBe(200);
    expect(histogram.body.success).toBe(true);
    expect(Array.isArray(histogram.body.data)).toBe(true);
    expect(
      histogram.body.data.every((bucket: { total?: number }) => bucket.total === 0)
    ).toBe(true);
  });

  it('handles config import and enables security analysis', async () => {
    // Import a config
    const fixture = SANDBOX_IMPORT_CONFIGS[0];
    const importRes = await agent
      .post('/api/v1/config/import')
      .attach(
        'config',
        Buffer.from(JSON.stringify(fixture.data), 'utf8'),
        `${fixture.name}.json`
      );
    expect(importRes.status).toBe(200);
    expect(importRes.body.success).toBe(true);
    expect(importRes.body.data?.config?.id).toBeTruthy();

    // Security analysis should now work
    const analyze = await agent.post('/api/v1/security/analyze').send({});
    expect(analyze.status).toBe(200);
    expect(analyze.body.success).toBe(true);
    expect(analyze.body.data.summary).toBeTruthy();
    expect(analyze.body.data.summary.totalRules).toBeGreaterThan(0);

    // Intent networks should now return networks
    const networks = await agent.get('/api/v1/intent/networks');
    expect(networks.status).toBe(200);
    expect(networks.body.success).toBe(true);
    expect(networks.body.data.hasConfig).toBe(true);
    expect(networks.body.data.networks.length).toBeGreaterThan(0);
  });

  it('exposes firmware info that matches the on-disk binary', async () => {
    const res = await agent.get('/api/v1/esp32/firmware/info');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.firmware).toMatchObject({
      version: expect.any(String),
      filename: expect.any(String),
      releaseDate: expect.any(String),
    });
    // available reflects actual on-disk state — true when the binary is
    // present and non-empty, false otherwise. Asserting both branches keeps
    // this useful regardless of whether the dev box has run `pio run` yet.
    expect(typeof res.body.data.available).toBe('boolean');
    if (res.body.data.available) {
      expect(res.body.data.firmware.size).toBeGreaterThan(0);
      expect(res.body.data.firmware.checksum).toMatch(/^[a-f0-9]{64}$/);
    } else {
      expect(res.body.data.firmware.size).toBe(0);
    }
  });

  it('handles logout and session invalidation', async () => {
    const logoutRes = await agent.post('/api/v1/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Subsequent authenticated request should return 401
    const dashboard = await agent.get('/api/v1/dashboard');
    expect(dashboard.status).toBe(401);
  });
});
