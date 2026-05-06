import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import dnsProxyRoutes from '../../../src/api/routes/dnsProxy';
import * as dnsProxyService from '../../../src/services/dnsProxyService';

jest.mock('../../../src/api/middleware/auth', () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../../../src/services/dnsProxyService', () => ({
  deleteDnsProxySettings: jest.fn(),
  getActiveDnsProxyConnection: jest.fn(),
  getDnsProxySettings: jest.fn(),
  getDnsProxyStatus: jest.fn(),
  getDnsSignals: jest.fn(),
  getRecentDnsQueries: jest.fn(),
  saveDnsProxySettings: jest.fn(),
  syncDnsProxyConnection: jest.fn(),
  testDnsProxyConnection: jest.fn(),
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/dns-proxy', dnsProxyRoutes);
  return app;
}

describe('dns proxy routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns saved DNS proxy settings', async () => {
    jest.mocked(dnsProxyService.getDnsProxySettings).mockResolvedValue({
      configured: true,
      settings: {
        id: 'conn-1',
        host: '192.168.1.10',
        port: 3000,
        useHttps: false,
        allowSelfSigned: false,
        username: 'admin',
        pollingEnabled: true,
        pollingIntervalSec: 60,
        retentionDays: 7,
        attributionStatus: 'UNKNOWN',
      },
    });

    const response = await request(buildApp()).get('/dns-proxy/settings');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.settings.host).toBe('192.168.1.10');
  });

  it('tests AdGuard Home connectivity', async () => {
    jest.mocked(dnsProxyService.testDnsProxyConnection).mockResolvedValue({
      status: { version: 'v0.108.0', protection_enabled: true },
      queryLogConfig: { enabled: true, interval: 24, anonymize_client_ip: false },
    });

    const payload = {
      host: '192.168.1.10',
      port: 3000,
      useHttps: false,
        allowSelfSigned: false,
      username: 'admin',
      password: 'secret',
      pollingEnabled: true,
      retentionDays: 7,
    };

    const response = await request(buildApp()).post('/dns-proxy/test').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.connected).toBe(true);
    expect(dnsProxyService.testDnsProxyConnection).toHaveBeenCalledWith(payload);
  });

  it('saves settings with validation defaults', async () => {
    jest.mocked(dnsProxyService.saveDnsProxySettings).mockResolvedValue({
      id: 'conn-1',
      host: '192.168.1.10',
      port: 3000,
      useHttps: false,
        allowSelfSigned: false,
      username: 'admin',
      pollingEnabled: true,
      pollingIntervalSec: 60,
      retentionDays: 7,
      attributionStatus: 'UNKNOWN',
    });

    const response = await request(buildApp()).post('/dns-proxy/settings').send({
      host: '192.168.1.10',
      username: 'admin',
      password: 'secret',
      useHttps: false,
        allowSelfSigned: false,
      pollingEnabled: true,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.configured).toBe(true);
    expect(dnsProxyService.saveDnsProxySettings).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3000, retentionDays: 7 })
    );
  });

  it('allows Home Assistant hosted AdGuard APIs with no AdGuard auth', async () => {
    jest.mocked(dnsProxyService.testDnsProxyConnection).mockResolvedValue({
      status: { version: 'v0.108.0', protection_enabled: true },
      queryLogConfig: { enabled: true, interval: 24, anonymize_client_ip: false },
    });
    jest.mocked(dnsProxyService.saveDnsProxySettings).mockResolvedValue({
      id: 'conn-1',
      host: 'homeassistant.local',
      port: 3000,
      useHttps: false,
        allowSelfSigned: false,
      username: '',
      pollingEnabled: true,
      pollingIntervalSec: 60,
      retentionDays: 30,
      attributionStatus: 'UNKNOWN',
    });

    const payload = {
      host: 'homeassistant.local',
      port: 3000,
      useHttps: false,
        allowSelfSigned: false,
      pollingEnabled: true,
      retentionDays: 30,
    };

    const app = buildApp();
    const testResponse = await request(app).post('/dns-proxy/test').send(payload);
    const saveResponse = await request(app).post('/dns-proxy/settings').send(payload);

    expect(testResponse.status).toBe(200);
    expect(saveResponse.status).toBe(200);
    expect(dnsProxyService.testDnsProxyConnection).toHaveBeenCalledWith(
      expect.objectContaining({ username: '' })
    );
    expect(dnsProxyService.saveDnsProxySettings).toHaveBeenCalledWith(
      expect.objectContaining({ username: '' })
    );
  });

  it('returns status, sync results, and recent query rows', async () => {
    jest.mocked(dnsProxyService.getDnsProxyStatus).mockResolvedValue({
      configured: true,
      settings: null,
      stats: {
        totalQueries: 10,
        recentQueries: 5,
        blockedQueries: 1,
        suspiciousQueries: 1,
        uniqueClients: 3,
      },
      attribution: {
        status: 'HEALTHY',
        reason: 'matched',
        uniqueClientCount: 3,
        matchedClientCount: 2,
        sampleClients: ['192.168.30.50'],
      },
    });
    jest.mocked(dnsProxyService.getActiveDnsProxyConnection).mockResolvedValue({
      id: 'conn-1',
      isActive: true,
    } as any);
    jest.mocked(dnsProxyService.syncDnsProxyConnection).mockResolvedValue({
      inserted: 2,
      signalsCreated: 1,
      latestQueryAt: new Date('2026-05-02T18:00:00.000Z'),
      queryLogConfig: { enabled: true, interval: 24, anonymize_client_ip: false },
      attribution: {
        status: 'HEALTHY',
        reason: 'matched',
        uniqueClientCount: 3,
        matchedClientCount: 2,
        sampleClients: [],
      },
    });
    jest.mocked(dnsProxyService.getRecentDnsQueries).mockResolvedValue({
      queries: [
        {
          id: 'query-1',
          queriedAt: '2026-05-02T18:00:00.000Z',
          clientIp: '192.168.30.50',
          clientName: null,
          domain: 'api.xdresi.to',
          queryType: 'A',
          status: 'NOERROR',
          reason: 'FilteredBlackList',
          rule: '||xdresi.to^',
          upstream: 'tls://1.1.1.1',
          isBlocked: true,
          isSuspicious: true,
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    });

    const app = buildApp();
    const statusResponse = await request(app).get('/dns-proxy/status');
    const syncResponse = await request(app).post('/dns-proxy/sync');
    const queriesResponse = await request(app).get(
      '/dns-proxy/queries?search=xdresi&client=192.168.30.50&status=blocked&suspiciousOnly=true'
    );

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.data.attribution.status).toBe('HEALTHY');
    expect(syncResponse.status).toBe(200);
    expect(syncResponse.body.data.inserted).toBe(2);
    expect(queriesResponse.status).toBe(200);
    expect(queriesResponse.body.data.queries[0].domain).toBe('api.xdresi.to');
    expect(dnsProxyService.getRecentDnsQueries).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'xdresi',
        client: '192.168.30.50',
        status: 'blocked',
        suspiciousOnly: true,
      })
    );
  });
});
