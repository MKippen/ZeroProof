# Changelog

All notable changes to ZeroProof will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.1.22] - Unreleased

### Changed
- **Dashboard update banner button now names the version it'll apply** ("Apply v1.1.22" instead of "View update"). Tighter affordance — the user knows what's about to happen before clicking through to Settings.

## [1.1.21] - 2026-05-25

### Fixed
- **In-app upgrades silently broke `nginx`, `mosquitto`, `rules`, and `backend/firmware` bind mounts.** Hit live during the 2026-05-25 v1.1.20 in-app upgrade attempt. Root cause was a path-mismatch I missed when shipping v1.1.19's self-suicide fix:
  - The updater container mounted the host worktree at `/repo` inside itself (`volumes: - .:/repo`).
  - When `upgrade.sh` ran from inside the updater and invoked `docker compose up`, compose resolved relative paths in `docker-compose.yml` (`./nginx/nginx.conf`, `./mosquitto/config`, `./rules`, `./backend/firmware`) **using its own working directory inside the container** — `/repo`.
  - It then passed `/repo/nginx/nginx.conf` etc. to the docker daemon **as host paths**. The host didn't have a `/repo` directory at all — docker auto-created empty directories there. For file-shaped mounts (nginx.conf, mosquitto.conf) the daemon then errored: "not a directory: Are you trying to mount a directory onto a file" → nginx Exit 127, mqtt crashloop. For directory-shaped mounts (rules, firmware) it silently mounted empty dirs and the containers booted with no rules and no firmware.
  - v1.1.20 healthchecks still passed because `/health` doesn't read rules.

  Fix: mount the host worktree at the **same absolute path** inside the updater container. `install.sh` writes `HOST_WORKTREE=$(pwd -P)` to `.env` on fresh installs; `upgrade.sh`'s env-sync auto-populates it on existing installs from the current worktree path. `docker-compose.yml`'s `updater` service uses `${HOST_WORKTREE:-/opt/zeroproof}:${HOST_WORKTREE:-/opt/zeroproof}` for the bind mount and sets `UPDATER_WORKTREE` to match.

  CLI runs were never affected — host bash has `PWD=/opt/zeroproof`, paths resolve correctly, mounts work.

### Bootstrap caveat (one-time CLI step, same pattern as v1.1.19)

The first upgrade *to* v1.1.21 still hits the same bug because v1.1.20's `upgrade.sh` is what runs first when an in-app v1.1.20 → v1.1.21 upgrade is initiated. **Apply v1.1.21 via host CLI**, not in-app:

```
ssh root@<proxmox-node> -- pct exec <ctid> -- bash -lc 'cd /opt/zeroproof && bash scripts/upgrade.sh v1.1.21'
```

From v1.1.21 → v1.1.22 onward, in-app upgrades exercise the new path layout and work cleanly.

## [1.1.20] - 2026-05-25

### Fixed
- **`remove_orphan_containers()` now nukes hex-prefixed leftovers from prior failed recreates.** When docker can't use the target `container_name:` because the old container still holds it, it prepends 12 hex chars + an underscore — e.g. `e6aa3f9db470_zeroproof-frontend`. These never start and accumulate across failed upgrades, eventually wedging every subsequent `compose up`. The v1.1.16 orphan-cleanup only caught foreign-project conflicts; same-project hex leftovers slipped through because they share our project label and looked legitimate. We hit four of these on the 2026-05-25 LXC. Now any container matching `^[a-f0-9]{12}_<declared-name>$` is removed unconditionally — there is no benign reason for that pattern to exist.
- **CI: `orphan-cleanup` job now seeds and asserts removal of a hex-prefixed `Created`-state leftover** alongside the existing foreign-project orphan scenario. Locks in the regression coverage so the gap can't reopen.

## [1.1.19] - 2026-05-25

### Fixed
- **In-app "Apply Update" no longer kills itself mid-upgrade.** `scripts/upgrade.sh` was running inside the updater container and calling `docker compose up -d --build`, which recreated the updater itself — terminating the bash process executing the script and leaving the stack in a half-recreated state (we hit this twice on the 2026-05-25 LXC). This was flagged as a "known limitation" in `docker-compose.yml` back at v1.1.5 and deferred. Fix: when `/.dockerenv` is present (meaning the script is running inside a container), `upgrade.sh` enumerates compose's services, removes `updater` from the list, and recreates everything else. The updater stays on its prior image until manually restarted or until the next CLI upgrade. A stale updater is a smaller problem than a half-done upgrade.
  - **Bootstrap caveat:** this fix only takes effect from v1.1.19 onward, because v1.1.18's `upgrade.sh` is what runs when an in-app v1.1.18 → v1.1.19 upgrade is initiated. The first upgrade to v1.1.19 must be done from a host CLI (`bash scripts/upgrade.sh v1.1.19`) to avoid the suicide one last time. From v1.1.19 → v1.1.20 onward, in-app upgrades work cleanly.
  - CLI runs are unaffected — without `/.dockerenv` the recreate list stays empty and `compose up -d --build` recreates everything including the updater.

