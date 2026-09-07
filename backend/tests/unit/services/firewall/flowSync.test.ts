/**
 * Unit tests for the firewall flow / threat sync bridge.
 * Mocks the lib's `UnifiClient` and the Prisma surface so we can exercise
 * watermark advancement, idempotency, and the field-mapping contract without
 * a live controller.
 */
// Mock @uguard/unifi-client BEFORE the module under test is required.
const mockLogin = jest.fn();
const mockLogout = jest.fn();
const mockFlowsIterate = jest.fn();
const mockThreatsIterate = jest.fn();

jest.mock('@uguard/unifi-client', () => ({
  UnifiClient: jest.fn().mockImplementation(() => ({
    login: mockLogin,
    logout: mockLogout,
    flows: { iterate: mockFlowsIterate },
    threats: { iterate: mockThreatsIterate },
    isLoggedIn: () => true,
  })),
}));

// Mock the host-resolver so the test doesn't care about Docker.
jest.mock('../../../../src/services/unifiClient', () => ({
  resolveControllerHost: (h: string) => h,
}));

// Mock the encryption helper.
jest.mock('../../../../src/utils/encryption', () => ({
  decrypt: (s: string) => `decrypted-${s}`,
}));

import prisma from '../../../../src/services/database';
import { Prisma } from '@prisma/client';
import logger from '../../../../src/utils/logger';
import {
  syncFirewallTelemetry,
  cleanupExpiredFirewallTelemetry,
} from '../../../../src/services/firewall/flowSync';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

interface ConnectionRow {
  id: string;
  name: string;
  host: string;
  port: number;
  usernameEnc: string;
  passwordEnc: string;
  siteId: string;
  isActive: boolean;
  flowsHighWater: Date | null;
  threatsHighWater: Date | null;
  flowRetentionDays: number;
}

const baseConnection: ConnectionRow = {
  id: 'conn-1',
  name: 'home',
  host: '192.168.1.1',
  port: 443,
  usernameEnc: 'enc-user',
  passwordEnc: 'enc-pass',
  siteId: 'default',
  isActive: true,
  flowsHighWater: null,
  threatsHighWater: null,
  flowRetentionDays: 7,
};

const baseScope = {
  id: 'scope-1', connectionId: 'conn-1', controllerHost: '192.168.1.1',
  controllerPort: 443, siteId: 'default', flowsHighWater: null,
  threatsHighWater: null, createdAt: new Date('2026-09-06T00:00:00Z'),
};

function flowFixture(id: string, time: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    action: 'blocked',
    count: 1,
    protocol: 'TCP',
    service: 'OTHER',
    risk: 'low',
    direction: 'outgoing',
    time,
    flow_start_time: time,
    flow_end_time: time + 1000,
    duration_milliseconds: 1000,
    traffic_data: { bytes_total: 64, packets_total: 1 },
    source: {
      mac: 'aa:bb:cc:dd:ee:01',
      ip: '192.168.1.10',
      port: 12345,
      client_name: 'iPad',
      network_id: 'net-1',
      network_name: 'Default',
      zone_name: 'Internal',
      subnet: '192.168.1.0/24',
    },
    destination: {
      ip: '203.0.113.10',
      port: 443,
      region: 'US',
      domains: ['example.com'],
      zone_name: 'External',
    },
    in: { network_id: 'net-iot', network_name: 'IOT' },
    out: { network_id: 'net-1', network_name: 'Default' },
    policies: [
      { id: 'pol-1', name: 'Block: IOT > Internet', type: 'FIREWALL', internal_type: 'FIREWALL_POLICY' },
    ],
    ...overrides,
  };
}

function threatFixture(id: string, timestamp: number) {
  return {
    id,
    timestamp,
    category: 'SECURITY',
    subcategory: 'SECURITY_INTRUSION_PREVENTION',
    event: 'THREAT_BLOCKED',
    key: 'THREAT_BLOCKED_V3',
    severity: 'LOW',
    status: 'NEW',
    type: 'THREAT_DETECTION_AND_PREVENTION',
    message: 'Threat blocked',
    parameters: {
      SRC_IP: { id: '192.168.1.50' },
      DST_IP: { id: '198.51.100.5' },
      DEVICE: { id: '60:22:32:96:06:6d', model: 'UDM-Pro' },
    },
  };
}

