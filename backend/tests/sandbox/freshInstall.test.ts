import request from 'supertest';
import { closeServerResources, createServer } from '../../src/server';
import prisma, { connectDatabase, disconnectDatabase } from '../../src/services/database';
import { initializeDefaultUser } from '../../src/api/routes/auth';
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
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123!';

  beforeAll(async () => {
    await connectDatabase();
    await resetDatabase();
    await initializeDefaultUser();

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

  it('creates default admin user and enforces password change', async () => {
    const login = await agent.post('/api/v1/auth/login').send({
      username: 'admin',
      password: adminPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);
    expect(login.body.data.mustChangePassword).toBe(true);
  });

  it('allows password change on first login', async () => {
    const newPassword = 'NewSecureP@ss1!';

    const changeRes = await agent.post('/api/v1/auth/change-password').send({
      currentPassword: adminPassword,
      newPassword,
    });
    expect(changeRes.status).toBe(200);
    expect(changeRes.body.success).toBe(true);

    // Verify mustChangePassword is now false by checking /me
    const meRes = await agent.get('/api/v1/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.user.mustChangePassword).toBe(false);

    // Change password back so subsequent tests can still use the original
    const revertRes = await agent.post('/api/v1/auth/change-password').send({
      currentPassword: newPassword,
      newPassword: adminPassword,
    });
    expect(revertRes.status).toBe(200);
    expect(revertRes.body.success).toBe(true);
  });

  it('returns empty state for dashboard with no config', async () => {
    const dashboard = await agent.get('/api/v1/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.success).toBe(true);
    expect(dashboard.body.data.hasConfig).toBe(false);
    expect(dashboard.body.data.securityScore).toBe(100);
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

  it('handles logout and session invalidation', async () => {
    const logoutRes = await agent.post('/api/v1/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Subsequent authenticated request should return 401
    const dashboard = await agent.get('/api/v1/dashboard');
    expect(dashboard.status).toBe(401);
  });
});
