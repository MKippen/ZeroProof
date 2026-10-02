import { syncUniFiConfiguration, UniFiSyncError, UNIFI_CONFIGURATION_SYNC_LEASE_KEY } from '../../../src/services/unifiSyncService';
import { withJobLease, JobLeaseLostError } from '../../../src/services/jobLease';
import { collectConfigurationFindings, persistConfigurationFindings } from '../../../src/analyzers';
import { decrypt } from '../../../src/utils/encryption';

jest.mock('../../../src/services/jobLease', () => ({
  withJobLease: jest.fn(),
  JobLeaseLostError: class JobLeaseLostError extends Error {},
}));
jest.mock('../../../src/utils/encryption', () => ({
  ...jest.requireActual('../../../src/utils/encryption'),
  decrypt: jest.fn((value) => value),
}));
jest.mock('../../../src/analyzers', () => ({
  collectConfigurationFindings: jest.fn(),
  persistConfigurationFindings: jest.fn(),
}));

// Every publication method requires the lease transaction. The real PostgreSQL
// fixture separately exercises lease races and rollback of these writes.
let publishing: boolean;
let controller: AbortController;
let connection: any;
let knownConfig: any;
let previousConfig: any;
let tx: any;
let client: any;
let fullConfig: any;
let lease: any;
function operation(result?: any) {
  return jest.fn(async (..._args: any[]) => {
    expect(publishing).toBe(true);
    return result;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  publishing = false;
  controller = new AbortController();
  connection = {
    id: 'controller-a', name: 'Office', host: 'unifi.internal', port: 443,
    siteId: 'default', usernameEnc: 'admin', passwordEnc: 'password',
    allowSelfSigned: true, isActive: true, autoSync: true,
    syncIntervalMin: 1440, lastSyncAt: null, lastSyncStatus: null,
  };
  fullConfig = {
    sites: [{ name: 'default', desc: 'Office' }], devices: [], networks: [],
    firewallRules: [], firewallPolicies: [], firewallGroups: [], wlans: [],
    portForwards: [], trafficRules: [], routingRules: [], clients: [], settings: {},
    aclRules: [], vpnServers: [], trafficMatchingLists: [], firewallZones: [], rawNetworkConfig: [], sysInfo: null,
  };
  knownConfig = null;
  previousConfig = null;
  tx = {
    $queryRaw: operation([]),
    uniFiConnection: {
      findUnique: operation(), findFirst: operation(), update: operation(), updateMany: operation({ count: 1 }),
    },
    configuration: {
      findUnique: operation(), findFirst: operation(), create: operation(), update: operation(),
      updateMany: operation({ count: 1 }), deleteMany: operation(),
    },
    uniFiSyncHistory: { create: operation({ id: 'sync-1' }), update: operation(), updateMany: operation({ count: 1 }) },
    uniFiConfigChange: { count: operation(0), create: operation(), createMany: operation({ count: 1 }) },
    vulnerability: { count: operation(2), deleteMany: operation() },
    networkClient: { upsert: operation() },
    notification: { createMany: operation({ count: 1 }) },
  };
  tx.uniFiConnection.findUnique.mockImplementation(async () => { expect(publishing).toBe(true); return connection && { ...connection }; });
  tx.uniFiConnection.findFirst.mockImplementation(tx.uniFiConnection.findUnique);
  tx.configuration.findUnique.mockImplementation(async () => { expect(publishing).toBe(true); return knownConfig; });
  tx.configuration.findFirst.mockImplementation(async () => { expect(publishing).toBe(true); return previousConfig; });
  tx.configuration.create.mockImplementation(async ({ data }: any) => { expect(publishing).toBe(true); return { ...data, id: 'config-new' }; });
  tx.configuration.update.mockImplementation(async ({ data }: any) => { expect(publishing).toBe(true); return { ...knownConfig, ...data }; });
  lease = {
    signal: controller.signal,
    publish: jest.fn(async (work) => {
      controller.signal.throwIfAborted();
      expect(publishing).toBe(false);
      publishing = true;
      try { return await work(tx); } finally { publishing = false; }
    }),
  };
  (withJobLease as jest.Mock).mockImplementation(async (_key, work) => work(lease));
  (decrypt as jest.Mock).mockImplementation((value) => value);
  (collectConfigurationFindings as jest.Mock).mockImplementation(async () => {
    expect(publishing).toBe(false);
    return [];
  });
  (persistConfigurationFindings as jest.Mock).mockImplementation(async (_id, _findings, db) => {
    expect(publishing).toBe(true);
    expect(db).toBe(tx);
  });
  const remote = (result: any) => jest.fn(async () => { expect(publishing).toBe(false); return result; });
  client = { login: remote(true), logout: remote(undefined), getFullConfig: remote(fullConfig), getEvents: remote([]), getAlarms: remote([]) };
});

const sync = (trigger: 'manual' | 'scheduled' = 'manual') =>
  syncUniFiConfiguration({ connectionId: 'controller-a', trigger }, { createClient: () => client });

it('collects network data outside publication and commits config, history, inventory and success through one fenced transaction', async () => {
  fullConfig.clients = [{ mac: 'aa:bb:cc:dd:ee:ff', hostname: 'Laptop', network_id: 'lan' }];
  fullConfig.networks = [{ _id: 'lan', name: 'LAN' }];
  const result = await sync();
  expect(result).toMatchObject({ syncId: 'sync-1', configId: 'config-new', changed: true, stats: { networksFound: 1 } });
  expect(withJobLease).toHaveBeenCalledWith(UNIFI_CONFIGURATION_SYNC_LEASE_KEY, expect.any(Function));
  expect(tx.networkClient.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ lastNetworkName: 'LAN', mac: 'aa:bb:cc:dd:ee:ff' }),
  }));
  expect(tx.uniFiSyncHistory.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }));
  expect(tx.configuration.deleteMany).not.toHaveBeenCalled();
  expect(tx.vulnerability.deleteMany).not.toHaveBeenCalled();
  expect(client.logout).toHaveBeenCalledTimes(1);
});

