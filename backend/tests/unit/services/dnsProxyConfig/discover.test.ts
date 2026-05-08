import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverDnsProxies,
  isPrivateIpv4,
  type DnsProxyCandidate,
} from '../../../../src/services/dnsProxyConfig/discover';

async function writeResolv(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zp-resolv-'));
  const file = path.join(dir, 'resolv.conf');
  await fs.writeFile(file, contents, 'utf8');
  return file;
}

describe('isPrivateIpv4', () => {
  it.each([
    ['10.0.0.1', true],
    ['10.255.255.254', true],
    ['192.168.1.1', true],
    ['192.168.255.1', true],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.15.0.1', false],
    ['172.32.0.1', false],
    ['127.0.0.1', false],
    ['127.0.0.53', false],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['169.254.1.1', false],
    ['::1', false],
    ['not-an-ip', false],
    ['', false],
  ])('classifies %s as private=%s', (ip, expected) => {
    expect(isPrivateIpv4(ip)).toBe(expected);
  });
});

describe('discoverDnsProxies', () => {
  it('returns empty list when resolv.conf is missing', async () => {
    const result = await discoverDnsProxies({
      resolvConfPath: '/nonexistent/path/resolv.conf',
      probe: jest.fn(),
    });
    expect(result).toEqual([]);
  });

  it('skips loopback and public resolvers', async () => {
    const file = await writeResolv(
      ['nameserver 127.0.0.53', 'nameserver 8.8.8.8', ''].join('\n')
    );
    const probe = jest.fn();
    const result = await discoverDnsProxies({ resolvConfPath: file, probe });
    expect(result).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });

  it('probes each LAN-side resolver and returns matches', async () => {
    const file = await writeResolv(
      ['nameserver 192.168.2.250', '# comment', ''].join('\n')
    );
    const probe = jest.fn(
      async (host: string, port: number): Promise<DnsProxyCandidate | null> => {
        if (host === '192.168.2.250' && port === 3000) {
          return {
            product: 'adguard_home',
            host,
            port,
            confidence: 'high',
            details: { version: 'v0.107.50' },
          };
        }
        return null;
      }
    );
    const result = await discoverDnsProxies({ resolvConfPath: file, probe });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      product: 'adguard_home',
      host: '192.168.2.250',
      port: 3000,
    });
    // Probe should have been invoked with deduped (port) set across both products.
    expect(probe.mock.calls.length).toBeGreaterThan(1);
  });

  it('deduplicates duplicate nameserver entries in resolv.conf', async () => {
    const file = await writeResolv('nameserver 10.0.0.1\nnameserver 10.0.0.1\n');
    const probe = jest.fn(
      async (host: string, port: number): Promise<DnsProxyCandidate | null> => {
        if (port !== 3000) return null;
        return {
          product: 'adguard_home',
          host,
          port,
          confidence: 'high',
        };
      }
    );
    const result = await discoverDnsProxies({ resolvConfPath: file, probe });
    // Same nameserver listed twice should still produce one match — collectResolverCandidates dedups IPs.
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      product: 'adguard_home',
      host: '10.0.0.1',
      port: 3000,
    });
  });

  it('swallows probe errors so one bad port does not poison the scan', async () => {
    const file = await writeResolv('nameserver 192.168.1.1\n');
    const probe = jest.fn(async (_host: string, port: number) => {
      if (port === 80) throw new Error('connect ECONNREFUSED');
      if (port === 3000) {
        return {
          product: 'adguard_home' as const,
          host: '192.168.1.1',
          port,
          confidence: 'high' as const,
        };
      }
      return null;
    });
    const result = await discoverDnsProxies({ resolvConfPath: file, probe });
    expect(result).toHaveLength(1);
    expect(result[0]?.port).toBe(3000);
  });

  it('handles a resolv.conf with no nameserver lines', async () => {
    const file = await writeResolv('# nothing here\nsearch lan\n');
    const probe = jest.fn();
    const result = await discoverDnsProxies({ resolvConfPath: file, probe });
    expect(result).toEqual([]);
    expect(probe).not.toHaveBeenCalled();
  });
});
