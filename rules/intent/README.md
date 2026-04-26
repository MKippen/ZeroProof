# Intent Evaluation Schema

Intent evaluations compare user's stated network security intent against actual configuration.
These rules detect gaps between what users want and what's actually configured.

## Intent Evaluation File Format

Each YAML file can contain one or more intent evaluation rules.

## Schema

```yaml
id: "intent-iot-isolation"          # Unique identifier (required)
name: "IoT Device Isolation"        # Human-readable name (required)
description: |                      # Detailed description (required)
  Evaluates if IoT devices are properly isolated from other network segments.

# Classification
category: device_isolation          # device_isolation, network_access, dns_security,
                                    # guest_network, work_network, general_security
priority: 1                         # Evaluation order (lower = first)

# Which intent setting this evaluates
intent_setting: iotIsolation        # Maps to NetworkIntentProfile field

# When this evaluation applies
applicable_when:
  intent_field: hasIoT
  op: equals
  value: true

# Evaluation logic
evaluation:
  # What to check in the config
  checks:
    - name: "IoT network exists"
      target: networks
      condition:
        operator: OR
        checks:
          - field: name
            op: matches_i
            value: "iot"
          - field: purpose
            op: equals
            value: "iot"
      required: true

    - name: "IoT network is isolated"
      target: networks
      filter:
        network_type: iot
      condition:
        field: network_isolation
        op: equals
        value: true
      required: true

    - name: "Firewall blocks IoT to trusted"
      target: firewallRules
      condition:
        # Check for blocking rule from IoT to trusted networks
        operator: exists
        checks:
          - field: action
            op: equals
            value: "drop"
          - field: src_network_type
            op: equals
            value: "iot"
      required: false
      severity_if_missing: MEDIUM

  # Scoring
  scoring:
    all_required_pass: configured
    some_required_fail: not_configured
    optional_bonus: true

# Output templates
output:
  configured:
    summary: "IoT devices are properly isolated"
    details: "IoT network exists with isolation enabled"

  not_configured:
    summary: "IoT isolation not configured"
    details: "{{missing_checks}}"
    remediation: |
      1. Create a dedicated IoT network/VLAN
      2. Enable network isolation on the IoT network
      3. Add firewall rules blocking IoT access to trusted networks

  partial:
    summary: "IoT isolation partially configured"
    details: "{{partial_details}}"
```

## Intent Settings Reference

These are the fields from `NetworkIntentProfile` that can be evaluated:

### Work Settings
| Setting | Type | Description |
|---------|------|-------------|
| `workFromHome` | boolean | User works from home |
| `workDeviceIsolation` | boolean | Work devices should be isolated |
| `workVpn` | boolean | Work requires VPN |
| `homeServer` | boolean | Has home server/NAS |

### Device Settings
| Setting | Type | Description |
|---------|------|-------------|
| `hasIoT` | boolean | Has IoT devices |
| `iotIsolation` | boolean | IoT should be isolated |
| `iotInternetAccess` | enum | full/limited/none |
| `hasGaming` | boolean | Has gaming devices |
| `hasNAS` | boolean | Has NAS/server |
| `nasAccessibleFrom` | enum | all/trusted/specific_vlans |

### Guest Settings
| Setting | Type | Description |
|---------|------|-------------|
| `guestNetwork` | boolean | Has guest network |
| `guestIsolation` | boolean | Guests should be isolated |
| `guestBandwidthLimit` | boolean | Limit guest bandwidth |

### Security Settings
| Setting | Type | Description |
|---------|------|-------------|
| `securityLevel` | enum | maximum/balanced/convenience |
| `dnsFiltering` | boolean | Enable DNS filtering |
| `malwareBlocking` | boolean | Enable malware blocking |
| `interVlanDefault` | enum | allow/deny default policy |

## Evaluation Results

Each evaluation produces one of these statuses:
- `configured` - Setting is properly implemented
- `not_configured` - Setting is needed but missing
- `partial` - Setting is partially implemented
- `not_applicable` - User doesn't need this setting

## Gap Detection

When an evaluation fails, a gap is generated:

```yaml
gap:
  intent: "IoT devices isolated from main network"
  reality: "No IoT network configured"
  severity: HIGH
  setting_id: "iotIsolation"
  remediation_steps:
    - "Create IoT VLAN"
    - "Enable network isolation"
    - "Configure firewall rules"
```
