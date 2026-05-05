import { evaluateClientCoverage } from '../../../src/analyzers/dnsProxyClientAnalyzer';
import {
  ADGUARD_PROVIDER,
  classifyClientIdentifier,
  normalizeAdGuardPersistentClient,
} from '../../../src/services/dnsProxyConfig';
import type { NormalizedDnsProxyClient } from '../../../src/services/dnsProxyConfig';

const unifiClients = [
  { mac: 'aa:bb:cc:11:22:33', displayName: 'Work Laptop', hostname: 'work-mbp', lastIp: '192.168.10.5' },
  { mac: 'aa:bb:cc:44:55:66', displayName: 'Kid iPhone', hostname: 'kid-phone', lastIp: '192.168.20.5' },
  { mac: 'aa:bb:cc:77:88:99', displayName: 'IoT Camera', hostname: 'cam01', lastIp: '192.168.30.5' },
  { mac: 'aa:bb:cc:aa:bb:cc', displayName: 'Roomba', hostname: 'roomba', lastIp: '192.168.30.6' },
];

function adguardClient(overrides: Partial<NormalizedDnsProxyClient> = {}): NormalizedDnsProxyClient {
  return {
    name: 'Default',
    identifiers: [],
    tags: [],
    usesGlobalSettings: true,
    filteringEnabled: null,
    safeBrowsingEnabled: null,
    parentalEnabled: null,
    blockedServices: [],
    upstreams: [],
    ...overrides,
  };
}

describe('classifyClientIdentifier', () => {
  it('detects MAC, IP, and ClientID identifiers', () => {
    expect(classifyClientIdentifier('aa:bb:cc:11:22:33')).toBe('mac');
    expect(classifyClientIdentifier('AA-BB-CC-11-22-33')).toBe('mac');
    expect(classifyClientIdentifier('192.168.1.50')).toBe('ip');
    expect(classifyClientIdentifier('192.168.1.0/24')).toBe('ip');
    expect(classifyClientIdentifier('kid-phone.lan')).toBe('hostname');
    expect(classifyClientIdentifier('my-clientid-string')).toBe('clientid');
  });
});

describe('normalizeAdGuardPersistentClient', () => {
  it('preserves per-client policy when use_global_settings is false', () => {
    const normalized = normalizeAdGuardPersistentClient({
      name: 'Kid iPhone',
      ids: ['aa:bb:cc:44:55:66'],
      use_global_settings: false,
      filtering_enabled: true,
      parental_enabled: true,
      safebrowsing_enabled: true,
      use_global_blocked_services: false,
      blocked_services: ['tiktok', 'discord'],
    });

    expect(normalized.usesGlobalSettings).toBe(false);
    expect(normalized.filteringEnabled).toBe(true);
    expect(normalized.parentalEnabled).toBe(true);
    expect(normalized.blockedServices).toEqual(['tiktok', 'discord']);
    expect(normalized.identifiers).toEqual([{ value: 'aa:bb:cc:44:55:66', kind: 'mac' }]);
  });

  it('reports per-client policy as null when client uses global settings', () => {
    const normalized = normalizeAdGuardPersistentClient({
      name: 'Inheritor',
      ids: ['192.168.10.5'],
      use_global_settings: true,
    });

    expect(normalized.usesGlobalSettings).toBe(true);
    expect(normalized.filteringEnabled).toBeNull();
    expect(normalized.identifiers).toEqual([{ value: '192.168.10.5', kind: 'ip' }]);
  });
});

describe('evaluateClientCoverage', () => {
  it('flags a HIGH finding when AdGuard has zero persistent clients', () => {
    const findings = evaluateClientCoverage({
      unifiClients,
      audit: { provider: ADGUARD_PROVIDER, persistentClients: [], autoClients: [] },
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('DNS_PROXY_NO_PERSISTENT_CLIENTS');
    expect(findings[0]?.severity).toBe('HIGH');
  });

  it('emits no findings when AdGuard fully covers UniFi inventory', () => {
    const persistentClients = unifiClients.map((u) =>
      adguardClient({
        name: u.displayName!,
        identifiers: [{ value: u.mac!, kind: 'mac' }],
      })
    );
    const findings = evaluateClientCoverage({
      unifiClients,
      audit: { provider: ADGUARD_PROVIDER, persistentClients, autoClients: [] },
    });
    expect(findings).toEqual([]);
  });

  it('flags a HIGH finding when AdGuard has clients but none match UniFi', () => {
    const findings = evaluateClientCoverage({
      unifiClients,
      audit: {
        provider: ADGUARD_PROVIDER,
        persistentClients: [
          adguardClient({ name: 'Mystery', identifiers: [{ value: '99:99:99:99:99:99', kind: 'mac' }] }),
        ],
        autoClients: [],
      },
    });
    expect(findings.some((f) => f.type === 'DNS_PROXY_NO_CLIENT_OVERLAP')).toBe(true);
  });

  it('flags a MEDIUM gap finding when fewer than half of UniFi clients are defined', () => {
    const findings = evaluateClientCoverage({
      unifiClients,
      audit: {
        provider: ADGUARD_PROVIDER,
        persistentClients: [
          adguardClient({
            name: 'Work Laptop',
            identifiers: [{ value: 'aa:bb:cc:11:22:33', kind: 'mac' }],
          }),
        ],
        autoClients: [],
      },
    });

    const gap = findings.find((f) => f.type === 'DNS_PROXY_CLIENT_INVENTORY_GAP');
    expect(gap).toBeDefined();
    expect(gap?.severity).toBe('MEDIUM');
    expect(gap?.title).toContain('3 of 4');
    expect(gap?.affectedResource).toContain('Kid iPhone');
  });

  it('flags MEDIUM when persistent clients are identified by IP only', () => {
    const findings = evaluateClientCoverage({
      unifiClients,
      audit: {
        provider: ADGUARD_PROVIDER,
        persistentClients: unifiClients.map((u) =>
          adguardClient({
            name: u.displayName!,
            identifiers: [{ value: u.lastIp!, kind: 'ip' }],
          })
        ),
        autoClients: [],
      },
    });

    const fragile = findings.find((f) => f.type === 'DNS_PROXY_CLIENTS_IP_IDENTIFIED');
    expect(fragile).toBeDefined();
    expect(fragile?.severity).toBe('MEDIUM');
    expect(fragile?.title).toContain('4 DNS Proxy client(s) identified by IP only');
  });

  it('does not double-count: clients matched by IP do not also trip the fragile finding when MAC is also present', () => {
    const findings = evaluateClientCoverage({
      unifiClients,
      audit: {
        provider: ADGUARD_PROVIDER,
        persistentClients: unifiClients.map((u) =>
          adguardClient({
            name: u.displayName!,
            identifiers: [
              { value: u.mac!, kind: 'mac' },
              { value: u.lastIp!, kind: 'ip' },
            ],
          })
        ),
        autoClients: [],
      },
    });

    expect(findings).toEqual([]);
  });
});
