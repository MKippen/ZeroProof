# Sandbox Testing Harness

This project now includes a clean-start sandbox harness for hardening and regression testing with no pre-existing app state.

## What It Does

- Creates an isolated PostgreSQL database (`zeroproof_sandbox` by default).
- Applies the current Prisma schema (`prisma db push`) to that isolated DB.
- Runs a dedicated sandbox integration suite (separate from unit tests).
- Uses a mock UniFi controller with current UniFi API shapes (v1 + v2 endpoints used by `UniFiClient`).
- Exercises first-run code paths:
- auth bootstrap/login
- rules auth protection
- config import on fresh state
- UniFi connection test/settings/sync
- security analysis after sync

## One-Command Run

```bash
./scripts/sandbox-clean-start.sh
```

Optional:

```bash
SANDBOX_DB_NAME=zeroproof_sandbox_ci ./scripts/sandbox-clean-start.sh
```

## Test Command Separation

- Standard backend tests exclude sandbox tests:
  - `cd backend && pnpm run test`
- Sandbox tests run only through:
  - `cd backend && pnpm run test:sandbox`
  - or `./scripts/sandbox-clean-start.sh`

## Key Files

- Harness runner:
- `scripts/sandbox-clean-start.sh`
- Sandbox Jest config:
- `backend/jest.sandbox.config.js`
- Sandbox integration test:
- `backend/tests/sandbox/cleanStartSandbox.test.ts`
- Mock UniFi controller:
- `backend/tests/sandbox/mockUnifiController.ts`
- UniFi fixture dataset:
- `backend/tests/sandbox/fixtures/unifiNetworkApi_9_2_17.ts`

## UniFi API Baseline Used

The fixture and mock endpoints align to current UniFi documentation references:

- UniFi Network API Getting Started (includes v2 endpoint patterns):  
  https://developer.ui.com/network-api/gettingstarted
- UniFi Local API documentation access and version guidance:  
  https://help.ui.com/hc/en-us/articles/31228198640023-Accessing-UniFi-Local-API-Documentation

## Real Config Fixtures

Current fixture pack includes:

- `clean-segmented-baseline`
- `insecure-open-guest-and-port-forward`

These are intentionally sanitized synthetic configs for deterministic testing.  
For real-world validation, export sanitized backups from your own UniFi sites and run them through `/api/v1/config/import` in this harness flow.
