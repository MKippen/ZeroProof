const mockPrisma = {
  uniFiConfigChange: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  uniFiSyncHistory: {
    count: jest.fn(),
    findFirst: jest.fn(),
  },
  networkClient: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  configuration: {
    findFirst: jest.fn(),
  },
};

jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: mockPrisma,
  prisma: mockPrisma,
}));

import {
  getTimelineEvents,
  getTimelineEventDetail,
  getTimelineStats,
  getClients,
  getClientDetail,
} from '../../../src/services/timelineService';

describe('TimelineService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getTimelineEvents', () => {
    it('returns grouped events by day', async () => {
      const mockEvents = [
        { id: 'c1', resourceType: 'firewallRule', changeType: 'CREATED', resourceId: 'r1', resourceName: 'Rule1', detectedAt: new Date('2026-02-14T10:00:00Z') },
        { id: 'c2', resourceType: 'client', changeType: 'CREATED', resourceId: 'aa:bb', resourceName: 'Phone', detectedAt: new Date('2026-02-14T11:00:00Z') },
        { id: 'c3', resourceType: 'network', changeType: 'MODIFIED', resourceId: 'n1', resourceName: 'LAN', detectedAt: new Date('2026-02-13T09:00:00Z') },
      ];
      (mockPrisma.uniFiConfigChange.findMany as jest.Mock).mockResolvedValue(mockEvents);

      const result = await getTimelineEvents({ groupBy: 'day' });

      expect(result.groups).toHaveLength(2); // Two different days
      // Most recent day first
      expect(result.groups[0].period).toBe('2026-02-14');
      expect(result.groups[0].events).toHaveLength(2);
      expect(result.groups[1].period).toBe('2026-02-13');
      expect(result.groups[1].events).toHaveLength(1);
    });

    it('computes summary correctly', async () => {
      const mockEvents = [
        { id: 'c1', resourceType: 'firewallRule', changeType: 'CREATED', detectedAt: new Date('2026-02-14T10:00:00Z'), resourceId: null, resourceName: null },
        { id: 'c2', resourceType: 'client', changeType: 'CREATED', detectedAt: new Date('2026-02-14T10:00:00Z'), resourceId: null, resourceName: null },
        { id: 'c3', resourceType: 'client', changeType: 'DELETED', detectedAt: new Date('2026-02-14T10:00:00Z'), resourceId: null, resourceName: null },
        { id: 'c4', resourceType: 'firmware', changeType: 'MODIFIED', detectedAt: new Date('2026-02-14T10:00:00Z'), resourceId: null, resourceName: null },
        { id: 'c5', resourceType: 'network', changeType: 'MODIFIED', detectedAt: new Date('2026-02-14T10:00:00Z'), resourceId: null, resourceName: null },
      ];
      (mockPrisma.uniFiConfigChange.findMany as jest.Mock).mockResolvedValue(mockEvents);

      const result = await getTimelineEvents({ groupBy: 'day' });

      const summary = result.groups[0].summary;
      expect(summary.total).toBe(5);
      expect(summary.newClients).toBe(1);
      expect(summary.removedClients).toBe(1);
      expect(summary.securityChanges).toBe(1);
      expect(summary.firmwareUpdates).toBe(1);
      expect(summary.configChanges).toBe(1);
    });

    it('filters by resource type', async () => {
      (mockPrisma.uniFiConfigChange.findMany as jest.Mock).mockResolvedValue([]);

      await getTimelineEvents({ filter: 'security' });

      expect(mockPrisma.uniFiConfigChange.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resourceType: {
              in: [
                'firewallRule',
                'firewallPolicy',
                'aclRule',
                'trafficRule',
                'portForward',
                'securityEvent',
                'alarm',
                'vpnServer',
              ],
            },
          }),
        })
      );
    });

    it('paginates groups', async () => {
      // Create 25 events spread across 25 different days
      const mockEvents = Array.from({ length: 25 }, (_, i) => ({
        id: `c${i}`,
        resourceType: 'firewallRule',
        changeType: 'CREATED',
        resourceId: null,
        resourceName: null,
        detectedAt: new Date(`2026-02-${String(i + 1).padStart(2, '0')}T10:00:00Z`),
      }));
      (mockPrisma.uniFiConfigChange.findMany as jest.Mock).mockResolvedValue(mockEvents);

      const result = await getTimelineEvents({ page: 1, limit: 10 });

      expect(result.groups).toHaveLength(10);
      expect(result.pagination.total).toBe(25);
      expect(result.pagination.totalPages).toBe(3);
    });

    it('returns empty result when no events', async () => {
      (mockPrisma.uniFiConfigChange.findMany as jest.Mock).mockResolvedValue([]);

      const result = await getTimelineEvents();

      expect(result.groups).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('getTimelineEventDetail', () => {
    it('returns full change record', async () => {
      const mockChange = {
        id: 'c1',
        changeType: 'MODIFIED',
        resourceType: 'firewallRule',
        previousValue: { action: 'drop' },
        newValue: { action: 'accept' },
      };
      (mockPrisma.uniFiConfigChange.findUnique as jest.Mock).mockResolvedValue(mockChange);

      const result = await getTimelineEventDetail('c1');

      expect(result).toEqual(mockChange);
      expect(mockPrisma.uniFiConfigChange.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1' },
      });
    });

    it('returns null for non-existent change', async () => {
      (mockPrisma.uniFiConfigChange.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await getTimelineEventDetail('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('getTimelineStats', () => {
    it('returns aggregated stats', async () => {
      (mockPrisma.uniFiSyncHistory.count as jest.Mock).mockResolvedValue(50);
      (mockPrisma.uniFiConfigChange.count as jest.Mock).mockResolvedValue(200);
      (mockPrisma.networkClient.count as jest.Mock).mockResolvedValue(30);
      (mockPrisma.uniFiSyncHistory.findFirst as jest.Mock)
        .mockResolvedValueOnce({ startedAt: new Date('2026-01-01') })
        .mockResolvedValueOnce({ startedAt: new Date('2026-02-14') });
      (mockPrisma.uniFiConfigChange.findFirst as jest.Mock).mockResolvedValue({ detectedAt: new Date('2026-01-01') });
      (mockPrisma.uniFiConfigChange.groupBy as jest.Mock).mockResolvedValue([
        { resourceType: 'firewallRule', _count: 80 },
        { resourceType: 'client', _count: 100 },
        { resourceType: 'network', _count: 20 },
      ]);

      const stats = await getTimelineStats();

      expect(stats.totalSyncs).toBe(50);
      expect(stats.totalChanges).toBe(200);
      expect(stats.totalClients).toBe(30);
      expect(stats.firstSyncDate).toBeTruthy();
      expect(stats.latestSyncDate).toBeTruthy();
      expect(stats.changesByType).toEqual({
        firewallRule: 80,
        client: 100,
        network: 20,
      });
    });
  });

  describe('getClients', () => {
    it('returns paginated client list', async () => {
      const mockClients = [
        { mac: 'aa:bb:cc:dd:ee:ff', hostname: 'phone', displayName: 'My Phone' },
      ];
      (mockPrisma.networkClient.findMany as jest.Mock).mockResolvedValue(mockClients);
      (mockPrisma.networkClient.count as jest.Mock).mockResolvedValue(1);

      const result = await getClients({ page: 1, limit: 50 });

      expect(result.clients).toEqual(mockClients);
      expect(result.pagination.total).toBe(1);
    });

    it('searches by hostname, mac, and network name', async () => {
      (mockPrisma.networkClient.findMany as jest.Mock).mockResolvedValue([]);
      (mockPrisma.networkClient.count as jest.Mock).mockResolvedValue(0);

      await getClients({ search: 'iphone' });

      expect(mockPrisma.networkClient.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { hostname: { contains: 'iphone', mode: 'insensitive' } },
              { mac: { contains: 'iphone', mode: 'insensitive' } },
            ]),
          }),
        })
      );
    });
  });

  describe('getClientDetail', () => {
    it('returns null for unknown MAC', async () => {
      (mockPrisma.networkClient.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await getClientDetail('00:00:00:00:00:00');
      expect(result).toBeNull();
    });

    it('returns enriched client detail', async () => {
      const mockClient = {
        mac: 'aa:bb:cc:dd:ee:ff',
        hostname: 'phone',
        displayName: 'My Phone',
        oui: 'Apple',
        lastIp: '192.168.1.50',
        lastNetworkId: 'net-1',
        lastNetworkName: 'LAN',
        isWired: false,
        unifiFirstSeen: new Date('2026-01-15'),
        unifiLastSeen: new Date('2026-02-14'),
      };
      (mockPrisma.networkClient.findUnique as jest.Mock).mockResolvedValue(mockClient);
      (mockPrisma.configuration.findFirst as jest.Mock).mockResolvedValue({
        configJson: {
          networkConf: [{ _id: 'net-1', name: 'LAN', vlan_enabled: true, vlan: 1, ip_subnet: '192.168.1.0/24', purpose: 'corporate' }],
          firewallRules: [],
          wlanConf: [],
        },
      });

      const result = await getClientDetail('aa:bb:cc:dd:ee:ff');

      expect(result).not.toBeNull();
      expect(result!.mac).toBe('aa:bb:cc:dd:ee:ff');
      expect(result!.displayName).toBe('My Phone');
      expect(result!.network).toEqual({
        name: 'LAN',
        vlan: 1,
        subnet: '192.168.1.0/24',
        isGuest: false,
      });
    });
  });
});
