import { test, expect } from '@playwright/test';

import { fixturePath, readTestOtp } from './helpers';

/**
 * End-to-end coverage for the rewritten /sign_in → /auth/onboard → /auth/home
 * flow.
 *
 * These tests require the full backend stack:
 *
 *   - Postgres reachable from the API (drizzle-managed schema applied)
 *   - Supabase configured (project URL + service role key) with
 *     `redirectTo` allowlist including /auth/invite/accept and /sign_in
 *   - The API running with test hooks enabled so /test/otp,
 *     /test/magic-link, and /test/invite return the codes/links the API
 *     just issued. See e2e/helpers.ts for the contract.
 *   - The web app served from http://localhost:3000 (Playwright spawns
 *     `npm run dev` for you unless E2E_NO_WEB_SERVER=1).
 *
 * Run:
 *
 *   E2E_FULL=1 npx playwright test e2e/auth-onboarding.spec.ts
 *
 * Without E2E_FULL the suite reports as skipped, not failed.
 */
test.describe('Auth + onboarding happy path', () => {
  test.skip(
    !process.env.E2E_FULL,
    'requires running API + Postgres + Supabase test hooks (set E2E_FULL=1)',
  );

  test('full sign-in → onboard → home flow with code', async ({ page }) => {
    const email = `e2e+${Date.now()}@example.com`;

    await page.goto('/sign_in');
    // Idle headline copy from sign_in.tsx
    await expect(page.getByRole('heading', { name: /A brain/i })).toBeVisible();

    await page.getByLabel(/work email/i).fill(email);
    await page.getByRole('button', { name: /continue/i }).click();

    // Code-entry view appears
    await page.waitForSelector('[aria-label="digit 1 of 6"]', { timeout: 10_000 });

    const code = await readTestOtp(page, email);
    for (let i = 0; i < 6; i++) {
      await page.getByLabel(new RegExp(`digit ${i + 1} of 6`, 'i')).fill(code.charAt(i));
    }

    // 6th digit auto-submits
    await page.waitForURL('**/auth/onboard**', { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Name/i })).toBeVisible();

    // Workspace step
    await page.getByLabel(/workspace name/i).fill('Speedrun Labs');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL('**/auth/onboard?step=invite**', { timeout: 5_000 });
    await expect(page.getByRole('heading', { name: /needs this brain/i })).toBeVisible();

    // Invite step — skip
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.waitForURL('**/auth/home**', { timeout: 5_000 });
    await expect(
      page.getByRole('heading', { name: /Your brain/i }),
    ).toBeVisible();

    // Source upload via zip — best-effort. Skips gracefully when the fixture
    // isn't present.
    const zipPath = fixturePath('sample.zip');
    test.skip(
      !zipPath,
      'sample.zip fixture not present (drop one in e2e/fixtures/ to exercise the upload path)',
    );
    await page
      .locator('input[type="file"]')
      .setInputFiles(zipPath as string);
    await expect(page.getByRole('heading', { name: /Reading/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});
