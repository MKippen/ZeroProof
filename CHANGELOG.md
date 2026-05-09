# Changelog

All notable changes to ZeroProof will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.8] - 2026-05-08

### Added
- **UniFi `allowSelfSigned` is now a first-class config field.** New `UniFiConnection.allowSelfSigned` column (idempotent migration `20260509000100_add_unifi_allow_self_signed`) defaults `true` to preserve current behavior. UI grows a "Verify SSL certificate" checkbox in both the legacy Settings → UniFi Configuration form and the new multi-connection form, defaults to unchecked (matches DB).
- **Sidecar hardening.** `POST /apply` returns `503` when `UPDATER_SECRET` is unset (instead of silently failing the empty-secret HMAC check). Request body capped at 16KB by default (`UPDATER_MAX_BODY_BYTES` env), `413` on overflow. Target ref allowlist (`isValidTargetRef`) rejects shell-meaningful strings before they reach `upgrade.sh`'s args. `/healthz` reports `configured: !!SECRET` for diagnostics. Sidecar test suite expanded from 5 to 19 tests.
- **Backend `updaterService` hardening.** New `resolveProgressPath()` clamps the sidecar-reported progress file path under `PROGRESS_DIR` so even a spoofed sidecar can't trick the backend into tailing arbitrary host files.
- **Dedicated CI job for the updater sidecar.** Sidecar tests now run on every PR. `@uguard/unifi-client` typecheck + test added to the main CI job.

### Fixed
- **`compareTags()` semver pre-release ordering was lexicographic.** `beta.10` was sorting before `beta.2`. Now follows proper semver: numeric-vs-numeric is numeric, mixed prefers numeric, otherwise lexicographic. Pinned by new unit tests.
- **`updater/package-lock.json` was being silently gitignored** by the workspace-level `package-lock.json` rule. Allowlisted via `!updater/package-lock.json` so `npm ci` works in CI.

### Changed
- **pnpm overrides consolidated into root `package.json`.** Per-project overrides previously duplicated in `backend/package.json` and `frontend/package.json` are now in a single workspace root file. Fewer drift opportunities.

## [1.1.7] - 2026-05-08

### Fixed
- **UniFi auto-sync settings were trapped after initial save.** The auto-sync controls in Settings → UniFi Configuration were gated on local-only `connectionTested` state that resets to `false` on every page reload and on every field edit. Once a connection was saved, getting back to the sync toggle required a fresh successful test — but since the saved password is masked (`(saved)` placeholder), re-testing meant re-entering credentials the operator didn't remember anymore. Fix: also expose the panel when `isConfigured`. The saved connection has been validated server-side, so the controls are safe.

## [1.1.6] - 2026-05-08

