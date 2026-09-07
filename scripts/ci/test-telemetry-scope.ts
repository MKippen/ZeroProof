/** Run only through the disposable PostgreSQL wrapper in this directory. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const url = new URL(process.env.DATABASE_URL ?? '');
assert.equal(process.env.TELEMETRY_SCOPE_FIXTURE, 'isolated-postgres');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.username, 'telemetry_fixture');
assert.ok(['/telemetry_fresh', '/telemetry_upgrade'].includes(url.pathname));
const mode = process.argv[2];
assert.ok(['seed-legacy', 'verify-fresh', 'verify-upgrade'].includes(mode));
const requireBackend = createRequire(path.resolve(__dirname, '../../backend/package.json'));

type Scenario = {
  label: string;
  at: number;
  upstreamId?: string;
  beforeFlows?: () => Promise<void>;
};

async function main() {
  const { default: prisma } = await import('../../backend/src/services/database');
  try {
    if (mode === 'seed-legacy') {
      // Use SQL because the current generated client contains columns absent
      // from the old schema. Values match a connection retargeted before upgrade;
      // the source of historical events cannot be inferred from this config.
      await prisma.$executeRaw`INSERT INTO "UniFiConnection"
        (id, name, host, port, "usernameEnc", "passwordEnc", "siteId", "updatedAt", "flowsHighWater", "threatsHighWater")
        VALUES ('fixture-legacy', 'Legacy fixture', 'changed-controller.fixture.invalid', 443,
          'unused', 'unused', 'changed-site', CURRENT_TIMESTAMP, '2026-01-01', '2026-01-02')`;
      await prisma.$executeRaw`INSERT INTO "FirewallFlowEvent"
        (id, "unifiId", "occurredAt", action, policies, "connectionId", "srcIp")
        VALUES ('fixture-legacy-flow', 'reused-upstream-id', '2025-12-31', 'blocked',
          '[{"name":"preserved-policy"}]'::jsonb, 'fixture-legacy', '192.0.2.10')`;
      await prisma.$executeRaw`INSERT INTO "FirewallThreatEvent"
        (id, "unifiId", "occurredAt", message, "rawJson", "connectionId")
        VALUES ('fixture-legacy-threat', 'reused-upstream-id', '2025-12-31', 'preserved-threat',
          '{"marker":"preserved-raw-data"}'::jsonb, 'fixture-legacy')`;
      assert.equal(await prisma.$queryRaw`SELECT id FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`.then((rows: any) => rows.length), 13);
      console.log('PASS: seeded prior 13-migration schema without inferred provenance');
      return;
    }

    if (mode === 'verify-upgrade') {
      const flow = await prisma.firewallFlowEvent.findUniqueOrThrow({ where: { id: 'fixture-legacy-flow' } });
      const threat = await prisma.firewallThreatEvent.findUniqueOrThrow({ where: { id: 'fixture-legacy-threat' } });
      assert.equal(flow.scopeId, null);
      assert.equal(threat.scopeId, null);
      assert.equal(flow.unifiId, 'reused-upstream-id');
      assert.equal(flow.srcIp, '192.0.2.10');
      assert.deepEqual(flow.policies, [{ name: 'preserved-policy' }]);
      assert.equal(threat.message, 'preserved-threat');
      assert.deepEqual(threat.rawJson, { marker: 'preserved-raw-data' });
      assert.equal(await prisma.telemetryScope.count(), 0, 'Migration must not guess historical controller/site');
      console.log('PASS: legacy flow/threat content preserved with unknown scope');
    } else {
      assert.equal(await prisma.uniFiConnection.count(), 0);
      assert.equal(await prisma.telemetryScope.count(), 0);
    }

    const { encrypt } = await import('../../backend/src/utils/encryption');
    const { syncFirewallTelemetry } = await import('../../backend/src/services/firewall/flowSync');
    const { UnifiClient } = requireBackend('@uguard/unifi-client');
    const probe = new UnifiClient({ host: 'unreachable.fixture.invalid', port: 443, username: 'fixture', password: 'fixture' });
    const flowsPrototype = Object.getPrototypeOf(probe.flows);
    const threatsPrototype = Object.getPrototypeOf(probe.threats);
    const original = {
      login: UnifiClient.prototype.login, logout: UnifiClient.prototype.logout,
      flows: flowsPrototype.iterate, threats: threatsPrototype.iterate,
    };
    const queue: Scenario[] = [];
    const requests: Array<{ label: string; kind: string; host: string; port: number; site: string; beginTime: number }> = [];
    const scenarios = new WeakMap<object, Scenario>();
    // Only the controller boundary is stubbed. The real sync service performs
    // configuration capture, encryption, mapping, deduplication, and DB writes.
    // A missing scenario fails immediately instead of contacting any controller.
    UnifiClient.prototype.login = async function () {
      const scenario = queue.shift();
      assert.ok(scenario, 'Unexpected controller login');
      scenarios.set(this.config, scenario);
    };
    UnifiClient.prototype.logout = async function () {};
    flowsPrototype.iterate = async function* (params: any) {
      const scenario = scenarios.get(this.config)!;
      requests.push({ label: scenario.label, kind: 'flows', host: this.config.host, port: this.config.port, site: this.config.siteId, beginTime: params.beginTime });
      await scenario.beforeFlows?.();
      yield { id: scenario.upstreamId ?? 'reused-upstream-id', time: scenario.at, action: 'blocked', policies: [], source: { ip: '192.0.2.20' } };
    };
    threatsPrototype.iterate = async function* (params: any) {
      const scenario = scenarios.get(this.config)!;
      requests.push({ label: scenario.label, kind: 'threats', host: this.config.host, port: this.config.port, site: this.config.siteId, beginTime: params.beginTime });
      yield { id: scenario.upstreamId ?? 'reused-upstream-id', timestamp: scenario.at, message: scenario.label, category: 'THREAT' };
    };

    try {
      const encrypted = encrypt('fixture-credential');
      const oldCursor = new Date('2035-01-01T00:00:00.000Z');
      const createConnection = (id: string, host: string) => prisma.uniFiConnection.create({ data: {
        id, name: id, host, port: 443, siteId: 'site-a', usernameEnc: encrypted, passwordEnc: encrypted,
        flowsHighWater: oldCursor, threatsHighWater: oldCursor,
      } });
      await createConnection('fixture-a', 'controller-a.fixture.invalid');
      await createConnection('fixture-b', 'controller-b.fixture.invalid');
      const now = Date.now();
      const run = (id: string, scenario: Scenario) => { queue.push(scenario); return syncFirewallTelemetry(id); };
      const first = await run('fixture-a', { label: 'first-a', at: now - 60_000 });
      assert.equal(first.flowsInserted, 1);
      assert.equal(first.threatsInserted, 1);
      const again = await run('fixture-a', { label: 'repeat-a', at: now - 60_000 });
      assert.equal(again.flowsInserted, 0);
      assert.equal(again.flowsSkipped, 1);
      assert.equal(again.threatsInserted, 0);
      assert.equal(again.threatsSkipped, 1);
      const otherController = await run('fixture-b', { label: 'first-b', at: now - 55_000 });
      assert.equal(otherController.flowsInserted, 1);
      assert.equal(otherController.threatsInserted, 1);
      await prisma.uniFiConnection.update({ where: { id: 'fixture-a' }, data: { siteId: 'site-b' } });
      const otherSite = await run('fixture-a', { label: 'site-b', at: now - 50_000 });
      assert.equal(otherSite.flowsInserted, 1);
      assert.equal(otherSite.threatsInserted, 1);
      assert.equal(await prisma.telemetryScope.count(), 3);
      assert.equal(await prisma.firewallFlowEvent.count({ where: { scopeId: { not: null }, unifiId: 'reused-upstream-id' } }), 3);
      assert.equal(await prisma.firewallThreatEvent.count({ where: { scopeId: { not: null }, unifiId: 'reused-upstream-id' } }), 3);
      for (const label of ['first-a', 'first-b', 'site-b']) {
        for (const request of requests.filter((entry) => entry.label === label)) {
          assert.ok(request.beginTime < now - 86_400_000, 'New scope must ignore previous connection cursor');
        }
      }
      console.log('PASS: upstream IDs deduplicate within scope and survive distinct controllers/sites');

      await run('fixture-a', { label: 'old-in-flight', upstreamId: 'inflight-event-id', at: now - 10_000, beforeFlows: async () => {
        await prisma.uniFiConnection.update({ where: { id: 'fixture-a' }, data: {
          host: 'controller-c.fixture.invalid', port: 8443, siteId: 'site-c',
        } });
        await run('fixture-a', { label: 'new-target', at: now - 40_000 });
      } });
      const oldScope = await prisma.telemetryScope.findFirstOrThrow({ where: { connectionId: 'fixture-a', controllerHost: 'controller-a.fixture.invalid', siteId: 'site-b' } });
      const newScope = await prisma.telemetryScope.findFirstOrThrow({ where: { connectionId: 'fixture-a', controllerHost: 'controller-c.fixture.invalid', controllerPort: 8443, siteId: 'site-c' } });
      assert.equal(oldScope.flowsHighWater?.getTime(), now - 10_000);
      assert.equal(oldScope.threatsHighWater?.getTime(), now - 10_000);
      assert.equal(newScope.flowsHighWater?.getTime(), now - 40_000);
      assert.equal(newScope.threatsHighWater?.getTime(), now - 40_000);
      assert.equal(await prisma.firewallFlowEvent.count({ where: { scopeId: oldScope.id, unifiId: 'inflight-event-id' } }), 1);
      assert.equal(await prisma.firewallThreatEvent.count({ where: { scopeId: oldScope.id, unifiId: 'inflight-event-id' } }), 1);
      assert.equal(await prisma.firewallFlowEvent.count({ where: { scopeId: newScope.id } }), 1);
      assert.equal(await prisma.firewallThreatEvent.count({ where: { scopeId: newScope.id } }), 1);
      const captured = requests.filter((entry) => entry.label === 'old-in-flight');
      assert.equal(captured.length, 2);
      assert.ok(captured.every((entry) => entry.host === 'controller-a.fixture.invalid' && entry.port === 443 && entry.site === 'site-b'));
      console.log('PASS: in-flight retargeting preserves original scope and independent cursors');

      // The slower older poll commits after a newer poll; its cursor must not
      // move backwards even though both began from the same stored watermark.
      await run('fixture-a', { label: 'older-poll', at: now - 30_000, beforeFlows: async () => {
        await run('fixture-a', { label: 'newer-poll', at: now - 5_000 });
      } });
      const monotonic = await prisma.telemetryScope.findUniqueOrThrow({ where: { id: newScope.id } });
      assert.equal(monotonic.flowsHighWater?.getTime(), now - 5_000);
      assert.equal(monotonic.threatsHighWater?.getTime(), now - 5_000);
      const connection = await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'fixture-a' } });
      assert.equal(connection.flowsHighWater?.getTime(), oldCursor.getTime());
      assert.equal(connection.threatsHighWater?.getTime(), oldCursor.getTime());
      console.log('PASS: overlapping polls advance scope cursors monotonically');

      await createConnection('fixture-concurrent', 'controller-a.fixture.invalid');
      queue.push({ label: 'concurrent-first-a', at: now - 2000 }, { label: 'concurrent-first-b', at: now - 1000 });
      const concurrent = await Promise.all([syncFirewallTelemetry('fixture-concurrent'), syncFirewallTelemetry('fixture-concurrent')]);
      assert.equal(await prisma.telemetryScope.count({ where: { connectionId: 'fixture-concurrent' } }), 1);
      assert.equal(concurrent.reduce((sum, result) => sum + result.flowsInserted, 0), 1);
      assert.equal(concurrent.reduce((sum, result) => sum + result.threatsInserted, 0), 1);
      console.log('PASS: concurrent first polls converge on one scope and one copy of each event');

      await assert.rejects(prisma.firewallFlowEvent.create({ data: {
        scopeId: newScope.id, connectionId: 'fixture-a', unifiId: 'reused-upstream-id',
        occurredAt: new Date(now), action: 'blocked', policies: [],
      } }), (error: any) => error.code === 'P2002', 'Database must reject same-scope duplicate flow IDs');
      await assert.rejects(prisma.firewallThreatEvent.create({ data: {
        scopeId: newScope.id, connectionId: 'fixture-a', unifiId: 'reused-upstream-id', occurredAt: new Date(now),
      } }), (error: any) => error.code === 'P2002', 'Database must reject same-scope duplicate threat IDs');

      // Old application versions omit scopeId. Partial indexes must still make
      // replay idempotent while allowing another connection's identical ID.
      for (const connectionId of ['fixture-a', 'fixture-b']) {
        const flow = { connectionId, unifiId: 'legacy-writer-id', occurredAt: new Date(now), action: 'blocked', policies: [] };
        const threat = { connectionId, unifiId: 'legacy-writer-id', occurredAt: new Date(now) };
        assert.equal((await prisma.firewallFlowEvent.createMany({ data: [flow], skipDuplicates: true })).count, 1);
        assert.equal((await prisma.firewallFlowEvent.createMany({ data: [flow], skipDuplicates: true })).count, 0);
        assert.equal((await prisma.firewallThreatEvent.createMany({ data: [threat], skipDuplicates: true })).count, 1);
        assert.equal((await prisma.firewallThreatEvent.createMany({ data: [threat], skipDuplicates: true })).count, 0);
      }
      console.log('PASS: legacy unscoped writers retain per-connection deduplication');

      const { getTrafficSummary } = await import('../../backend/src/services/firewall/trafficAnalytics');
      const summary = await getTrafficSummary({ connectionId: 'fixture-a', windowHours: 24 });
      assert.equal(summary.totalBlocked, 5);
      assert.equal(summary.threatCount, 5);
      assert.equal(summary.unscopedFlowCount, 1);
      assert.equal(summary.unscopedThreatCount, 1);
      assert.equal(summary.sourceScopeCount, 3);
      console.log('PASS: real traffic aggregates preserve raw counts and report legacy/multiple-source context');
      assert.equal(queue.length, 0);
      console.log(`Telemetry scope fixture passed (${mode}).`);
    } finally {
      UnifiClient.prototype.login = original.login;
      UnifiClient.prototype.logout = original.logout;
      flowsPrototype.iterate = original.flows;
      threatsPrototype.iterate = original.threats;
    }
  } finally {
    await prisma.$disconnect();
  }
}

const deadline = setTimeout(() => { console.error('Telemetry fixture exceeded its two-minute deadline.'); process.exit(1); }, 120_000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
