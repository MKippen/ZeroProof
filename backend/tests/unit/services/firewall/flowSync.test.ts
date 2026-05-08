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
    expect(mockedPrisma.uniFiConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'conn-1' },
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
    });
  });

  it('starts from the existing watermark when one is set', async () => {
    const existingWatermark = new Date('2026-05-06T12:00:00Z');
    (mockedPrisma.uniFiConnection.findUnique as jest.Mock).mockResolvedValue({
      ...baseConnection,
      flowsHighWater: existingWatermark,
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
