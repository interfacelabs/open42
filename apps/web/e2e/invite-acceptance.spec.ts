import { test, expect } from '@playwright/test';

import { readTestInviteLink, signInE2E } from './helpers';

/**
 * E2E coverage for the invite-acceptance flow.
 *
 * Two scenarios:
 *
 * 1. Happy path: USER_A creates a workspace and invites USER_B's email.
 *    USER_B (in a separate browser context, no shared cookies) clicks the
 *    invite link, lands on /auth/invite/accept, and is redirected to
 *    /auth/home as a member of USER_A's workspace.
 *
 * 2. Blocked: USER_C already has their own workspace. They click the invite
 *    link and see the "You already have a brain" page (P1: one workspace per
 *    account).
 *
 * Same setup gate as the other E2E specs — needs the API running with test
 * hooks enabled.
 *
 *   E2E_FULL=1 npx playwright test e2e/invite-acceptance.spec.ts
 */
test.describe('Invite acceptance', () => {
  test.skip(
    !process.env.E2E_FULL,
    'requires running API + Postgres + Supabase test hooks (set E2E_FULL=1)',
  );

  test('happy path: invitee joins inviter\u2019s workspace', async ({ browser }) => {
    const stamp = Date.now();
    const inviterEmail = `e2e-inviter+${stamp}@example.com`;
    const inviteeEmail = `e2e-invitee+${stamp}@example.com`;

    // ─── Inviter context ─────────────────────────────────────
    const inviterCtx = await browser.newContext();
    const inviterPage = await inviterCtx.newPage();

    await signInE2E(inviterPage, inviterEmail);
    await inviterPage.waitForURL('**/auth/onboard**');

    // Workspace step
    await inviterPage.getByLabel(/workspace name/i).fill('Inviter Co');
    await inviterPage.getByRole('button', { name: /continue/i }).click();
    await inviterPage.waitForURL('**/auth/onboard?step=invite**');

    // Invite step — add the invitee email and submit
    await inviterPage.getByLabel(/email addresses/i).fill(inviteeEmail);
    await inviterPage
      .getByRole('button', { name: /send invites/i })
      .click();
    await inviterPage.waitForURL('**/auth/home**', { timeout: 15_000 });

    // Read the invite link from the API test hook
    const inviteLink = await readTestInviteLink(inviterPage, inviteeEmail);
    await inviterCtx.close();

    // ─── Invitee context (fresh, no shared cookies) ──────────
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();

    await inviteePage.goto(inviteLink);
    // /auth/invite/accept verifies, then redirects to /auth/home
    await inviteePage.waitForURL('**/auth/home**', { timeout: 15_000 });
    // The workspace name should appear in the topbar / sidebar pill
    await expect(inviteePage.getByText(/Inviter Co/)).toBeVisible();

    // Idempotency: re-opening the same link should still land on /auth/home
    // (already-accepted invites should be a no-op redirect, not an error).
    await inviteePage.goto(inviteLink);
    await inviteePage.waitForURL('**/auth/home**', { timeout: 15_000 });

    await inviteeCtx.close();
  });

  test('blocked: invitee with their own workspace sees the blocked page', async ({
    browser,
  }) => {
    const stamp = Date.now();
    const inviterEmail = `e2e-inviter2+${stamp}@example.com`;
    const inviteeEmail = `e2e-invitee2+${stamp}@example.com`;

    // ─── Inviter creates workspace + invites ─────────────────
    const inviterCtx = await browser.newContext();
    const inviterPage = await inviterCtx.newPage();
    await signInE2E(inviterPage, inviterEmail);
    await inviterPage.waitForURL('**/auth/onboard**');
    await inviterPage.getByLabel(/workspace name/i).fill('Inviter Co');
    await inviterPage.getByRole('button', { name: /continue/i }).click();
    await inviterPage.waitForURL('**/auth/onboard?step=invite**');
    await inviterPage.getByLabel(/email addresses/i).fill(inviteeEmail);
    await inviterPage
      .getByRole('button', { name: /send invites/i })
      .click();
    await inviterPage.waitForURL('**/auth/home**', { timeout: 15_000 });
    const inviteLink = await readTestInviteLink(inviterPage, inviteeEmail);
    await inviterCtx.close();

    // ─── Invitee creates their OWN workspace first ───────────
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();
    await signInE2E(inviteePage, inviteeEmail);
    await inviteePage.waitForURL('**/auth/onboard**');
    await inviteePage.getByLabel(/workspace name/i).fill('Invitee Solo');
    await inviteePage.getByRole('button', { name: /continue/i }).click();
    await inviteePage.waitForURL('**/auth/onboard?step=invite**');
    await inviteePage
      .getByRole('button', { name: /skip for now/i })
      .click();
    await inviteePage.waitForURL('**/auth/home**', { timeout: 5_000 });

    // Now they click the invite link from the OTHER workspace
    await inviteePage.goto(inviteLink);
    // Should land on /auth/invite/accept and show the blocked page
    await expect(
      inviteePage.getByRole('heading', { name: /already have/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      inviteePage.getByText(/one workspace per account/i),
    ).toBeVisible();

    await inviteeCtx.close();
  });
});
