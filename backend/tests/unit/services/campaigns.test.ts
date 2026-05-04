import { getCampaignDefinition, listCampaignDefinitions, RESIDENTIAL_PROXY_CAMPAIGN_ID } from '../../../src/services/campaigns/registry';
import {
  buildResidentialValidationCommandBatches,
  evaluateResidentialProxyEvidence,
  ResidentialEvidence,
} from '../../../src/services/campaigns/residentialProxy';
import { residentialProxyDefaultOptions } from '../../../src/services/campaigns/registry';

function baseEvidence(overrides: Partial<ResidentialEvidence> = {}): ResidentialEvidence {
  return {
    collectedAt: '2026-05-02T00:00:00.000Z',
    configId: 'config-1',
    siteName: 'Test Site',
    dataSources: {
      activeConfig: true,
      unifiConnection: true,
      eventsChecked: 0,
      alarmsChecked: 0,
      validationRunners: [{ id: 'runner-1', deviceId: 'server-local', name: 'Server', status: 'ONLINE' }],
    },
    candidateDevices: [],
    riskyNetworkPosture: {
      targetNetworks: [{ id: 'iot', name: 'IoT', vlan: 30, subnet: '192.168.30.0/24' }],
      weakSegmentation: false,
      indicators: [],
    },
    dnsPosture: { protectiveDnsLikely: true, indicators: ['IoT uses protective DNS.'] },
    dnsProxyEvidence: {
      configured: false,
      attributionStatus: 'UNKNOWN',
      attributionReason: 'DNS Proxy is not configured.',
      deviceLevelQueryCount: 0,
      networkLevelSignalCount: 0,
      matches: [],
      indicators: ['DNS Proxy is not configured.'],
    },
    idsHoneypotStatus: {
      idsIpsEnabled: true,
      honeypotEnabled: true,
      honeypotCount: 1,
      indicators: ['IDS/IPS appears enabled.'],
    },
    portForwards: [],
    upnpNatPmp: { upnpEnabled: false, natPmpEnabled: false, indicators: [] },
    telemetryMatches: { snippets: [], eventMatchCount: 0, alarmMatchCount: 0 },
    ...overrides,
  };
}

describe('campaign registry', () => {
  it('loads the residential proxy campaign definition', () => {
    const definitions = listCampaignDefinitions();
    expect(definitions.some((definition) => definition.id === RESIDENTIAL_PROXY_CAMPAIGN_ID)).toBe(true);
    expect(getCampaignDefinition(RESIDENTIAL_PROXY_CAMPAIGN_ID)?.steps.map((step) => step.id)).toEqual([
      'setup',
      'configure',
      'collect',
      'evaluate',
      'validate',
      'cleanup',
    ]);
  });
});