### Changed
- **Dashboard "update available" banner now shows the release age.** The banner already named the version it was offering; adding "released N days ago" gives operators a quick read on how far behind they are without clicking through to Settings or GitHub. Reuses the `publishedAt` field the backend already returns from `/api/v1/system/update`.

## [1.1.18] - 2026-05-25

### Added
- **Dashboard now surfaces "Update available" notifications.** Previously the `SystemUpdateCard` only rendered on the Settings page — a user who never opened Settings would never know their ZeroProof install was behind. The new `DashboardUpdateBanner` reads the same `['system','update']` query (so no extra network) and renders a dismissable alert at the top of the dashboard when `hasUpdate === true`. Dismissal is keyed by the *latest* version in localStorage, so dismissing the v1.1.18 banner won't silence v1.1.19 when it ships.

## [1.1.17] - 2026-05-25

### Fixed
- **In-place upgrades could leave the public-facing nginx routing to a half-recreated frontend.** During the May 2026 LXC v1.1.15 → v1.1.16 upgrade, `docker compose up -d` recreated the `frontend` container and the host-network `nginx` started proxying to it before the new bundle was actually being served. Users saw the login page render with no JavaScript bundle attached, while `/health` happily returned 200. The root cause was twofold and both halves are now closed:
  - `frontend` had **no healthcheck**, so docker treated "container running" as good enough.
  - `nginx`'s `depends_on` used short-syntax (`- frontend`, `- backend`), which waits only for `service_started`, not `service_healthy`.
- **`/health` was insufficient as a post-upgrade contract.** During the same incident, `/health` returned 200 while `/api/v1/auth/setup-status` returned a `500 SETUP_STATUS_ERROR` because the backend had lost its DB connection during the postgres recreate. Tier 4 CI now probes the deeper contract on every cross-version upgrade.

### Changed
- **`frontend` container now has a bundle-aware healthcheck.** It fetches `/index.html` and asserts the response contains a `<script` tag. A bare 200 from nginx no longer counts as healthy — the file has to actually reference a bundle.
- **`nginx` `depends_on` now uses map syntax with `condition: service_healthy`** for both `frontend` and `backend`. The host-facing proxy waits for each component to pass its own healthcheck before routing traffic on a recreate.
- **`postgres` healthcheck gains a `start_period: 20s`.** initdb / WAL recovery on container recreate can take longer than the first probe interval; the prior config counted those probes as failures and unnecessarily delayed `backend` startup.

### Added
- **Deeper post-upgrade probes in the `cross-version-upgrade` and `orphan-cleanup` CI jobs.** After `upgrade.sh` runs, the jobs now verify:
  - `/api/v1/auth/setup-status` returns HTTP 200 with `"success":true` (catches the broken-DB-chain failure mode the May 2026 incident hit).
  - `/` returns an `index.html` that references a `<script src="…">` bundle, and that bundle path itself returns 200 (catches the stale/empty-bundle failure mode the same incident hit).
  Both checks would have caught today's break on the live LXC; the existing `/health` probe did not.

## [1.1.16] - 2026-05-13

### Fixed
- **Upgrade aborted with `Your local changes to scripts/upgrade.sh would be overwritten by checkout`** when a tracked file had been hot-patched on the host (via SCP, an editor, or anything that wrote bytes without committing). The bug was visible in the wild during the v1.1.15 rollout: the 2026-05-09 SCP'd `COMPOSE_PROJECT_NAME` fix left `scripts/upgrade.sh` dirty, and every subsequent `git checkout v1.1.X` bailed with git's raw stderr. New preflight in `scripts/upgrade.sh`:
  - For each locally-modified tracked file, compare the working-tree bytes to what the target tag would install. **If equal** — the local edit is redundant — silently discard it (`git checkout HEAD -- <file>`) and continue. This is the SCP-hotfix shape and now auto-resolves.
  - **If different** — refuse upgrade with each path named, plus the exact `git checkout HEAD -- <file>` command to discard each one, plus a mention of the new `--force-clean` flag.
