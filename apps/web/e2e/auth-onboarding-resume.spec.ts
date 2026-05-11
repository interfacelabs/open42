import { test, expect } from '@playwright/test';

import { readTestMagicLink, signInE2E } from './helpers';

/**
 * Resume + alternate-path coverage for the rewritten auth flow.
 *
 * - Refresh at each onboarding step lands the user back on the right step
 *   (server-side state is the source of truth; the client does not persist
 *   draft state in P1).
 * - The magic-link fallback (visiting /sign_in?token_hash=… or the Supabase
 *   #access_token=… hash) auto-verifies and redirects without ever showing
 *   the 6-digit code UI.
 *
 * Same gating + setup as auth-onboarding.spec.ts — see that file's header.
 *
 *   E2E_FULL=1 npx playwright test e2e/auth-onboarding-resume.spec.ts
 */
test.describe('Auth + onboarding resilience', () => {
  test.skip(
    !process.env.E2E_FULL,
    'requires running API + Postgres + Supabase test hooks (set E2E_FULL=1)',
  );

  test('refresh-at-each-step resumes correctly', async ({ page }) => {
    const email = `e2e-resume+${Date.now()}@example.com`;
    await signInE2E(page, email);

    // After sign-in, derive should land us on /onboard?step=workspace
    await page.waitForURL('**/onboard**');
    await expect(page.getByRole('heading', { name: /Name/i })).toBeVisible();

    // Type a partial name, refresh — should still be on workspace step,
    // server has not yet seen the name so the input is empty (no draft
    // persistence in P1).
    await page.getByLabel(/workspace name/i).fill('Resume Co (draft)');
    await page.reload();
    await expect(page.getByRole('heading', { name: /Name/i })).toBeVisible();
    await expect(page.getByLabel(/workspace name/i)).toHaveValue('');

    // Now actually submit, advance to invite
    await page.getByLabel(/workspace name/i).fill('Resume Co');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL('**/onboard?step=invite**');

    // Reload at invite step — should still be on invite, with workspace
    // name preserved server-side and shown in the topbar pill.
    await page.reload();
    await expect(page.getByRole('heading', { name: /needs this brain/i })).toBeVisible();
    await expect(page.getByText(/Resume Co/)).toBeVisible();
  });

  test('magic-link fallback path: visiting the link verifies + redirects', async ({
    page,
  }) => {
    const email = `e2e-magic+${Date.now()}@example.com`;
    await page.goto('/sign_in');
    await page.getByLabel(/work email/i).fill(email);
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForSelector('[aria-label="digit 1 of 6"]', { timeout: 10_000 });

    const link = await readTestMagicLink(page, email);
    // Visit the link directly. /sign_in handles ?token_hash=… in its
    // verification effect and redirects.
    await page.goto(link);
    await page.waitForURL(/\/auth\/(onboard|home)/, { timeout: 15_000 });
  });
});
