import { collectConfigurationFindings, persistConfigurationFindings } from '../../../src/analyzers';
import { collectHistoricalTimeline, persistHistoricalTimeline, bootstrapHistoricalTimeline } from '../../../src/services/historyBootstrapService';
import { detectConfigChanges } from '../../../src/services/configChangeService';
import prisma from '../../../src/services/database';

jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: {
    setting: { findUnique: jest.fn() }, adGuardConnection: { findFirst: jest.fn() },
    networkClient: { findMany: jest.fn() },
    vulnerability: { createMany: jest.fn(), deleteMany: jest.fn() },
    uniFiConfigChange: { count: jest.fn(), create: jest.fn(), createMany: jest.fn() },
  },
}));

const config: any = {
  sites: [], devices: [], networks: [], firewallRules: [], firewallPolicies: [],
  wlans: [], portForwards: [], trafficRules: [], aclRules: [], vpnServers: [], clients: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.setting.findUnique as jest.Mock).mockResolvedValue(null);
  (prisma.adGuardConnection.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.uniFiConfigChange.count as jest.Mock).mockResolvedValue(0);
});

it('collects configuration findings without database writes and propagates collection failures', async () => {
  await collectConfigurationFindings({ firewallRules: [], networkConf: [], wlanConf: [], portForward: [] } as any);
  expect(prisma.vulnerability.createMany).not.toHaveBeenCalled();
  expect(prisma.vulnerability.deleteMany).not.toHaveBeenCalled();
  const error = new Error('Required analysis inputs unavailable');
  (prisma.setting.findUnique as jest.Mock).mockRejectedValueOnce(error);
  await expect(collectConfigurationFindings({} as any)).rejects.toBe(error);
});

it('persists finding batches only through the supplied transaction and propagates write failure', async () => {
  const findings = Array.from({ length: 501 }, (_, index) => ({
    type: 'FIREWALL', severity: 'HIGH', title: `Finding ${index}`, description: 'Details', impact: 'Impact', remediation: 'Fix',
  } as any));
  const error = new Error('Second batch failed');
  const db = { vulnerability: { createMany: jest.fn().mockResolvedValueOnce({ count: 500 }).mockRejectedValueOnce(error) } };
  await expect(persistConfigurationFindings('config-1', findings, db as any)).rejects.toBe(error);
  expect(db.vulnerability.createMany.mock.calls[0][0].data).toHaveLength(500);
  expect(db.vulnerability.createMany.mock.calls[1][0].data).toHaveLength(1);
  expect(db.vulnerability.createMany.mock.calls[0][0].data[0]).toMatchObject({ configId: 'config-1', title: 'Finding 0' });
  expect(prisma.vulnerability.createMany).not.toHaveBeenCalled();
  expect(prisma.vulnerability.deleteMany).not.toHaveBeenCalled();
});

it('collects historical controller and object timestamps without publishing rows', async () => {
  const eventTime = new Date('2026-09-01T10:00:00Z').getTime();
  const client = {
    getEvents: jest.fn().mockResolvedValue([
      { _id: 'event', key: 'EVT_AP_Upgraded', time: eventTime, ap_name: 'AP', msg: 'Upgraded', version_from: '1', version_to: '2' },
      { _id: 'noise', key: 'IGNORED_EVENT', time: eventTime },
    ]),
    getAlarms: jest.fn().mockResolvedValue([{ _id: 'alarm', key: 'EVT_AP_Isolated', time: eventTime, archived: false }]),
  };
  const rows = await collectHistoricalTimeline('connection-1', {
    ...config,
    networks: [{ _id: '64a000000000000000000001', name: 'LAN' }],
    clients: [{ mac: 'aa:bb:cc:dd:ee:ff', first_seen: eventTime / 1000, hostname: 'Laptop' }],
  }, client);
  expect(rows).toHaveLength(4);
  expect(rows.find((row) => row.resourceId === 'event')).toMatchObject({
    connectionId: 'connection-1', resourceType: 'firmware', resourceName: 'AP', detectedAt: new Date(eventTime),
    newValue: expect.objectContaining({ versionFrom: '1', versionTo: '2' }),
  });
  expect(rows.find((row) => row.resourceId === '64a000000000000000000001')?.detectedAt).toEqual(new Date(parseInt('64a00000', 16) * 1000));
  expect(prisma.uniFiConfigChange.create).not.toHaveBeenCalled();
  expect(prisma.uniFiConfigChange.createMany).not.toHaveBeenCalled();
  expect(prisma.uniFiConfigChange.count).not.toHaveBeenCalled();
});

it('keeps object history when optional controller event endpoints fail', async () => {
  const client = { getEvents: jest.fn().mockRejectedValue(new Error('Unsupported')), getAlarms: jest.fn().mockRejectedValue(new Error('Unavailable')) };
  const rows = await collectHistoricalTimeline('connection-1', {
    ...config, networks: [{ _id: '64a000000000000000000001', name: 'LAN' }],
  }, client);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ resourceType: 'network', changeType: 'CREATED' });
});

it('rechecks the historical baseline inside publication and never duplicates existing legacy history', async () => {
  const db = { uniFiConfigChange: { count: jest.fn().mockResolvedValue(1), createMany: jest.fn() } };
  const rows = [{ connectionId: 'connection-1', changeType: 'CREATED', resourceType: 'network' } as any];
  await expect(persistHistoricalTimeline('connection-1', rows, db as any)).resolves.toBe(0);
  expect(db.uniFiConfigChange.createMany).not.toHaveBeenCalled();
  expect(prisma.uniFiConfigChange.count).not.toHaveBeenCalled();
  (prisma.uniFiConfigChange.count as jest.Mock).mockResolvedValue(1);
  const client = { getEvents: jest.fn(), getAlarms: jest.fn() };
  await expect(bootstrapHistoricalTimeline('connection-1', config, client)).resolves.toBe(0);
  expect(client.getEvents).not.toHaveBeenCalled();
});

it('does not swallow historical persistence errors that must roll back the entire sync', async () => {
  const error = new Error('History insert failed');
  const db = { uniFiConfigChange: { count: jest.fn().mockResolvedValue(0), createMany: jest.fn().mockRejectedValue(error) } };
  await expect(persistHistoricalTimeline('connection-1', [
    { connectionId: 'connection-1', changeType: 'CREATED', resourceType: 'network' },
  ], db as any)).rejects.toBe(error);
  expect(prisma.uniFiConfigChange.createMany).not.toHaveBeenCalled();
});

it('uses the supplied transaction for ACL baseline and device firmware changes as well as ordinary resources', async () => {
  const db = { uniFiConfigChange: { count: jest.fn().mockResolvedValue(0), create: jest.fn() } };
  const aclRules = [{ _id: 'acl-1', name: 'Deny IoT' }];
  const previous = { aclRules, devices: [{ mac: 'aa', name: 'AP', version: '1' }], networkConf: [] };
  const current = { aclRules, devices: [{ mac: 'aa', name: 'AP', version: '2' }], networkConf: [{ _id: 'lan', name: 'LAN' }] };
  await expect(detectConfigChanges('connection-1', previous, current, undefined, db as any)).resolves.toBe(4);
  expect(db.uniFiConfigChange.create.mock.calls.map(([args]) => args.data.resourceType).sort()).toEqual(['aclRule', 'device', 'firmware', 'network']);
  expect(prisma.uniFiConfigChange.create).not.toHaveBeenCalled();
  expect(prisma.uniFiConfigChange.count).not.toHaveBeenCalled();
});
