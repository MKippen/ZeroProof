/**
 * Routes test for /api/v1/detections. Mocks the analytics service so we can
 * verify the route shape, auth gate, query validation, and status mutators.
 */
jest.mock('../../../src/services/detection/detectionAnalytics', () => ({
  getDetectionSummary: jest.fn(),
  listDetections: jest.fn(),
}));

import express from 'express';
import request from 'supertest';
import detectionsRoutes from '../../../src/api/routes/detections';
import prisma from '../../../src/services/database';
import * as analytics from '../../../src/services/detection/detectionAnalytics';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;
const mockedAnalytics = analytics as jest.Mocked<typeof analytics>;

function buildApp(authed = true): express.Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { session?: { userId?: number } }).session = authed ? { userId: 42 } : {};
    next();
  });
  app.use('/api/v1/detections', detectionsRoutes);
  return app;
}

beforeEach(() => jest.clearAllMocks());

describe('auth', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp(false);
    await request(app).get('/api/v1/detections/analytics').expect(401);
    await request(app).get('/api/v1/detections').expect(401);
  });
});

describe('GET /analytics', () => {
  it('returns the full summary envelope', async () => {
    mockedAnalytics.getDetectionSummary.mockResolvedValue({
      windowHours: 24,
      since: '2026-05-06T00:00:00Z',
      total: 12,
      open: 9,
      resolved: 2,
      dismissed: 1,
      bySeverity: [{ severity: 'HIGH', count: 5 }],
      byDetector: [{ detectorId: 'ioc_match', count: 7 }],
      topAffected: [{ resource: 'iot-cam', count: 4, maxSeverity: 'CRITICAL' }],
    });

    const res = await request(buildApp())
      .get('/api/v1/detections/analytics')
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBe(12);
    expect(mockedAnalytics.getDetectionSummary).toHaveBeenCalledWith({
      windowHours: 24,
    });
  });

  it('forwards the hours query param to the service', async () => {
    mockedAnalytics.getDetectionSummary.mockResolvedValue({
      windowHours: 72,
      since: '',
      total: 0,
      open: 0,
      resolved: 0,
      dismissed: 0,
      bySeverity: [],
      byDetector: [],
      topAffected: [],
    });

    await request(buildApp())
      .get('/api/v1/detections/analytics?hours=72')
      .expect(200);
    expect(mockedAnalytics.getDetectionSummary).toHaveBeenCalledWith({
      windowHours: 72,
    });
  });

  it('rejects out-of-range hours', async () => {
    await request(buildApp())
      .get('/api/v1/detections/analytics?hours=999')
      .expect(400);
  });
});

describe('GET /', () => {
  it('lists detections, forwarding filters', async () => {
    mockedAnalytics.listDetections.mockResolvedValue([]);
    await request(buildApp())
      .get(
        '/api/v1/detections?hours=12&status=OPEN&detectorId=ioc_match&severityAtLeast=HIGH&limit=50'
      )
      .expect(200);

    expect(mockedAnalytics.listDetections).toHaveBeenCalledWith({
      windowHours: 12,
      status: 'OPEN',
      detectorId: 'ioc_match',
      severityAtLeast: 'HIGH',
      limit: 50,
    });
  });

  it('rejects invalid status values', async () => {
    await request(buildApp())
      .get('/api/v1/detections?status=BANANA')
      .expect(400);
  });
});

describe('GET /:id', () => {
  it('returns 404 when the detection does not exist', async () => {
    (mockedPrisma.detection.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/v1/detections/missing-id')
      .expect(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns the detection with date fields ISO-formatted', async () => {
    (mockedPrisma.detection.findUnique as jest.Mock).mockResolvedValue({
      id: 'd-1',
      detectorId: 'ioc_match',
      severity: 'HIGH',
      status: 'OPEN',
      title: 't',
      description: 'd',
      occurrences: 2,
      firstSeen: new Date('2026-05-01T00:00:00Z'),
      lastSeen: new Date('2026-05-06T00:00:00Z'),
      expiresAt: new Date('2026-05-20T00:00:00Z'),
      evidence: [],
    });

    const res = await request(buildApp()).get('/api/v1/detections/d-1').expect(200);
    expect(res.body.data.firstSeen).toBe('2026-05-01T00:00:00.000Z');
    expect(res.body.data.lastSeen).toBe('2026-05-06T00:00:00.000Z');
  });
});

describe('status mutators', () => {
  it('POST /:id/resolve sets status=RESOLVED', async () => {
    (mockedPrisma.detection.update as jest.Mock).mockResolvedValue({ id: 'd-1' });
    const res = await request(buildApp())
      .post('/api/v1/detections/d-1/resolve')
      .expect(200);
    expect(res.body.data.status).toBe('RESOLVED');
    expect(mockedPrisma.detection.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { status: 'RESOLVED' },
    });
  });

  it('POST /:id/dismiss sets status=DISMISSED', async () => {
    (mockedPrisma.detection.update as jest.Mock).mockResolvedValue({ id: 'd-1' });
    await request(buildApp())
      .post('/api/v1/detections/d-1/dismiss')
      .expect(200);
    expect(mockedPrisma.detection.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { status: 'DISMISSED' },
    });
  });

  it('POST /:id/reopen sets status=OPEN', async () => {
    (mockedPrisma.detection.update as jest.Mock).mockResolvedValue({ id: 'd-1' });
    await request(buildApp())
      .post('/api/v1/detections/d-1/reopen')
      .expect(200);
    expect(mockedPrisma.detection.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { status: 'OPEN' },
    });
  });
});
