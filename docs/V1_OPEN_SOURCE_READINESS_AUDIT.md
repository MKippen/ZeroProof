# ZeroProof V1 Open Source Readiness Audit

Date: 2026-04-26

## Status

The GitHub `main` branch is ready for V1 open-source release. It was published from a single squashed root commit on 2026-04-26 after generated/local artifacts were removed from the tree.

## Verified Gates

- Backend install reproducibility: `pnpm install --frozen-lockfile` passed.
- Backend build: `pnpm build` passed.
- Backend unit/mock-safe tests: `pnpm test --runInBand` passed, 286 tests.
- Backend sandbox/API tests: `NODE_ENV=development pnpm exec jest -c jest.sandbox.config.js --runInBand` passed, 25 tests.
- Backend dependency audit: `pnpm audit` passed with no known vulnerabilities.
- Backend lint: `pnpm lint` passed with 0 errors and 0 warnings.
- Frontend install reproducibility: `pnpm install --frozen-lockfile` passed.
- Frontend build: `pnpm build` passed with route-level chunks and no large chunk warning.
- Frontend tests: `pnpm test -- run` passed, 64 tests.
- Frontend dependency audit: `pnpm audit` passed with no known vulnerabilities.
- Frontend lint: `pnpm lint` passed with 0 errors and 0 warnings.
- Docker config validation: `docker compose -f docker-compose.yml config --quiet` and `docker compose -f docker-compose.dev.yml config --quiet` passed.
- Tracked-file secret scan: `trufflesecurity/trufflehog` runs on every PR via `.github/workflows/pr-check.yml`. A manual regex sweep of the tracked tree found no committed private keys, tokens, real LAN IPs, MAC addresses, hostnames, or local paths.

## Cleanup Completed

- Removed tracked generated secrets and artifacts:
  - `mosquitto/config/passwd`
  - `frontend/package-lock.json`
  - `backend/firmware/zeroproof-esp32.bin`
- Added ignored examples and generated-file protections:
  - `mosquitto/config/passwd.example`
  - `package-lock.json`
  - `.claude/launch.json`
  - `mosquitto/config/passwd`
  - `backend/firmware/*.bin`
  - `backend/firmware/*.elf`
  - `backend/firmware/*.map`
- Removed embedded static TLS material from the UniFi mock controller. Tests now generate a temporary self-signed certificate at runtime.
- Updated bootstrap scripts to generate the Mosquitto password file when needed.
- Updated Dockerfiles to use strict `pnpm install --frozen-lockfile`.
- Updated public test commands and CI pnpm setup to match the lockfile workflow used for release validation.
- Split frontend routes with lazy loading and isolated chart dependencies so the production build no longer emits a large chunk warning.
- Removed frontend lint warnings from debug logging, hook dependencies, and loose result typing.
- Made the backend lint policy explicit for schemaless UniFi controller responses and YAML rule payloads.
- Added production fail-fast checks for placeholder/default secrets.
- Tightened production CORS and proxy trust behavior.
- Added server resource cleanup for the Postgres session store so sandbox tests exit cleanly.
- Updated public docs and project branding from legacy wording to ZeroProof.
- Removed stale public references to committed firmware binaries. Firmware binaries must be built locally for release distribution.

## Remaining Known Work

- Backend code still uses explicit `any` at UniFi API, MQTT, and YAML rule boundaries where payloads are intentionally schemaless. The lint rule is disabled for the backend rather than requiring misleading local schemas for V1.
- The license and GitHub URLs intentionally identify the project owner. No personal network identifiers were found in tracked text files.
- Generic RFC1918/private IP examples remain in tests, fixtures, and documentation. These are synthetic examples, not local network exports.

## Release History Warning

The public `main` branch is a single squashed root commit. Old remote branches and archive tags were removed before release.

GitHub continues to advertise `refs/pull/N/head` for the six historical pull requests merged before the squash. While the repository is private these refs are only visible to collaborators, but they expose the original pre-squash commits and must be addressed before flipping the repository to public:

- Option A: ask GitHub Support to purge `refs/pull/*/head` for the closed PRs.
- Option B: confirm via direct review of each PR's commits that nothing sensitive (secrets, firmware binaries, real LAN data) is reachable, and accept the exposure.
- Option C: re-create the repository under a new name and re-publish the squashed commit there.

Do not push old local backup branches, tags, or stashes back to GitHub. They may reintroduce private pre-release history.
