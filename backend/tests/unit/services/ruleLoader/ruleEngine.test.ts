/**
 * Rule Engine Tests
 *
 * Tests to ensure YAML-based rules execute correctly and produce expected findings.
 */

import { ruleLoader } from '../../../../src/services/ruleLoader';
import { executeRule, executeAllRules } from '../../../../src/services/ruleLoader/ruleEngine';
import { runSecurityAnalysis, normalizeConfig } from '../../../../src/scanners';
import { TEST_CONFIGS } from '../../../fixtures/unifiConfigs';
import {
  PERSONA_A_APARTMENT,
  PERSONA_B_FAMILY_HOME,
  PERSONA_C_POWER_USER,
  PERSONA_D_SMALL_BUSINESS,
  PERSONA_E_EDGE_CASE,
} from '../../../fixtures/diverseNetworkConfigs';

describe('Rule Loader', () => {
  beforeAll(async () => {
    // Initialize the rule loader
    await ruleLoader.initialize();
  });

  describe('Rule Loading', () => {
    it('should load security rules from YAML files', () => {
      const rules = ruleLoader.getSecurityRules();
      expect(rules.length).toBeGreaterThan(0);
    });

    it('should load test definitions from YAML files', () => {
      const tests = ruleLoader.getTestDefinitions();
      expect(tests.length).toBeGreaterThan(0);
    });

    it('should load intent evaluations from YAML files', () => {
      const intents = ruleLoader.getIntentEvaluations();
      expect(intents.length).toBeGreaterThan(0);
    });

    it('should load rule sources', () => {
      const sources = ruleLoader.getSources();
      expect(sources.length).toBeGreaterThan(0);
      expect(sources.find(s => s.id === 'industry-standards')).toBeDefined();
    });

    it('should provide statistics', () => {
      const stats = ruleLoader.getStats();
      expect(stats.securityRules).toBeGreaterThan(0);
      expect(stats.testDefinitions).toBeGreaterThan(0);
      expect(stats.lastLoaded).toBeInstanceOf(Date);
    });

    it('should get rules by category', () => {
      const firewallRules = ruleLoader.getSecurityRulesByCategory('firewall');
      expect(firewallRules.length).toBeGreaterThan(0);
      firewallRules.forEach(rule => {
        expect(rule.category).toBe('firewall');
      });
    });

    it('should get rules by source', () => {
      const industryRules = ruleLoader.getSecurityRulesBySource('industry-standards');
      expect(industryRules.length).toBeGreaterThan(0);
    });
  });
});

