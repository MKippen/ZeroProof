# Engineering review and improvement plan

Started 2026-09-06 against `80aab6e` on `main`. Working branch:
`codex/engineering-hardening-2026-09-06`.

## Objective and approach

Restore reliable GitHub checks and installations, close concrete security and
correctness defects, refresh dependencies, and establish a sustainable engineering
backlog. Each fix needs a reproducible failure or code-path evidence and appropriate
validation. Application behavior, dependency changes, and deployment checks are
reviewed together. Existing local password-reset work is preserved.

## Priorities

| Priority | Work | Acceptance criteria |
| --- | --- | --- |
| P1 — current batch | Diagnose failed GitHub installs and dependency update jobs | Root causes linked to logs; reproducible toolchain; failures surface immediately |
| P1 — current batch | Backend authentication, CSRF, WebSocket and updater review | Sensitive entry points enforce session/origin boundaries; regression tests |
| P1 — current batch | Security dependency refresh and runtime support | Review both lockfiles; resolve known advisories; build/test on Node 24 LTS |
| P1 — current batch | Frontend authentication and connection reliability | Password errors do not replay mutations or log users out; socket lifecycle tested |
| P2 — follow-up | Deployment and recovery assurance | Stateful upgrade and rollback test; MQTT health included; database migration history exercised |
| P2 — follow-up | Website usability and maintainability | Review key journeys, keyboard access, responsive views, error/empty/loading states; split oversized pages as changes require |
| P2 — follow-up | Detection correctness and operational reliability | Representative controller fixtures, false-positive/negative cases, scheduler concurrency and retention/load checks |
| P3 — follow-up | Deliberate major dependency migrations | Separate compatibility plans for Prisma, React, lint/test tooling and styling; avoid combining unrelated migrations |

## Confirmed starting evidence

