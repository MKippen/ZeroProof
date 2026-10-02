import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import unifiRoutes from '../../../src/api/routes/unifi';
import { syncUniFiConfiguration, UniFiSyncError } from '../../../src/services/unifiSyncService';
import { JobLeaseBusyError, JobLeaseLostError } from '../../../src/services/jobLease';
import prisma from '../../../src/services/database';
import { credentialVersion } from '../../../src/services/accountSession';

jest.mock('../../../src/services/unifiSyncService', () => ({
  syncUniFiConfiguration: jest.fn(),
  UniFiSyncError: class extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));
jest.mock('../../../src/api/middleware/rateLimit', () => ({
  unifiReadLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
  unifiMutationLimiter: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const result = {
  connectionId: 'lab', connectionName: 'Lab controller', syncId: 'sync-1', configId: 'config-1', siteName: 'Lab',
  changed: true, clientsDiscovered: 2,
  stats: { devicesFound: 3, networksFound: 4, rulesFound: 5, wlansFound: 6, changesDetected: 7, vulnerabilitiesFound: 8 },
};
const endpoints = ['/sync', '/connections/lab/sync'];

function buildApp(authed = true) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      ...(authed ? { userId: 42, credentialVersion: credentialVersion('test-account-hash') } : {}),
      destroy: (done: (error?: Error) => void) => done(),
    } as unknown as typeof req.session;
    next();
  });
  app.use('/unifi', unifiRoutes);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 42, passwordHash: 'test-account-hash', mustChangePassword: false, lastLogin: null });
  jest.mocked(syncUniFiConfiguration).mockReset().mockResolvedValue(result);
});

describe('UniFi sync route delegation', () => {
  it.each(endpoints)('requires authentication before starting %s', async (endpoint) => {
    await request(buildApp(false)).post(`/unifi${endpoint}`).send({}).expect(401);
    expect(syncUniFiConfiguration).not.toHaveBeenCalled();
  });

  it('preserves the legacy changed response and delegates the validated site override', async () => {
    const response = await request(buildApp()).post('/unifi/sync').send({ site: ' lab-a ' }).expect(200);
    expect(syncUniFiConfiguration).toHaveBeenCalledTimes(1);
    expect(syncUniFiConfiguration).toHaveBeenCalledWith({ siteId: 'lab-a', trigger: 'manual' });
    expect(response.body).toEqual({ success: true, data: {
      synced: true, config: { id: 'config-1', siteName: 'Lab' }, changesDetected: 7, clientsDiscovered: 2,
      analysis: { vulnerabilitiesFound: 8 },
    } });
  });

  it('preserves the unchanged response with client changes reported', async () => {
    jest.mocked(syncUniFiConfiguration).mockResolvedValue({ ...result, changed: false });
    const response = await request(buildApp()).post('/unifi/sync').send({}).expect(200);
    expect(response.body).toEqual({ success: true, data: {
      synced: false, message: 'Configuration unchanged', changesDetected: 7, clientsDiscovered: 2,
    } });
  });

  it('preserves the named connection response and delegates ownership to the same service', async () => {
    const response = await request(buildApp()).post('/unifi/connections/lab/sync').send({}).expect(200);
    expect(syncUniFiConfiguration).toHaveBeenCalledTimes(1);
    expect(syncUniFiConfiguration).toHaveBeenCalledWith({ connectionId: 'lab', trigger: 'manual' });
    expect(response.body).toEqual({ success: true, data: { syncId: 'sync-1', configId: 'config-1', stats: result.stats } });
  });

  it.each([42, {}, '', ' '.repeat(5), 'x'.repeat(129)])('rejects an invalid site override before acquiring ownership: %s', async (site) => {
    const response = await request(buildApp()).post('/unifi/sync').send({ site }).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(syncUniFiConfiguration).not.toHaveBeenCalled();
  });

  it('preserves NOT_CONFIGURED400 and NOT_FOUND404 with safe messages', async () => {
    jest.mocked(syncUniFiConfiguration).mockRejectedValueOnce(new UniFiSyncError('NOT_CONFIGURED', 'private detail'));
    const legacy = await request(buildApp()).post('/unifi/sync').send({}).expect(400);
    expect(legacy.body.error).toEqual({ code: 'NOT_CONFIGURED', message: 'No UniFi connection configured' });
    jest.mocked(syncUniFiConfiguration).mockRejectedValueOnce(new UniFiSyncError('NOT_FOUND', 'private detail'));
    const named = await request(buildApp()).post('/unifi/connections/missing/sync').send({}).expect(404);
    expect(named.body.error).toEqual({ code: 'NOT_FOUND', message: 'Connection not found' });
  });

  describe.each(endpoints)('%s failure contracts', (endpoint) => {
    it.each([
      { error: new JobLeaseBusyError(), status: 409, code: 'SYNC_IN_PROGRESS' },
      { error: new JobLeaseLostError(), status: 503, code: 'SYNC_LEASE_LOST' },
      { error: new UniFiSyncError('CONNECTION_CHANGED', 'private controller details'), status: 409, code: 'CONNECTION_CHANGED' },
    ])('returns $status $code once without exposing internals', async ({ error, status, code }) => {
      error.message = 'password=do-not-expose; database://private';
      jest.mocked(syncUniFiConfiguration).mockRejectedValueOnce(error);
      const response = await request(buildApp()).post(`/unifi${endpoint}`).send({}).expect(status);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe(code);
      expect(response.body.error.message).toMatch(/try again|try syncing again/);
      expect(JSON.stringify(response.body)).not.toMatch(/do-not-expose|database:\/\/private/);
      expect(syncUniFiConfiguration).toHaveBeenCalledTimes(1);
    });

    it('returns a generic 500 when sync fails before producing a result', async () => {
      jest.mocked(syncUniFiConfiguration).mockRejectedValueOnce(new Error('password=do-not-expose; database://private'));
      const response = await request(buildApp()).post(`/unifi${endpoint}`).send({}).expect(500);
      expect(response.body).toEqual({ success: false, error: {
        code: endpoint === '/sync' ? 'SYNC_FAILED' : 'SYNC_ERROR',
        message: 'Could not sync configuration. Please try again.',
      } });
      expect(syncUniFiConfiguration).toHaveBeenCalledTimes(1);
    });

    it('does not claim success when the manual service unexpectedly returns no result', async () => {
      jest.mocked(syncUniFiConfiguration).mockResolvedValueOnce(null);
      const response = await request(buildApp()).post(`/unifi${endpoint}`).send({}).expect(500);
      expect(response.body.success).toBe(false);
    });
  });
});
