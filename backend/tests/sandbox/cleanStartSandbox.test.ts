import request from 'supertest';
import { closeServerResources, createServer } from '../../src/server';
import prisma, { connectDatabase, disconnectDatabase } from '../../src/services/database';
import { initializeDefaultUser } from '../../src/api/routes/auth';
import { ruleLoader } from '../../src/services/ruleLoader';
import { startMockUnifiController } from './mockUnifiController';
import {
  SANDBOX_IMPORT_CONFIGS,
  UNIFI_NETWORK_FIXTURE,
  UNIFI_NETWORK_FIXTURE_VERSION,
} from './fixtures/unifiNetworkApi_9_2_17';

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

describe('Sandbox Clean-Start Harness', () => {
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
      throw new Error(`Failed to load rules for sandbox harness: ${loadResult.errors.join('; ')}`);
    }

    mockController = await startMockUnifiController();
  });

  afterAll(async () => {
    ruleLoader.stopWatching();
    if (mockController) {
      await mockController.stop();
    }
    await closeServerResources(app);
    await disconnectDatabase();
  });

  it('starts from a clean DB and enforces auth on rules endpoints', async () => {
    const unauthRules = await request(app).get('/api/v1/rules');
    expect(unauthRules.status).toBe(401);

    const login = await agent.post('/api/v1/auth/login').send({
      username: 'admin',
      password: adminPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.success).toBe(true);

    const dashboard = await agent.get('/api/v1/dashboard');
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.success).toBe(true);

    const authRules = await agent.get('/api/v1/rules');
    expect(authRules.status).toBe(200);
    expect(authRules.body.success).toBe(true);
  });

  it('imports multiple clean-start fixture configs via /config/import', async () => {
    for (const fixture of SANDBOX_IMPORT_CONFIGS) {
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
    }
  });

  it(`syncs from mock UniFi controller dataset (${UNIFI_NETWORK_FIXTURE_VERSION})`, async () => {
    const testConnection = await agent.post('/api/v1/unifi/test').send({
      host: mockController.host,
      port: mockController.port,
      username: UNIFI_NETWORK_FIXTURE.auth.username,
      password: UNIFI_NETWORK_FIXTURE.auth.password,
    });
    expect(testConnection.status).toBe(200);
    expect(testConnection.body.success).toBe(true);
    expect(testConnection.body.data?.connected).toBe(true);
    expect(Array.isArray(testConnection.body.data?.sites)).toBe(true);

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
    expect(saveSettings.body.success).toBe(true);

    const syncRes = await agent.post('/api/v1/unifi/sync').send({});
    expect(syncRes.status).toBe(200);
    expect(syncRes.body.success).toBe(true);
    expect(syncRes.body.data?.config?.id).toBeTruthy();

    const currentConfig = await agent.get('/api/v1/config/current');
    expect(currentConfig.status).toBe(200);
    expect(currentConfig.body.success).toBe(true);
    expect(currentConfig.body.data?.config?.controllerVersion).toBe(UNIFI_NETWORK_FIXTURE_VERSION);

    const analyze = await agent.post('/api/v1/security/analyze').send({ saveFindings: true });
    expect(analyze.status).toBe(200);
    expect(analyze.body.success).toBe(true);

    const { summary, results } = analyze.body.data;
    expect(summary).toBeTruthy();

    // --- Severity counts should be non-trivial ---
    expect(summary.failed).toBeGreaterThan(0);
    expect(summary.bySeverity.CRITICAL + summary.bySeverity.HIGH).toBeGreaterThan(0);

    // Helper: find a rule result by ID
    const findRule = (id: string) => results.find((r: any) => r.ruleId === id);

    // --- IS-FW-001: any-any firewall rule should fire ---
    // Fixture has "Allow LAN Any Any" with action=accept, protocol=all, no src/dst
    const fwAny = findRule('IS-FW-001');
    expect(fwAny).toBeDefined();
    expect(fwAny.passed).toBe(false);
    expect(fwAny.findings.length).toBeGreaterThan(0);

    // --- IS-PORT-001: sensitive port forward should fire ---
    // Fixture has RDP forward on port 3389
    const portFwd = findRule('IS-PORT-001');
    expect(portFwd).toBeDefined();
    expect(portFwd.passed).toBe(false);
    expect(portFwd.findings.length).toBeGreaterThan(0);

    // --- IS-WIFI-001: open WiFi rule should NOT fire on guest network ---
    // Guest-WiFi is open but is_guest=true, rule filters exclude guest networks
    const openWifi = findRule('IS-WIFI-001');
    if (openWifi) {
      // Rule was evaluated but should pass (no non-guest open networks)
      expect(openWifi.passed).toBe(true);
    }
    // If rule not in results at all, that's also acceptable (no applicable targets)

    // --- IS-VLAN-001: IoT not isolated should fire ---
    // IoT network has network_isolation: false
    const vlanIsolation = findRule('IS-VLAN-001');
    expect(vlanIsolation).toBeDefined();
    expect(vlanIsolation.passed).toBe(false);
    expect(vlanIsolation.findings.length).toBeGreaterThan(0);

    // --- IS-WIFI-003: PMF disabled should fire ---
    // IoT-WiFi has pmf_mode: "disabled"
    const pmf = findRule('IS-WIFI-003');
    expect(pmf).toBeDefined();
    expect(pmf.passed).toBe(false);
    expect(pmf.findings.length).toBeGreaterThan(0);
  });
});