describe('residential proxy campaign evaluator', () => {
  it('returns validated for clean evidence with no candidates or posture signals', () => {
    const summary = evaluateResidentialProxyEvidence(baseEvidence());
    expect(summary.verdict).toBe('VALIDATED');
    expect(summary.findings).toHaveLength(0);
  });

  it('returns at-risk for suspicious inventory plus weak posture', () => {
    const evidence = baseEvidence({
      candidateDevices: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.30.50',
          name: 'AOSP TV Box',
          networkName: 'IoT',
          reasonCodes: ['suspicious-device-fingerprint', 'target-network'],
          confidence: 0.8,
        },
      ],
      riskyNetworkPosture: {
        targetNetworks: [{ id: 'iot', name: 'IoT', vlan: 30, subnet: '192.168.30.0/24' }],
        weakSegmentation: true,
        indicators: ['IoT does not show network isolation enabled.'],
      },
      dnsPosture: { protectiveDnsLikely: false, indicators: ['IoT inherits default DNS.'] },
    });

    const summary = evaluateResidentialProxyEvidence(evidence);
    expect(summary.verdict).toBe('AT_RISK');
    expect(summary.findings[0].severity).toBe('MEDIUM');
  });

  it('returns suspected compromise for validated open campaign ports', () => {
    const evidence = baseEvidence({
      candidateDevices: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.30.50',
          name: 'AOSP TV Box',
          networkName: 'IoT',
          reasonCodes: ['suspicious-device-fingerprint', 'target-network'],
          confidence: 0.8,
        },
      ],
      validation: {
        runner: { id: 'runner-1', deviceId: 'server-local', name: 'Server' },
        testRunIds: ['test-1'],
        scannedHosts: 1,
        scannedPorts: 9,
        openPorts: [
          {
            host: '192.168.30.50',
            port: 5555,
            service: 'android-debug-bridge',
            candidateName: 'AOSP TV Box',
            candidateMac: 'aa:bb:cc:dd:ee:ff',
          },
        ],
        cleanHosts: [],
        failedTestRuns: [],
      },
    });

    const summary = evaluateResidentialProxyEvidence(evidence);
    expect(summary.verdict).toBe('SUSPECTED_COMPROMISE');
    expect(summary.findings[0].severity).toBe('HIGH');
  });

  it('uses healthy DNS proxy matches as device-level compromise evidence', () => {
    const evidence = baseEvidence({
      candidateDevices: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.30.50',
          name: 'AOSP TV Box',
          networkName: 'IoT',
          reasonCodes: ['suspicious-device-fingerprint'],
          confidence: 0.8,
        },
      ],
      dnsProxyEvidence: {
        configured: true,
        queryLogEnabled: true,
        anonymizedClientIp: false,
        attributionStatus: 'HEALTHY',
        attributionReason: 'AdGuard is seeing multiple client IPs that match UniFi client inventory.',
        deviceLevelQueryCount: 1,
        networkLevelSignalCount: 0,
        matches: [
          {
            source: 'device',
            attribution: 'device',
            queriedAt: '2026-05-02T18:00:00.000Z',
            clientIp: '192.168.30.50',
            domain: 'api.xdresi.to',
            queryType: 'A',
            status: 'NOERROR',
            reason: 'FilteredBlackList',
            blocked: true,
            suspicious: true,
            signalType: 'known_campaign_domain',
            severity: 'HIGH',
            title: 'Kimwolf xdresi domain',
          },
        ],
        indicators: ['AdGuard sees UniFi client IPs.'],
      },
    });

    const summary = evaluateResidentialProxyEvidence(evidence);
    expect(summary.verdict).toBe('SUSPECTED_COMPROMISE');
    expect(summary.highSignals.some((signal) => signal.includes('device-level DNS'))).toBe(true);
    expect(summary.findings[0].severity).toBe('HIGH');
  });

  it('does not escalate generic blocked DNS rows into compromise evidence', () => {
    const evidence = baseEvidence({
      candidateDevices: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.30.50',
          name: 'AOSP TV Box',
          networkName: 'IoT',
          reasonCodes: ['suspicious-device-fingerprint'],
          confidence: 0.8,
        },
      ],
      dnsProxyEvidence: {
        configured: true,
        queryLogEnabled: true,
        anonymizedClientIp: false,
        attributionStatus: 'HEALTHY',
        attributionReason: 'AdGuard is seeing multiple client IPs that match UniFi client inventory.',
        deviceLevelQueryCount: 1,
        networkLevelSignalCount: 0,
        matches: [
          {
            source: 'device',
            attribution: 'device',
            queriedAt: '2026-05-02T18:00:00.000Z',
            clientIp: '192.168.30.50',
            domain: 'self.events.data.microsoft.com',
            queryType: 'A',
            status: 'NOERROR',
            reason: 'FilteredBlackList',
            blocked: true,
            suspicious: false,
          },
        ],
        indicators: ['AdGuard sees UniFi client IPs.'],
      },
    });

    const summary = evaluateResidentialProxyEvidence(evidence);
    expect(summary.verdict).toBe('AT_RISK');
    expect(summary.highSignals).toHaveLength(0);
    expect(summary.findings).toHaveLength(0);
  });

  it('labels degraded DNS proxy matches as network-level evidence', () => {
    const evidence = baseEvidence({
      dnsProxyEvidence: {
        configured: true,
        queryLogEnabled: true,
        anonymizedClientIp: false,
        attributionStatus: 'DEGRADED',
        attributionReason: 'Most DNS queries appear to come from one or two IPs.',
        deviceLevelQueryCount: 0,
        networkLevelSignalCount: 1,
        matches: [
          {
            source: 'network',
            attribution: 'network',
            queriedAt: '2026-05-02T18:00:00.000Z',
            clientIp: '192.168.1.1',
            domain: 'api.xdresi.to',
            blocked: false,
            suspicious: true,
            title: 'Kimwolf xdresi domain',
          },
        ],
        indicators: ['AdGuard mostly sees gateway or router IPs.'],
      },
    });

    const summary = evaluateResidentialProxyEvidence(evidence);
    expect(summary.verdict).toBe('AT_RISK');
    expect(summary.mediumSignals.some((signal) => signal.includes('network-level DNS'))).toBe(true);
    expect(summary.findings[0].affectedResource).toBe('DNS Proxy');
  });

  it('returns inconclusive when no active config is available', () => {
    const summary = evaluateResidentialProxyEvidence(
      baseEvidence({
        dataSources: {
          activeConfig: false,
          unifiConnection: false,
          eventsChecked: 0,
          alarmsChecked: 0,
          validationRunners: [],
        },
      })
    );
    expect(summary.verdict).toBe('INCONCLUSIVE');
  });

  it('builds chunked tcp_connect validation batches without new firmware operations', () => {
    const evidence = baseEvidence({
      candidateDevices: [
        {
          mac: 'aa:bb:cc:dd:ee:ff',
          ip: '192.168.30.50',
          name: 'AOSP TV Box',
          reasonCodes: ['suspicious-device-fingerprint'],
          confidence: 0.8,
        },
      ],
    });

    const batches = buildResidentialValidationCommandBatches(evidence, residentialProxyDefaultOptions, 4);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((batch) => batch.commands).every((command) => command.op === 'tcp_connect')).toBe(true);
  });
});
