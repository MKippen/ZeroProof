import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { createNodeHttpTransport } from '../src/transport/fetch.js';
import { UnifiTransportError } from '../src/errors.js';

let server: http.Server;
let baseURL: string;

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');

          if (req.url === '/echo') {
            res.writeHead(200, {
              'content-type': 'application/json',
              'x-csrf-token': 'csrf-1',
              'set-cookie': ['T=fresh', 'csrf=xyz'],
            });
            res.end(
              JSON.stringify({ method: req.method, url: req.url, body, headers: req.headers })
            );
            return;
          }

          if (req.url === '/error') {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'kapow' }));
            return;
          }

          if (req.url === '/timeout') {
            // Never respond — let the client time out.
            return;
          }

          if (req.url === '/html') {
            res.writeHead(200, { 'content-type': 'text/html' });
            res.end('<!doctype html><html></html>');
            return;
          }

          if (req.url === '/empty-json') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('');
            return;
          }

          if (req.url === '/bad-json') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end('{not json');
            return;
          }

          res.writeHead(404, { 'content-type': 'application/json' });
          res.end('{}');
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseURL = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    })
);

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    })
);

describe('createNodeHttpTransport', () => {
  it('GET returns parsed JSON, status, and headers including set-cookie', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false });
    const result = await transport.request<{ method: string; url: string }>({
      method: 'GET',
      url: '/echo',
    });
    expect(result.status).toBe(200);
    expect(result.data.method).toBe('GET');
    expect(result.headers['x-csrf-token']).toBe('csrf-1');
    expect(result.headers['set-cookie']).toBeDefined();
  });

  it('serializes JSON body for POST and includes Content-Length', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false });
    const result = await transport.request<{ body: string; headers: Record<string, string> }>({
      method: 'POST',
      url: '/echo',
      body: { hello: 'world' },
    });
    expect(JSON.parse(result.data.body)).toEqual({ hello: 'world' });
    expect(result.data.headers['content-length']).toBeDefined();
  });

  it('forwards custom headers', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false });
    const result = await transport.request<{ headers: Record<string, string> }>({
      method: 'GET',
      url: '/echo',
      headers: { 'X-Custom': 'foo', Cookie: 'TOKEN=abc' },
    });
    expect(result.data.headers['x-custom']).toBe('foo');
    expect(result.data.headers.cookie).toBe('TOKEN=abc');
  });

  it('does not throw on 5xx — returns response for caller', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false });
    const result = await transport.request({ method: 'GET', url: '/error' });
    expect(result.status).toBe(500);
  });

  it('returns HTML body as a string when content-type is text/html', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false });
    const result = await transport.request({ method: 'GET', url: '/html' });
    expect(typeof result.data).toBe('string');
    expect(result.data).toContain('<!doctype html>');
  });

  it('returns empty object when content-type is JSON but body is empty', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false });
    const result = await transport.request({ method: 'GET', url: '/empty-json' });
    expect(result.data).toEqual({});
  });

  it('throws UnifiTransportError when JSON body is malformed', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false });
    await expect(
      transport.request({ method: 'GET', url: '/bad-json' })
    ).rejects.toBeInstanceOf(UnifiTransportError);
  });

  it('wraps timeouts as UnifiTransportError with descriptive message', async () => {
    const transport = createNodeHttpTransport({ baseURL, timeoutMs: 100, allowSelfSigned: false });
    try {
      await transport.request({ method: 'GET', url: '/timeout' });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(UnifiTransportError);
      expect((err as UnifiTransportError).message).toContain('timed out');
      expect((err as UnifiTransportError).path).toBe('/timeout');
    }
  });

  it('wraps connection-refused as UnifiTransportError', async () => {
    const transport = createNodeHttpTransport({
      baseURL: 'http://127.0.0.1:1',
      timeoutMs: 1000,
      allowSelfSigned: false,
    });
    await expect(
      transport.request({ method: 'GET', url: '/anything' })
    ).rejects.toBeInstanceOf(UnifiTransportError);
  });

  it('accepts absolute URLs (overrides baseURL)', async () => {
    const transport = createNodeHttpTransport({
      baseURL: 'http://invalid.invalid',
      timeoutMs: 5000,
      allowSelfSigned: false,
    });
    const result = await transport.request({ method: 'GET', url: `${baseURL}/echo` });
    expect(result.status).toBe(200);
  });

  it('constructs without throwing for both TLS modes', () => {
    expect(() =>
      createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: true })
    ).not.toThrow();
    expect(() =>
      createNodeHttpTransport({ baseURL, timeoutMs: 5000, allowSelfSigned: false })
    ).not.toThrow();
  });
});