async function* iterArray<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe('syncFirewallTelemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLogin.mockResolvedValue(undefined);
    mockLogout.mockResolvedValue(undefined);
    mockFlowsIterate.mockImplementation(() => iterArray([]));
    mockThreatsIterate.mockImplementation(() => iterArray([]));
    (mockedPrisma.telemetryScope.upsert as jest.Mock).mockResolvedValue({ ...baseScope });
    (mockedPrisma.telemetryScope.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  });

  it('throws when the connection does not exist', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(syncFirewallTelemetry('missing')).rejects.toThrow(/not found/);
  });

  it('throws when the connection is inactive', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue({
      ...baseConnection,
      isActive: false,
    });
    await expect(syncFirewallTelemetry('conn-1')).rejects.toThrow(/not active/);
  });

  it('inserts new flow rows and advances the watermark to the latest occurredAt', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);

    const t1 = 1_700_000_000_000;
    const t2 = t1 + 60_000;
    mockFlowsIterate.mockReturnValue(
      iterArray([flowFixture('f1', t1), flowFixture('f2', t2)])
    );
    mockThreatsIterate.mockReturnValue(iterArray([]));

    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await syncFirewallTelemetry('conn-1');

    expect(result.flowsInserted).toBe(2);
    expect(result.flowsSkipped).toBe(0);
    expect(result.flowsHighWater?.getTime()).toBe(t2);
    expect(mockedPrisma.firewallFlowEvent.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ skipDuplicates: true })
    );
    expect(mockedPrisma.telemetryScope.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'scope-1' }),
        data: expect.objectContaining({ flowsHighWater: expect.any(Date) }),
      })
    );
  });

  it('counts skipDuplicates results as skipped (idempotent re-poll)', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);

    mockFlowsIterate.mockReturnValue(
      iterArray([flowFixture('f1', 1_700_000_000_000), flowFixture('f2', 1_700_000_001_000)])
    );
    mockThreatsIterate.mockReturnValue(iterArray([]));

    // Both rows already exist — controller returned 0 new inserts.
    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockResolvedValue({ count: 0 });

    const result = await syncFirewallTelemetry('conn-1');
    expect(result.flowsInserted).toBe(0);
    expect(result.flowsSkipped).toBe(2);
  });

  it('rethrows non-skip Prisma errors instead of silently dropping them', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);

    mockFlowsIterate.mockReturnValue(iterArray([flowFixture('f1', 1_700_000_000_000)]));
    mockThreatsIterate.mockReturnValue(iterArray([]));

    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockRejectedValue(
      new Error('Storage full')
    );

    await expect(syncFirewallTelemetry('conn-1')).rejects.toThrow(/Storage full/);
  });

  it('maps lib FlowEvent fields onto the Prisma row faithfully', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);

    const t = 1_700_000_000_000;
    mockFlowsIterate.mockReturnValue(iterArray([flowFixture('f1', t)]));
    mockThreatsIterate.mockReturnValue(iterArray([]));

    let capturedRows: Array<Record<string, unknown>> = [];
    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockImplementation((args) => {
      capturedRows = args.data;
      return Promise.resolve({ count: capturedRows.length });
    });

    await syncFirewallTelemetry('conn-1');

    const capturedData = capturedRows[0]!;
    expect(capturedData).toMatchObject({
      unifiId: 'f1',
      action: 'blocked',
      protocol: 'TCP',
      service: 'OTHER',
      risk: 'low',
      direction: 'outgoing',
      srcMac: 'aa:bb:cc:dd:ee:01',
      srcIp: '192.168.1.10',
      srcClientName: 'iPad',
      srcNetworkName: 'Default',
      srcZoneName: 'Internal',
      dstIp: '203.0.113.10',
      dstRegion: 'US',
      dstZoneName: 'External',
      inNetworkName: 'IOT',
      outNetworkName: 'Default',
      primaryPolicyName: 'Block: IOT > Internet',
      connectionId: 'conn-1',
      scopeId: 'scope-1',
    });
    expect(capturedData.flowStartAt).toBeInstanceOf(Date);
    expect(capturedData.flowEndAt).toBeInstanceOf(Date);
    expect(capturedData.bytesTotal).toEqual(BigInt(64));
    expect(capturedData.packetsTotal).toBe(1);
    expect(capturedData.dstDomains).toEqual(['example.com']);
    expect(Array.isArray(capturedData.policies)).toBe(true);
  });

  it('inserts threat rows and maps SRC_IP / DST_IP / DEVICE parameters', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);

    mockFlowsIterate.mockReturnValue(iterArray([]));
    mockThreatsIterate.mockReturnValue(iterArray([threatFixture('t1', 1_700_000_000_000)]));

    let capturedRows: Array<Record<string, unknown>> = [];
    (mockedPrisma.firewallThreatEvent.createMany as jest.Mock).mockImplementation((args) => {
      capturedRows = args.data;
      return Promise.resolve({ count: capturedRows.length });
    });

    const result = await syncFirewallTelemetry('conn-1');

    expect(result.threatsInserted).toBe(1);
    const capturedData = capturedRows[0]!;
    expect(capturedData).toMatchObject({
      unifiId: 't1',
      severity: 'LOW',
      event: 'THREAT_BLOCKED',
      srcIp: '192.168.1.50',
      dstIp: '198.51.100.5',
      deviceMac: '60:22:32:96:06:6d',
      deviceModel: 'UDM-Pro',
      scopeId: 'scope-1',
    });
  });

  it('starts from the immutable scope watermark rather than the legacy connection watermark', async () => {
    const existingWatermark = new Date('2026-05-06T12:00:00Z');
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue({
      ...baseConnection,
      flowsHighWater: new Date('2026-09-05T12:00:00Z'),
    });
    (mockedPrisma.telemetryScope.upsert as jest.Mock).mockResolvedValue({
      ...baseScope, flowsHighWater: existingWatermark,
    });
    mockFlowsIterate.mockReturnValue(iterArray([]));
    mockThreatsIterate.mockReturnValue(iterArray([]));

    await syncFirewallTelemetry('conn-1');

    expect(mockFlowsIterate).toHaveBeenCalledWith(
      expect.objectContaining({ beginTime: existingWatermark.getTime() })
    );
  });

  it('logs out even when the controller errors out mid-pull', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);
    mockFlowsIterate.mockImplementation(() => {
      throw new Error('controller blew up');
    });
    mockThreatsIterate.mockReturnValue(iterArray([]));

    await expect(syncFirewallTelemetry('conn-1')).rejects.toThrow(/controller blew up/);
    expect(mockLogout).toHaveBeenCalled();
  });

  it('does not inherit unknown legacy flow or threat cursors on the first scoped poll', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue({
      ...baseConnection, flowsHighWater: new Date('2100-01-01'), threatsHighWater: new Date('2100-01-01'),
    });
    const before = Date.now() - baseConnection.flowRetentionDays * 86_400_000;
    await syncFirewallTelemetry('conn-1');
    const after = Date.now() - baseConnection.flowRetentionDays * 86_400_000;
    for (const iterate of [mockFlowsIterate, mockThreatsIterate]) {
      const { beginTime } = iterate.mock.calls[0][0];
      expect(beginTime).toBeGreaterThanOrEqual(before);
      expect(beginTime).toBeLessThanOrEqual(after);
    }
    expect(mockedPrisma.uniFiConnection.update).not.toHaveBeenCalled();
  });

  it.each([
    ['CONTROLLER.Example', 'controller.example'],
    ['[2001:0db8:0000:0000:0000:0000:0000:0001]', '[2001:db8::1]'],
  ])('canonicalizes the configured host %s without rewriting the client destination', async (host, canonical) => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue({ ...baseConnection, host });
    await syncFirewallTelemetry('conn-1');
    expect(mockedPrisma.telemetryScope.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: { connectionId: 'conn-1', controllerHost: canonical, controllerPort: 443, siteId: 'default' },
      update: {},
    }));
    const { UnifiClient } = jest.requireMock('@uguard/unifi-client');
    expect(UnifiClient).toHaveBeenCalledWith(expect.objectContaining({ host }));
  });

  it.each(['https://controller.example', 'controller.example/', 'user:secret@controller.example',
    'controller.example?token=secret', 'controller.example#secret'])('rejects malformed or credential-bearing host input before storing scope (%s)', async (host) => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue({ ...baseConnection, host });
    await expect(syncFirewallTelemetry('conn-1')).rejects.toThrow(/hostname/);
    expect(mockedPrisma.telemetryScope.upsert).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('converges on the existing scope when two first polls race to create it', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);
    (mockedPrisma.telemetryScope.upsert as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('scope already inserted', { code: 'P2002', clientVersion: 'test' })
    );
    (mockedPrisma.telemetryScope.findUnique as jest.Mock).mockResolvedValueOnce(baseScope);
    await syncFirewallTelemetry('conn-1');
    expect(mockedPrisma.telemetryScope.findUnique).toHaveBeenCalledWith({
      where: { connectionId_controllerHost_controllerPort_siteId: {
        connectionId: 'conn-1', controllerHost: '192.168.1.1', controllerPort: 443, siteId: 'default',
      } },
    });
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it.each([
    { host: '192.168.2.1' }, { port: 8443 }, { siteId: 'branch-office' },
  ])('retargets into an independent scope and cursor for %p', async (change) => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock)
      .mockResolvedValueOnce(baseConnection).mockResolvedValueOnce({ ...baseConnection, ...change });
    (mockedPrisma.telemetryScope.upsert as jest.Mock)
      .mockResolvedValueOnce({ ...baseScope, flowsHighWater: new Date('2026-09-05T00:00:00Z') })
      .mockResolvedValueOnce({ ...baseScope, id: 'scope-2' });
    const eventTime = Date.now();
    mockFlowsIterate.mockImplementation(() => iterArray([flowFixture('same-upstream-id', eventTime)]));
    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    await syncFirewallTelemetry('conn-1');
    await syncFirewallTelemetry('conn-1');
    const scopeCalls = (mockedPrisma.telemetryScope.upsert as jest.Mock).mock.calls;
    expect(scopeCalls[0][0].create).not.toEqual(scopeCalls[1][0].create);
    const writes = (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mock.calls;
    expect(writes[0][0].data[0]).toMatchObject({ unifiId: 'same-upstream-id', scopeId: 'scope-1' });
    expect(writes[1][0].data[0]).toMatchObject({ unifiId: 'same-upstream-id', scopeId: 'scope-2' });
    expect(mockFlowsIterate.mock.calls[1][0].beginTime).toBeLessThan(eventTime - 6 * 86_400_000);
    expect(mockedPrisma.uniFiConnection.update).not.toHaveBeenCalled();
  });

  it('keeps an old in-flight sync on its captured scope after the connection is retargeted', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock)
      .mockResolvedValueOnce(baseConnection).mockResolvedValueOnce({ ...baseConnection, siteId: 'new-site' });
    (mockedPrisma.telemetryScope.upsert as jest.Mock)
      .mockResolvedValueOnce(baseScope).mockResolvedValueOnce({ ...baseScope, id: 'new-scope', siteId: 'new-site' });
    let release!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const oldTime = Date.UTC(2026, 8, 5);
    const newTime = Date.UTC(2026, 8, 6);
    mockFlowsIterate.mockImplementationOnce(async function* () {
      started();
      await wait;
      yield flowFixture('same-upstream-id', oldTime);
    }).mockImplementationOnce(() => iterArray([flowFixture('same-upstream-id', newTime)]));
    mockThreatsIterate.mockImplementation(() => iterArray([threatFixture('shared-threat-id', oldTime)]));
    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (mockedPrisma.firewallThreatEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    const oldSync = syncFirewallTelemetry('conn-1');
    await ready;
    await syncFirewallTelemetry('conn-1');
    release();
    await oldSync;
    const flowWrites = (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mock.calls;
    expect(flowWrites[0][0].data[0].scopeId).toBe('new-scope');
    expect(flowWrites[1][0].data[0].scopeId).toBe('scope-1');
    const threatWrites = (mockedPrisma.firewallThreatEvent.createMany as jest.Mock).mock.calls;
    expect(threatWrites[0][0].data[0].scopeId).toBe('new-scope');
    expect(threatWrites[1][0].data[0].scopeId).toBe('scope-1');
    const cursorWrites = (mockedPrisma.telemetryScope.updateMany as jest.Mock).mock.calls;
    expect(cursorWrites.map(([args]) => args.where.id)).toEqual(['new-scope', 'new-scope', 'scope-1', 'scope-1']);
    expect(mockedPrisma.uniFiConnection.update).not.toHaveBeenCalled();
  });

  it('advances flow and threat cursors conditionally so a slower concurrent poll cannot move them backwards', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);
    const occurredAt = new Date('2026-09-06T12:00:00Z');
    mockFlowsIterate.mockImplementation(() => iterArray([flowFixture('f1', occurredAt.getTime())]));
    mockThreatsIterate.mockImplementation(() => iterArray([threatFixture('t1', occurredAt.getTime())]));
    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (mockedPrisma.firewallThreatEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    await syncFirewallTelemetry('conn-1');
    for (const cursor of ['flowsHighWater', 'threatsHighWater']) {
      expect(mockedPrisma.telemetryScope.updateMany).toHaveBeenCalledWith({
        where: { id: 'scope-1', OR: [{ [cursor]: null }, { [cursor]: { lt: occurredAt } }] },
        data: { [cursor]: occurredAt },
      });
    }
  });

  it('skips missing, malformed, and future event timestamps without inserting rows or advancing either cursor', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);
    const invalid = [undefined, null, NaN, Infinity, -Infinity, -1, 9e15, Date.now() + 86_400_000, '1700000000000'];
    mockFlowsIterate.mockImplementation(() => iterArray(invalid.map((time, index) =>
      flowFixture(`invalid-flow-${index}`, 1_700_000_000_000, { time, flow_start_time: undefined }))));
    mockThreatsIterate.mockImplementation(() => iterArray(invalid.map((timestamp, index) => ({
      ...threatFixture(`invalid-threat-${index}`, 1_700_000_000_000), timestamp,
    }))));
    const result = await syncFirewallTelemetry('conn-1');
    expect(result).toEqual({
      flowsInserted: 0, threatsInserted: 0, flowsSkipped: invalid.length, threatsSkipped: invalid.length,
      flowsHighWater: null, threatsHighWater: null,
    });
    expect(mockedPrisma.firewallFlowEvent.createMany).not.toHaveBeenCalled();
    expect(mockedPrisma.firewallThreatEvent.createMany).not.toHaveBeenCalled();
    expect(mockedPrisma.telemetryScope.updateMany).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('accepts a controller flow-start timestamp only when the primary event time is absent', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);
    const time = 1_700_000_000_000;
    mockFlowsIterate.mockImplementation(() => iterArray([
      flowFixture('valid-fallback', time, { time: undefined }),
      flowFixture('invalid-primary', time, { time: NaN }),
      flowFixture('null-primary', time, { time: null }),
    ]));
    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    const result = await syncFirewallTelemetry('conn-1');
    expect(result).toMatchObject({ flowsInserted: 1, flowsSkipped: 2, flowsHighWater: new Date(time) });
    expect(mockedPrisma.firewallFlowEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ unifiId: 'valid-fallback', occurredAt: new Date(time) })], skipDuplicates: true,
    });
  });

  it('advances only to observed valid events in a mixed batch', async () => {
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue(baseConnection);
    const time = 1_700_000_000_000;
    const future = Date.now() + 86_400_000;
    mockFlowsIterate.mockImplementation(() => iterArray([flowFixture('valid-flow', time), flowFixture('future-flow', future)]));
    mockThreatsIterate.mockImplementation(() => iterArray([threatFixture('valid-threat', time), threatFixture('future-threat', future)]));
    (mockedPrisma.firewallFlowEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    (mockedPrisma.firewallThreatEvent.createMany as jest.Mock).mockResolvedValue({ count: 1 });
    const result = await syncFirewallTelemetry('conn-1');
    expect(result).toEqual({
      flowsInserted: 1, threatsInserted: 1, flowsSkipped: 1, threatsSkipped: 1,
      flowsHighWater: new Date(time), threatsHighWater: new Date(time),
    });
    for (const [args] of (mockedPrisma.telemetryScope.updateMany as jest.Mock).mock.calls) {
      expect(Object.values(args.data)).toEqual([new Date(time)]);
    }
  });
});

describe('cleanupExpiredFirewallTelemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes flow + threat rows older than the retention window per connection', async () => {
    (mockedPrisma.uniFiConnection.findMany as jest.Mock).mockResolvedValue([
      { id: 'conn-1', flowRetentionDays: 7 },
    ]);
    (mockedPrisma.firewallFlowEvent.deleteMany as jest.Mock).mockResolvedValue({ count: 12 });
    (mockedPrisma.firewallThreatEvent.deleteMany as jest.Mock).mockResolvedValue({ count: 3 });

    const result = await cleanupExpiredFirewallTelemetry();

    expect(result.flowsDeleted).toBe(12);
    expect(result.threatsDeleted).toBe(3);
    expect(mockedPrisma.firewallFlowEvent.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          connectionId: 'conn-1',
          occurredAt: { lt: expect.any(Date) },
        }),
      })
    );
  });

  it('handles zero connections cleanly', async () => {
    (mockedPrisma.uniFiConnection.findMany as jest.Mock).mockResolvedValue([]);
    const result = await cleanupExpiredFirewallTelemetry();
    expect(result).toEqual({ flowsDeleted: 0, threatsDeleted: 0 });
  });
});
