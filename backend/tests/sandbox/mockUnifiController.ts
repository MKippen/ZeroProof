import express from 'express';
import https from 'https';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import { UNIFI_NETWORK_FIXTURE } from './fixtures/unifiNetworkApi_9_2_17';

type MockController = {
  port: number;
  host: string;
  stop: () => Promise<void>;
};

function createTestCertificate(): { key: string; cert: string } {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'zeroproof-unifi-mock-'));
  const keyPath = path.join(tempDir, 'server.key');
  const certPath = path.join(tempDir, 'server.crt');

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-nodes',
        '-days',
        '1',
        '-newkey',
        'rsa:2048',
        '-keyout',
        keyPath,
        '-out',
        certPath,
        '-subj',
        '/CN=localhost/O=ZeroProof Test/C=US',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' }
    );

    return {
      key: readFileSync(keyPath, 'utf8'),
      cert: readFileSync(certPath, 'utf8'),
    };
  } catch (error) {
    throw new Error(
      `OpenSSL is required to start the mock UniFi HTTPS controller: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function ok(payload: unknown): { meta: { rc: string }; data: unknown } {
  return { meta: { rc: 'ok' }, data: payload };
}

export async function startMockUnifiController(): Promise<MockController> {
  const app = express();
  app.use(express.json());

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (
      username === UNIFI_NETWORK_FIXTURE.auth.username &&
      password === UNIFI_NETWORK_FIXTURE.auth.password
    ) {
      res.setHeader('Set-Cookie', ['TOKEN=mock-unifi-session; Path=/; HttpOnly']);
      res.json({ meta: { rc: 'ok' } });
      return;
    }
    res.status(401).json({ meta: { rc: 'error', msg: 'invalid credentials' } });
  });

  app.post('/api/login', (req, res) => {
    const { username, password } = req.body ?? {};
    if (
      username === UNIFI_NETWORK_FIXTURE.auth.username &&
      password === UNIFI_NETWORK_FIXTURE.auth.password
    ) {
      res.setHeader('Set-Cookie', ['TOKEN=mock-unifi-session; Path=/; HttpOnly']);
      res.json({ meta: { rc: 'ok' } });
      return;
    }
    res.status(401).json({ meta: { rc: 'error', msg: 'invalid credentials' } });
  });

  app.get('/proxy/network/api/self/sites', (_req, res) => {
    res.json(ok(UNIFI_NETWORK_FIXTURE.sites));
  });
  app.get('/api/self/sites', (_req, res) => {
    res.json(ok(UNIFI_NETWORK_FIXTURE.sites));
  });

  const v1RouteData: Record<string, unknown> = {
    '/rest/setting': UNIFI_NETWORK_FIXTURE.settings,
    '/stat/device': UNIFI_NETWORK_FIXTURE.devices,
    '/rest/firewallrule': UNIFI_NETWORK_FIXTURE.firewallRules,
    '/rest/firewallgroup': UNIFI_NETWORK_FIXTURE.firewallGroups,
    '/rest/networkconf': UNIFI_NETWORK_FIXTURE.networks,
    '/rest/wlanconf': UNIFI_NETWORK_FIXTURE.wlans,
    '/rest/portforward': UNIFI_NETWORK_FIXTURE.portForwards,
    '/rest/trafficrule': UNIFI_NETWORK_FIXTURE.trafficRules,
    '/rest/routing': UNIFI_NETWORK_FIXTURE.routingRules,
    '/stat/sta': UNIFI_NETWORK_FIXTURE.clients,
    '/rest/aclrule': UNIFI_NETWORK_FIXTURE.aclRules,
    '/stat/fingerprint-devices/0': UNIFI_NETWORK_FIXTURE.fingerprintDevices,
    '/stat/alluser?_limit=5000': UNIFI_NETWORK_FIXTURE.clients,
  };

  for (const [routePath, payload] of Object.entries(v1RouteData)) {
    app.get(`/proxy/network/api/s/default${routePath}`, (_req, res) => {
      res.json(ok(payload));
    });
    app.get(`/api/s/default${routePath}`, (_req, res) => {
      res.json(ok(payload));
    });
  }

  app.get('/proxy/network/v2/api/site/default/firewall-policies', (_req, res) => {
    res.json(UNIFI_NETWORK_FIXTURE.firewallPolicies);
  });
  app.get('/proxy/network/v2/api/site/default/vpn/servers', (_req, res) => {
    res.json(UNIFI_NETWORK_FIXTURE.vpnServers);
  });
  app.get('/proxy/network/v2/api/site/default/traffic-matching-lists', (_req, res) => {
    res.json(UNIFI_NETWORK_FIXTURE.trafficMatchingLists);
  });
  app.get('/proxy/network/v2/api/site/default/firewall-zones', (_req, res) => {
    res.json(UNIFI_NETWORK_FIXTURE.firewallZones);
  });
  app.get('/proxy/network/v2/api/site/default/acl-rules', (_req, res) => {
    res.json(UNIFI_NETWORK_FIXTURE.aclRules);
  });
  app.get('/proxy/network/v2/api/site/default/fingerprint-devices/0', (_req, res) => {
    res.json(UNIFI_NETWORK_FIXTURE.fingerprintDevices);
  });

  const tls = createTestCertificate();
  const server = https.createServer({ key: tls.key, cert: tls.cert }, app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;

  return {
    host: '127.0.0.1',
    port: address.port,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
