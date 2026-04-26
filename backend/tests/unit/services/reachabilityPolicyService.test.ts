import { createReachabilityPolicyEvaluator } from '../../../src/services/reachabilityPolicyService';
import { NetworkIntentProfile } from '../../../src/types';

function baseProfile(): NetworkIntentProfile {
  return {
    workFromHome: true,
    workDeviceIsolation: true,
    workIsolationMode: 'phased',
    workVpn: false,
    homeServer: false,
    hasIoT: true,
    iotIsolation: true,
    iotInternetAccess: 'full',
    hasGaming: false,
    hasNAS: false,
    nasAccessibleFrom: 'trusted',
    guestNetwork: true,
    guestIsolation: true,
    guestBandwidthLimit: false,
    securityLevel: 'balanced',
    dnsFiltering: false,
    malwareBlocking: false,
    interVlanDefault: 'allow',
    reachabilityOverrides: [],
    networkMappings: {
      workNetworkId: 'work',
      iotNetworkId: 'iot',
      trustedNetworkId: 'trusted',
      guestNetworkId: 'guest',
    },
    completedAt: new Date().toISOString(),
    version: 1,
  };
}

describe('reachabilityPolicyService', () => {
  const networks = [
    { id: 'work', name: 'Work' },
    { id: 'iot', name: 'IoT' },
    { id: 'trusted', name: 'Trusted' },
    { id: 'guest', name: 'Guest' },
  ];

  it('applies WORK phased policy defaults', () => {
    const profile = baseProfile();
    const evaluator = createReachabilityPolicyEvaluator({
      intentProfile: profile,
      networks,
      configJson: { networks },
    });

    expect(evaluator.evaluate('work', 'iot').expected).toBe('block');
    expect(evaluator.evaluate('work', 'trusted').expected).toBe('allow');
  });

  it('surfaces conflict when WORK strict intent disagrees with effective behavior', () => {
    const profile = baseProfile();
    profile.workIsolationMode = 'strict';

    const evaluator = createReachabilityPolicyEvaluator({
      intentProfile: profile,
      networks,
      configJson: { networks },
    });

    const decision = evaluator.evaluate('work', 'trusted');
    expect(decision.expected).toBe('block');
    expect(decision.conflict).toBe(true);
    expect(decision.policySource).toBe('conflict');
  });
});
