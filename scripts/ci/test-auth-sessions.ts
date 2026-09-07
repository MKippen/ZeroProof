/** Run through test-auth-sessions.sh; all state belongs to its disposable DB. */
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request, createServer as createTlsServer } from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
assert.equal(process.env.AUTH_SESSION_FIXTURE, 'isolated-postgres');
assert.equal(databaseUrl.hostname, '127.0.0.1');
assert.equal(databaseUrl.pathname, '/auth_fixture');
assert.equal(databaseUrl.username, 'auth_fixture');
assert.equal(process.env.NODE_ENV, 'production');
const fixtureDir = process.env.AUTH_SESSION_FIXTURE_DIR!;
assert.ok(fixtureDir && path.basename(fixtureDir).startsWith('zeroproof-auth-sessions.'));

const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const WebSocket = createRequire(backendRequire.resolve('express-ws'))('ws');
const bcrypt = backendRequire('bcrypt');
const certificate = readFileSync(path.join(fixtureDir, 'cert.pem'));
const sockets = new Set<any>();
let origin: string;

class Browser {
  cookie = '';
  csrf = '';

  constructor(cookie = '') { this.cookie = cookie; }

  async call(method: string, route: string, body?: unknown, csrf = this.csrf) {
    const response = await new Promise<{ status: number; headers: any; body: any }>((resolve, reject) => {
      const encoded = body === undefined ? undefined : JSON.stringify(body);
      const req = request(`${origin}${route}`, {
        method,
        ca: certificate,
        headers: {
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {}),
        },
        timeout: 10_000,
      }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode!, headers: res.headers, body: text ? JSON.parse(text) : null }); }
          catch (error) { reject(error); }
        });
      });
      req.on('timeout', () => req.destroy(new Error(`Timed out: ${method} ${route}`)));
      req.on('error', reject);
      req.end(encoded);
    });
    const cookie = response.headers['set-cookie']?.find((value: string) => value.startsWith('connect.sid='));
    if (cookie) {
      this.cookie = cookie.split(';')[0];
      if (!this.cookie.endsWith('=')) {
        assert.match(cookie, /; Secure/i);
        assert.match(cookie, /; HttpOnly/i);
        assert.match(cookie, /; SameSite=Strict/i);
      }
    }
    return response;
  }

  async token() {
    const response = await this.call('GET', '/api/v1/auth/csrf');
    assert.equal(response.status, 200);
    this.csrf = response.body.data.csrfToken;
    assert.equal(typeof this.csrf, 'string');
    assert.equal(this.csrf.length, 64);
    return this.csrf;
  }

  async login(password: string) {
    await this.token();
    const beforeCookie = this.cookie;
    const beforeCsrf = this.csrf;
    const response = await this.call('POST', '/api/v1/auth/login', { password });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.notEqual(this.cookie, beforeCookie, 'Login must rotate the session');
    assert.notEqual(await this.token(), beforeCsrf, 'Login must rotate CSRF');
    return response;
  }
}

async function expectError(browser: Browser, route: string, status: number, code: string) {
  const response = await browser.call('GET', route);
  assert.equal(response.status, status, `${route}: ${JSON.stringify(response.body)}`);
  assert.equal(response.body.error.code, code);
}

function openSocket(browser: Browser, socketOrigin = origin) {
  const socket = new WebSocket(`${origin.replace('https:', 'wss:')}/ws`, {
    ca: certificate,
    origin: socketOrigin,
    headers: browser.cookie ? { Cookie: browser.cookie } : {},
    handshakeTimeout: 5000,
  });
  sockets.add(socket);
  socket.on('error', () => { /* Rejection is asserted by the operation's listener. */ });
  socket.once('close', () => sockets.delete(socket));
  return socket;
}

async function expectClosed(socket: any, code: number, timeout = 5000) {
  if (socket.readyState === WebSocket.CLOSED) {
    assert.equal(socket._closeCode, code);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`WebSocket did not close with ${code}`)), timeout);
    socket.once('close', (actual: number) => {
      clearTimeout(timer);
      try { assert.equal(actual, code); resolve(); } catch (error) { reject(error); }
    });
    socket.once('error', (error: Error) => { clearTimeout(timer); reject(error); });
  });
}

async function ping(socket: any) {
  if (socket.readyState === WebSocket.CONNECTING) await once(socket, 'open');
  await new Promise<void>((resolve, reject) => {
    // The upgrade completes before the asynchronous database policy check.
    // Retry the harmless ping until the authorized message handler is ready.
    const send = () => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })); };
    const interval = setInterval(send, 100);
    const cleanup = () => { clearTimeout(timer); clearInterval(interval); socket.off('message', onMessage); socket.off('close', onClose); };
    const onMessage = (message: Buffer) => {
      cleanup();
      try { assert.equal(JSON.parse(message.toString()).type, 'pong'); resolve(); }
      catch (error) { reject(error); }
    };
    const onClose = (code: number) => { cleanup(); reject(new Error(`WebSocket closed before pong: ${code}`)); };
    const timer = setTimeout(() => { cleanup(); reject(new Error('WebSocket did not send pong')); }, 5000);
    socket.once('message', onMessage);
    socket.once('close', onClose);
    send();
  });
}

