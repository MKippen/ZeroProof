import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for ZeroProof end-to-end tests.
 *
 * Tier 3 of the testing strategy — drives a real browser through the
 * critical user flows (fresh install, setup, login, settings, in-app
 * upgrade). Runs against the install-smoke stack (https://localhost
 * after `./scripts/install.sh`), which means Playwright tests share
 * the same fresh-install fixture as the Tier 1/2 API tests in CI.
 *
 * Local development:
 *   cd frontend
 *   pnpm exec playwright install chromium
 *   PLAYWRIGHT_BASE_URL=https://localhost pnpm exec playwright test
 *
 * Override the base URL via PLAYWRIGHT_BASE_URL when pointing at a
 * remote install (e.g. an LXC under test).
 */
export default defineConfig({
  testDir: './tests/e2e',
  // CI runs slower than local; give individual operations more headroom.
  timeout: process.env.CI ? 60_000 : 30_000,
  // Fail-fast in CI but allow retries to absorb a single flake without
  // turning the whole job red.
  retries: process.env.CI ? 1 : 0,
  // E2E suite is small for now — single worker keeps test ordering and
  // cookie state predictable across the auth flow.
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'https://localhost',
    // The install-smoke stack and most production deployments serve a
    // self-signed cert (UI is local-network-only by design). Skipping
    // verification here is the same trade-off the API integration
    // scenarios already make.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
