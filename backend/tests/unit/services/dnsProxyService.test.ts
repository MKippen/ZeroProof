import {
  evaluateDnsAttribution,
  isAdGuardQueryBlocked,
  isCampaignRelevantDnsReason,
  normalizeAdGuardQueryItem,
} from '../../../src/services/dnsProxyService';
import type { AdGuardQueryLogItem } from '../../../src/services/adguardClient';

describe('dns proxy service parsing', () => {
  it('normalizes AdGuard query log rows and flags campaign domains', () => {
    const item: AdGuardQueryLogItem = {
      time: '2026-05-02T18:00:00.000Z',
      client: '192.168.30.50',
      client_info: { name: 'AOSP TV Box' },
      question: { name: 'api.xdresi.to.', type: 'A' },
      status: 'NOERROR',
      reason: 'FilteredBlackList',
      rules: [{ text: '||xdresi.to^' }],
      upstream: 'tls://1.1.1.1',
    };

    const event = normalizeAdGuardQueryItem(item, 'connection-1', 7);

    expect(event).not.toBeNull();
    expect(event?.domain).toBe('api.xdresi.to');
    expect(event?.clientIp).toBe('192.168.30.50');
    expect(event?.clientName).toBe('AOSP TV Box');
    expect(event?.isBlocked).toBe(true);
    expect(event?.isSuspicious).toBe(true);
    expect(event?.signal?.type).toBe('known_campaign_domain');
    expect(event?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
  });

  it('accepts AdGuard Home question.name rows from the live API shape', () => {
    const event = normalizeAdGuardQueryItem(
      {
        time: '2026-05-02T17:18:38.102522843-07:00',
        client: '192.168.3.115',
        question: { class: 'IN', name: 'self.events.data.microsoft.com', type: 'A' },
        reason: 'FilteredBlackList',
        rule: '||events.data.microsoft.com^',
        rules: [{ filter_list_id: 1735077292, text: '||events.data.microsoft.com^' }],
        status: 'NOERROR',
      },
      'connection-1'
    );

    expect(event?.domain).toBe('self.events.data.microsoft.com');
    expect(event?.queryType).toBe('A');
    expect(event?.isBlocked).toBe(true);
    expect(event?.isSuspicious).toBe(false);
    expect(event?.answerJson).toBeUndefined();
    expect(event?.rawJson).toBeUndefined();
    expect(event?.queriedAt.toISOString()).toBe('2026-05-03T00:18:38.102Z');
  });

  it('dedupes by stable source, time, client, domain, type, status, and reason fields', () => {
    const first = normalizeAdGuardQueryItem(
      {
        time: '2026-05-02T18:00:00.000Z',
        client: '192.168.30.50',
        question: { host: 'example.com', type: 'AAAA' },
        status: 'NOERROR',
        reason: 'NotFilteredNotFound',
      },
      'connection-1'
    );
    const second = normalizeAdGuardQueryItem(
      {
        time: '2026-05-02T18:00:00.000Z',
        client: '192.168.30.50',
        question: { host: 'example.com', type: 'AAAA' },
        status: 'NOERROR',
        reason: 'NotFilteredNotFound',
      },
      'connection-1'
    );
    const changedStatus = normalizeAdGuardQueryItem(
      {
        time: '2026-05-02T18:00:00.000Z',
        client: '192.168.30.50',
        question: { host: 'example.com', type: 'AAAA' },
        status: 'NOERROR',
        reason: 'FilteredSafeBrowsing',
      },
      'connection-1'
    );

    expect(first?.eventHash).toBe(second?.eventHash);
    expect(first?.eventHash).not.toBe(changedStatus?.eventHash);
  });

  it('detects AdGuard filtered reasons', () => {
    expect(isAdGuardQueryBlocked('FilteredBlackList')).toBe(true);
    expect(isAdGuardQueryBlocked('NotFilteredNotFound')).toBe(false);
    expect(isAdGuardQueryBlocked(undefined)).toBe(false);
  });

  it('limits campaign-relevant DNS reasons to security blocks', () => {
    expect(isCampaignRelevantDnsReason('FilteredSafeBrowsing')).toBe(true);
    expect(isCampaignRelevantDnsReason('FilteredBlockedService')).toBe(true);
    expect(isCampaignRelevantDnsReason('FilteredBlackList')).toBe(false);
    expect(isCampaignRelevantDnsReason(undefined)).toBe(false);
  });
});

describe('dns proxy attribution', () => {
  it('marks attribution healthy when AdGuard clients match UniFi inventory', () => {
    const attribution = evaluateDnsAttribution(
      ['192.168.30.10', '192.168.30.11', '192.168.30.12'],
      ['192.168.30.10', '192.168.30.11', '192.168.30.50'],
      25,
      false
    );

    expect(attribution.status).toBe('HEALTHY');
    expect(attribution.matchedClientCount).toBe(2);
  });

  it('marks attribution degraded when most queries come from one gateway IP', () => {
    const attribution = evaluateDnsAttribution(
      ['192.168.1.1', '192.168.1.1', '192.168.1.1'],
      ['192.168.30.10', '192.168.30.11', '192.168.30.12', '192.168.30.13', '192.168.30.14'],
      40,
      false
    );

    expect(attribution.status).toBe('DEGRADED');
    expect(attribution.reason).toContain('gateway');
  });

  it('keeps attribution unknown when AdGuard anonymizes client IPs', () => {
    const attribution = evaluateDnsAttribution(
      ['192.168.30.10', '192.168.30.11'],
      ['192.168.30.10', '192.168.30.11'],
      25,
      true
    );

    expect(attribution.status).toBe('UNKNOWN');
    expect(attribution.reason).toContain('anonymizes');
  });
});
