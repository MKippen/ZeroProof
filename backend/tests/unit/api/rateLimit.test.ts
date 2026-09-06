import express from 'express';
import request from 'supertest';
import { firmwareDownloadLimiter, unifiMutationLimiter, unifiReadLimiter } from '../../../src/api/middleware/rateLimit';

it('allows dashboard polling without consuming the controller mutation budget', async () => {
  const app = express();
  app.use((req, _res, next) => { req.session = { userId: 5 } as typeof req.session; next(); });
  app.use(unifiReadLimiter, unifiMutationLimiter);
  app.all('/controller', (_req, res) => res.sendStatus(200));
  for (let i = 0; i < 30; i++) await request(app).get('/controller').expect(200);
  for (let i = 0; i < 20; i++) await request(app).post('/controller').expect(200);
  const limited = await request(app).post('/controller').expect(429);
  expect(limited.body.error.code).toBe('RATE_LIMITED');
  expect(limited.headers['retry-after']).toBeDefined();
  await request(app).get('/controller').expect(200);
});

it('bounds public firmware downloads without requiring a session', async () => {
  const app = express();
  app.get('/firmware', firmwareDownloadLimiter, (_req, res) => res.sendStatus(200));
  for (let i = 0; i < 20; i++) await request(app).get('/firmware').expect(200);
  await request(app).get('/firmware').expect(429);
});
