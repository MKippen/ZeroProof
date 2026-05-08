import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverUniFiGateways,
  isPrivateIpv4,
  readDefaultGateway,
  type UniFiCandidate,
} from '../../../../src/services/unifiConfig/discover';

async function writeRoute(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-route-'));
  const file = path.join(dir, 'route');
  await fs.writeFile(file, contents, 'utf8');
  return file;
}

const HEADER = 'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n';

describe('isPrivateIpv4', () => {
  it.each([
    ['192.168.2.1', true],
    ['10.0.0.1', true],
    ['172.18.0.1', true], // docker bridge — still RFC1918, caller must filter
    ['172.20.0.1', true],
    ['172.32.0.1', false],
    ['127.0.0.1', false],
    ['8.8.8.8', false],
    ['169.254.1.1', false],
    ['', false],
  ])('classifies %s as private=%s', (ip, expected) => {
    expect(isPrivateIpv4(ip)).toBe(expected);
  });
});

describe('readDefaultGateway', () => {
  it('returns null when route table is missing', async () => {
    const result = await readDefaultGateway('/nonexistent/path/route');
    expect(result).toBeNull();
  });

  it('parses the default-route gateway in little-endian hex', async () => {
    // 0102A8C0 little-endian = 192.168.2.1
    const file = await writeRoute(
      `${HEADER}eth0\t00000000\t0102A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n` +
        `eth0\t0000A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n`
    );
    const result = await readDefaultGateway(file);
    expect(result).toBe('192.168.2.1');
  });

  it('parses Docker bridge gateway 010012AC → 172.18.0.1', async () => {
    const file = await writeRoute(
      `${HEADER}eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`
    );
    const result = await readDefaultGateway(file);
    expect(result).toBe('172.18.0.1');
  });

  it('returns null when no default route exists', async () => {
    const file = await writeRoute(
      `${HEADER}eth0\t0000A8C0\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n`
    );
    const result = await readDefaultGateway(file);
    expect(result).toBeNull();
  });

  it('skips malformed gateway hex', async () => {
    const file = await writeRoute(
      `${HEADER}eth0\t00000000\tNOTHEX\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`
    );
    const result = await readDefaultGateway(file);
    expect(result).toBeNull();
  });
});

describe('discoverUniFiGateways', () => {
  it('returns empty list when no default route is set', async () => {
    const result = await discoverUniFiGateways({
      routeTablePath: '/nonexistent/path/route',
      probe: jest.fn(),
    });
    expect(result).toEqual([]);
  });

  it('skips probing when the gateway is not RFC1918', async () => {
    // 08080808 little-endian = 8.8.8.8 — pretend the gateway is public.
    const file = await writeRoute(
      `${HEADER}eth0\t00000000\t08080808\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`
    );
    const probe = jest.fn();
    const result = await discoverUniFiGateways({ routeTablePath: file, probe });
    expect(result).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('probes the gateway on UniFi OS + legacy ports', async () => {
    const file = await writeRoute(
      `${HEADER}eth0\t00000000\t0102A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`
    );
    const probe = jest.fn(
      async (
        host: string,
        port: number
      ): Promise<UniFiCandidate | null> => {
        if (host === '192.168.2.1' && port === 443) {
          return {
            product: 'unifi_os',
            host,
            port,
            confidence: 'high',
            details: { server: 'UniFi' },
          };
        }
        return null;
      }
    );
    const result = await discoverUniFiGateways({ routeTablePath: file, probe });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      product: 'unifi_os',
      host: '192.168.2.1',
      port: 443,
    });
    expect(probe).toHaveBeenCalledTimes(2); // 443 and 8443
  });

  it('returns both UniFi OS and legacy candidates when both answer', async () => {
    const file = await writeRoute(
      `${HEADER}eth0\t00000000\t0102A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`
    );
    const probe = jest.fn(
      async (host: string, port: number): Promise<UniFiCandidate | null> => ({
        product: port === 8443 ? 'unifi_network_legacy' : 'unifi_os',
        host,
        port,
        confidence: 'high',
      })
    );
    const result = await discoverUniFiGateways({ routeTablePath: file, probe });
    expect(result.map((c) => `${c.product}:${c.port}`).sort()).toEqual([
      'unifi_network_legacy:8443',
      'unifi_os:443',
    ]);
  });

  it('swallows probe errors so one bad port does not poison the scan', async () => {
    const file = await writeRoute(
      `${HEADER}eth0\t00000000\t0102A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0\n`
    );
    const probe = jest.fn(async (_host: string, port: number) => {
      if (port === 8443) throw new Error('connect ETIMEDOUT');
      return {
        product: 'unifi_os' as const,
        host: '192.168.2.1',
        port,
        confidence: 'high' as const,
      };
    });
    const result = await discoverUniFiGateways({ routeTablePath: file, probe });
    expect(result).toHaveLength(1);
    expect(result[0]?.product).toBe('unifi_os');
  });
});