async function main() {
  // Import only the API constructor: index.ts starts scheduler/hardware services.
  const { createServer, closeServerResources } = await import('../../backend/src/server');
  const { default: prisma } = await import('../../backend/src/services/database');
  assert.equal(await prisma.user.count(), 0, 'Fixture database must start empty');
  const app = createServer();
  const backend = app.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  // TLS terminates locally like the production proxy. Forward upgrades to the
  // exact express-ws server created by createServer, retaining public Host.
  const server = createTlsServer({ key: readFileSync(path.join(fixtureDir, 'key.pem')), cert: certificate }, (req, res) => {
    req.headers['x-forwarded-proto'] = 'https';
    app(req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    req.headers['x-forwarded-proto'] = 'https';
    backend.emit('upgrade', req, socket, head);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const initialPassword = 'fixture-initial-password-2026';
    const changedPassword = 'fixture-changed-password-2026';
    const requiredPassword = 'fixture-required-password-2026';
    const anonymous = new Browser();
    assert.equal((await anonymous.call('GET', '/api/v1/auth/setup-status')).body.data.initialized, false);
    await expectError(anonymous, '/api/v1/devices', 401, 'UNAUTHORIZED');
    await expectClosed(openSocket(anonymous), 1008);
    const withoutCsrf = await anonymous.call('POST', '/api/v1/auth/setup', { password: initialPassword }, '');
    assert.equal(withoutCsrf.status, 403);
    assert.equal(withoutCsrf.body.error.code, 'CSRF_TOKEN_INVALID');

    const setupBrowsers = [new Browser(), new Browser()];
    await Promise.all(setupBrowsers.map((browser) => browser.token()));
    const beforeSetup = setupBrowsers.map((browser) => ({ cookie: browser.cookie, csrf: browser.csrf }));
    const setupResponses = await Promise.all(setupBrowsers.map((browser) => browser.call('POST', '/api/v1/auth/setup', { password: initialPassword })));
    assert.deepEqual(setupResponses.map((response) => response.status).sort(), [201, 409]);
    assert.equal(await prisma.user.count(), 1);
    const winnerIndex = setupResponses.findIndex((response) => response.status === 201);
    const a = setupBrowsers[winnerIndex];
    assert.notEqual(a.cookie, beforeSetup[winnerIndex].cookie);
    assert.notEqual(await a.token(), beforeSetup[winnerIndex].csrf);
    await expectError(new Browser(beforeSetup[winnerIndex].cookie), '/api/v1/devices', 401, 'UNAUTHORIZED');
    const account = await prisma.user.findFirstOrThrow();
    assert.equal(account.mustChangePassword, false);
    console.log('PASS: concurrent first setup, secure cookies, session/CSRF rotation');

    const b = new Browser();
    await b.login(initialPassword);
    const socketA = openSocket(a);
    const socketB = openSocket(b);
    await Promise.all([ping(socketA), ping(socketB)]);
    await expectClosed(openSocket(b, 'https://untrusted.invalid'), 1008);
    const missingToken = await b.call('POST', '/api/v1/auth/change-password', { currentPassword: initialPassword, newPassword: changedPassword }, '');
    assert.equal(missingToken.status, 403);
    assert.equal(missingToken.body.error.code, 'CSRF_TOKEN_INVALID');
    assert.equal((await a.call('POST', '/api/v1/auth/logout')).status, 200);
    await expectClosed(socketA, 1008);
    await expectError(a, '/api/v1/devices', 401, 'UNAUTHORIZED');
    await ping(socketB);
    console.log('PASS: CSRF and WebSocket Origin enforcement; logout revokes its session');

    const unchanged = await b.call('POST', '/api/v1/auth/change-password', { currentPassword: initialPassword, newPassword: initialPassword });
    assert.equal(unchanged.status, 400);
    assert.equal(unchanged.body.error.code, 'PASSWORD_UNCHANGED');
    const c = new Browser();
    await c.login(initialPassword);
    const socketC = openSocket(c);
    await ping(socketC);
    const oldCookieB = b.cookie;
    const oldCsrfB = b.csrf;
    const changed = await b.call('POST', '/api/v1/auth/change-password', { currentPassword: initialPassword, newPassword: changedPassword });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal(changed.body.data.mustChangePassword, false);
    assert.equal(changed.body.data.user.id, account.id);
    assert.notEqual(b.cookie, oldCookieB);
    assert.notEqual(await b.token(), oldCsrfB);
    await Promise.all([expectClosed(socketB, 1008), expectClosed(socketC, 1008)]);
    await expectError(c, '/api/v1/devices', 401, 'UNAUTHORIZED');
    await expectError(new Browser(oldCookieB), '/api/v1/devices', 401, 'UNAUTHORIZED');
    assert.equal((await b.call('GET', '/api/v1/devices')).status, 200);
    const oldLogin = new Browser();
    await oldLogin.token();
    assert.equal((await oldLogin.call('POST', '/api/v1/auth/login', { password: initialPassword })).status, 401);
    console.log('PASS: password change rotates current session and revokes other HTTP/WS sessions');

    const d = new Browser();
    await d.login(changedPassword);
    const requiredSocket = openSocket(d);
    await ping(requiredSocket);
    await prisma.user.update({ where: { id: account.id }, data: { mustChangePassword: true } });
    await expectError(d, '/api/v1/devices', 403, 'PASSWORD_CHANGE_REQUIRED');
    const meRequired = await d.call('GET', '/api/v1/auth/me');
    assert.equal(meRequired.status, 200);
    assert.equal(meRequired.body.data.user.mustChangePassword, true);
    await d.token();
    await expectClosed(openSocket(d), 1008);
    await expectClosed(requiredSocket, 1008, 35_000);
    assert.equal((await b.call('POST', '/api/v1/auth/logout')).status, 200, 'Required-change user can log out');
    const requiredChanged = await d.call('POST', '/api/v1/auth/change-password', { currentPassword: changedPassword, newPassword: requiredPassword });
    assert.equal(requiredChanged.status, 200, JSON.stringify(requiredChanged.body));
    await d.token();
    assert.equal((await d.call('GET', '/api/v1/devices')).status, 200);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).mustChangePassword, false);
    console.log('PASS: authoritative required-password policy and idle WebSocket revalidation');

    const e = new Browser();
    await e.login(requiredPassword);
    const raceBrowsers = [d, e];
    const racePasswords = ['fixture-race-winner-a-2026', 'fixture-race-winner-b-2026'];
    const raceResponses = await Promise.all(raceBrowsers.map((browser, index) => browser.call('POST', '/api/v1/auth/change-password', { currentPassword: requiredPassword, newPassword: racePasswords[index] })));
    assert.deepEqual(raceResponses.map((response) => response.status).sort(), [200, 401], JSON.stringify(raceResponses.map((response) => response.body)));
    const raceWinner = raceResponses.findIndex((response) => response.status === 200);
    assert.equal(raceResponses[1 - raceWinner].body.error.code, 'UNAUTHORIZED');
    const raceHash = (await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).passwordHash;
    assert.equal(await bcrypt.compare(racePasswords[raceWinner], raceHash), true);
    assert.equal(await bcrypt.compare(racePasswords[1 - raceWinner], raceHash), false);
    const survivor = raceBrowsers[raceWinner];
    await survivor.token();
    await expectError(raceBrowsers[1 - raceWinner], '/api/v1/devices', 401, 'UNAUTHORIZED');
    console.log('PASS: simultaneous password changes have exactly one committed winner');

    const stableCookie = survivor.cookie;
    await prisma.$executeRawUnsafe('ALTER TABLE "User" RENAME TO "User_auth_fixture_unavailable"');
    try {
      await expectError(survivor, '/api/v1/devices', 503, 'AUTH_UNAVAILABLE');
      assert.equal(survivor.cookie, stableCookie, 'Database failure must retain session cookie');
      await expectClosed(openSocket(survivor), 1013);
    } finally {
      await prisma.$executeRawUnsafe('ALTER TABLE "User_auth_fixture_unavailable" RENAME TO "User"');
    }
    assert.equal((await survivor.call('GET', '/api/v1/devices')).status, 200);
    console.log('PASS: database failure fails closed while allowing session recovery');

    const legacy = new Browser();
    await legacy.login(racePasswords[raceWinner]);
    const legacySid = decodeURIComponent(legacy.cookie.slice('connect.sid='.length)).slice(2).split('.')[0];
    await prisma.$executeRaw`UPDATE session SET sess = (sess::jsonb - 'credentialVersion')::json WHERE sid = ${legacySid}`;
    await expectError(legacy, '/api/v1/devices', 401, 'UNAUTHORIZED');

    const resetPassword = 'fixture-out-of-band-reset-2026';
    await prisma.user.update({ where: { id: account.id }, data: { passwordHash: await bcrypt.hash(resetPassword, 12), mustChangePassword: false } });
    await expectError(survivor, '/api/v1/devices', 401, 'UNAUTHORIZED');
    const resetSession = new Browser();
    await resetSession.login(resetPassword);
    assert.equal((await resetSession.call('GET', '/api/v1/devices')).status, 200);
    await prisma.auditLog.deleteMany({ where: { userId: account.id } });
    await prisma.user.delete({ where: { id: account.id } });
    await expectError(resetSession, '/api/v1/devices', 401, 'UNAUTHORIZED');
    console.log('PASS: legacy sessions, out-of-band resets, and deleted accounts fail closed');
    console.log('Authentication session integration fixture passed.');
  } finally {
    for (const socket of sockets) socket.terminate();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => backend.close(() => resolve())),
    ]);
    await closeServerResources(app);
    await prisma.$disconnect();
  }
}

const deadline = setTimeout(() => {
  console.error('Authentication integration fixture exceeded its three-minute deadline.');
  process.exit(1);
}, 180_000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
