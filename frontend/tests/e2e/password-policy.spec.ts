import { test, expect, type Page } from '@playwright/test';

// The install-smoke workflow marks its disposable administrator as requiring
// a password change immediately before this test. It never targets an operator
// account. This stateful scenario must not silently retry an altered fixture.
test.describe('required password change and session revocation', () => {
  test.describe.configure({ retries: 0 });
  const password = process.env.E2E_SETUP_PASSWORD ?? 'playwright-e2e-setup-password-32+';
  const changedPassword = `${password}-changed`;

  async function signIn(page: Page, base: string) {
    await page.goto(new URL('/login', base).href);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).toHaveURL(/\/change-password$/);
  }

  async function fillPasswords(page: Page, current: string, next: string) {
    await page.getByLabel('Current Password', { exact: true }).fill(current);
    await page.getByLabel('New Password', { exact: true }).fill(next);
    await page.getByLabel('Confirm New Password', { exact: true }).fill(next);
  }

  test('enforces the change, rotates the current session, and invalidates another login', async ({ page, browser, baseURL }) => {
    test.setTimeout(90_000);
    const base = baseURL!;
    const sockets: string[] = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));
    await signIn(page, base);
    await page.goto(new URL('/dashboard', base).href);
    await expect(page).toHaveURL(/\/change-password$/);
    expect(sockets).toEqual([]);

    const restricted = await page.request.get(new URL('/api/v1/dashboard', base).href);
    expect(restricted.status()).toBe(403);
    expect((await restricted.json()).error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const secondContext = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const secondPage = await secondContext.newPage();
      await signIn(secondPage, base);

      let submissions = 0;
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/auth/change-password') submissions++;
      });
      await fillPasswords(page, 'incorrect-current-password', changedPassword);
      await page.getByRole('button', { name: 'Change Password', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Current password is incorrect');
      expect(submissions).toBe(1);
      await expect(page).toHaveURL(/\/change-password$/);

      await fillPasswords(page, password, changedPassword);
      await page.getByRole('button', { name: 'Change Password', exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      expect(submissions).toBe(2);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();

      const previousSession = await secondContext.request.get(new URL('/api/v1/auth/me', base).href);
      expect(previousSession.status()).toBe(401);
      expect((await previousSession.json()).error.code).toBe('UNAUTHORIZED');
      await secondPage.reload();
      await expect(secondPage).toHaveURL(/\/login$/);

      // The normal Settings form must also survive rotation and leave a valid
      // current session. Restoring the fixture password keeps later API checks
      // independent of which browser scenarios were selected.
      await page.goto(new URL('/settings', base).href);
      await fillPasswords(page, changedPassword, password);
      await page.getByRole('button', { name: 'Change Password', exact: true }).click();
      await expect(page.getByLabel('Current Password', { exact: true })).toHaveValue('');
      await page.reload();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.getByRole('button', { name: 'Logout', exact: true })).toBeVisible();
    } finally {
      await secondContext.close();
    }
  });
});
