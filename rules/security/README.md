# Security Rules Schema

Security rules analyze UniFi configuration data to detect misconfigurations and vulnerabilities.

## Rule File Format

Each YAML file can contain one or more rules. Files should be named descriptively:
- `firewall.yaml` - Firewall-related rules
- `vlan-isolation.yaml` - VLAN isolation rules
- `wireless-security.yaml` - WiFi security rules

## Schema

```yaml
# Rule metadata
id: "ZP-FW-001"                    # Unique identifier (required)
                                    # Format: {SOURCE}-{CATEGORY}-{NUMBER}
                                    # Sources: ZP (ZeroProof), IS (Industry Standards), CM (Community)
                                    # Categories: FW, VLAN, DNS, WIFI, PORT, UPNP, IPS, ACL, SW, GEN

name: "Any-to-Any Firewall Rule"   # Human-readable name (required)
description: |                      # Detailed description (required)
  Detects overly permissive firewall rules that allow all traffic
  from any source to any destination.

# Classification
category: firewall                  # Rule category (required)
                                    # Options: firewall, vlan, dns, port, upnp, wireless,
                                    #          ids_ips, access_control, switch, general, optimization

severity: CRITICAL                  # Severity level (required)
                                    # Options: CRITICAL, HIGH, MEDIUM, LOW, INFO

# Guidance
impact: |                           # Security impact description (required)
  Allows unrestricted network access, bypassing all security controls.
  Attackers or compromised devices can freely communicate across segments.

remediation: |                      # How to fix the issue (required)
  Restrict source, destination, or protocol to minimum required access.
  Navigate to Settings > Firewall & Security > Firewall Rules.

# Metadata (optional but recommended)
metadata:
  author: "ZeroProof Team"
  created: "2024-01-15"
  modified: "2024-06-20"
  version: "1.0"
  tags:
    - firewall
    - permissive
    - critical
  references:
    - "https://www.cisecurity.org/benchmark/network"
    - "https://www.nist.gov/cyberframework"
  mitre_attack:
    - "T1021"                       # Remote Services
  cwe:
    - "CWE-284"                     # Improper Access Control
  false_positives:
    - "Temporary rules during troubleshooting"

# Detection Logic
detection:
  # Target specifies what config section to analyze
  target: firewallRules             # Options: firewallRules, networks, wlans, portForwards,
                                    #          settings, firewallPolicies, aclRules, etc.

  # Filter reduces the dataset before condition checks
  filter:
    enabled: true                   # Only check enabled rules
    action: accept                  # Only check allow rules

  # Condition defines when a finding is generated
  # Uses field paths with operators
  condition:
    operator: AND                   # AND, OR, NOT
    checks:
      - field: src_address
        op: empty                   # empty, not_empty, equals, not_equals, contains,
                                    # matches (regex), in, not_in, gt, lt, gte, lte
      - field: src_network_id
        op: empty
      - field: src_firewallgroup_ids
        op: empty
      - field: dst_address
        op: empty
      - field: dst_network_id
        op: empty
      - field: dst_firewallgroup_ids
        op: empty
      - field: protocol
        op: in
        value: ["all", null, ""]

  # Output template for findings
  output:
    affected_resource: "Firewall Rule: {{name}}"
    details: "Rule \"{{name}}\" allows all traffic from any source to any destination"
    current_value: "Any -> Any (All protocols)"
    expected_value: "Specific source/destination/protocol restrictions"
```

## Condition Operators

### Comparison Operators
| Operator | Description | Example |
|----------|-------------|---------|
| `equals` | Exact match | `{field: status, op: equals, value: "disabled"}` |
| `not_equals` | Not equal | `{field: security, op: not_equals, value: "wpa3"}` |
| `contains` | String contains | `{field: name, op: contains, value: "guest"}` |
| `not_contains` | String doesn't contain | `{field: name, op: not_contains, value: "test"}` |
| `matches` | Regex match | `{field: name, op: matches, value: "^iot.*"}` |
| `in` | Value in list | `{field: severity, op: in, value: ["HIGH", "CRITICAL"]}` |
| `not_in` | Value not in list | `{field: protocol, op: not_in, value: ["tcp", "udp"]}` |
| `gt` | Greater than | `{field: port, op: gt, value: 1024}` |
| `lt` | Less than | `{field: port, op: lt, value: 1024}` |
| `gte` | Greater than or equal | `{field: vlan, op: gte, value: 100}` |
| `lte` | Less than or equal | `{field: vlan, op: lte, value: 4094}` |
| `empty` | Field is null/undefined/empty | `{field: src_address, op: empty}` |
| `not_empty` | Field has a value | `{field: dhcpd_dns_1, op: not_empty}` |

### Logical Operators
```yaml
# AND - All conditions must match
condition:
  operator: AND
  checks:
    - {field: enabled, op: equals, value: true}
    - {field: action, op: equals, value: "accept"}

# OR - Any condition matches
condition:
  operator: OR
  checks:
    - {field: security, op: equals, value: "open"}
    - {field: security, op: equals, value: "wep"}

# NOT - Negate a condition
condition:
  operator: NOT
  check:
    field: network_isolation
    op: equals
    value: true

# Nested conditions
condition:
  operator: AND
  checks:
    - field: enabled
      op: equals
      value: true
    - operator: OR
      checks:
        - {field: security, op: equals, value: "open"}
        - {field: wpa_mode, op: equals, value: "wpa1"}
```

## Helper Functions

Special functions for common network checks:

```yaml
detection:
  target: networks
  filter:
    # Built-in network type detection
    network_type: iot               # iot, guest, security, work, management, corporate

  condition:
    field: network_isolation
    op: equals
    value: false
```

## Settings Checks

For checking global settings:

```yaml
detection:
  target: settings
  condition:
    field: upnp_enabled
    op: equals
    value: true
```

## Cross-Reference Checks

Check relationships between config objects:

```yaml
detection:
  target: wlans
  filter:
    enabled: true

  # Reference other config sections
  cross_reference:
    type: network                   # Look up related network
    key: networkconf_id             # WLAN field containing network ID
    target_field: _id               # Network field to match

  condition:
    # Check the referenced network's properties
    ref_field: network_isolation    # Field on the referenced network
    op: equals
    value: false
```

## Port Range Checks

For port forward analysis:

```yaml
detection:
  target: portForwards
  filter:
    enabled: true

  condition:
    operator: AND
    checks:
      # Check if port is in sensitive range
      - field: dst_port
        op: in_port_list
        value: [22, 23, 3389, 5900, 445, 139, 3306, 5432, 1433, 27017, 6379]
```
