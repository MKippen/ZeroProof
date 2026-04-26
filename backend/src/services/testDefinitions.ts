/**
 * Test Definitions - Define tests as sequences of ESP32 commands
 * Tests are defined server-side and sent to devices for execution.
 * New tests can be added without firmware updates.
 */

export interface Command {
  op: string;
  [key: string]: unknown;
}

export interface TestDefinition {
  name: string;
  description: string;
  commands: Command[];
  isDynamic?: boolean; // Commands are generated at runtime based on config
  isMeshTest?: boolean; // Uses special mesh test flow (multi-device)
}

// Available operations on ESP32:
// - get_network_info: Get device network configuration
// - tcp_connect: Test TCP connection to host:port
// - tcp_banner: Get service banner from host:port
// - arp_scan: Discover hosts on local subnet
// - dns_lookup: Resolve hostname to IP
// - ping: Check if host is reachable

export const testDefinitions: Record<string, TestDefinition> = {
  connectivity: {
    name: 'Connectivity Test',
    description: 'Quick verification of device communication and network',
    commands: [
      { op: 'get_network_info' },
      { op: 'ping', host: '8.8.8.8', timeout: 2000 },
      { op: 'dns_lookup', hostname: 'google.com' },
    ],
  },

  topology_validation: {
    name: 'Topology Validation',
    description: 'Validate network isolation matches intent profile - tests if device can reach networks it should be blocked from',
    commands: [], // Commands are generated dynamically based on intent profile
    isDynamic: true, // Flag to indicate commands are generated at runtime
  },

  device_to_device: {
    name: 'Device-to-Device Test',
    description: 'Test connectivity from one device to other ESP32 devices across VLANs',
    commands: [], // Commands are generated dynamically based on registered devices
    isDynamic: true,
  },

  device_mesh: {
    name: 'Device Mesh Test',
    description: 'Test all ESP32 devices against each other to build a connectivity matrix',
    commands: [], // Handled by special mesh test endpoint
    isDynamic: true,
    isMeshTest: true, // Special flag to indicate different UI flow
  },

  port_scan: {
    name: 'Port Scan',
    description: 'Discover hosts and scan common ports',
    commands: [
      { op: 'get_network_info' },
      { op: 'arp_scan', timeout: 100, startHost: 1, endHost: 254 },
      // After arp_scan, the backend can dynamically add tcp_connect commands
      // for discovered hosts - this is handled in processTestResults
    ],
  },

  quick_scan: {
    name: 'Quick Scan',
    description: 'Fast scan of common targets',
    commands: [
      { op: 'get_network_info' },
      { op: 'ping', host: '8.8.8.8', timeout: 1000 },
      { op: 'ping', host: '1.1.1.1', timeout: 1000 },
      { op: 'dns_lookup', hostname: 'google.com' },
      { op: 'dns_lookup', hostname: 'cloudflare.com' },
    ],
  },

  vlan_isolation: {
    name: 'VLAN Isolation Test',
    description: 'Test network segmentation between VLANs',
    commands: [
      { op: 'get_network_info' },
      // Test common private network gateways
      { op: 'tcp_connect', host: '192.168.1.1', port: 80, timeout: 1000 },
      { op: 'tcp_connect', host: '192.168.1.1', port: 443, timeout: 1000 },
      { op: 'tcp_connect', host: '192.168.0.1', port: 80, timeout: 1000 },
      { op: 'tcp_connect', host: '192.168.0.1', port: 443, timeout: 1000 },
      { op: 'tcp_connect', host: '10.0.0.1', port: 80, timeout: 1000 },
      { op: 'tcp_connect', host: '10.0.0.1', port: 443, timeout: 1000 },
      { op: 'tcp_connect', host: '172.16.0.1', port: 80, timeout: 1000 },
      { op: 'tcp_connect', host: '172.16.0.1', port: 443, timeout: 1000 },
    ],
  },

  service_discovery: {
    name: 'Service Discovery',
    description: 'Discover and identify network services',
    commands: [
      { op: 'get_network_info' },
      { op: 'arp_scan', timeout: 100, startHost: 1, endHost: 254 },
      // Banner grabbing commands will be added dynamically based on arp_scan results
    ],
  },

  gateway_audit: {
    name: 'Gateway Audit',
    description: 'Scan common router/gateway IPs for open ports',
    commands: [
      { op: 'get_network_info' },
      // Common gateway IPs - 192.168.1.1
      { op: 'tcp_connect', host: '192.168.1.1', port: 80, timeout: 1000 },
      { op: 'tcp_connect', host: '192.168.1.1', port: 443, timeout: 1000 },
      { op: 'tcp_connect', host: '192.168.1.1', port: 22, timeout: 1000 },
      // Common gateway IPs - 192.168.0.1
      { op: 'tcp_connect', host: '192.168.0.1', port: 80, timeout: 1000 },
      { op: 'tcp_connect', host: '192.168.0.1', port: 443, timeout: 1000 },
      // Common gateway IPs - 10.0.0.1
      { op: 'tcp_connect', host: '10.0.0.1', port: 80, timeout: 1000 },
      { op: 'tcp_connect', host: '10.0.0.1', port: 443, timeout: 1000 },
    ],
  },

  honeypot_validation: {
    name: 'Honeypot Validation',
    description: 'Test that honeypots are responding correctly',
    commands: [
      { op: 'get_network_info' },
      // Commands will be dynamically generated based on configured honeypots
    ],
  },
};

/**
 * Get test definition by type
 */
export function getTestDefinition(testType: string): TestDefinition | undefined {
  return testDefinitions[testType];
}

/**
 * Get all available test types
 */
export function getAvailableTests(): Array<{ type: string; name: string; description: string; isMeshTest?: boolean }> {
  return Object.entries(testDefinitions).map(([type, def]) => ({
    type,
    name: def.name,
    description: def.description,
    isMeshTest: def.isMeshTest,
  }));
}
