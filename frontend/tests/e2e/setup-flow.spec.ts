import { test, expect } from '@playwright/test';

/**
 * Brand-new-user setup flow.
 *
 * Single highest-value Playwright test: a fresh install lands on /,
 * the SetupGate redirects to /setup, the operator fills the admin
 * form, submits, and is auto-logged into /dashboard.
 *
 * This single test exercises:
 *   - Public nginx serving the SPA (catches the v1.1.0 frontend
 *     volume bug + the v1.1.5 host-net DNS bug)
 *   - SetupGate routing logic (initialized=false → /setup)
 *   - SetupPage form validation (the "button stuck disabled" bug)
 *   - POST /api/v1/auth/setup with CSRF (the v1.1.2 setup flow)
 *   - Backend session-stamping + auto-login (the v1.1.2 fix that
 *     stopped bouncing through /login)
 *   - Auth store update + Navigate('/dashboard')
 *   - Dashboard renders for an authenticated user
 *
 * Also verifies session recovery on reload, rejection of forged local auth
 * storage, existing-account login, and logout against the same live server.
 * Future Tier 3 tests (separate PRs):
 *   - Settings → General shows version + Updates card
 *   - Settings → DNS Proxy form is interactive
 *   - Settings → UniFi Configuration form is interactive
 *   - In-app upgrade click → progress log → "Restarting..." UX
 */
test.describe('fresh install setup flow', () => {
  // This test creates persistent state. A retry cannot recreate a fresh
  // install, so report the original failure and retain its browser trace.
  test.describe.configure({ retries: 0 });
  const password = process.env.E2E_SETUP_PASSWORD ?? 'playwright-e2e-setup-password-32+';

  test('creates admin, restores the server session, and rejects forged browser auth', async ({ page, browser }) => {
    await page.goto('/');

    // CI runs browser setup before the API login scenarios. An existing
    // admin indicates fixture drift and must fail instead of silently
    // skipping the only browser check of first-run onboarding.
    await expect(page).toHaveURL(/\/setup$/, { timeout: 30_000 });

    await expect(page.getByRole('heading', { name: /Welcome to ZeroProof/i })).toBeVisible();

    await page.locator('#setup-password').fill(password);
    await page.locator('#setup-password-confirm').fill(password);

    const submit = page.getByRole('button', { name: /Create administrator account/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    // Backend session-stamps + frontend navigates straight to /dashboard.
    // No /login bounce (regression target from v1.1.2).
    await page.waitForURL('**/dashboard', { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe('/dashboard');

    // The httpOnly cookie is sufficient after a reload; local auth hints are
    // neither required nor authoritative.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();

    const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      await anonymous.addInitScript(() => {
        localStorage.setItem('auth-storage', JSON.stringify({
          state: { user: { id: 999 }, isAuthenticated: true, mustChangePassword: false },
          version: 0,
        }));
      });
      const otherPage = await anonymous.newPage();
      const sockets: string[] = [];
      otherPage.on('websocket', (socket) => sockets.push(socket.url()));
      await otherPage.goto(new URL('/dashboard', page.url()).href);
      await expect(otherPage).toHaveURL(/\/login$/);
      expect(sockets).toEqual([]);

      await otherPage.getByLabel('Password', { exact: true }).fill(password);
      await otherPage.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(otherPage).toHaveURL(/\/dashboard$/);
      await otherPage.getByRole('button', { name: 'Logout', exact: true }).click();
      await expect(otherPage).toHaveURL(/\/login$/);
      await otherPage.reload();
      await expect(otherPage).toHaveURL(/\/login$/);
      // Ending one session must not end another independently logged-in one.
      await page.reload();
      await expect(page).toHaveURL(/\/dashboard$/);
    } finally {
      await anonymous.close();
    }
  });
});
