# Test Definitions Schema

Test definitions specify network tests that can be executed by ESP32 devices or the server.
Tests are sequences of commands that probe network connectivity and services.

## Test File Format

Each YAML file can contain one or more test definitions.

## Schema

```yaml
id: "connectivity"                  # Unique identifier (required)
name: "Connectivity Test"           # Human-readable name (required)
description: |                      # Detailed description (required)
  Quick verification of device communication and basic network connectivity.

# Test classification
category: connectivity              # connectivity, isolation, discovery, audit, validation
target: esp32                       # esp32, server, both

# Metadata (optional)
metadata:
  author: "ZeroProof Team"
  created: "2024-01-15"
  version: "1.0"
  tags: [connectivity, quick, basic]
  estimated_duration: "10s"         # Approximate runtime

# Test flags
is_dynamic: false                   # Commands generated at runtime
is_mesh_test: false                 # Requires multiple devices

# Command sequence
commands:
  - op: get_network_info            # Get device network configuration

  - op: ping                        # ICMP ping
    host: "8.8.8.8"
    timeout: 2000

  - op: dns_lookup                  # DNS resolution
    hostname: "google.com"

  - op: tcp_connect                 # TCP connection test
    host: "192.168.1.1"
    port: 80
    timeout: 1000

  - op: tcp_banner                  # Get service banner
    host: "192.168.1.1"
    port: 22
    timeout: 2000

  - op: arp_scan                    # Discover hosts
    timeout: 100
    startHost: 1
    endHost: 254
```

## Available Operations

These operations are implemented in the ESP32 firmware (`command_executor.cpp`) and server-side executor.
**Only operations listed here can be used in test definitions.**

| Operation | Description | Parameters | Returns |
|-----------|-------------|------------|---------|
| `get_network_info` | Get device network configuration | none | `ip`, `gateway`, `subnet`, `dns`, `mac` |
| `ping` | ICMP ping to check reachability | `host`, `timeout`, `count` | `success`, `responseTime`, `ttl` |
| `dns_lookup` | Resolve hostname to IP | `hostname` | `success`, `addresses[]` |
| `tcp_connect` | Test TCP connection | `host`, `port`, `timeout` | `success`, `responseTime` |
| `tcp_banner` | Get service banner | `host`, `port`, `timeout` | `success`, `banner` |
| `arp_scan` | Discover hosts on subnet | `timeout`, `startHost`, `endHost` | `hosts[]` with `ip`, `mac`, `responseTime` |

### Firmware Constraints

Test definitions can only use operations that exist in the ESP32 firmware. The YAML file defines
**what to test**, but the ability to perform that test must be implemented in firmware.

To add new test operations:
1. Implement the operation in `esp32-firmware/src/command_executor.cpp`
2. Add corresponding handler in `backend/src/services/localTestExecutor.ts`
3. Update this documentation

### Default Timeouts & Limits

From `esp32-firmware/include/config.h`:
- Port scan timeout: 1000ms per port
- VLAN test timeout: 5000ms
- Service banner timeout: 2000ms
- Max banner length: 256 bytes
- Max ports to scan: 100

## Dynamic Tests

Dynamic tests generate commands at runtime based on:
- Network intent profile
- Device configuration
- Discovered networks/VLANs

```yaml
id: "topology_validation"
name: "Topology Validation"
is_dynamic: true

# Dynamic generation config
dynamic:
  source: intent_profile            # intent_profile, device_list, network_config
  generator: topology_test          # Which generator to use

  # Generator-specific options
  options:
    test_blocked_paths: true        # Test paths that should be blocked
    test_allowed_paths: true        # Test paths that should be allowed
    include_gateways: true          # Include gateway connectivity tests
```

## Mesh Tests

Mesh tests run across multiple ESP32 devices to build connectivity matrices:

```yaml
id: "device_mesh"
name: "Device Mesh Test"
is_mesh_test: true

mesh:
  mode: all_to_all                  # all_to_all, hub_spoke, sequential
  parallel: true                    # Run tests in parallel
  collect_matrix: true              # Build connectivity matrix
```
