/**
 * iocMatch detector — exercises both flow→IP and DNS→domain matching plus
 * the dedupe + severity rules.
 */
import { iocMatchDetector } from '../../../src/detectors/iocMatch';
import type { DetectorContext } from '../../../src/detectors/framework';
import prisma from '../../../src/services/database';
import * as iocFeedService from '../../../src/services/threatIntel/iocFeedService';

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
  (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([]);
  (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue([]);
});

describe('iocMatchDetector', () => {
  it('emits nothing when no flows or DNS queries match', async () => {
    jest.spyOn(iocFeedService, 'lookupIp').mockResolvedValue([]);
    jest.spyOn(iocFeedService, 'lookupDomain').mockResolvedValue([]);
    const findings = await iocMatchDetector.evaluate(ctx());
    expect(findings).toEqual([]);
  });

  it('fires HIGH for a flow that matches a non-c2 IOC', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'flow-1',
        srcMac: 'aa:bb:cc:dd:ee:ff',
        srcIp: '10.0.0.5',
        srcClientName: 'iot-cam',
        dstIp: '203.0.113.5',
        dstHostName: null,
      },
    ]);
    jest.spyOn(iocFeedService, 'lookupIp').mockResolvedValue([
      {
        feed: 'urlhaus',
        kind: 'ip',
        value: '203.0.113.5',
        category: 'phishing',
        severity: 'HIGH',
        context: null,
        refreshedAt: new Date(),
      },
    ]);

    const findings = await iocMatchDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('HIGH');
    expect(findings[0]?.fingerprint).toBe(
      'ioc_match:aa:bb:cc:dd:ee:ff:203.0.113.5'
    );
    expect(findings[0]?.affectedResource).toBe('iot-cam');
    expect(findings[0]?.evidence).toEqual([
      { kind: 'flow', id: 'flow-1' },
      { kind: 'ioc', ioc: '203.0.113.5', feed: 'urlhaus' },
    ]);
  });

  it('escalates to CRITICAL when any feed flags malware-c2', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'flow-2',
        srcMac: '11:22:33:44:55:66',
        srcIp: '10.0.0.6',
        srcClientName: 'laptop',
        dstIp: '198.51.100.7',
        dstHostName: null,
      },
    ]);
    jest.spyOn(iocFeedService, 'lookupIp').mockResolvedValue([
      {
        feed: 'urlhaus',
        kind: 'ip',
        value: '198.51.100.7',
        category: 'phishing',
        severity: 'HIGH',
        context: null,
        refreshedAt: new Date(),
      },
      {
        feed: 'spamhaus',
        kind: 'ip',
        value: '198.51.100.7',
        category: 'malware-c2',
        severity: 'CRITICAL',
        context: null,
        refreshedAt: new Date(),
      },
    ]);

    const findings = await iocMatchDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('CRITICAL');
  });

  it('coalesces multiple flows from the same device to the same IOC', async () => {
    (mockedPrisma.firewallFlowEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'flow-1',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'cam',
        dstIp: '203.0.113.5',
        dstHostName: null,
      },
      {
        id: 'flow-2',
        srcMac: 'aa:aa:aa:aa:aa:aa',
        srcIp: '10.0.0.5',
        srcClientName: 'cam',
        dstIp: '203.0.113.5',
        dstHostName: null,
      },
    ]);
    jest.spyOn(iocFeedService, 'lookupIp').mockResolvedValue([
      {
        feed: 'urlhaus',
        kind: 'ip',
        value: '203.0.113.5',
        category: 'phishing',
        severity: 'HIGH',
        context: null,
        refreshedAt: new Date(),
      },
    ]);

    const findings = await iocMatchDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.filter((e) => e.kind === 'flow')).toHaveLength(2);
  });

  it('matches DNS queries against the domain cache too', async () => {
    (mockedPrisma.dnsQueryEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'q-1',
        domain: 'sub.evil.example',
        clientIp: '10.0.0.20',
        clientName: 'phone',
      },
    ]);
    jest.spyOn(iocFeedService, 'lookupDomain').mockResolvedValue([
      {
        feed: 'urlhaus',
        kind: 'domain',
        value: 'evil.example',
        category: 'phishing',
        severity: 'HIGH',
        context: null,
        refreshedAt: new Date(),
      },
    ]);

    const findings = await iocMatchDetector.evaluate(ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.fingerprint).toBe('ioc_match:10.0.0.20:sub.evil.example');
    expect(findings[0]?.evidence).toContainEqual({ kind: 'dns_query', id: 'q-1' });
  });

  it('queries flows + DNS over the supplied window only', async () => {
    const c = ctx();
    await iocMatchDetector.evaluate(c);

    expect(mockedPrisma.firewallFlowEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          occurredAt: { gte: new Date(c.beginTime), lte: new Date(c.endTime) },
        }),
      })
    );
    expect(mockedPrisma.dnsQueryEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          queriedAt: { gte: new Date(c.beginTime), lte: new Date(c.endTime) },
        }),
      })
    );
  });
});
