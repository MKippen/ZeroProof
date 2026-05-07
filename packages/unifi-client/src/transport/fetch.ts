import https, { type RequestOptions } from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import type { HttpRequest, HttpResponse, HttpTransport } from './http.js';
import { UnifiTransportError } from '../errors.js';

export interface NodeHttpTransportOptions {
  baseURL: string;
  timeoutMs: number;
  allowSelfSigned: boolean;
}

/**
 * Default HttpTransport built on Node's stdlib `node:https` / `node:http`.
 *
 * No npm dependencies — the lib ships zero runtime deps for HTTP. Self-signed
 * certificate handling is opt-in via `allowSelfSigned` (passed straight to
 * `https.Agent({ rejectUnauthorized })`); strict TLS is the default.
 */
export function createNodeHttpTransport(opts: NodeHttpTransportOptions): HttpTransport {
  const httpsAgent = new https.Agent({
    rejectUnauthorized: !opts.allowSelfSigned,
    keepAlive: true,
  });

  return {
    request<T = unknown>(req: HttpRequest): Promise<HttpResponse<T>> {
      const fullUrl = req.url.startsWith('http') ? req.url : `${opts.baseURL}${req.url}`;
      const parsed = new URL(fullUrl);
      const transport = parsed.protocol === 'http:' ? http : https;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(req.headers ?? {}),
      };

      const requestOptions: RequestOptions = {
        method: req.method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        headers,
        timeout: opts.timeoutMs,
      };
      if (parsed.protocol === 'https:') requestOptions.agent = httpsAgent;

      const bodyString = req.body !== undefined ? JSON.stringify(req.body) : undefined;
      if (bodyString !== undefined) {
        headers['Content-Length'] = Buffer.byteLength(bodyString).toString();
      }

      return new Promise<HttpResponse<T>>((resolve, reject) => {
        const r = transport.request(requestOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            const ct = String(res.headers['content-type'] ?? '');

            let data: unknown;
            const isJson = ct.includes('application/json');
            if (isJson) {
              if (text.length === 0) {
                data = {};
              } else {
                try {
                  data = JSON.parse(text);
                } catch (err) {
                  reject(
                    new UnifiTransportError('Failed to parse JSON response', {
                      cause: err,
                      path: req.url,
                      statusCode: res.statusCode,
                    })
                  );
                  return;
                }
              }
            } else {
              data = text;
            }

            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[] | undefined>,
              data: data as T,
            });
          });
          res.on('error', (err) =>
            reject(new UnifiTransportError(err.message, { cause: err, path: req.url }))
          );
        });

        r.on('error', (err: NodeJS.ErrnoException) =>
          reject(new UnifiTransportError(err.message, { cause: err, path: req.url }))
        );

        r.on('timeout', () => {
          r.destroy();
          reject(
            new UnifiTransportError(`Request timed out after ${opts.timeoutMs}ms`, {
              path: req.url,
            })
          );
        });

        if (bodyString !== undefined) r.write(bodyString);
        r.end();
      });
    },
  };
}