it('retains inventory compatibility with sparse previous clients and alternate network IDs', async () => {
  previousConfig = { configHash: 'old', configJson: { clients: [null, {}, { mac: 'previous-client' }] } };
  fullConfig.clients = [{ mac: 'new-client', network_id: 'lan' }];
  fullConfig.networks = [{ id: 'lan', name: 'LAN' }];
  await expect(sync()).resolves.toMatchObject({ clientsDiscovered: 1 });
  expect(tx.networkClient.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ lastNetworkName: 'LAN', mac: 'new-client' }),
  }));
});

it('reactivates a known historical configuration without resetting vulnerability dispositions', async () => {
  knownConfig = { id: 'config-old', configHash: 'old-hash', siteName: 'Office', isActive: false };
  previousConfig = { id: 'config-active', configHash: 'other-hash', configJson: {} };
  await expect(sync()).resolves.toMatchObject({ configId: 'config-old', changed: true, stats: { vulnerabilitiesFound: 2 } });
  expect(collectConfigurationFindings).not.toHaveBeenCalled();
  expect(persistConfigurationFindings).not.toHaveBeenCalled();
  expect(tx.configuration.create).not.toHaveBeenCalled();
  expect(tx.configuration.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }));
  expect(tx.configuration.deleteMany).not.toHaveBeenCalled();
  expect(tx.vulnerability.deleteMany).not.toHaveBeenCalled();
});

it('refreshes clients on an unchanged configuration and preserves the infrastructure hash contract', async () => {
  await sync();
  const first = tx.configuration.create.mock.calls[0][0].data;
  knownConfig = { ...first, id: 'config-old' };
  previousConfig = { ...knownConfig, configJson: { ...first.configJson, clients: [{ mac: 'old' }] } };
  fullConfig.clients = [{ mac: 'new', hostname: 'New laptop' }];
  fullConfig.rawNetworkConfig = [{ transient: 'different unnormalized response' }];
  fullConfig.sysInfo = { version: 'other', uptime: 12345 };
  jest.clearAllMocks();
  await expect(sync()).resolves.toMatchObject({ changed: false, clientsDiscovered: 1 });
  expect(tx.configuration.create).not.toHaveBeenCalled();
  expect(collectConfigurationFindings).not.toHaveBeenCalled();
  expect(tx.uniFiConfigChange.create).toHaveBeenCalled();
});

it('rechecks recent successful schedules under ownership and skips without creating a history', async () => {
  connection.lastSyncAt = new Date();
  connection.lastSyncStatus = 'SUCCESS';
  await expect(sync('scheduled')).resolves.toBeNull();
  expect(tx.uniFiSyncHistory.create).not.toHaveBeenCalled();
  expect(client.login).not.toHaveBeenCalled();
});

