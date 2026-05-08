# Changelog

All notable changes to ZeroProof will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.1] - 2026-05-08

### Fixed
- **Migration history is incomplete on fresh deploys.** 13 tables (UniFiConnection, UniFiSyncHistory, UniFiConfigChange, Notification, NetworkClient, RemediationAction, CachedRule, CachedTest, CachedIntentEval, RuleSource, GitHubRuleRepo, CampaignSetting, CampaignRun) and 6 enums (SyncStatus, ChangeType, NotificationType, RemediationStatus, CampaignRunStatus, CampaignVerdict) referenced in `schema.prisma` were originally introduced via `prisma db push` and were never captured by `prisma migrate dev`. Fresh `prisma migrate deploy` against an empty Postgres hit `P3009` partway through. Added `20260502000100_baseline_phantom_objects` (idempotent — `CREATE TABLE IF NOT EXISTS` for tables, `DO $$ ... EXCEPTION WHEN duplicate_object $$` for enums and constraints) plus `IF NOT EXISTS` guards on `ADD COLUMN` statements in two later migrations.
- **`DEFAULT_ADMIN_PASSWORD=""` crashed the backend** instead of routing the user to `/setup`. `docker-compose` passes the var through as empty when `.env` has it blank — the documented "leave blank to use /setup" path. The zod env validator treated `""` as present-but-too-short and crash-looped boot. Now preprocesses `""` → `undefined` before the `.min(8)` check.
- **`rules/` directory not mounted in production `docker-compose.yml`.** Only the dev compose had it; without the mount the security analyzer, intent system, and detection-engine YAML metadata never loaded. Added `./rules:/rules:ro` + `RULES_DIR=/rules` to backend + scheduler.
- **Frontend SPA never reached the public nginx.** Browsing to the dashboard URL returned the default `nginx:alpine` welcome page. Root cause: the frontend Dockerfile copies the build to `/usr/share/nginx/html` but compose mounted the named `frontend_build` volume at `/app/dist` on the frontend container, capturing nothing; the public nginx, mounting the same volume, was populated from `nginx:alpine`'s default `/usr/share/nginx/html` (the welcome page) at first volume init. Switched the public nginx to `proxy_pass` `/` to the frontend container's own nginx (port 80), removing the brittle shared-volume hand-off entirely. The `frontend_build` volume is gone.

## [1.1.0] - 2026-05-08

### Added
- **Detection engine** — event-driven cross-source security findings layer that evaluates UniFi flow events, UniFi IDS threat events, and DNS query events against rule windows on a schedule. Findings land in a new `Detection` table with fingerprint dedupe, max-severity escalation (never silent downgrade), and per-rule retention.
- **10 built-in detectors** with paired YAML rule metadata in `rules/detection/`:
  - `ioc_match` — flow / DNS hits a known-bad IOC (HIGH / CRITICAL when category is `malware-c2` or `cryptominer`)
  - `validated_compromise` — same device shows IOC match AND UniFi IDS hit (CRITICAL, near-zero FP rate)
  - `honeypot_hit` — internal device touches a configured honeypot resource (CRITICAL)
  - `repeating_threat` — single source IP triggers UniFi IDS many times in a window
  - `high_risk_country_egress` — allowed flow to operator-defined high-risk region
  - `dns_bypass` — internal device used an external DNS resolver outside the allowlist
  - `admin_port_egress` — outbound to SSH / RDP / VNC / WinRM on the public internet
  - `high_egress_volume` — single host crossed an outbound byte threshold
  - `internal_scanning` — single host contacted many distinct internal IPs
  - `dns_tunneling` — long, high-entropy DNS queries from one client
- **Threat-intel cache** — new `IocEntry` table keyed by `(feed, kind, value)` with daily refresh and stale-prune. Detectors look up cached entries via `lookupIp()` / `lookupDomain()` (parent-zone walk so a parent IOC catches subdomains).
- **URLhaus feed adapter** (CC0-1.0, abuse.ch) — first IOC source. Pure stdlib `node:https` (no axios). Categorizes entries into `malware-c2` / `phishing` / `cryptominer` / `malware-distribution`.
- **`/detections` page** — summary tiles, top-detector and top-affected breakdowns, expandable findings table with severity / status filters and resolve / dismiss / reopen actions.
- **Dashboard alert card** — surfaces only when there are open detections so quiet networks stay calm.
- **Detection-engine API** — `GET /api/v1/detections{,/analytics,/:id}` and `POST /:id/{resolve,dismiss,reopen}`.
- **Scheduler integration** — runs every detector every 5 minutes (`DETECTOR_RUN_INTERVAL_MS` to override) and refreshes IOC feeds daily (eager refresh on boot).
- **External data sources section in `EXTERNALS.md`** — tracks the lineage and license of every threat-intel feed alongside npm dependencies.

### Security
- **Synchronizer-token CSRF protection** — new middleware mounted at `/api/v1/*` validates an `X-CSRF-Token` header against a per-session crypto-random token. Bypasses safe methods, ESP32 device endpoints (no browser session), and `NODE_ENV=test`. Closes pre-existing CodeQL `js/missing-token-validation` alert.
- New `GET /api/v1/auth/csrf` endpoint returns the per-session token; the frontend client lazily fetches it, replays it on every mutating request, and auto-retries once on `CSRF_TOKEN_INVALID` to recover from session rotation.

### Docs
- New `rules/detection/*.yaml` — per-detector severity tiers, remediation guidance, and references that can evolve without code deploys.

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
