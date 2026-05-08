/**
 * dnsTunneling detector — exercises entropy + length filters and
 * per-(client, parent-domain) grouping.
 */
import {
  dnsTunnelingDetector,
  shannonEntropy,
  parentDomain,
} from '../../../src/detectors/dnsTunneling';
import type { DetectorContext } from '../../../src/detectors/framework';
import prisma from '../../../src/services/database';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

function ctx(): DetectorContext {
  const now = Date.UTC(2026, 4, 7, 12, 0, 0);
  return {
    beginTime: now - 60 * 60 * 1000,
    endTime: now,
    log: { debug: jest.fn(), info: jest.fn(), warn: jest.fn() },
    tz: 'UTC',
    now: () => now,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.DNS_TUNNEL_MIN_LENGTH;
  delete process.env.DNS_TUNNEL_MIN_ENTROPY;
  delete process.env.DNS_TUNNEL_MIN_HITS;
});

describe('shannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for a uniform string', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0);
  });

  it('returns log2(N) for a string with N unique equally-frequent chars', () => {
    expect(shannonEntropy('ab')).toBeCloseTo(1, 5);
    expect(shannonEntropy('abcd')).toBeCloseTo(2, 5);
  });
});

describe('parentDomain', () => {
  it('returns the eTLD+1 for multi-label domains', () => {
    expect(parentDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('returns the input when only two labels', () => {
    expect(parentDomain('example.com')).toBe('example.com');
  });

  it('lowercases and strips trailing dot', () => {
    expect(parentDomain('Example.COM.')).toBe('example.com');
  });
});

describe('dnsTunnelingDetector', () => {
  function highEntropyDomain(prefixSeed: number): string {
    // 60-char base32-style label — high entropy, well over the length floor.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let label = '';
    for (let i = 0; i < 60; i += 1) {
      label += alphabet[(prefixSeed * 31 + i * 7) % alphabet.length];
    }
    return `${label}.tunnel.example`;
  }

  it('does not fire for normal short domains', async () => {
    (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `q-${i}`,
        domain: 'www.example.com',
        clientIp: '10.0.0.5',
        clientName: 'host',
      }))
    );
    expect(await dnsTunnelingDetector.evaluate(ctx())).toEqual([]);
  });

  it('does not fire for long domains with low entropy', async () => {
    const lowEntropyDomain = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.example.com';
    (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        id: `q-${i}`,
        domain: lowEntropyDomain,
        clientIp: '10.0.0.5',
        clientName: 'host',
      }))
    );
    expect(await dnsTunnelingDetector.evaluate(ctx())).toEqual([]);
  });

  it('fires MEDIUM when threshold-many high-entropy long queries land on one parent', async () => {
    (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `q-${i}`,
        domain: highEntropyDomain(i),
        clientIp: '10.0.0.5',
        clientName: 'host',
      }))
    );
    const findings = await dnsTunnelingDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('MEDIUM');
    expect(findings[0]?.metadata?.parentDomain).toBe('tunnel.example');
  });

  it('escalates to HIGH at >= 2x the hit threshold', async () => {
    (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        id: `q-${i}`,
        domain: highEntropyDomain(i),
        clientIp: '10.0.0.5',
        clientName: 'host',
      }))
    );
    const findings = await dnsTunnelingDetector.evaluate(ctx());
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('groups by (clientIp, parentDomain) so distinct parents stay distinct', async () => {
    const a = Array.from({ length: 5 }, (_, i) => ({
      id: `qa-${i}`,
      domain: highEntropyDomain(i),
      clientIp: '10.0.0.5',
      clientName: 'host',
    }));
    const b = Array.from({ length: 5 }, (_, i) => ({
      id: `qb-${i}`,
      // Different parent
      domain: highEntropyDomain(i).replace('tunnel.example', 'tunnel.evil'),
      clientIp: '10.0.0.5',
      clientName: 'host',
    }));
    (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue([
      ...a,
      ...b,
    ]);
    const findings = await dnsTunnelingDetector.evaluate(ctx());
    expect(findings).toHaveLength(2);
  });

  it('honors DNS_TUNNEL_MIN_HITS env override', async () => {
    process.env.DNS_TUNNEL_MIN_HITS = '2';
    (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 2 }, (_, i) => ({
        id: `q-${i}`,
        domain: highEntropyDomain(i),
        clientIp: '10.0.0.5',
        clientName: 'host',
      }))
    );
    expect(await dnsTunnelingDetector.evaluate(ctx())).toHaveLength(1);
  });
});
