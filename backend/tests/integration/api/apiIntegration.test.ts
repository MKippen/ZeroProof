import request from 'supertest';
import { closeServerResources, createServer } from '../../../src/server';
import prisma, { connectDatabase, disconnectDatabase } from '../../../src/services/database';
import { initializeDefaultUser } from '../../../src/api/routes/auth';
import { ruleLoader } from '../../../src/services/ruleLoader';
import { startMockUnifiController } from '../../sandbox/mockUnifiController';
import {
  SANDBOX_IMPORT_CONFIGS,
  UNIFI_NETWORK_FIXTURE,
} from '../../sandbox/fixtures/unifiNetworkApi_9_2_17';

type MockController = {
  host: string;
  port: number;
  stop: () => Promise<void>;
};

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

describe('API Integration Tests', () => {
  let mockController: MockController;
  const app = createServer();
  const agent = request.agent(app);
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123!';

  beforeAll(async () => {
    await connectDatabase();
    await resetDatabase();
    await initializeDefaultUser();

    const loadResult = await ruleLoader.initialize();
    if (!loadResult.success) {
      throw new Error(`Failed to load rules: ${loadResult.errors.join('; ')}`);
    }

    mockController = await startMockUnifiController();

    const login = await agent.post('/api/v1/auth/login').send({
      username: 'admin',
      password: adminPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);

    // Import a config fixture
    const importRes = await agent
      .post('/api/v1/config/import')
      .attach(
        'config',
        Buffer.from(JSON.stringify(SANDBOX_IMPORT_CONFIGS[0].data), 'utf8'),
        `${SANDBOX_IMPORT_CONFIGS[0].name}.json`
      );
    expect(importRes.status).toBe(200);
    expect(importRes.body.success).toBe(true);

    // Connect and sync from mock controller
    const saveSettings = await agent.post('/api/v1/unifi/settings').send({
      host: mockController.host,
      port: mockController.port,
      username: UNIFI_NETWORK_FIXTURE.auth.username,
      password: UNIFI_NETWORK_FIXTURE.auth.password,
      selectedSite: 'default',
      autoSync: false,
      syncInterval: 'manual',
    });
    expect(saveSettings.status).toBe(200);

    const syncRes = await agent.post('/api/v1/unifi/sync').send({});
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.success).toBe(true);

    // Bootstrap timeline data from the synced config
    await agent.post('/api/v1/timeline/bootstrap').send({});
  }, 30_000);

  afterAll(async () => {
    ruleLoader.stopWatching();
    if (mockController) {
      await mockController.stop();
    }
    await closeServerResources(app);
    await disconnectDatabase();
  });

  // ── Intent API ──────────────────────────────────────────────────────────

  describe('Intent API', () => {
    it('GET /api/v1/intent/networks returns networks from active config', async () => {
      const res = await agent.get('/api/v1/intent/networks');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hasConfig).toBe(true);
      expect(Array.isArray(res.body.data.networks)).toBe(true);
      expect(res.body.data.networks.length).toBeGreaterThan(0);

      const network = res.body.data.networks[0];
      expect(network).toHaveProperty('_id');
      expect(network).toHaveProperty('name');
      expect(network).toHaveProperty('purpose');
    });

    it('POST /api/v1/intent creates an intent profile', async () => {
      const profile = {
        workFromHome: true,
        workDeviceIsolation: true,
        workVpn: false,
        homeServer: false,
        hasIoT: true,
        iotIsolation: true,
        iotInternetAccess: 'limited',
        hasGaming: false,
        hasNAS: true,
        nasAccessibleFrom: 'trusted',
        guestNetwork: true,
        guestIsolation: true,
        guestBandwidthLimit: true,
        securityLevel: 'balanced',
        dnsFiltering: true,
        malwareBlocking: true,
        interVlanDefault: 'deny',
      };

      const res = await agent.post('/api/v1/intent').send(profile);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile).toBeTruthy();
      expect(res.body.data.profile.securityLevel).toBe('balanced');
      expect(res.body.data.profile.completedAt).toBeTruthy();
      expect(res.body.data.profile.version).toBe(1);
    });

    it('GET /api/v1/intent returns saved profile', async () => {
      const res = await agent.get('/api/v1/intent');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.configured).toBe(true);
      expect(res.body.data.profile.securityLevel).toBe('balanced');
    });

    it('GET /api/v1/intent/analysis returns compliance data', async () => {
      const res = await agent.get('/api/v1/intent/analysis');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('score');
      expect(res.body.data).toHaveProperty('configImportedAt');
      expect(res.body.data).toHaveProperty('analyzedAt');
      expect(typeof res.body.data.score).toBe('number');
    });

    it('PATCH /api/v1/intent/mappings updates mappings and re-analyzes', async () => {
      const res = await agent.patch('/api/v1/intent/mappings').send({
        workNetworkId: 'net-main',
        iotNetworkId: 'net-iot',
        guestNetworkId: 'net-guest',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.profile.networkMappings.workNetworkId).toBe('net-main');
      expect(res.body.data.profile.networkMappings.iotNetworkId).toBe('net-iot');
      expect(res.body.data.analysis).toBeTruthy();
      expect(typeof res.body.data.analysis.score).toBe('number');
    });

    it('full intent flow: profile + mappings + analysis produces a compliance score', async () => {
      const analysis = await agent.get('/api/v1/intent/analysis');
      expect(analysis.status).toBe(200);
      expect(analysis.body.data.score).toBeGreaterThanOrEqual(0);
      expect(analysis.body.data.score).toBeLessThanOrEqual(100);
      expect(Array.isArray(analysis.body.data.gaps) || Array.isArray(analysis.body.data.findings)).toBe(true);
    });
  });

  // ── Security API ────────────────────────────────────────────────────────

  describe('Security API', () => {
    it('GET /api/v1/security/rules returns all rules grouped by source', async () => {
      const res = await agent.get('/api/v1/security/rules');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalRules).toBeGreaterThan(0);
      expect(Array.isArray(res.body.data.sources)).toBe(true);
      expect(res.body.data.sources.length).toBeGreaterThan(0);

      const rulesBySource = res.body.data.rulesBySource;
      expect(typeof rulesBySource).toBe('object');

      const allRules = Object.values(rulesBySource).flat() as any[];
      expect(allRules.length).toBe(res.body.data.totalRules);

      const sampleRule = allRules[0];
      expect(sampleRule).toHaveProperty('id');
      expect(sampleRule).toHaveProperty('name');
      expect(sampleRule).toHaveProperty('severity');
      expect(sampleRule).toHaveProperty('category');
    });

    it('POST /api/v1/security/analyze returns findings with summary', async () => {
      const res = await agent.post('/api/v1/security/analyze').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const { summary, results } = res.body.data;
      expect(summary).toBeTruthy();
      expect(typeof summary.totalRules).toBe('number');
      expect(typeof summary.passed).toBe('number');
      expect(typeof summary.failed).toBe('number');
      expect(summary.bySeverity).toBeTruthy();
      expect(summary.totalRules).toBeGreaterThan(0);
      expect(summary.failed).toBeGreaterThan(0);
      expect(Array.isArray(results)).toBe(true);
    });

    it('POST /api/v1/security/analyze with saveFindings persists vulnerabilities', async () => {
      const res = await agent.post('/api/v1/security/analyze').send({ saveFindings: true });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary.failed).toBeGreaterThan(0);

      const vulns = await prisma.vulnerability.findMany();
      expect(vulns.length).toBeGreaterThan(0);
    });

    it('GET /api/v1/security/analysis returns latest analysis results', async () => {
      const res = await agent.get('/api/v1/security/analysis');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary).toBeTruthy();
      expect(res.body.data.configId).toBeTruthy();
      expect(res.body.data.configImportedAt).toBeTruthy();
      expect(res.body.data.summary.totalRules).toBeGreaterThan(0);
      expect(Array.isArray(res.body.data.results)).toBe(true);
    });
  });

  // ── Timeline API ────────────────────────────────────────────────────────

  describe('Timeline API', () => {
    it('GET /api/v1/timeline/stats returns event counts', async () => {
      const res = await agent.get('/api/v1/timeline/stats');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.data.totalChanges).toBe('number');
      expect(res.body.data.totalChanges).toBeGreaterThan(0);
      expect(typeof res.body.data.totalSyncs).toBe('number');
      expect(typeof res.body.data.totalClients).toBe('number');

      if (res.body.data.changesByType) {
        expect(typeof res.body.data.changesByType).toBe('object');
      }
    });

    it('GET /api/v1/timeline/histogram?days=0 returns all-time histogram', async () => {
      const res = await agent.get('/api/v1/timeline/histogram?days=0');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data).toBeTruthy();
      if (Array.isArray(data.buckets || data)) {
        const buckets = data.buckets || data;
        expect(buckets.length).toBeGreaterThan(0);
      }
    });

    it('GET /api/v1/timeline/histogram?days=90 returns recent data', async () => {
      const res = await agent.get('/api/v1/timeline/histogram?days=90');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeTruthy();
    });

    it('GET /api/v1/timeline/clients returns client list with pagination', async () => {
      const res = await agent.get('/api/v1/timeline/clients?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const data = res.body.data;
      expect(data).toBeTruthy();
      if (data.clients) {
        expect(Array.isArray(data.clients)).toBe(true);
      }
      if (data.total !== undefined) {
        expect(typeof data.total).toBe('number');
      }
      if (data.page !== undefined) {
        expect(data.page).toBe(1);
      }
    });
  });
});