it('recovers interrupted work despite a recent prior success time', async () => {
  connection.lastSyncAt = new Date();
  connection.lastSyncStatus = 'IN_PROGRESS';
  await expect(sync('scheduled')).resolves.toMatchObject({ syncId: 'sync-1' });
  expect(tx.uniFiSyncHistory.updateMany).toHaveBeenCalledWith({
    where: { connectionId: 'controller-a', status: 'IN_PROGRESS' },
    data: expect.objectContaining({ status: 'FAILED', completedAt: expect.any(Date) }),
  });
});

it.each([{ isActive: false }, { autoSync: false }])('respects disabled scheduled connections during recovery: %s', async (patch) => {
  Object.assign(connection, patch, { lastSyncStatus: 'IN_PROGRESS' });
  await expect(sync('scheduled')).resolves.toBeNull();
  expect(tx.uniFiSyncHistory.create).not.toHaveBeenCalled();
});

it('returns typed missing errors for both manual contracts while schedules skip', async () => {
  connection = null;
  await expect(sync()).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(syncUniFiConfiguration({ trigger: 'manual' })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  await expect(sync('scheduled')).resolves.toBeNull();
  expect(tx.uniFiSyncHistory.create).not.toHaveBeenCalled();
});

it('terminalizes credential decryption failure and preserves its original error', async () => {
  const error = new Error('Cannot decrypt credential');
  (decrypt as jest.Mock).mockImplementation(() => { throw error; });
  await expect(sync()).rejects.toBe(error);
  expect(tx.uniFiSyncHistory.updateMany).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 'sync-1', status: 'IN_PROGRESS' }, data: expect.objectContaining({ status: 'FAILED', errorMessage: error.message }),
  }));
  expect(client.login).not.toHaveBeenCalled();
  expect(tx.configuration.create).not.toHaveBeenCalled();
});

it('propagates analysis failures instead of publishing an apparently successful partial audit', async () => {
  const error = new Error('Analysis database unavailable');
  (collectConfigurationFindings as jest.Mock).mockRejectedValue(error);
  await expect(sync()).rejects.toBe(error);
  expect(tx.configuration.create).not.toHaveBeenCalled();
  expect(tx.uniFiSyncHistory.update).not.toHaveBeenCalled();
  expect(client.logout).toHaveBeenCalledTimes(1);
});

it('refuses every local result after a connection is retargeted during collection', async () => {
  client.getFullConfig.mockImplementation(async () => {
    expect(publishing).toBe(false);
    connection.host = 'different-controller.internal';
    return fullConfig;
  });
  await expect(sync()).rejects.toBeInstanceOf(UniFiSyncError);
  expect(tx.configuration.create).not.toHaveBeenCalled();
  expect(tx.networkClient.upsert).not.toHaveBeenCalled();
  expect(tx.uniFiConfigChange.create).not.toHaveBeenCalled();
  const failureUpdate = tx.uniFiConnection.updateMany.mock.calls[0][0];
  expect(failureUpdate.data).toMatchObject({ lastSyncStatus: 'FAILED' });
  expect(failureUpdate.data).not.toHaveProperty('lastSyncAt');
});

it('does not publish or terminalize after ownership is lost during controller collection', async () => {
  const lost = new JobLeaseLostError();
  client.getFullConfig.mockImplementation(async () => { controller.abort(lost); return fullConfig; });
  await expect(sync()).rejects.toBe(lost);
  expect(tx.configuration.create).not.toHaveBeenCalled();
  expect(tx.uniFiSyncHistory.update).not.toHaveBeenCalled();
  // Only recovery of prior histories ran; a stale owner cannot write its failure.
  expect(tx.uniFiSyncHistory.updateMany).toHaveBeenCalledTimes(1);
  expect(client.logout).toHaveBeenCalledTimes(1);
});

it('reports local persistence errors and finalizes failure instead of recording SUCCESS', async () => {
  const error = new Error('Inventory persistence failed');
  fullConfig.clients = [{ mac: 'aa:bb:cc:dd:ee:ff' }];
  tx.networkClient.upsert.mockRejectedValue(error);
  await expect(sync()).rejects.toBe(error);
  expect(tx.uniFiSyncHistory.update).not.toHaveBeenCalled();
  expect(tx.uniFiConnection.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastSyncStatus: 'FAILED' }) }));
});

it('keeps committed success when controller logout or notification publication fails', async () => {
  client.logout.mockRejectedValue(new Error('Controller timed out'));
  tx.notification.createMany.mockRejectedValue(new Error('Notification database error'));
  await expect(sync('scheduled')).resolves.toMatchObject({ syncId: 'sync-1' });
  expect(tx.uniFiSyncHistory.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCESS' }) }));
  expect(tx.uniFiConnection.updateMany).not.toHaveBeenCalled();
});