- **Upgrade aborted with `Conflict. The container name "/zeroproof-mqtt" is already in use`** when a stopped container from a *different* compose project (typically the legacy `repo_*` project from before `COMPOSE_PROJECT_NAME` was pinned) held one of our hardcoded `container_name:` values. The v1.1.14 fix only resolved the parallel-project case; orphans outliving a botched run still wedged every retry. `scripts/upgrade.sh` now scans `docker-compose.yml` for declared `container_name:` values before every `compose up` and removes any matching container whose `com.docker.compose.project` label is *not* ours. Containers with no compose-project label are surfaced as a warning, not auto-removed — those look operator-managed and silently nuking them would be a different class of bug.

### Added
- **`--force-clean` flag on `scripts/upgrade.sh`**: discards locally-modified tracked files that differ from the target instead of refusing. Documented in `--help` output. Intended for operators who've reviewed the diff and want to proceed.
- **Two new CI jobs in `install-smoke.yml`** that prevent regression of both fixes above:
  - `worktree-drift` — unit-style: three scenarios (refuse + named file, `--force-clean` succeeds, redundant edit auto-discards) executed against the PR's `upgrade.sh` in `--check` mode.
  - `orphan-cleanup` — end-to-end: installs the previous release, seeds a stopped container labelled `com.docker.compose.project=ci-foreign-project` named `zeroproof-mqtt`, then runs the PR's `upgrade.sh` and asserts the orphan was removed transparently and `/health` still answers.

## [1.1.15] - 2026-05-11

### Changed
- **Login and setup are now password-only.** ZeroProof is single-admin by design — `/auth/setup` is gated on an empty user table and there's no UI to add a second user — yet the login form asked for a username every time, and the setup form asked you to pick one up front. The username field was effectively dead UX (every install ended up with `admin`) and a small friction point on every login. Both forms are now password-only; the backend authenticates against the singleton `User` row by `id`. `/auth/login` returns `409 NOT_INITIALIZED` instead of `401` when called on a truly fresh install, so the frontend can route to `/setup` instead of showing a generic "invalid password" message.

### Removed
- **`username` column on the `User` table.** Dropped via migration `20260511000100_drop_user_username` (also drops the `User_username_key` unique index). Existing password hashes and audit-log foreign keys are preserved — only the username field goes away. `SessionUser`, `LoginSchema`, and the frontend `User` type all lose the field. Existing operators don't need to do anything; the migration runs as part of the in-app upgrade.

## [1.1.14] - 2026-05-09

