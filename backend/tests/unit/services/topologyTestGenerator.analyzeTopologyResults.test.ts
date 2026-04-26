jest.mock('../../../src/services/database', () => ({
  __esModule: true,
  default: {},
  prisma: {},
}));

import { analyzeTopologyResults } from '../../../src/services/topologyTestGenerator';

describe('analyzeTopologyResults', () => {
  it('keeps unintended block->reachable paths as critical isolation breaches with explicit direction', () => {
    const metadata = {
      sourceDeviceName: 'Work Probe',
      testTargets: [
        {
          sourceNetwork: 'IOT',
          network: 'Home',
          deviceName: 'Mac Mini',
          ip: '192.168.3.1',
          port: 0,
          expected: 'block',
          intentExpected: 'block',
          effectiveExpected: 'block',
          effectiveExplicit: true,
          intentReason: 'IoT isolation requires blocking traffic to/from IoT.',
          effectiveReason: 'Blocked by UniFi network isolation on Home.',
          policySource: 'hybrid',
          verdict: 'unknown',
          shouldBeBlocked: true,
        },
      ],
    };

    const results = [
      {
        op: 'ping',
        success: true,
        data: {
          host: '192.168.3.1',
          reachable: true,
        },
      },
    ];

    const findings = analyzeTopologyResults(results, metadata);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('CRITICAL');
    expect(findings[0].title).toBe('Network Isolation Breach: IOT -> Mac Mini (Home) [PING]');
    expect(findings[0].affectedResource).toBe('IOT -> Mac Mini (Home) (192.168.3.1)');
  });

  it('downgrades to low only when explicit UniFi policy allows a conflict path', () => {
    const metadata = {
      sourceDeviceName: 'Work Probe',
      testTargets: [
        {
          sourceNetwork: 'WORK',
          network: 'Default',
          deviceName: 'ZeroProof Server',
          ip: '192.168.1.10',
          port: 22,
          expected: 'block',
          intentExpected: 'block',
          effectiveExpected: 'allow',
          effectiveExplicit: true,
          intentReason: 'Inter-VLAN default policy is deny.',
          effectiveReason: 'Allowed by UniFi policy/rule ZeroProof Server Allow (LAN IN #100).',
          policySource: 'conflict',
          verdict: 'conflict',
          shouldBeBlocked: true,
        },
      ],
    };

    const results = [
      {
        op: 'tcp_connect',
        success: true,
        data: {
          host: '192.168.1.10',
          port: 22,
          open: true,
        },
      },
    ];

    const findings = analyzeTopologyResults(results, metadata);
    expect(findings).toHaveLength(1);
    expect(findings[0].type).toBe('isolation_breach');
    expect(findings[0].severity).toBe('LOW');
    expect(findings[0].title).toBe('Potential Firewall Opening: WORK -> ZeroProof Server (Default) [TCP:22]');
    expect(findings[0].affectedResource).toBe('WORK -> ZeroProof Server (Default) (192.168.1.10:22)');
  });
});
