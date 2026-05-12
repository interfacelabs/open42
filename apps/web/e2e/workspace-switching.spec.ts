import { test, expect } from '@playwright/test';

import { signInE2E } from './helpers';

/**
 * E2E coverage for Slack-style multi-workspace switching (chunk D7 of the
 * workspace-invite-flow plan).
 *
 * The flow:
 *
 *   1. Sign in fresh, onboard workspace A ("Alpha").
 *   2. Open the workspace switcher, click "Create new workspace" → land on
 *      /auth/onboard?mode=create, name it "Beta", let it provision, redirect
 *      back to /.
 *   3. Current workspace is now Beta (server-side users.current_workspace_id
 *      is Beta; the switcher caption shows Beta).
 *   4. Switch back to Alpha via the switcher — dashboard re-mounts with
 *      Alpha's context.
 *   5. Switch back to Beta — dashboard shows Beta's context.
 *
 * This exercises:
 *   - The mode=create branch of /auth/onboard
 *   - The /workspaces/current honor-the-column behaviour (we wrote the fix
 *     for users that have multiple memberships but a specific current pin)
 *   - useWorkspaceStore.switchTo() + the switcher's redirect
 *
 *   E2E_FULL=1 npx playwright test e2e/workspace-switching.spec.ts
 */
test.describe('Workspace switching: A→B isolation', () => {
  test.skip(
    !process.env.E2E_FULL,
    'requires running API + Postgres + Supabase test hooks (set E2E_FULL=1)',
  );

  test('create A and B, switch between them, and observe per-workspace context', async ({
    page,
  }) => {
    const email = `e2e-switch+${Date.now()}@example.com`;

    // ─── 1. Sign in + onboard workspace Alpha ─────────────────
    await signInE2E(page, email);
    await page.waitForURL('**/auth/onboard**');
    await page.getByLabel(/workspace name/i).fill('Alpha');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForURL('**/auth/onboard?step=invite**');
    await page.getByRole('button', { name: /skip for now/i }).click();
    await page.waitForURL('**/auth/home**', { timeout: 5_000 });

    // The switcher (top of the sidebar) should now render "Alpha".
    await expect(
      page.getByRole('button', { name: /alpha/i }).first(),
    ).toBeVisible();

    // ─── 2. Use the switcher to create workspace Beta ────────
    await page.getByRole('button', { name: /alpha/i }).first().click();
    await page
      .getByRole('menuitem', { name: /create new workspace/i })
      .click();
    await page.waitForURL('**/auth/onboard?mode=create**', { timeout: 5_000 });
    await page.getByLabel(/workspace name/i).fill('Beta');
    await page.getByRole('button', { name: /continue/i }).click();

    // Provisioning settles, the redirect-after-onboarding effect bounces us
    // back to /. The store is now pinned to Beta.
    await page.waitForURL(/\/(auth\/home)?$/, { timeout: 30_000 });
    await expect(
      page.getByRole('button', { name: /beta/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // ─── 3. Switch back to Alpha ─────────────────────────────
    await page.getByRole('button', { name: /beta/i }).first().click();
    await page.getByRole('menuitem', { name: /^alpha$/i }).click();
    await page.waitForURL(/\/(auth\/home)?$/, { timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: /alpha/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Sanity: the settings/members page should now describe Alpha. The
    // current-workspace pin is server-side, so a fresh navigation honours it.
    await page.goto('/auth/settings/members');
    await expect(
      page.getByRole('heading', { name: /^Members$/ }),
    ).toBeVisible();
    // The header strip shows just the owner since we never invited anyone.
    await expect(
      page.getByTestId('members-header-counts'),
    ).toContainText(/1 member\b/i);

    // ─── 4. Switch back to Beta — context isolates ──────────
    await page.getByRole('button', { name: /alpha/i }).first().click();
    await page.getByRole('menuitem', { name: /^beta$/i }).click();
    await page.waitForURL(/\/(auth\/home)?$/, { timeout: 10_000 });
    await expect(
      page.getByRole('button', { name: /beta/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Verify isolation: Members page for Beta. Beta also has 1 member.
    // The key signal is that we can navigate freely and Alpha's name is
    // NOT shown in the header chrome — only Beta's.
    await page.goto('/auth/settings/members');
    await expect(
      page.getByRole('heading', { name: /^Members$/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /beta/i }).first(),
    ).toBeVisible();
    // The switcher button is the only label rendering workspace names —
    // Alpha should not appear anywhere outside the open menu (which we
    // haven't opened here).
    await expect(page.getByText(/^Alpha$/)).toHaveCount(0);
  });

  // Sending a chat in Alpha, switching to Beta, and verifying that Alpha's
  // history does NOT bleed through is a high-value stretch goal — but it
  // depends on a working gbrain container, which our CI E2E job may not
  // bring up. Mark as fixme so the spec is visible without flaking.
  test.fixme(
    'chat history is isolated per workspace',
    async () => {
      // Implementation when CI runs a real gbrain:
      //   1. In Alpha, send a chat: "remember the alpha-secret-token".
      //   2. Switch to Beta.
      //   3. Reload /. The chat surface should show NO history.
      //   4. Send a chat: "what is the alpha-secret-token?".
      //   5. Assert the response does NOT contain "alpha-secret-token".
      //   6. Switch back to Alpha. The chat history should still include
      //      the original message.
    },
  );
});