### Fixed
- **In-app upgrade hit `Conflict. The container name "/zeroproof-mqtt" is already in use`** because the updater sidecar invokes `docker compose` from `/repo` (its bind-mount of `/opt/zeroproof`), and Compose v1 derives the project name from the cwd → so the sidecar tried to create a parallel `repo` project alongside the existing `zeroproof` one and collided on the hardcoded `container_name:` values. `scripts/upgrade.sh` and `scripts/install.sh` now pin `COMPOSE_PROJECT_NAME=zeroproof`, so the project label is identical regardless of where the script runs from. Existing installs on `/opt/zeroproof` keep the same project name they had; new installs at any path get a stable label too.
- **A failed in-app upgrade left git ahead of the running containers**, and a retry exited "Already on $TARGET. Nothing to do." instead of finishing the job. Two layers of hardening:
  - **Drift-aware short-circuit.** Before exiting "already on target", the upgrade script now compares the worktree's `CHANGELOG` version against the running backend container's `CHANGELOG` version. If they disagree (git checked out new code, but `compose up --build` hadn't run yet), it converges by re-running `compose up -d --build` instead of treating the run as a no-op.
  - **Restore-on-failure trap.** Snapshots `CURRENT_SHA` before the `git checkout`, installs an `EXIT` trap that restores the worktree if the run exits non-zero before the post-`compose up` `UPGRADE_DONE=true` flag. Health-check failures *after* a successful `compose up` are still recoverable via `--rollback` and don't trigger the trap.

### Changed
- **Update log panel wraps long lines instead of horizontally scrolling.** The progress log in the Settings → Updates card was rendering with `whitespace-pre`, so a single long line (a stack trace, a docker compose path) forced the whole panel into a horizontal scrollbar that obscured the text underneath. Switched to `whitespace-pre-wrap break-all` with `overflow-x-hidden` — vertical scroll only, lines wrap at the panel edge.

### Added
- **Export log button on the update panel.** Installing/restarting, rolled-back, and failed states now include an "Export log" action that downloads the streamed progress lines as a text file (`zeroproof-upgrade-<target>-<timestamp>.log`). One-click handoff for support / debugging without copy-pasting from the scrolling panel.

## [1.1.13] - 2026-05-09

### Changed
- **Unified sync-settings UX across DNS Proxy and UniFi connection forms.** Both forms now render the same Sync card: "Enable automatic sync" toggle, pill-style interval picker when enabled, helper text. Default is hourly on both. DNS Proxy options: 1m / 5m / 15m / Hourly (was hardcoded "every 60 seconds" with no choice). UniFi options stay Hourly / Daily — different option lists per data source is intentional (DNS query logs and UniFi config snapshots have different natural cadences), but the visual shape and vocabulary now match. New backend support for `pollingIntervalSec` on the DNS proxy settings endpoint, clamped server-side to 30..3600.

## [1.1.12] - 2026-05-09

### Added
- **Tier 4 e2e tests — cross-version upgrade.** New parallel CI job that installs the latest released tag, then runs the baseline's `scripts/upgrade.sh` targeting the PR HEAD commit. Asserts the upgrade left the worktree on the requested commit and `/health` still answers, and the updater sidecar didn't crashloop. Mirrors the actual user upgrade path: the on-disk script is whatever version they're already on. PR-introduced `upgrade.sh` changes get caught in the *next* release's Tier 4 cycle — so every release validates the previous release's upgrade path before its own changes ever ship. Completes the four-tier testing scaffolding (install smoke, API contracts, Playwright UI, cross-version upgrade).

## [1.1.11] - 2026-05-09

### Added
- **Tier 3 e2e tests — Playwright baseline.** New `@playwright/test` dev dep, `frontend/playwright.config.ts`, and the first browser-driven test: `fresh install setup flow`. Drives a real browser through `/` → `/setup` redirect → admin form fill → `/dashboard` auto-login. That single test exercises SPA serving, SetupGate routing, SetupPage form validation, CSRF, session-stamping auto-login, and the dashboard render — all paths that have regressed before. Wired into the existing `Install Smoke Test` workflow as the final step, sharing the install-smoke fixture. HTML report + traces uploaded as a 14-day artifact on test failure.

### Fixed
- **`pnpm/action-setup` failed in CI** with "Multiple versions of pnpm specified" because both the root `package.json` `packageManager: pnpm@10.28.2` field and an explicit `version: 10` in the action were set. Dropped the explicit version; the action now reads from `packageManager`.

## [1.1.10] - 2026-05-09

### Added
- **Tier 2 e2e tests — critical-path API contract scenarios.** Extends the install-smoke workflow with 11 scenarios that exercise the running stack with the real auth flow (CSRF, /setup, session rotation, /auth/me, /system/update with dual versions, channel persistence, /unifi/discover, /dns-proxy/discover, /unifi/settings, /dns-proxy/settings). Catches contract drift between backend response shapes and frontend expectations — the kind of regression that would otherwise need a manual click-through to spot.

## [1.1.9] - 2026-05-08

### Fixed
- **In-app upgrade crashed inside the updater sidecar with `openssl: command not found`.** v1.1.6 added an env-merge step to `scripts/upgrade.sh` that called `openssl rand`, but the sidecar's Alpine image only has `bash git curl docker-cli docker-cli-compose` — no openssl. Replaced with `head -c 64 /dev/urandom | base64 | tr ... | head -c 48`. Pure POSIX, works in any minimal container.
- **env-merge appended noise to `.env`** like `DATABASE_URL=`, `MQTT_BROKER=`, `MQTT_PORT=`, `PORT=` — keys that docker-compose hardcodes in its `environment:` blocks rather than reading from .env. Now scoped to keys docker-compose actually interpolates via `${KEY}` syntax.
- **`DEFAULT_ADMIN_PASSWORD` would have been auto-generated** by the `*_PASSWORD$` regex match in env-merge — but it's intentionally optional (the `/setup` flow is the design). Replaced the regex with an explicit allowlist: `POSTGRES_PASSWORD`, `MQTT_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `UPDATER_SECRET`. Future required secrets opt in by name.

### Added
- **Install Smoke Test GitHub Action** that runs the actual brand-new-user install path on every PR touching orchestration code: `./scripts/install.sh` → wait for all 7 containers healthy → hit `/health` and `/api/v1/auth/setup-status` through nginx → confirm SPA loads (not the nginx welcome page) → confirm all required secrets generated → smoke `./scripts/upgrade.sh --check`. Catches the kind of bugs we kept hitting on live LXC validation: nginx 502, missing UPDATER_SECRET, container ordering, install.sh assuming missing tools. Also runs nightly against `main` as a canary.

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
