import request from 'supertest';
import express from 'express';
import type { Server } from 'http';

// Create a minimal express app for testing
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Mock auth routes for testing
  app.post('/api/v1/auth/login', (req, res) => {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Password required' },
      });
    }

    if (password === 'admin123!') {
      return res.status(200).json({
        success: true,
        data: {
          user: { id: 1 },
          mustChangePassword: false,
        },
      });
    }

    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid password' },
    });
  });

  app.post('/api/v1/auth/logout', (_req, res) => {
    res.status(200).json({ success: true });
  });

  app.get('/api/v1/auth/me', (_req, res) => {
    // Simulate unauthenticated
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
  });

  return app;
};

const runIntegration = process.env.SKIP_INTEGRATION !== '1';
const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('Auth API', () => {
  const app = createTestApp();
  let server: Server;

  beforeAll((done) => {
    server = app.listen(0, '127.0.0.1', done);
  });

  afterAll((done) => {
    server.close(done);
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid password', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ password: 'admin123!' })
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user.id).toBe(1);
    });

    it('should reject invalid password', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({ password: 'wrongpassword' })
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('should require a password', async () => {
      const response = await request(server)
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully', async () => {
      const response = await request(server)
        .post('/api/v1/auth/logout')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('should return 401 when not authenticated', async () => {
      const response = await request(server)
        .get('/api/v1/auth/me')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });
  });
});