- [Install smoke on September 6](https://github.com/MKippen/ZeroProof/actions/runs/34034194143)
  and [first failure on August 27](https://github.com/MKippen/ZeroProof/actions/runs/33110127146)
  fail at package-manager installation/resolution. Docker installs unpinned pnpm;
  the newer toolchain raises `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE`.
  [August 26 passed](https://github.com/MKippen/ZeroProof/actions/runs/32955105529)
  on the same application commit. The smoke workflow masks installer errors.
- [Dependabot qs update](https://github.com/MKippen/ZeroProof/actions/runs/33745423822)
  cannot resolve the patched package because the root override pins `6.15.1`;
  the log identifies `6.16.0` as the earliest patched version.
- Initial registry audits report 43 workspace advisories (22 high, 17 moderate,
  four low) and four updater advisories (three high, one low). These are dependency
  advisories, not 47 demonstrated exploitable application vulnerabilities.
- All routine Dependabot version-update limits are zero; npm configuration targets
  individual packages instead of the root pnpm lockfile, and omits the updater.
- Node 20 is end of life. Node 24 is the selected supported LTS runtime:
  [official release schedule](https://nodejs.org/en/about/previous-releases).

## Validation and delivery

Run frozen installs, dependency audits, package typechecks/tests, backend lint,
typecheck and coverage, frontend lint/tests/build, updater tests/build, shell and
workflow checks, and Docker image builds. Exercise migrations against a disposable
database and browser flows against an isolated fixture where available. Never use
the running development database as a disposable test database. Record exact
results and any checks that could not be performed below before delivery.

The existing development stack and other local services occupy common ports;
installation tests must use isolated resources. GitHub fixes only affect hosted
checks after the reviewed changes reach GitHub.

## Results

### Implemented fixes

| Severity | Finding and change | Evidence / location |
| --- | --- | --- |
| P1 | Docker and development bootstrap downloaded floating pnpm; derive the exact version from `packageManager` and standardize Node 24 | `backend/Dockerfile`, `frontend/Dockerfile`, `scripts/dev-setup.*` |
| P1 | Installer failure was swallowed; preserve nonzero exits, require API/database readiness, and enforce readiness deadlines | `scripts/install.sh`, `scripts/upgrade.sh`, `.github/workflows/install-smoke.yml` |
| P1 | The new cloud MQTT gate reproduced issue #50: root-owned credentials were unreadable by the broker. Configure ownership inside Docker and stage a private runtime copy for existing installations with read-only legacy files; retain additional users | Cloud run `34042729361`; `scripts/configure-mqtt.sh`, `scripts/mosquitto-entrypoint.sh` |
| P1 | Anonymous and cross-origin WebSocket clients could receive live network telemetry; enforce session/origin checks and revoke subscriptions on logout/expiry | `backend/src/api/middleware/websocket.ts`, `backend/src/server.ts` |
| P1 | Login/setup retained the anonymous session ID; regenerate session and CSRF state at authentication | `backend/src/api/routes/auth.ts` |
| P1 | Browser-admin ESP32 mutations bypassed CSRF; remove the broad path exemption | `backend/src/api/middleware/csrf.ts` |
| P1 | Concurrent setup/seed requests could create multiple administrators; serialize first-admin creation in PostgreSQL | `backend/src/services/adminAccount.ts` |
| P1 | Wrong current password was retried and treated as session expiration; distinguish application errors and never replay mutations after authentication failures | `frontend/src/api/client.ts` |
| P1 | UniFi writes were replayed after ambiguous transport failures and HTML gateway errors, potentially applying a mutation twice; stop those retries and retain safe endpoint discovery | `packages/unifi-client/src/transport/request.ts` |
| P1 | Security/intent fetch failures appeared as empty findings or missing configuration; show explicit retryable errors and preserve previous data | `SecurityAnalysisPage.tsx`, `IntentDashboardPage.tsx` |
| P1 | Privileged upgrade requests could overlap before async startup and during health verification; reserve the run through completion and rollback | `updater/src/index.ts` |
| P1 | Failed application readiness exited before automatic rollback; use a distinct post-apply exit code and verify recovery before reporting rollback success | `scripts/upgrade.sh`, `updater/src/index.ts` |
| P2 | Logout could report success while session destruction failed; await invalidation, clear cookie, and report real failure | Backend auth routes and frontend `Layout.tsx` |
| P2 | Live sockets duplicated or reconnected after logout; own timers and disconnect state, including failed initial handshakes | `frontend/src/stores/websocketStore.ts` |
| P2 | Uploads bypassed common CSRF/session recovery and malformed API responses resembled success | `frontend/src/api/client.ts` |
| P2 | Controller operations and public firmware downloads lacked limits; bound controller work per admin and firmware reads per IP | `backend/src/api/middleware/rateLimit.ts` |
| P2 | Notification mutations changed local state even when persistence failed; preserve state and expose the failure | `frontend/src/stores/notificationStore.ts` |
| P2 | Fresh-install browser test silently skipped after API setup; run the browser first and fail an initialized fixture | Install smoke workflow and `frontend/tests/e2e/setup-flow.spec.ts` |
| P2 | Upgrade cleanup pruned unrelated applications' Docker images and caches; remove host-wide pruning | `scripts/upgrade.sh` |
| P2 | Manual firmware release could attach default-branch binaries to a different tag; build the requested tag and verify embedded version | `.github/workflows/firmware-release.yml` |
| P2 | Dependency maintenance was disabled/incomplete; enable grouped updates for the root workspace, updater, actions and Docker images | `.github/dependabot.yml` |
| P2 | Every boot reported the DNS allowlist as an invalid detector rule; keep the reserved suppression file in its dedicated loader and require error-free built-in metadata loading | `backend/src/detectors/ruleLoader.ts` |

Dependency audits now report **zero known advisories** for both the pnpm workspace
and independent updater npm lockfile. Compatible direct/transitive packages were
refreshed, including Express 4.22.2, Multer 2.3.0, js-yaml 4.3.2, Vite 6.4.3 and
PostCSS 8.5.28. React Router moved to 7.18.3 because the audited 6.x line retained
redirect advisories. Existing declarative routing and tested navigation remain.

The old broad override set was removed. Two scoped overrides remain: `qs` below
6.16.0 is lifted to the patched 6.x range because Express pins an earlier version;
`tsup` uses patched esbuild 0.28.x. The UniFi library's ESM/CJS/declaration builds
and tests validate the latter. Lockfiles retain reproducible exact resolutions.

CI now audits dependencies, applies all committed migrations against PostgreSQL
15 (matching deployment), builds the updater image, uses separate image cache
scopes, and seeds a configuration sentinel before cross-version upgrade tests.
Fresh/upgrade/orphan-recovery smoke also requires an authenticated backend MQTT
connection and a stable broker, addressing the missing gate reported in issue #50.
The root `pnpm check` command covers the local JavaScript validation baseline.

### Remaining engineering backlog

1. **P1: Make account/session state authoritative.** `requirePasswordChange` is
   currently a no-op; the seeded-password flag needs coordinated API enforcement
   and a usable password-change route. Refresh `/auth/me` on application startup
   instead of trusting persisted browser state. Resolve the cached setup-state
   loop when another tab completes first-run setup.
2. **P1: Correct detector identity and correlation scope.** `iocMatch.ts` stores
   a display name as `affectedResource`; `validatedCompromise.ts` uses that field
   as an IP when MAC is absent, missing correlations for named DNS clients. Flow
   and threat queries also omit controller identity from correlation/dedupe keys,
   so overlapping private addresses across controllers can cross-correlate.
   Add explicit source IP/controller/site identity and multi-controller fixtures
   before assigning maximum confidence. This needs a coordinated schema/data
   design rather than a display-name heuristic.
3. **P1: Prove recovery with state.** Extend the new configuration sentinel to
   sessions, controller secrets, detections and MQTT reconnect. Test failed
   upgrades and automatic rollback against real images. Source rollback does not
   undo database migrations; define backup/restore and compatibility rules before
   relying on rollback for schema changes. Track existing issues
   [#49](https://github.com/MKippen/ZeroProof/issues/49) and
   [#50](https://github.com/MKippen/ZeroProof/issues/50).
4. **P2: Guard scheduled work and large data volumes.** Review overlapping async
   `setInterval` jobs in `scheduler.ts`, atomic detection persistence, bounded
   telemetry queries, and per-flow IOC lookup cost. Exercise timeouts, disconnects,
   shutdown and repeated jobs with realistic retained data. A crashed sync can
   leave `lastSyncStatus=IN_PROGRESS`, which the scheduler skips indefinitely;
   replace that flag with a recoverable lease. Add timestamp/nonce validation to
   updater HMAC requests if protecting against replay across process restarts.
5. **P2: Reconcile schema history without losing data.** All 13 migrations apply,
   but legacy `CampaignRun`, `CampaignSetting`, `CampaignRunStatus` and
   `CampaignVerdict` objects remain outside the current Prisma schema. Decide
   retention/export before adding a cleanup migration; no data was dropped.
6. **P2: Enforce merge and supply-chain policy.** `main` currently has no required
   status checks or reviews, and admin enforcement is disabled. Select required
   checks after this branch's cloud run is verified. Pin third-party Actions to
   reviewed commit SHAs and enable scheduled updates for those pins.
7. **P2: Improve website resilience.** Add route error boundaries and unknown-route
   handling, expand keyboard/focus checks, and add real browser coverage for
   settings/controller configuration and upgrade recovery. Split the remaining
   approximately 503 kB Recharts chunk if measured loading warrants it.
8. **P3: Plan major toolchain migrations.** Prisma, React, ESLint, Jest/Vitest,
   Recharts and Tailwind need separate compatibility work. Firmware builds pass,
   but ESP32 and C3 currently use different ArduinoJson major/platform constraints;
   unify them with hardware validation. Do not treat successful compilation as
   proof of device behavior.

### Security alert triage

GitHub lists nine open CodeQL alerts at the starting commit. Missing rate limits
around controller work and public firmware downloads are actionable. The Helmet
alert concerns CSP disabled only in development; production retains Helmet's
defaults. The sensitive-query alert identifies `includePassword=true`, a selector,
not a password value in the URL; the response route requires authentication and
uses no-store/audit controls. These assessments do not close GitHub alerts;
fresh analysis and explicit triage are still required.

### Validation record

- **`pnpm check` passes on Node 24: 860 tests across all four packages**, both
  dependency audits, lint, builds, and UniFi client typecheck.
- Frozen pnpm install and updater `npm ci` succeed; both audits report zero.
- UniFi library: ESM/CJS/type declarations and typecheck pass; **157 tests pass**.
- Backend: **557 tests pass**, clean lint and TypeScript build. Scanner/rule-loader
  coverage thresholds pass (scope is not whole-application coverage).
- Frontend: **112 tests pass**, clean lint and production build.
- Updater: **34 tests pass**, including real disposable child-script lifecycle
  fixtures for concurrent applies, spawn failures, malformed requests, automatic
  and explicit rollback, and failed recovery. No real upgrade ran locally.
- All three Node 24 Docker images build (backend, frontend, updater).
- Frontend also builds for Linux AMD64, the architecture of the failing CI jobs.
- All 13 migrations deploy to an isolated PostgreSQL 15 database. Twelve
  simultaneous admin-creation transactions produce exactly one administrator.
- Live production HTTP routes against a separate disposable database pass setup,
  session/CSRF rotation, old-session rejection, ESP32 CSRF rejection, anonymous and
  foreign-origin WebSocket rejection, authenticated ping, and logout revocation.
  This fixture uses development cookies; production TLS is covered by cloud smoke.
- Production-build Chrome smoke with mocked APIs passes desktop login, wrong
  password remaining authenticated with one submission, logout, setup, and mobile
  navigation. This is complementary to the live API checks, not a full-stack E2E run.
- Both ESP32 and ESP32-C3 firmware builds pass. No physical hardware test performed.
- Actionlint 1.7.12, Bash syntax, shellcheck and Compose configuration checks pass;
  five installer regression checks exercise failed builds, MQTT setup failure, failed readiness and secret
  file permissions using isolated stubs.
- Real MQTT regression tests use an isolated Linux Docker volume to verify
  credential ownership, preserved additional users, custom application usernames,
  recovery from a read-only root-owned legacy file, authenticated pub/sub, rejected
  bad credentials, and broker UID 1883. No host ports or operator credentials are used.

Current cloud installation/upgrade results are tracked in
[draft PR #75](https://github.com/MKippen/ZeroProof/pull/75). The first run passed
application tests, CodeQL, firmware, Docker builds and PR validation; all three
installation/upgrade scenarios failed the new MQTT gate, exposing the real
credential-ownership defect described above. Subsequent runs verify the repair.
Local results alone do not imply hosted checks are green. The existing live
development stack and preexisting password-reset changes were preserved.