describe('Rule Engine', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  describe('Condition Evaluation', () => {
    it('should detect any-to-any firewall rules', () => {
      const rules = ruleLoader.getSecurityRules();
      const anyToAnyRule = rules.find(r => r.id === 'IS-FW-001');
      expect(anyToAnyRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.permissiveFirewall);
      const result = executeRule(anyToAnyRule!, config);

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0].affectedResource).toContain('Allow All');
    });

    it('should detect IoT network not isolated', () => {
      const rules = ruleLoader.getSecurityRules();
      const iotRule = rules.find(r => r.id === 'IS-VLAN-001');
      expect(iotRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.iotNotIsolated);
      const result = executeRule(iotRule!, config);

      expect(result.findings.length).toBeGreaterThan(0);
      expect(result.findings[0].affectedResource).toContain('IoT');
    });

    it('should detect open WiFi networks', () => {
      const rules = ruleLoader.getSecurityRules();
      const openWifiRule = rules.find(r => r.id === 'IS-WIFI-001');
      expect(openWifiRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.openWifi);
      const result = executeRule(openWifiRule!, config);

      // Should find Main-Network but not Guest-Network (guest networks excluded)
      expect(result.findings.length).toBe(1);
      expect(result.findings[0].affectedResource).toContain('Main-Network');
    });

    it('should detect weak WiFi security', () => {
      const rules = ruleLoader.getSecurityRules();
      const weakWifiRule = rules.find(r => r.id === 'IS-WIFI-002');
      expect(weakWifiRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.weakWifi);
      const result = executeRule(weakWifiRule!, config);

      expect(result.findings.length).toBeGreaterThan(0);
    });

    it('should detect dangerous port forwards', () => {
      const rules = ruleLoader.getSecurityRules();
      const portRule = rules.find(r => r.id === 'IS-PORT-001');
      expect(portRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.dangerousPorts);
      const result = executeRule(portRule!, config);

      // Should find both SSH and RDP
      expect(result.findings.length).toBe(2);
    });

    it('should detect UPnP enabled', () => {
      const rules = ruleLoader.getSecurityRules();
      const upnpRule = rules.find(r => r.id === 'IS-UPNP-001');
      expect(upnpRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.upnpEnabled);
      const result = executeRule(upnpRule!, config);

      expect(result.findings.length).toBe(1);
    });

    it('should detect isolated networks sharing corporate DNS', () => {
      const rules = ruleLoader.getSecurityRules();
      const dnsRule = rules.find(r => r.id === 'IS-DNS-002');
      expect(dnsRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.sharedDns);
      const result = executeRule(dnsRule!, config);

      expect(result.findings.length).toBe(1);
      expect(result.findings[0].affectedResource).toContain('IoT');
    });

    it('should report L3 ACL isolation entries with network names', () => {
      const rules = ruleLoader.getSecurityRules();
      const aclRule = rules.find(r => r.id === 'IS-ACL-001');
      expect(aclRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.aclConfig);
      const result = executeRule(aclRule!, config);

      expect(result.findings.length).toBe(1);
      expect(result.findings[0].affectedResource).toContain('IoT');
      expect(result.findings[0].details).toContain('Default');
    });

    it('should report device isolation networks with names', () => {
      const rules = ruleLoader.getSecurityRules();
      const aclRule = rules.find(r => r.id === 'IS-ACL-002');
      expect(aclRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.aclConfig);
      const result = executeRule(aclRule!, config);

      expect(result.findings.length).toBe(1);
      expect(result.findings[0].affectedResource).toContain('IoT');
    });

    it('should detect missing L3 ACL coverage for untrusted networks', () => {
      const rules = ruleLoader.getSecurityRules();
      const aclRule = rules.find(r => r.id === 'IS-ACL-003');
      expect(aclRule).toBeDefined();

      const config = normalizeConfig({
        ...TEST_CONFIGS.aclConfig,
        settings: {
          acl_l3_isolation: [],
        },
      });
      const result = executeRule(aclRule!, config);

      expect(result.findings.length).toBe(1);
      expect(result.findings[0].affectedResource).toContain('IoT');
    });

    it('should render ACL rule summaries with source/destination descriptions', () => {
      const rules = ruleLoader.getSecurityRules();
      const aclRule = rules.find(r => r.id === 'IS-ACL-004');
      expect(aclRule).toBeDefined();

      const config = normalizeConfig(TEST_CONFIGS.aclConfig);
      const result = executeRule(aclRule!, config);

      expect(result.findings.length).toBe(1);
      expect(result.findings[0].details).toContain('IoT');
      expect(result.findings[0].details).toContain('Default');
    });

    it('should have minimal findings for secure config', () => {
      const rules = ruleLoader.getSecurityRules();
      const config = normalizeConfig(TEST_CONFIGS.secure);
      const results = executeAllRules(rules, config);

      // Count total findings
      const totalFindings = results.reduce((sum, r) => sum + r.findings.length, 0);

      // Secure config should have very few findings
      expect(totalFindings).toBeLessThan(7);
    });
  });

  describe('Rule Validation Matrix', () => {
    const cases = [
      // Firewall
      { ruleId: 'IS-FW-001', config: TEST_CONFIGS.permissiveFirewall, shouldFind: true },
      { ruleId: 'IS-FW-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-FW-002', config: TEST_CONFIGS.broadAllowRule, shouldFind: true },
      { ruleId: 'IS-FW-002', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-POSTURE-001', config: TEST_CONFIGS.allowAllPosture, shouldFind: true },
      { ruleId: 'IS-POSTURE-001', config: TEST_CONFIGS.secure, shouldFind: false },
      // VLAN isolation
      { ruleId: 'IS-VLAN-001', config: TEST_CONFIGS.iotNotIsolated, shouldFind: true },
      { ruleId: 'IS-VLAN-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-VLAN-002', config: TEST_CONFIGS.cameraNotIsolated, shouldFind: true },
      { ruleId: 'IS-VLAN-002', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-VLAN-003', config: TEST_CONFIGS.guestNotIsolated, shouldFind: true },
      { ruleId: 'IS-VLAN-003', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-VLAN-004', config: TEST_CONFIGS.securityNetInternet, shouldFind: true },
      { ruleId: 'IS-VLAN-004', config: TEST_CONFIGS.securityNetNoInternet, shouldFind: false },
      // Wireless
      { ruleId: 'IS-WIFI-001', config: TEST_CONFIGS.openWifi, shouldFind: true },
      { ruleId: 'IS-WIFI-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-WIFI-002', config: TEST_CONFIGS.weakWifi, shouldFind: true },
      { ruleId: 'IS-WIFI-002', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-WIFI-003', config: TEST_CONFIGS.pmfDisabled, shouldFind: true },
      { ruleId: 'IS-WIFI-003', config: TEST_CONFIGS.pmfEnabled, shouldFind: false },
      { ruleId: 'IS-WIFI-005', config: TEST_CONFIGS.noClientIsolation, shouldFind: true },
      { ruleId: 'IS-WIFI-005', config: TEST_CONFIGS.clientIsolationEnabled, shouldFind: false },
      { ruleId: 'IS-WIFI-007', config: TEST_CONFIGS.noWpa3, shouldFind: true },
      { ruleId: 'IS-WIFI-007', config: TEST_CONFIGS.wpa3Enabled, shouldFind: false },
      // Port forwards
      { ruleId: 'IS-PORT-001', config: TEST_CONFIGS.dangerousPorts, shouldFind: true },
      { ruleId: 'IS-PORT-001', config: TEST_CONFIGS.secure, shouldFind: false },
      // UPnP / NAT-PMP
      { ruleId: 'IS-UPNP-001', config: TEST_CONFIGS.upnpEnabled, shouldFind: true },
      { ruleId: 'IS-UPNP-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-UPNP-002', config: TEST_CONFIGS.upnpEnabled, shouldFind: true },
      { ruleId: 'IS-UPNP-002', config: TEST_CONFIGS.secure, shouldFind: false },
      // IDS/IPS
      { ruleId: 'IS-IPS-001', config: TEST_CONFIGS.noIps, shouldFind: true },
      { ruleId: 'IS-IPS-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-IPS-002', config: TEST_CONFIGS.ipsLowSensitivity, shouldFind: true },
      { ruleId: 'IS-IPS-002', config: TEST_CONFIGS.secure, shouldFind: false },
      // Access control
      { ruleId: 'IS-ACCESS-001', config: TEST_CONFIGS.sshEnabled, shouldFind: true },
      { ruleId: 'IS-ACCESS-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-ACCESS-002', config: TEST_CONFIGS.remoteAccess, shouldFind: true },
      { ruleId: 'IS-ACCESS-002', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-ACCESS-003', config: TEST_CONFIGS.noRadius, shouldFind: true },
      // Pass: WLAN without corporate/work/office/employee name doesn't trigger
      { ruleId: 'IS-ACCESS-003', config: TEST_CONFIGS.pmfEnabled, shouldFind: false },
      // Switch / General
      { ruleId: 'IS-SWITCH-001', config: TEST_CONFIGS.noDhcpGuard, shouldFind: true },
      // Pass: secure config has no top-level dhcp_guarding_enabled: false
      { ruleId: 'IS-SWITCH-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-SWITCH-002', config: TEST_CONFIGS.noStormControl, shouldFind: true },
      { ruleId: 'IS-SWITCH-002', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-GEN-001', config: TEST_CONFIGS.noManagementNetwork, shouldFind: true },
      // Pass: single network config (aggregate count <= 1 doesn't trigger)
      { ruleId: 'IS-GEN-001', config: TEST_CONFIGS.noIps, shouldFind: false },
      { ruleId: 'IS-GEN-002', config: TEST_CONFIGS.mdnsAcrossVlans, shouldFind: true },
      { ruleId: 'IS-GEN-002', config: TEST_CONFIGS.secure, shouldFind: false },
      // VPN
      { ruleId: 'IS-VPN-001', config: TEST_CONFIGS.l2tpVpn, shouldFind: true },
      { ruleId: 'IS-VPN-001', config: TEST_CONFIGS.secure, shouldFind: false },
      { ruleId: 'IS-VPN-003', config: TEST_CONFIGS.l2tpVpn, shouldFind: true },
      { ruleId: 'IS-VPN-003', config: TEST_CONFIGS.secure, shouldFind: false },
    ];

    it.each(cases)('$ruleId shouldFind=$shouldFind', ({ ruleId, config, shouldFind }) => {
      const rules = ruleLoader.getSecurityRules();
      const rule = rules.find(r => r.id === ruleId);
      expect(rule).toBeDefined();
      const result = executeRule(rule!, normalizeConfig(config));
      if (shouldFind) {
        expect(result.findings.length).toBeGreaterThan(0);
      } else {
        expect(result.findings.length).toBe(0);
      }
    });
  });
});

describe('Persona A: Apartment Dweller', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  const getResults = () => {
    const rules = ruleLoader.getSecurityRules();
    const config = normalizeConfig(PERSONA_A_APARTMENT);
    return executeAllRules(rules, config);
  };

  const findResult = (ruleId: string) => {
    return getResults().find(r => r.ruleId === ruleId);
  };

  it('should trigger IS-VLAN-006 (no VLAN segmentation)', () => {
    const r = findResult('IS-VLAN-006');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should trigger IS-IPS-001 (IDS/IPS not enabled)', () => {
    const r = findResult('IS-IPS-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should trigger IS-DNS-001 (using default ISP DNS)', () => {
    const r = findResult('IS-DNS-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should NOT trigger IS-FW-001 (no firewall rules exist)', () => {
    const r = findResult('IS-FW-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-PORT-001 (no port forwards)', () => {
    const r = findResult('IS-PORT-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-VLAN-001 (no IoT network)', () => {
    const r = findResult('IS-VLAN-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-WIFI-001 (WPA2, not open)', () => {
    const r = findResult('IS-WIFI-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-UPNP-001 (UPnP not enabled)', () => {
    const r = findResult('IS-UPNP-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should produce only LOW/MEDIUM/HIGH findings (no CRITICAL)', () => {
    const results = getResults();
    const criticalFindings = results.filter(
      r => r.severity === 'CRITICAL' && r.findings.length > 0
    );
    expect(criticalFindings.length).toBe(0);
  });
});

describe('Persona E: Edge Case Breaker', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  const getResults = () => {
    const rules = ruleLoader.getSecurityRules();
    const config = normalizeConfig(PERSONA_E_EDGE_CASE);
    return executeAllRules(rules, config);
  };

  const findResult = (ruleId: string) => {
    return getResults().find(r => r.ruleId === ruleId);
  };

  it('should detect "Downstairs Devices" as IoT (name contains "device")', () => {
    const r = findResult('IS-VLAN-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
    expect(r!.findings[0].affectedResource).toContain('Downstairs Devices');
  });

  it('should NOT detect "Visitors" as guest (no "guest" keyword or purpose)', () => {
    const r = findResult('IS-VLAN-003');
    expect(r).toBeDefined();
    // "Visitors" doesn't match the guest detection pattern
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT detect "CCTV" as security network (no camera/security/nvr/surveillance)', () => {
    const r = findResult('IS-VLAN-002');
    expect(r).toBeDefined();
    // "CCTV" doesn't match security network patterns
    expect(r!.findings.length).toBe(0);
  });

  it('should detect "The Office" as work network (name contains "office")', () => {
    const r = findResult('IS-VLAN-005');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
    expect(r!.findings[0].affectedResource).toContain('The Office');
  });

  it('should detect WEP WiFi (IS-WIFI-002)', () => {
    const r = findResult('IS-WIFI-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
    expect(r!.findings[0].affectedResource).toContain('Legacy CCTV');
  });

  it('should detect hidden SSID (IS-WIFI-004)', () => {
    const r = findResult('IS-WIFI-004');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
    expect(r!.findings[0].affectedResource).toContain('The Office WiFi');
  });

  it('should detect fast roaming without PMF (IS-WIFI-006)', () => {
    const r = findResult('IS-WIFI-006');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
    expect(r!.findings[0].affectedResource).toContain('Visitors WiFi');
  });

  it('should detect L2TP VPN (IS-VPN-001)', () => {
    const r = findResult('IS-VPN-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should detect VPN without logging (IS-VPN-002)', () => {
    const r = findResult('IS-VPN-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should detect wide port range forward (IS-PORT-002)', () => {
    const r = findResult('IS-PORT-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should NOT trigger IS-FW-001 (firewall rule is disabled)', () => {
    const r = findResult('IS-FW-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-PORT-001 (no sensitive port forwards)', () => {
    const r = findResult('IS-PORT-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should detect UPnP enabled (IS-UPNP-001)', () => {
    const r = findResult('IS-UPNP-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should detect IDS/IPS not enabled (IS-IPS-001)', () => {
    const r = findResult('IS-IPS-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });
});

describe('Persona B: Family Home', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  const getResults = () => {
    const rules = ruleLoader.getSecurityRules();
    const config = normalizeConfig(PERSONA_B_FAMILY_HOME);
    return executeAllRules(rules, config);
  };

  const findResult = (ruleId: string) => {
    return getResults().find(r => r.ruleId === ruleId);
  };

  it('should trigger IS-WIFI-005 (guest WiFi missing client isolation)', () => {
    const r = findResult('IS-WIFI-005');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
    expect(r!.findings[0].affectedResource).toContain('Guest WiFi');
  });

  it('should trigger IS-VLAN-004 (camera network has internet access)', () => {
    const r = findResult('IS-VLAN-004');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
    expect(r!.findings[0].affectedResource).toContain('Security Cameras');
  });

  it('should trigger IS-WIFI-003 (PMF disabled on Kids WiFi)', () => {
    const r = findResult('IS-WIFI-003');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should NOT trigger IS-FW-001 (targeted firewall rules)', () => {
    const r = findResult('IS-FW-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-WIFI-001 (all WLANs use WPA2)', () => {
    const r = findResult('IS-WIFI-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-WIFI-002 (no WEP)', () => {
    const r = findResult('IS-WIFI-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-VLAN-006 (multiple VLANs configured)', () => {
    const r = findResult('IS-VLAN-006');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-UPNP-001 (UPnP disabled)', () => {
    const r = findResult('IS-UPNP-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-PORT-001 (no port forwards)', () => {
    const r = findResult('IS-PORT-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should produce exactly one CRITICAL finding (IS-VLAN-004 camera internet)', () => {
    const results = getResults();
    const criticalFindings = results.filter(
      r => r.severity === 'CRITICAL' && r.findings.length > 0
    );
    expect(criticalFindings.length).toBe(1);
    expect(criticalFindings[0].ruleId).toBe('IS-VLAN-004');
  });
});

describe('Persona C: Power User / Home Lab', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  const getResults = () => {
    const rules = ruleLoader.getSecurityRules();
    const config = normalizeConfig(PERSONA_C_POWER_USER);
    return executeAllRules(rules, config);
  };

  const findResult = (ruleId: string) => {
    return getResults().find(r => r.ruleId === ruleId);
  };

  it('should trigger IS-VPN-003 (VPN server active — informational)', () => {
    const r = findResult('IS-VPN-003');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should trigger IS-ACCESS-002 (remote access enabled)', () => {
    const r = findResult('IS-ACCESS-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBeGreaterThan(0);
  });

  it('should NOT trigger IS-FW-001 (targeted firewall rules)', () => {
    const r = findResult('IS-FW-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-WIFI-001 (no open networks)', () => {
    const r = findResult('IS-WIFI-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-WIFI-002 (no WEP)', () => {
    const r = findResult('IS-WIFI-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-VLAN-006 (many VLANs)', () => {
    const r = findResult('IS-VLAN-006');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-UPNP-001 (UPnP disabled)', () => {
    const r = findResult('IS-UPNP-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-IPS-001 (IPS enabled)', () => {
    const r = findResult('IS-IPS-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-VLAN-002 (cameras isolated)', () => {
    const r = findResult('IS-VLAN-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should produce no CRITICAL findings', () => {
    const results = getResults();
    const criticalFindings = results.filter(
      r => r.severity === 'CRITICAL' && r.findings.length > 0
    );
    expect(criticalFindings.length).toBe(0);
  });
});

describe('Persona D: Small Business', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  const getResults = () => {
    const rules = ruleLoader.getSecurityRules();
    const config = normalizeConfig(PERSONA_D_SMALL_BUSINESS);
    return executeAllRules(rules, config);
  };

  const findResult = (ruleId: string) => {
    return getResults().find(r => r.ruleId === ruleId);
  };

  it('should NOT trigger IS-ACCESS-001 (SSH disabled)', () => {
    const r = findResult('IS-ACCESS-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-ACCESS-002 (remote access disabled)', () => {
    const r = findResult('IS-ACCESS-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-ACCESS-003 (corporate WLAN has RADIUS)', () => {
    const r = findResult('IS-ACCESS-003');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-SWITCH-001 (DHCP guarding enabled)', () => {
    const r = findResult('IS-SWITCH-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-SWITCH-002 (storm control enabled)', () => {
    const r = findResult('IS-SWITCH-002');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-FW-001 (targeted firewall rules)', () => {
    const r = findResult('IS-FW-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-WIFI-001 (no open WiFi)', () => {
    const r = findResult('IS-WIFI-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-UPNP-001 (UPnP disabled)', () => {
    const r = findResult('IS-UPNP-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should NOT trigger IS-IPS-001 (IPS enabled)', () => {
    const r = findResult('IS-IPS-001');
    expect(r).toBeDefined();
    expect(r!.findings.length).toBe(0);
  });

  it('should produce no CRITICAL findings', () => {
    const results = getResults();
    const criticalFindings = results.filter(
      r => r.severity === 'CRITICAL' && r.findings.length > 0
    );
    expect(criticalFindings.length).toBe(0);
  });
});

describe('YAML Rule Coverage', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  it('should produce same severity classifications', () => {
    const rules = ruleLoader.getSecurityRules();

    // Check that critical rules are marked as critical
    const criticalRules = rules.filter(r => r.severity === 'CRITICAL');
    expect(criticalRules.length).toBeGreaterThan(0);

    // Verify specific critical rules
    const anyToAny = rules.find(r => r.id === 'IS-FW-001');
    expect(anyToAny?.severity).toBe('CRITICAL');

    const openWifi = rules.find(r => r.id === 'IS-WIFI-001');
    expect(openWifi?.severity).toBe('CRITICAL');

    const sensitivePort = rules.find(r => r.id === 'IS-PORT-001');
    expect(sensitivePort?.severity).toBe('CRITICAL');
  });

  it('should produce same category classifications', () => {
    const rules = ruleLoader.getSecurityRules();

    // Check categories
    const firewallRules = rules.filter(r => r.category === 'firewall');
    expect(firewallRules.length).toBeGreaterThan(0);

    const vlanRules = rules.filter(r => r.category === 'vlan');
    expect(vlanRules.length).toBeGreaterThan(0);

    const wirelessRules = rules.filter(r => r.category === 'wireless');
    expect(wirelessRules.length).toBeGreaterThan(0);
  });
});

describe('Security Analysis Integration', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  it('runSecurityAnalysis should execute YAML rules', () => {
    const result = runSecurityAnalysis(TEST_CONFIGS.permissiveFirewall);
    const anyToAny = result.results.find(r => r.ruleId === 'IS-FW-001');
    expect(anyToAny).toBeDefined();
    expect(anyToAny?.findings.length).toBeGreaterThan(0);
  });
});

describe('Test Definitions', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  it('should load connectivity test', () => {
    const test = ruleLoader.getTestDefinition('connectivity');
    expect(test).toBeDefined();
    expect(test?.commands.length).toBeGreaterThan(0);
    expect(test?.commands.some(c => c.op === 'ping')).toBe(true);
  });

  it('should load VLAN isolation test', () => {
    const test = ruleLoader.getTestDefinition('vlan_isolation');
    expect(test).toBeDefined();
    expect(test?.commands.length).toBeGreaterThan(0);
    expect(test?.commands.some(c => c.op === 'tcp_connect')).toBe(true);
  });

  it('should load dynamic topology validation test', () => {
    const test = ruleLoader.getTestDefinition('topology_validation');
    expect(test).toBeDefined();
    expect(test?.is_dynamic).toBe(true);
  });

  it('should load mesh test', () => {
    const test = ruleLoader.getTestDefinition('device_mesh');
    expect(test).toBeDefined();
    expect(test?.is_mesh_test).toBe(true);
  });
});

describe('Intent Evaluations', () => {
  beforeAll(async () => {
    await ruleLoader.initialize();
  });

  it('should load IoT isolation intent', () => {
    const intent = ruleLoader.getIntentEvaluation('intent-iot-isolation');
    expect(intent).toBeDefined();
    expect(intent?.intent_setting).toBe('iotIsolation');
  });

  it('should load guest network intent', () => {
    const intent = ruleLoader.getIntentEvaluation('intent-guest-network');
    expect(intent).toBeDefined();
    expect(intent?.intent_setting).toBe('guestNetwork');
  });

  it('should have proper priority ordering', () => {
    const intents = ruleLoader.getIntentEvaluations();
    const sorted = [...intents].sort((a, b) => a.priority - b.priority);

    // Priority 1 intents should be first
    expect(sorted[0].priority).toBe(1);
  });
});