### Fixed
- **`502 Bad Gateway` on every page after the v1.1.5 host-networking switch.** The nginx config used a `set $upstream ...; proxy_pass $upstream;` pattern that forces nginx to do runtime DNS resolution. On the Docker bridge that auto-defaulted to `127.0.0.11` (Docker's embedded resolver); under `network_mode: host` no Docker resolver exists, so `localhost` failed to resolve and every proxied request 502'd. Replaced with literal `proxy_pass http://localhost:N;` — uses `/etc/hosts`, no DNS round-trip.
- **`UPDATER_SECRET` missing on existing v1.1.x installs upgrading to v1.1.5+.** `install.sh` only generates the secret on fresh installs, so existing operators ended up with a sidecar that crashlooped on `FATAL: UPDATER_SECRET is required`. New env-merge step in `scripts/upgrade.sh`: scans `.env.example` for keys missing in `.env`, auto-generates values for `*_SECRET` / `*_PASSWORD` / `*_KEY` shaped keys, appends other missing keys blank for the operator. Operator-set values are never overwritten.

### Added
- **Dual version display.** Settings → General Updates card now shows backend and updater versions as separate rows, with a yellow drift warning if they don't match. Sidecar grows a `GET /version` endpoint that reads `CHANGELOG.md` (same source-of-truth pattern the backend uses), so the two version reports come from a single file stamped on release.

### Legacy migration note
- Anyone already running a broken v1.1.5 (sidecar crashlooping because `UPDATER_SECRET` is missing) needs that one secret added to `.env` before they can in-app upgrade to v1.1.6. v1.1.5's `upgrade.sh` doesn't have the new env-merge logic, so it can't self-heal. One-line fix: `echo "UPDATER_SECRET=$(openssl rand -base64 48 | tr -dc 'a-zA-Z0-9' | head -c 48)" >> .env && docker compose up -d updater`. From v1.1.6 forward it's fully appliance-style.

## [1.1.5] - 2026-05-08

### Added
- **One-click in-app upgrades.** Settings → General "Install update" button now drives the whole upgrade through the existing `scripts/upgrade.sh` path — no SSH required. New `updater/` sidecar service (privileged container with Docker socket access, `network_mode: host`) receives HMAC-SHA256 signed apply requests from the backend on `127.0.0.1:9090`, shells `bash scripts/upgrade.sh <target>`, streams stdout/stderr to a shared progress file the backend tails and forwards over the existing `/ws` WebSocket as `updater_progress` events. Single source of truth for upgrade orchestration: every protection in `upgrade.sh` (annotated-tag SHA dereference, bootstrap untracked-file pre-flight, `--rollback`, health polling) applies to the UI path too.
- **Auto-rollback on failed health check.** After `upgrade.sh` exits 0, the sidecar re-polls `/health` for 90 seconds. If health doesn't recover, it triggers `scripts/upgrade.sh --rollback` automatically and broadcasts `rolledBack: true` to the UI. Same pattern as Home Assistant's recovery mode.
- **`UPDATER_SECRET` env var.** Shared HMAC key between backend (signer) and updater (verifier). `install.sh` generates a 48-char secret on fresh installs; `.env.example` documents it; blank secret disables in-app updates entirely (CLI `scripts/upgrade.sh` remains the unconditional fallback).
- **Frontend "Restarting…" UX.** WebSocket disconnect during an apply triggers the same UX pattern HA Supervisor uses: card transitions to "Server is restarting…", waits for the WebSocket to reconnect, refetches `/system/update`, then either lands in `done` (version moved) or `failed` (version did not move). State machine in `SystemUpdateCard`: `idle → confirming → installing → restarting → done | rolledback | failed`.

### Known limitations
- When an upgrade includes a new updater image, the sidecar gets recreated mid-run and the in-progress apply may be interrupted. The progress file is on a shared volume so the backend can still read final state after the sidecar restarts, and CLI `scripts/upgrade.sh` always works as a fallback. Throwaway-container pattern (Portainer-style) for self-update of the updater is queued for v1.1.6.

## [1.1.4] - 2026-05-08

### Added
- **In-app update notifications.** Settings → General now shows a Updates card with current version (read from CHANGELOG.md), latest available release, and an orange "vX.Y.Z available" banner with release-notes preview + "View on GitHub" link when an update exists. Notify-and-confirm by design — applying the update is still a CLI step (`./scripts/upgrade.sh`) until the sidecar updater lands. New backend `systemUpdateService` fetches GitHub releases over stdlib `node:https` (5-minute server cache, well under the 60/hr anonymous limit).
- **Stable / Beta release channels.** Channel selector in the Updates card; persists in the existing `Setting` k/v table (no new migration). Stable shows only `prerelease: false` releases; Beta includes prereleases. Semver-descending sort means a Stable always supersedes a Beta of the same version, so beta-channel users still see stable releases.

## [1.1.3] - 2026-05-08

### Added
- **Auto-discover for AdGuard Home / Pi-hole.** New `discoverDnsProxies()` reads DHCP-advertised resolvers from `/etc/resolv.conf`, filters to RFC1918 (no LAN sweep, no public probes), and fingerprints AdGuard's `/control/status` and Pi-hole's `/admin/api.php?summaryRaw` over stdlib `node:http`. The DNS proxy settings form shows an orange "We found a DNS filter on your network" banner with one-click prefill — never auto-applied.
- **Auto-discover for UniFi gateway controllers.** New `discoverUniFiGateways()` reads the host's default-route gateway from `/proc/net/route`, filters to RFC1918, and TCP-probes UniFi-typical ports (443 / 8443) for a listening service. The controller connection form surfaces matches the same way as DNS proxy. Confidence is `medium`; the operator's Test click is the real fingerprint validator.
- **Host networking for production deployments.** `docker-compose.yml` now runs backend, scheduler, and the public nginx with `network_mode: host` on Linux. ZeroProof is a network-security tool — backend needs to see the host's resolv.conf and routing table to auto-discover UniFi/DNS from DHCP-advertised sources. Same pattern Pi-hole, AdGuard Home, and Tailscale use. Docker Desktop on Mac/Windows uses a hidden VM, so dev keeps using `docker-compose.dev.yml` with bridge networking. Stateful services (postgres, mosquitto) and the frontend container stay on the bridge with their ports bound to `127.0.0.1` (postgres, frontend) or kept public (mosquitto, for ESP32 sensor connections).

### Fixed
- **`scripts/upgrade.sh` failed when `git rev-parse <annotated-tag>` returned the tag-object SHA instead of the commit SHA**, so the "Already on target" short-circuit silently misfired for every annotated-tag upgrade. Dereference with `^{commit}`.
- **`scripts/upgrade.sh` aborted with "untracked working tree files would be overwritten by checkout"** for users who downloaded the script before the target version had it tracked (the bootstrap pattern). New pre-flight pass: if an untracked file is byte-identical to the target's version, remove it and continue. Otherwise bail loudly so the operator decides what to do — never silently destructive.

## [1.1.2] - 2026-05-08

### Added
- **`scripts/upgrade.sh`** — single-command upgrade flow (`./scripts/upgrade.sh` for the latest tag, `./scripts/upgrade.sh v1.2.0` for a specific ref, `--check` to preview, `--rollback` to undo). Records the current commit SHA, fetches the target ref, rebuilds containers, waits for `/health`, and surfaces a rollback command if health doesn't recover within 90 seconds. Replaces the manual `git pull && docker-compose up -d --build` dance for everyone on v1.1.2+.
- **DNS proxy as step 2 of the first-run checklist on the dashboard.** The detection engine reads from three data pillars (UniFi flows, UniFi IDS threats, DNS query stream); without DNS, `dns_bypass` / `dns_tunneling` / IOC-domain matching all run dry. New ordering: 1) Connect UniFi → 2) Hook up DNS proxy → 3) Define intent.

### Fixed
- **Mosquitto password file shipped at mode `0600`** so the in-container mosquitto user (UID 1883) couldn't read it and the container crash-looped with `Unable to open pwfile`. `install.sh` and `dev-setup.sh` now `chmod 644`. Contents are bcrypt-hashed credentials, not plaintext.
- **`/setup` button stayed disabled when the form looked filled.** The username field was empty with `placeholder="admin"` styled to look pre-filled. Defaulted username to `admin` (editable). Also added a single-line hint beneath the disabled button explaining what's missing ("Enter a username", "Password must be at least 12 characters", "Passwords do not match", etc.).
- **`/setup` redirected to `/login` instead of auto-logging-in the freshly created admin.** Backend `/auth/setup` now stamps the session before responding (matches the `/login` handler's pattern); frontend updates the auth store and navigates straight to `/dashboard`. The "you have to refresh" complaint is gone.
- **`SetupGate` cached its `setup-status` probe forever** and bounced authenticated post-setup users back to `/setup`. Now short-circuits to `initialized` whenever the auth store says we're logged in.

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
