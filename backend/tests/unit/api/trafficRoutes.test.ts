/**
 * Routes test for /api/v1/traffic. Mocks the analytics service so we can
 * verify the route shape, auth gate, and response envelope without booting
 * a real DB.
 */
jest.mock('../../../src/services/firewall/trafficAnalytics', () => ({
  getTrafficSummary: jest.fn(),
  getTopPolicies: jest.fn(),
  getTopClients: jest.fn(),
  getTopRegions: jest.fn(),
  getRecentFlows: jest.fn(),
  getRecentThreats: jest.fn(),
}));

import express from 'express';
import session from 'express-session';
import request from 'supertest';
import trafficRoutes from '../../../src/api/routes/traffic';
import prisma from '../../../src/services/database';
import * as analytics from '../../../src/services/firewall/trafficAnalytics';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedAnalytics = analytics as jest.Mocked<typeof analytics>;

function buildApp(authed = true): express.Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
    })
  );
  app.use((req, _res, next) => {
    if (authed) (req.session as unknown as { userId?: number }).userId = 42;
    next();
  });
  app.use('/api/v1/traffic', trafficRoutes);
  return app;
}

describe('GET /api/v1/traffic/analytics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const app = buildApp(false);
    await request(app).get('/api/v1/traffic/analytics').expect(401);
  });

  it('returns configured=false when no UniFi connection exists', async () => {
    (mockedPrisma.uniFiConnection.findFirst as jest.Mock).mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app).get('/api/v1/traffic/analytics').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.configured).toBe(false);
    expect(res.body.data.summary).toBeNull();
    expect(res.body.data.recentFlows).toEqual([]);
  });

  it('returns the full analytics payload for an active connection', async () => {
    (mockedPrisma.uniFiConnection.findFirst as jest.Mock).mockResolvedValue({ id: 'conn-1' });
    mockedAnalytics.getTrafficSummary.mockResolvedValue({
      windowHours: 24,
      since: '2026-05-06T00:00:00Z',
      totalBlocked: 5000,
      byRisk: { low: 4900, medium: 50, high: 50, concerning: 0 },
      uniqueSrcMacs: 25,
      threatCount: 50,
    });
    mockedAnalytics.getTopPolicies.mockResolvedValue([
      { name: 'Block: IOT > Internet', type: null, count: 1500 },
    ]);
    mockedAnalytics.getTopClients.mockResolvedValue([
      { mac: 'aa:bb:cc:dd:ee:01', displayName: 'iPad', count: 800 },
    ]);
    mockedAnalytics.getTopRegions.mockResolvedValue([{ region: 'US', count: 4000 }]);
    mockedAnalytics.getRecentFlows.mockResolvedValue([]);
    mockedAnalytics.getRecentThreats.mockResolvedValue([]);

    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/traffic/analytics?hours=24')
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.configured).toBe(true);
    expect(res.body.data.summary.totalBlocked).toBe(5000);
    expect(res.body.data.topPolicies[0].name).toBe('Block: IOT > Internet');
    expect(res.body.data.topClients[0].displayName).toBe('iPad');
    expect(res.body.data.topRegions[0].region).toBe('US');
  });

  it('rejects out-of-range `hours` query param', async () => {
    (mockedPrisma.uniFiConnection.findFirst as jest.Mock).mockResolvedValue({ id: 'conn-1' });
    const app = buildApp();
    await request(app).get('/api/v1/traffic/analytics?hours=999').expect(400);
  });

  it('forwards the windowHours to each analytics call', async () => {
    (mockedPrisma.uniFiConnection.findFirst as jest.Mock).mockResolvedValue({ id: 'conn-1' });
    mockedAnalytics.getTrafficSummary.mockResolvedValue({
      windowHours: 6,
      since: '2026-05-07T00:00:00Z',
      totalBlocked: 0,
      byRisk: { low: 0, medium: 0, high: 0, concerning: 0 },
      uniqueSrcMacs: 0,
      threatCount: 0,
    });
    mockedAnalytics.getTopPolicies.mockResolvedValue([]);
    mockedAnalytics.getTopClients.mockResolvedValue([]);
    mockedAnalytics.getTopRegions.mockResolvedValue([]);
    mockedAnalytics.getRecentFlows.mockResolvedValue([]);
    mockedAnalytics.getRecentThreats.mockResolvedValue([]);

    const app = buildApp();
    await request(app).get('/api/v1/traffic/analytics?hours=6').expect(200);

    expect(mockedAnalytics.getTopPolicies).toHaveBeenCalledWith(
      expect.objectContaining({ windowHours: 6 }),
      expect.any(Number)
    );
  });
});
