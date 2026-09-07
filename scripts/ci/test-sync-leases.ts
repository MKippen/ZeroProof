/** Production lease/service calls against a database owned by the shell wrapper. */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const url = new URL(process.env.DATABASE_URL ?? '');
assert.equal(process.env.SYNC_LEASE_FIXTURE, 'isolated-postgres');
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.username, 'sync_fixture');
assert.ok(['/sync_fresh', '/sync_upgrade'].includes(url.pathname));
const mode = process.argv[2];
assert.ok(['seed-legacy', 'verify-fresh', 'verify-upgrade'].includes(mode));

async function main() {
  const { default: prisma } = await import('../../backend/src/services/database');
  const { encrypt } = await import('../../backend/src/utils/encryption');
  try {
    const credentials = encrypt('fixture-password');
    if (mode === 'seed-legacy') {
      await prisma.uniFiConnection.create({ data: {
        id: 'legacy-sync-connection', name: 'Preserved connection', host: 'unused.fixture.invalid',
        usernameEnc: credentials, passwordEnc: credentials, autoSync: true,
        lastSyncStatus: 'IN_PROGRESS', lastSyncAt: new Date('2026-01-01T00:00:00Z'),
      } });
      await prisma.uniFiSyncHistory.create({ data: {
        id: 'legacy-sync-history', connectionId: 'legacy-sync-connection', status: 'IN_PROGRESS',
        startedAt: new Date('2026-01-01T00:00:00Z'),
      } });
      await prisma.configuration.create({ data: {
        id: 'legacy-sync-config', configHash: 'legacy-sync-config-hash', siteName: 'Preserved site',
        configJson: { fixture: 'retain-after-upgrade', firewallRules: [], clients: [] },
      } });
      const applied = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
      assert.equal(Number(applied[0].count), 14);
      console.log('PASS: seeded prior 14-migration state with interrupted sync and retained configuration');
      return;
    }

    const applied = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    assert.equal(Number(applied[0].count), 15);
    if (mode === 'verify-upgrade') {
      assert.equal((await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'legacy-sync-connection' } })).lastSyncStatus, 'IN_PROGRESS');
      assert.equal((await prisma.uniFiSyncHistory.findUniqueOrThrow({ where: { id: 'legacy-sync-history' } })).status, 'IN_PROGRESS');
      assert.deepEqual((await prisma.configuration.findUniqueOrThrow({ where: { id: 'legacy-sync-config' } })).configJson,
        { fixture: 'retain-after-upgrade', firewallRules: [], clients: [] });
      assert.equal(await prisma.jobLease.count(), 0);
      console.log('PASS: additive lease migration preserves interrupted state and configuration evidence');
    }

    const { acquireJobLease, withJobLease, JobLeaseBusyError, JobLeaseLostError } = await import('../../backend/src/services/jobLease');
    const claims = await Promise.all(Array.from({ length: 12 }, () => acquireJobLease('fixture:claim', { ttlMs: 5000 })));
    const owners = claims.filter((claim) => claim !== null);
    assert.equal(owners.length, 1);
    const owner = owners[0]!;
    assert.equal((await prisma.jobLease.findUniqueOrThrow({ where: { key: owner.key } })).ownerToken, owner.ownerToken);
    const independent = await acquireJobLease('fixture:independent', { ttlMs: 5000 });
    assert.ok(independent);
    await owner.publish(async (tx) => {
      await tx.setting.create({ data: { key: 'fixture-owned-publication', value: { owner: owner.ownerToken } } });
    });
    await prisma.jobLease.update({ where: { key: owner.key }, data: { expiresAt: new Date(Date.now() + 1000) } });
    await owner.renew();
    assert.ok((await prisma.jobLease.findUniqueOrThrow({ where: { key: owner.key } })).expiresAt.getTime() > Date.now() + 3000);
    await owner.release();
    await independent.release();
    assert.equal(await prisma.jobLease.count(), 0);
    console.log('PASS: simultaneous claims choose one owner; renewal and separate job keys remain independent');

    const stale = await acquireJobLease('fixture:recovery', { ttlMs: 5000 });
    assert.ok(stale);
    await prisma.jobLease.update({ where: { key: stale.key }, data: { expiresAt: new Date(0) } });
    const replacement = await acquireJobLease(stale.key, { ttlMs: 5000 });
    assert.ok(replacement);
    assert.notEqual(replacement.ownerToken, stale.ownerToken);
    let stalePublished = false;
    await assert.rejects(stale.publish(async () => { stalePublished = true; }), JobLeaseLostError);
    assert.equal(stalePublished, false);
    await stale.release();
    assert.equal((await prisma.jobLease.findUniqueOrThrow({ where: { key: stale.key } })).ownerToken, replacement.ownerToken);
    await replacement.release();
    console.log('PASS: expired owners recover; stale publish and release cannot affect a successor');

    const publishing = await acquireJobLease('fixture:publication-lock', { ttlMs: 500, transactionTimeoutMs: 3000 });
    assert.ok(publishing);
    let entered!: () => void;
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    const publication = publishing.publish(async (tx) => {
      entered();
      // This database operation outlives the lease's nominal TTL. The locked
      // publication must finish before a contender can evaluate takeover.
      await tx.$executeRaw`SELECT pg_sleep(1.2)`;
      await tx.setting.create({ data: { key: 'fixture-long-publication', value: true } });
    });
    await locked;
    await delay(700);
    const contender = acquireJobLease(publishing.key, { ttlMs: 500 });
    await publication;
    assert.equal(await contender, null);
    assert.equal((await prisma.jobLease.findUniqueOrThrow({ where: { key: publishing.key } })).ownerToken, publishing.ownerToken);
    await publishing.release();
    console.log('PASS: publication row lock prevents takeover past nominal expiry and refreshes on commit');

    const unavailable = await acquireJobLease('fixture:db-failure', { ttlMs: 5000 });
    assert.ok(unavailable);
    await prisma.$executeRawUnsafe('ALTER TABLE "JobLease" RENAME TO "JobLease_fixture_unavailable"');
    try {
      await assert.rejects(acquireJobLease('fixture:no-database'));
      await assert.rejects(unavailable.renew());
      assert.equal(unavailable.signal.aborted, true);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "JobLease_fixture_unavailable" RENAME TO "JobLease"');
    }
    await assert.rejects(unavailable.publish(async () => { throw new Error('Unsafe publication after lost lease'); }), JobLeaseLostError);
    await unavailable.release();
    console.log('PASS: database failure prevents claims and permanently fences an owner that cannot renew');

    await withJobLease('fixture:heartbeat', async (lease) => {
      // Survive more than two lease lifetimes using the actual timer + DB clock.
      await delay(1200);
      assert.equal(await acquireJobLease(lease.key, { ttlMs: 500 }), null);
      await lease.publish(async (tx) => {
        await tx.setting.create({ data: { key: 'fixture-heartbeat-publication', value: true } });
      });
    }, { ttlMs: 500, renewIntervalMs: 100 });
    assert.equal(await prisma.jobLease.count(), 0);
    console.log('PASS: automatic renewal retains ownership until fenced publication and releases afterwards');

    const { syncUniFiConfiguration } = await import('../../backend/src/services/unifiSyncService');
    const createConnection = (id: string, overrides: object = {}) => prisma.uniFiConnection.create({ data: {
      id, name: id, host: 'unused.fixture.invalid', usernameEnc: credentials, passwordEnc: credentials,
      autoSync: true, ...overrides,
    } });
    const fullConfig = (label: string) => ({
      sites: [{ _id: 'fixture-site', name: 'default', desc: label }], devices: [], networks: [],
      firewallRules: [], firewallPolicies: [], firewallGroups: [], wlans: [], portForwards: [],
      trafficRules: [], routingRules: [], clients: [], settings: [], aclRules: [],
      rawNetworkConfig: [], vpnServers: [], trafficMatchingLists: [], firewallZones: [],
      sysInfo: null, fetchedAt: new Date(),
    });
    let logoutCalls = 0;
    const client = (label: string, fetch?: () => Promise<void>, failLogout = false) => ({
      login: async () => true,
      logout: async () => { logoutCalls += 1; if (failLogout) throw new Error('fixture logout failed'); },
      getFullConfig: async () => { await fetch?.(); return fullConfig(label) as any; },
      getEvents: async () => [], getAlarms: async () => [],
    });
    if (mode === 'verify-fresh') {
      await createConnection('legacy-sync-connection', { lastSyncStatus: 'IN_PROGRESS', lastSyncAt: new Date(0) });
      await prisma.uniFiSyncHistory.create({ data: {
        id: 'legacy-sync-history', connectionId: 'legacy-sync-connection', status: 'IN_PROGRESS', startedAt: new Date(0),
      } });
    }
    // A prior success can be recent when the following run crashes. Recovery
    // must not wait for its normal interval once no live lease remains.
    await prisma.uniFiConnection.update({ where: { id: 'legacy-sync-connection' }, data: { lastSyncAt: new Date() } });
    const recovered = await syncUniFiConfiguration({ connectionId: 'legacy-sync-connection', trigger: 'scheduled' },
      { createClient: () => client('legacy-recovered') });
    assert.ok(recovered);
    const interrupted = await prisma.uniFiSyncHistory.findUniqueOrThrow({ where: { id: 'legacy-sync-history' } });
    assert.equal(interrupted.status, 'FAILED');
    assert.ok(interrupted.completedAt);
    assert.equal((await prisma.uniFiSyncHistory.findUniqueOrThrow({ where: { id: recovered.syncId } })).status, 'SUCCESS');
    if (mode === 'verify-upgrade') assert.ok(await prisma.configuration.findUnique({ where: { id: 'legacy-sync-config' } }));
    console.log('PASS: ownerless legacy IN_PROGRESS history recovers through the real scheduled sync service');

    await createConnection('fixture-sync-a');
    let fetchEntered!: () => void;
    let finishFetch!: () => void;
    const fetching = new Promise<void>((resolve) => { fetchEntered = resolve; });
    const fetchReleased = new Promise<void>((resolve) => { finishFetch = resolve; });
    const manual = syncUniFiConfiguration({ connectionId: 'fixture-sync-a', trigger: 'manual' }, {
      createClient: () => client('manual-winner', async () => { fetchEntered(); await fetchReleased; }),
    });
    await fetching;
    try {
      await assert.rejects(syncUniFiConfiguration({ connectionId: 'fixture-sync-a', trigger: 'scheduled' },
        { createClient: () => { throw new Error('Contending scheduler reached controller'); } }), JobLeaseBusyError);
      assert.equal(await prisma.uniFiSyncHistory.count({ where: { connectionId: 'fixture-sync-a' } }), 1);
    } finally { finishFetch(); }
    const completed = await manual;
    assert.ok(completed);
    assert.equal((await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'fixture-sync-a' } })).lastSyncStatus, 'SUCCESS');
    assert.equal(await syncUniFiConfiguration({ connectionId: 'fixture-sync-a', trigger: 'scheduled' },
      { createClient: () => { throw new Error('Not-due scheduler reached controller'); } }), null);
    assert.equal(await prisma.jobLease.count(), 0);
    console.log('PASS: manual and scheduled sync contend for one owner; not-due schedules create no extra run');

    await createConnection('fixture-bad-credentials', { passwordEnc: 'invalid-encrypted-value' });
    await assert.rejects(syncUniFiConfiguration({ connectionId: 'fixture-bad-credentials', trigger: 'manual' },
      { createClient: () => { throw new Error('Invalid credentials reached controller'); } }));
    assert.equal((await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'fixture-bad-credentials' } })).lastSyncStatus, 'FAILED');
    assert.equal((await prisma.uniFiSyncHistory.findFirstOrThrow({ where: { connectionId: 'fixture-bad-credentials' } })).status, 'FAILED');
    assert.equal(await prisma.jobLease.count(), 0);
    const beforeLogoutFailure = logoutCalls;
    const logoutFailed = await syncUniFiConfiguration({ connectionId: 'fixture-sync-a', trigger: 'manual' },
      { createClient: () => client('logout-failure', undefined, true) });
    assert.ok(logoutFailed);
    assert.equal(logoutCalls, beforeLogoutFailure + 1);
    assert.equal((await prisma.uniFiSyncHistory.findUniqueOrThrow({ where: { id: logoutFailed.syncId } })).status, 'SUCCESS');
    assert.equal((await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'fixture-sync-a' } })).lastSyncStatus, 'SUCCESS');
    console.log('PASS: decryption failure finalizes FAILED; logout failure preserves a committed SUCCESS');

    let staleEntered!: () => void;
    let staleResume!: () => void;
    const oldFetching = new Promise<void>((resolve) => { staleEntered = resolve; });
    const oldReleased = new Promise<void>((resolve) => { staleResume = resolve; });
    const oldSync = syncUniFiConfiguration({ connectionId: 'fixture-sync-a', trigger: 'manual' }, {
      createClient: () => client('stale-must-never-publish', async () => { staleEntered(); await oldReleased; }),
    });
    // Attach the rejection handler before waking the old worker.
    const oldRejected = assert.rejects(oldSync, JobLeaseLostError);
    await oldFetching;
    await prisma.jobLease.update({ where: { key: 'unifi:configuration-sync' }, data: { expiresAt: new Date(0) } });
    let replacementSync;
    try {
      replacementSync = await syncUniFiConfiguration({ connectionId: 'fixture-sync-a', trigger: 'manual' },
        { createClient: () => client('replacement-owner') });
    } finally { staleResume(); }
    await oldRejected;
    assert.ok(replacementSync);
    assert.equal((await prisma.uniFiSyncHistory.findUniqueOrThrow({ where: { id: replacementSync.syncId } })).status, 'SUCCESS');
    assert.equal((await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'fixture-sync-a' } })).lastSyncStatus, 'SUCCESS');
    assert.equal(await prisma.configuration.count({ where: { siteName: 'stale-must-never-publish' } }), 0);
    assert.equal((await prisma.configuration.findUniqueOrThrow({ where: { id: replacementSync.configId } })).isActive, true);
    assert.equal(await prisma.jobLease.count(), 0);
    console.log('PASS: an expired sync cannot publish stale configuration or overwrite its successful replacement');

    await createConnection('fixture-retarget');
    const publicationCounts = async () => Promise.all([
      prisma.configuration.count(), prisma.vulnerability.count(),
      prisma.networkClient.count(), prisma.uniFiConfigChange.count(),
    ]);
    const beforeRetarget = await publicationCounts();
    let retargetEntered!: () => void;
    let retargetResume!: () => void;
    const retargetFetching = new Promise<void>((resolve) => { retargetEntered = resolve; });
    const retargetReleased = new Promise<void>((resolve) => { retargetResume = resolve; });
    const retargetSync = syncUniFiConfiguration({ connectionId: 'fixture-retarget', trigger: 'manual' }, {
      createClient: () => ({
        ...client('retarget-must-never-publish'),
        getFullConfig: async () => {
          retargetEntered();
          await retargetReleased;
          return { ...fullConfig('retarget-must-never-publish'), clients: [
            { mac: '02:00:00:00:00:88', hostname: 'stale-controller-client', ip: '192.0.2.88' },
          ] } as any;
        },
      }),
    });
    const retargetRejected = assert.rejects(retargetSync,
      (error: unknown) => error instanceof Error && 'code' in error && error.code === 'CONNECTION_CHANGED');
    await retargetFetching;
    const newEndpointSyncTime = new Date('2026-02-01T00:00:00Z');
    try {
      await prisma.uniFiConnection.update({ where: { id: 'fixture-retarget' }, data: {
        host: 'replacement.fixture.invalid', siteId: 'replacement-site', lastSyncAt: newEndpointSyncTime,
      } });
    } finally { retargetResume(); }
    await retargetRejected;
    assert.deepEqual(await publicationCounts(), beforeRetarget);
    const retargeted = await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'fixture-retarget' } });
    assert.equal(retargeted.host, 'replacement.fixture.invalid');
    assert.equal(retargeted.siteId, 'replacement-site');
    assert.equal(retargeted.lastSyncAt?.getTime(), newEndpointSyncTime.getTime());
    assert.equal(retargeted.lastSyncStatus, 'FAILED');
    const retargetHistory = await prisma.uniFiSyncHistory.findFirstOrThrow({ where: { connectionId: 'fixture-retarget' } });
    assert.equal(retargetHistory.status, 'FAILED');
    assert.ok(retargetHistory.completedAt);
    assert.equal(retargetHistory.configId, null);
    assert.equal(await prisma.jobLease.count(), 0);
    console.log('PASS: controller retarget rejects stale inventory/configuration and preserves the new endpoint sync timestamp');

    await createConnection('fixture-rollback');
    const beforeRollback = await publicationCounts();
    const activeBeforeRollback = await prisma.configuration.findMany({
      where: { isActive: true }, select: { id: true }, orderBy: { id: 'asc' },
    });
    // Fail late in the actual publication transaction, after proving that its
    // earlier configuration, finding and timeline writes have all occurred.
    // The wrapper guarantees this trigger can exist only in a disposable DB.
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fixture_reject_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW."mac" = '02:00:00:00:00:99' THEN
          IF NOT EXISTS (SELECT 1 FROM "Configuration" WHERE "siteName" = 'rollback-must-never-persist') THEN
            RAISE EXCEPTION 'fixture precondition: configuration not yet written';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM "Vulnerability" v JOIN "Configuration" c ON c."id" = v."configId"
                         WHERE c."siteName" = 'rollback-must-never-persist') THEN
            RAISE EXCEPTION 'fixture precondition: findings not yet written';
          END IF;
          IF NOT EXISTS (SELECT 1 FROM "UniFiConfigChange" WHERE "connectionId" = 'fixture-rollback') THEN
            RAISE EXCEPTION 'fixture precondition: timeline not yet written';
          END IF;
          RAISE EXCEPTION 'fixture inventory rejected after configuration findings timeline';
        END IF;
        RETURN NEW;
      END
      $$`);
    await prisma.$executeRawUnsafe('CREATE TRIGGER fixture_reject_inventory BEFORE INSERT OR UPDATE ON "NetworkClient" FOR EACH ROW EXECUTE FUNCTION fixture_reject_inventory()');
    try {
      await assert.rejects(syncUniFiConfiguration({ connectionId: 'fixture-rollback', trigger: 'manual' }, {
        createClient: () => ({
          ...client('rollback-must-never-persist'),
          getFullConfig: async () => ({ ...fullConfig('rollback-must-never-persist'),
            wlans: [{ _id: '65a000000000000000000099', name: 'Fixture open WLAN', enabled: true, security: 'open' }],
            clients: [{ mac: '02:00:00:00:00:99', hostname: 'rollback-client', first_seen: 1700000000 }],
          }) as any,
        }),
      }), /fixture inventory rejected after configuration findings timeline/);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fixture_reject_inventory ON "NetworkClient"');
      await prisma.$executeRawUnsafe('DROP FUNCTION fixture_reject_inventory()');
    }
    assert.deepEqual(await publicationCounts(), beforeRollback);
    assert.deepEqual(await prisma.configuration.findMany({
      where: { isActive: true }, select: { id: true }, orderBy: { id: 'asc' },
    }), activeBeforeRollback);
    const rolledBackHistory = await prisma.uniFiSyncHistory.findFirstOrThrow({ where: { connectionId: 'fixture-rollback' } });
    assert.equal(rolledBackHistory.status, 'FAILED');
    assert.equal(rolledBackHistory.configId, null);
    assert.ok(rolledBackHistory.completedAt);
    assert.match(rolledBackHistory.errorMessage!, /fixture inventory rejected after configuration findings timeline/);
    assert.equal((await prisma.uniFiConnection.findUniqueOrThrow({ where: { id: 'fixture-rollback' } })).lastSyncStatus, 'FAILED');
    assert.equal(await prisma.jobLease.count(), 0);
    console.log('PASS: late inventory failure rolls back configuration/findings/timeline and active snapshot; owned history records FAILED');
    console.log(`Sync lease fixture passed (${mode}).`);
  } finally {
    await prisma.$disconnect();
  }
}

const deadline = setTimeout(() => { console.error('Sync lease fixture exceeded its two-minute deadline.'); process.exit(1); }, 120_000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
