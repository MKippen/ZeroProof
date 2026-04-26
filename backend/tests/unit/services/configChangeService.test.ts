const mockPrisma = {
  uniFiConfigChange: {
    create: jest.fn(),
  },
};

jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: mockPrisma,
  prisma: mockPrisma,
}));

import { compareResources, detectConfigChanges } from '../../../src/services/configChangeService';

describe('ConfigChangeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPrisma.uniFiConfigChange.create as jest.Mock).mockResolvedValue({ id: 'change-1' });
  });

  describe('compareResources', () => {
    it('detects new resources', async () => {
      const previous: any[] = [];
      const current = [{ _id: 'r1', name: 'New Rule' }];

      const count = await compareResources(
        'conn-1', 'firewallRule', previous, current,
        (r) => r._id, (r) => r.name
      );

      expect(count).toBe(1);
      expect(mockPrisma.uniFiConfigChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          connectionId: 'conn-1',
          changeType: 'CREATED',
          resourceType: 'firewallRule',
          resourceId: 'r1',
          resourceName: 'New Rule',
        }),
      });
    });

    it('detects deleted resources', async () => {
      const previous = [{ _id: 'r1', name: 'Old Rule' }];
      const current: any[] = [];

      const count = await compareResources(
        'conn-1', 'firewallRule', previous, current,
        (r) => r._id, (r) => r.name
      );

      expect(count).toBe(1);
      expect(mockPrisma.uniFiConfigChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changeType: 'DELETED',
          resourceName: 'Old Rule',
          previousValue: expect.objectContaining({ _id: 'r1' }),
        }),
      });
    });

    it('detects modified resources', async () => {
      const previous = [{ _id: 'r1', name: 'Rule', action: 'drop' }];
      const current = [{ _id: 'r1', name: 'Rule', action: 'accept' }];

      const count = await compareResources(
        'conn-1', 'firewallRule', previous, current,
        (r) => r._id, (r) => r.name
      );

      expect(count).toBe(1);
      expect(mockPrisma.uniFiConfigChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changeType: 'MODIFIED',
          previousValue: expect.objectContaining({ action: 'drop' }),
          newValue: expect.objectContaining({ action: 'accept' }),
        }),
      });
    });

    it('returns 0 for unchanged resources', async () => {
      const data = [{ _id: 'r1', name: 'Rule', action: 'drop' }];

      const count = await compareResources(
        'conn-1', 'firewallRule', data, data,
        (r) => r._id, (r) => r.name
      );

      expect(count).toBe(0);
      expect(mockPrisma.uniFiConfigChange.create).not.toHaveBeenCalled();
    });

    it('handles multiple changes at once', async () => {
      const previous = [
        { _id: 'r1', name: 'Existing', action: 'drop' },
        { _id: 'r2', name: 'ToDelete', action: 'accept' },
      ];
      const current = [
        { _id: 'r1', name: 'Existing', action: 'accept' }, // modified
        { _id: 'r3', name: 'NewRule', action: 'drop' },     // created
      ];

      const count = await compareResources(
        'conn-1', 'firewallRule', previous, current,
        (r) => r._id, (r) => r.name
      );

      expect(count).toBe(3); // 1 modified + 1 deleted + 1 created
      expect(mockPrisma.uniFiConfigChange.create).toHaveBeenCalledTimes(3);
    });
  });

  describe('detectConfigChanges', () => {
    it('compares all resource types', async () => {
      const previousConfig = {
        firewallRules: [{ _id: 'fw1', name: 'Rule1' }],
        networkConf: [{ _id: 'n1', name: 'LAN' }],
        wlanConf: [{ _id: 'w1', name: 'WiFi' }],
        portForward: [],
        trafficRules: [],
        firewallPolicies: [],
        clients: [{ mac: 'aa:bb:cc:dd:ee:ff', name: 'Phone' }],
        devices: [{ mac: '11:22:33:44:55:66', name: 'USW', version: '6.0' }],
      };

      const newConfig = {
        firewallRules: [{ _id: 'fw1', name: 'Rule1' }], // unchanged
        networkConf: [{ _id: 'n1', name: 'LAN-Updated' }], // modified
        wlanConf: [{ _id: 'w1', name: 'WiFi' }], // unchanged
        portForward: [{ _id: 'pf1', name: 'SSH' }], // new
        trafficRules: [],
        firewallPolicies: [],
        clients: [{ mac: 'aa:bb:cc:dd:ee:ff', name: 'Phone' }], // unchanged
        devices: [{ mac: '11:22:33:44:55:66', name: 'USW', version: '7.0' }], // firmware change
      };

      const count = await detectConfigChanges('conn-1', previousConfig, newConfig);

      // network modified + portForward created + device modified + firmware changed = 4
      expect(count).toBe(4);
    });

    it('returns 0 when configs are identical', async () => {
      const config = {
        firewallRules: [],
        networkConf: [],
        wlanConf: [],
        portForward: [],
        trafficRules: [],
        firewallPolicies: [],
        clients: [],
        devices: [],
      };

      const count = await detectConfigChanges('conn-1', config, config);
      expect(count).toBe(0);
    });

    it('detects firmware version changes', async () => {
      const previousConfig = {
        firewallRules: [],
        networkConf: [],
        wlanConf: [],
        portForward: [],
        trafficRules: [],
        firewallPolicies: [],
        clients: [],
        devices: [{ mac: 'aa:bb:cc:dd:ee:ff', name: 'UDM Pro', version: '3.0.20' }],
      };

      const newConfig = {
        ...previousConfig,
        devices: [{ mac: 'aa:bb:cc:dd:ee:ff', name: 'UDM Pro', version: '3.1.0' }],
      };

      const count = await detectConfigChanges('conn-1', previousConfig, newConfig);

      // Device metadata change + explicit firmware change event
      expect(count).toBe(2);
      expect(mockPrisma.uniFiConfigChange.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.uniFiConfigChange.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          resourceType: 'firmware',
          changeType: 'MODIFIED',
          previousValue: expect.objectContaining({ version: '3.0.20' }),
          newValue: expect.objectContaining({ version: '3.1.0' }),
        }),
      });
    });

    it('compares clients by MAC address', async () => {
      const previousConfig = {
        firewallRules: [], networkConf: [], wlanConf: [], portForward: [],
        trafficRules: [], firewallPolicies: [], devices: [],
        clients: [{ mac: 'aa:bb:cc:dd:ee:ff', name: 'Phone' }],
      };

      const newConfig = {
        ...previousConfig,
        clients: [
          { mac: 'aa:bb:cc:dd:ee:ff', name: 'Phone' },
          { mac: '11:22:33:44:55:66', name: 'Laptop' },
        ],
      };

      const count = await detectConfigChanges('conn-1', previousConfig, newConfig);

      // 1 new client
      expect(count).toBe(1);
    });
  });
});
