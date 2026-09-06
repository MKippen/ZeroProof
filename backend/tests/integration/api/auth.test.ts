import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from '../../../src/api/routes/auth';
import { csrfProtection } from '../../../src/api/middleware/csrf';
import prisma from '../../../src/services/database';

jest.mock('../../../src/config', () => ({ isProd: false }));
jest.mock('bcrypt', () => ({
  compare: jest.fn(async (password: string) => password === 'correct-password-123'),
  hash: jest.fn(async (password: string) => `hashed:${password}`),
}));
// Rate limiting is independent of the session lifecycle exercised here.
jest.mock('express-rate-limit', () => () => (
  _req: express.Request, _res: express.Response, next: express.NextFunction
) => next());
jest.mock('../../../src/services/database', () => {
  const db = {
    user: {
      findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(),
      count: jest.fn(), create: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  return { __esModule: true, default: db };
});

function buildApp(store = new session.MemoryStore()) {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-session-secret-with-at-least-32-characters',
    resave: false, saveUninitialized: false, store,
    cookie: { httpOnly: true, sameSite: 'strict' },
  }));
  app.use('/api/v1', csrfProtection);
  app.use('/api/v1/auth', authRoutes);
  return app;
}

describe('production auth routes and real session lifecycle', () => {
  const originalEnv = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = 'production'; });
  afterAll(() => { process.env.NODE_ENV = originalEnv; });
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(prisma.user.findFirst).mockResolvedValue({
      id: 1, passwordHash: 'hashed', mustChangePassword: false,
    } as any);
    jest.mocked(prisma.user.findUnique).mockResolvedValue({ id: 1 } as any);
    jest.mocked(prisma.user.count).mockResolvedValue(0);
    jest.mocked(prisma.user.create).mockResolvedValue({ id: 1 } as any);
    jest.mocked(prisma.auditLog.create).mockResolvedValue({} as any);
    jest.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma));
  });

  async function login(agent: ReturnType<typeof request.agent>) {
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const response = await agent.post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ password: 'correct-password-123' }).expect(200);
    return { csrf, response };
  }

  it('rotates the anonymous session and token after login and invalidates the old cookie', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    const { csrf, response } = await login(agent);
    expect(response.headers['set-cookie'][0]).not.toBe(csrf.headers['set-cookie'][0]);
    await agent.get('/api/v1/auth/me').expect(200);
    await request(app).get('/api/v1/auth/me')
      .set('Cookie', csrf.headers['set-cookie'][0].split(';')[0]).expect(401);
    await agent.post('/api/v1/auth/logout')
      .set('X-CSRF-Token', csrf.body.data.csrfToken).expect(403);
    const refreshed = await agent.get('/api/v1/auth/csrf').expect(200);
    expect(refreshed.body.data.csrfToken).not.toBe(csrf.body.data.csrfToken);
  });

  it('rejects incorrect credentials without authenticating the session', async () => {
    const agent = request.agent(buildApp());
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    await agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ password: 'wrong-password-123' }).expect(401);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('destroys the stored session even when logout audit logging fails', async () => {
    const app = buildApp();
    const agent = request.agent(app);
    const { response } = await login(agent);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    jest.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error('audit database unavailable'));
    const logout = await agent.post('/api/v1/auth/logout')
      .set('X-CSRF-Token', csrf.body.data.csrfToken).expect(200);
    expect(logout.headers['set-cookie'][0]).toContain('connect.sid=;');
    await request(app).get('/api/v1/auth/me')
      .set('Cookie', response.headers['set-cookie'][0].split(';')[0]).expect(401);
  });

  it('reports failure when the session store cannot invalidate a session', async () => {
    const store = new session.MemoryStore();
    const agent = request.agent(buildApp(store));
    await login(agent);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    jest.spyOn(store, 'destroy').mockImplementationOnce((_sid, callback) => {
      callback?.(new Error('store unavailable'));
    });
    const response = await agent.post('/api/v1/auth/logout')
      .set('X-CSRF-Token', csrf.body.data.csrfToken).expect(500);
    expect(response.body.error.code).toBe('LOGOUT_ERROR');
  });

  it.each(['x'.repeat(73), 'é'.repeat(37)])('rejects password changes beyond bcrypt byte limits (%p)', async (newPassword) => {
    const agent = request.agent(buildApp());
    await login(agent);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    jest.mocked(prisma.user.update).mockClear();
    await agent.post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ currentPassword: 'correct-password-123', newPassword }).expect(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('creates the first admin under a database lock and rotates the setup session', async () => {
    const agent = request.agent(buildApp());
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const response = await agent.post('/api/v1/auth/setup')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ password: 'correct-password-123' }).expect(201);
    expect(response.headers['set-cookie'][0]).not.toBe(csrf.headers['set-cookie'][0]);
    expect(prisma.$executeRaw).toHaveBeenCalledWith(['LOCK TABLE "User" IN EXCLUSIVE MODE']);
    const lockedAt = jest.mocked(prisma.$executeRaw).mock.invocationCallOrder[0];
    const recheckedAt = jest.mocked(prisma.user.count).mock.invocationCallOrder[1];
    const createdAt = jest.mocked(prisma.user.create).mock.invocationCallOrder[0];
    expect(lockedAt).toBeLessThan(recheckedAt);
    expect(recheckedAt).toBeLessThan(createdAt);
    await agent.get('/api/v1/auth/me').expect(200);
  });

  it('rejects a setup request if another admin was created while its password was hashing', async () => {
    jest.mocked(prisma.user.count).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const agent = request.agent(buildApp());
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const response = await agent.post('/api/v1/auth/setup')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ password: 'correct-password-123' }).expect(409);
    expect(response.body.error.code).toBe('ALREADY_INITIALIZED');
    expect(prisma.user.create).not.toHaveBeenCalled();
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it.each([123456789012, { length: 20 }, 'x'.repeat(73), 'é'.repeat(37)])(
    'rejects setup passwords that are not strings or exceed bcrypt byte limits (%p)', async (password) => {
      const agent = request.agent(buildApp());
      const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      await agent.post('/api/v1/auth/setup').set('X-CSRF-Token', csrf.body.data.csrfToken)
        .send({ password }).expect(400);
      expect(prisma.user.create).not.toHaveBeenCalled();
    }
  );
});
