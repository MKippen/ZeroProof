import express from 'express';
import session from 'express-session';
import request from 'supertest';
import authRoutes from '../../../src/api/routes/auth';
import { csrfProtection } from '../../../src/api/middleware/csrf';
import prisma from '../../../src/services/database';
import { requireAuth } from '../../../src/api/middleware/auth';

jest.mock('../../../src/config', () => ({ isProd: false }));
jest.mock('bcrypt', () => ({
  compare: jest.fn(async (password: string, hash: string) => hash === `hashed:${password}`),
  hash: jest.fn(async (password: string) => `hashed:${password}`),
}));
// Rate limiting is independent of the session lifecycle exercised here.
jest.mock('express-rate-limit', () => () => (
  _req: express.Request, _res: express.Response, next: express.NextFunction
) => next());
jest.mock('../../../src/services/database', () => {
  const db = {
    user: {
      findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(),
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
  app.all('/api/v1/privileged', requireAuth, (_req, res) => res.json({ success: true }));
  app.get('/fixture/legacy-session', (req, res) => {
    req.session.userId = 1;
    req.session.user = { id: 1 };
    res.json({ success: true });
  });
  return app;
}

describe('production auth routes and real session lifecycle', () => {
  let account: any;
  const originalEnv = process.env.NODE_ENV;
  beforeAll(() => { process.env.NODE_ENV = 'production'; });
  afterAll(() => { process.env.NODE_ENV = originalEnv; });
  beforeEach(() => {
    jest.clearAllMocks();
    account = { id: 1, passwordHash: 'hashed:correct-password-123', mustChangePassword: false, lastLogin: null };
    (prisma.user.findFirst as jest.Mock).mockImplementation(async () => account);
    (prisma.user.findUnique as jest.Mock).mockImplementation(async () => account);
    (prisma.user.count as jest.Mock).mockImplementation(async () => account ? 1 : 0);
    (prisma.user.create as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      account = { id: 1, lastLogin: null, ...data };
      return account;
    });
    (prisma.user.update as jest.Mock).mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      Object.assign(account, data);
      return account;
    });
    (prisma.user.updateMany as jest.Mock).mockImplementation(async (args: { where?: { passwordHash?: string }; data: Record<string, unknown> }) => {
      if (!account || args?.where?.passwordHash !== account.passwordHash) return { count: 0 };
      Object.assign(account, args.data);
      return { count: 1 };
    });
    jest.mocked(prisma.auditLog.create).mockResolvedValue({} as any);
    jest.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(prisma));
  });

  async function login(agent: ReturnType<typeof request.agent>, password = 'correct-password-123') {
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const response = await agent.post('/api/v1/auth/login')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ password }).expect(200);
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
    account = null;
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
      account = null;
      const agent = request.agent(buildApp());
      const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      await agent.post('/api/v1/auth/setup').set('X-CSRF-Token', csrf.body.data.csrfToken)
        .send({ password }).expect(400);
      expect(prisma.user.create).not.toHaveBeenCalled();
    }
  );

  it('requires legacy cookies without a credential fingerprint to sign in again', async () => {
    const agent = request.agent(buildApp());
    await agent.get('/fixture/legacy-session').expect(200);
    const response = await agent.get('/api/v1/auth/me').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(response.headers['set-cookie'][0]).toContain('connect.sid=;');
  });

  it.each(['reset', 'delete'])('revokes existing sessions after an external account %s', async (operation) => {
    const agent = request.agent(buildApp());
    await login(agent);
    await agent.get('/api/v1/privileged').expect(200);
    if (operation === 'reset') account.passwordHash = 'hashed:external-reset-password';
    else account = null;
    const response = await agent.get('/api/v1/privileged').expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('enforces current required-password state while allowing account maintenance', async () => {
    const agent = request.agent(buildApp());
    await login(agent);
    account.mustChangePassword = true;
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.user.mustChangePassword).toBe(true);
    expect(me.body.data.user.passwordHash).toBeUndefined();
    expect(me.body.data.user.credentialVersion).toBeUndefined();
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    const denied = await agent.get('/api/v1/privileged').expect(403);
    expect(denied.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await agent.post('/api/v1/privileged').set('X-CSRF-Token', csrf.body.data.csrfToken).expect(403);
    const unchanged = await agent.post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ currentPassword: 'correct-password-123', newPassword: 'correct-password-123' }).expect(400);
    expect(unchanged.body.error.code).toBe('PASSWORD_UNCHANGED');
    expect(account.mustChangePassword).toBe(true);
    await agent.post('/api/v1/auth/logout').set('X-CSRF-Token', csrf.body.data.csrfToken).expect(200);
  });

  it('returns retryable 503 on account lookup failure without destroying a valid session', async () => {
    const agent = request.agent(buildApp());
    await login(agent);
    jest.mocked(prisma.user.findUnique).mockRejectedValueOnce(new Error('database unavailable'));
    const response = await agent.get('/api/v1/privileged').expect(503);
    expect(response.body.error.code).toBe('AUTH_UNAVAILABLE');
    expect(response.headers['set-cookie']).toBeUndefined();
    await agent.get('/api/v1/privileged').expect(200);
  });

  it('rotates the password-changing session and CSRF while revoking another signed-in browser', async () => {
    const app = buildApp();
    const current = request.agent(app);
    const other = request.agent(app);
    const { response: signedIn } = await login(current);
    await login(other);
    const csrf = await current.get('/api/v1/auth/csrf').expect(200);
    const changed = await current.post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ currentPassword: 'correct-password-123', newPassword: 'new-distinct-password' }).expect(200);
    expect(changed.body.data).toEqual({ user: { id: 1 }, mustChangePassword: false });
    expect(changed.headers['set-cookie'][0]).not.toBe(signedIn.headers['set-cookie'][0]);
    await current.get('/api/v1/privileged').expect(200);
    await other.get('/api/v1/privileged').expect(401);
    await current.post('/api/v1/privileged').set('X-CSRF-Token', csrf.body.data.csrfToken).expect(403);
    const refreshed = await current.get('/api/v1/auth/csrf').expect(200);
    expect(refreshed.body.data.csrfToken).not.toBe(csrf.body.data.csrfToken);
  });

  it('refuses to overwrite a password changed by another request after current-password verification', async () => {
    const agent = request.agent(buildApp());
    await login(agent);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    (prisma.user.updateMany as jest.Mock).mockImplementationOnce(async () => {
      account.passwordHash = 'hashed:concurrent-reset-password';
      return { count: 0 };
    });
    const response = await agent.post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ currentPassword: 'correct-password-123', newPassword: 'new-distinct-password' }).expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(account.passwordHash).toBe('hashed:concurrent-reset-password');
  });

  it('reports the committed password accurately if renewing its session fails', async () => {
    const store = new session.MemoryStore();
    const app = buildApp(store);
    const agent = request.agent(app);
    await login(agent);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    jest.spyOn(store, 'set').mockImplementationOnce((_sid, _session, callback) => callback?.(new Error('save unavailable')));
    const response = await agent.post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ currentPassword: 'correct-password-123', newPassword: 'new-distinct-password' }).expect(401);
    expect(response.body.error.code).toBe('PASSWORD_CHANGED_SESSION_EXPIRED');
    expect(account.passwordHash).toBe('hashed:new-distinct-password');
    await login(request.agent(app), 'new-distinct-password');
  });

  it('keeps a successful password change successful when audit logging fails', async () => {
    const agent = request.agent(buildApp());
    await login(agent);
    const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
    jest.mocked(prisma.auditLog.create).mockRejectedValueOnce(new Error('audit unavailable'));
    await agent.post('/api/v1/auth/change-password')
      .set('X-CSRF-Token', csrf.body.data.csrfToken)
      .send({ currentPassword: 'correct-password-123', newPassword: 'new-distinct-password' }).expect(200);
    await agent.get('/api/v1/privileged').expect(200);
  });
});
