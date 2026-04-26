# Changelog

All notable changes to ZeroProof will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-04-26

### Added
- **39 YAML-based security rules** covering firewall, VLAN isolation, wireless, DNS, UPnP, port forwards, IDS/IPS, VPN, ACL, version validation, and general hardening
- **8 optimization rules** for WiFi performance (band steering, fast roaming, multicast, SSID count, IGMP snooping, mDNS, BSS transition)
- **Intent-based security profiles** — define network goals (IoT isolation, guest network, work segmentation, DNS filtering, NAS access) and measure compliance
- **Security analysis engine** with config normalization for UniFi Network Application 9.x/10.x API variations
- **100% rule test coverage** — all 47 rules (39 security + 8 optimization) have pass/fail tests validated against realistic UniFi config fixtures
- **5 diverse persona test configs** (Apartment Dweller, Family Home, Power User, Small Business, Edge Case) exercising different rule paths
- **Config key normalizer** (`configNormalizer.ts`) — shared utility eliminating config key mismatch bugs across all consumers
- **Sandbox test harness** with mock UniFi controller for end-to-end testing without real hardware
- **Fresh install test suite** validating zero-to-one experience (empty states, password change flow, config import)
- **API integration tests** for intent, security, and timeline endpoints
- **Frontend component tests** (64 tests) for Dashboard, Security, Timeline, and Intent pages
- **Upgrade path tests** validating config format forward compatibility across key naming variants
- **Install script hardening** — health-check loop, .env idempotency, Docker daemon check, port conflict detection
- **Smoke test script** (`scripts/smoke-test.sh`) for post-install validation with intent, timeline, and session checks
- **Text-only wordmark** branding (ZeroProof)
- **Timeline view** with all-time range selector and auto-bucketing by month for wide date ranges
- **Clients page** for network client visibility
- **Optimization page** for network performance recommendations
- **Controller version validation rule** (IS-VER-001) — warns when controller version cannot be verified
- CONTRIBUTING.md, SECURITY.md, CHANGELOG.md

### Changed
- Rule validation matrix expanded to 54 test cases covering all security rules
- Timeline histogram supports `days=0` for all-time view with automatic month bucketing
- Dashboard activity label updated to "Recent changes" (was incorrectly labeled "last 90 days")
- Security Analysis page score renamed to "Config Score" to distinguish from Dashboard's combined "Security Score"
- CI pipeline now includes PostgreSQL service for integration tests

### Security
- **PostgreSQL session store** (`connect-pg-simple`) replaces in-memory sessions — sessions survive restarts
- **Rate limiting** on login (10 attempts/15min) and password change (5 attempts/15min) endpoints
- Production admin bootstrap requires `DEFAULT_ADMIN_PASSWORD` environment variable (no fallback)
- Install script generates random credentials and warns before overwriting existing `.env`

### Fixed
- **Config key normalization bug** — Intent system, VLAN mapping dropdown, and 10+ other consumers now correctly handle all UniFi config key variants (`networkConf`, `networks`, `networkconf`)
- Timeline histogram timezone bucketing for all-time date ranges

## [0.1.0] - 2025-01-30

### Added
- Initial release
- UniFi controller API integration (live sync and config import)
- Security analysis with rule engine
- ESP32 firmware for real-world network testing
- Web-based ESP32 flashing via WebSerial
- React frontend with dashboard, devices, and settings pages
- Docker Compose deployment (backend, frontend, postgres, MQTT, nginx)
- MQTT-based device communication
- OTA firmware updates for ESP32 devices
