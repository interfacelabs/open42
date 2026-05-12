import { test, expect } from '@playwright/test';

import { readTestInviteLink, signInE2E } from './helpers';

/**
 * E2E coverage for the invite-acceptance flow.
 *
 * Two scenarios:
 *
 * 1. Happy path: USER_A creates a workspace and invites USER_B's email.
 *    USER_B (in a separate browser context, no shared cookies) clicks the
 *    invite link, lands on /invite/accept, and is redirected to
 *    / as a member of USER_A's workspace.
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
    await inviterPage.waitForURL('**/onboard**');

    // Workspace step
    await inviterPage.getByLabel(/workspace name/i).fill('Inviter Co');
    await inviterPage.getByRole('button', { name: /continue/i }).click();
    await inviterPage.waitForURL('**/onboard?step=invite**');

    // Invite step — add the invitee email and submit
    await inviterPage.getByLabel(/email addresses/i).fill(inviteeEmail);
    await inviterPage
      .getByRole('button', { name: /send invites/i })
      .click();
    await inviterPage.waitForURL('**/**', { timeout: 15_000 });

    // Read the invite link from the API test hook
    const inviteLink = await readTestInviteLink(inviterPage, inviteeEmail);
    await inviterCtx.close();

    // ─── Invitee context (fresh, no shared cookies) ──────────
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();

    await inviteePage.goto(inviteLink);
    // /invite/accept verifies, then redirects to /
    await inviteePage.waitForURL('**/**', { timeout: 15_000 });
    // The workspace name should appear in the topbar / sidebar pill
    await expect(inviteePage.getByText(/Inviter Co/)).toBeVisible();

    // Idempotency: re-opening the same link should still land on /
    // (already-accepted invites should be a no-op redirect, not an error).
    await inviteePage.goto(inviteLink);
    await inviteePage.waitForURL('**/**', { timeout: 15_000 });

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
    await inviterPage.waitForURL('**/onboard**');
    await inviterPage.getByLabel(/workspace name/i).fill('Inviter Co');
    await inviterPage.getByRole('button', { name: /continue/i }).click();
    await inviterPage.waitForURL('**/onboard?step=invite**');
    await inviterPage.getByLabel(/email addresses/i).fill(inviteeEmail);
    await inviterPage
      .getByRole('button', { name: /send invites/i })
      .click();
    await inviterPage.waitForURL('**/**', { timeout: 15_000 });
    const inviteLink = await readTestInviteLink(inviterPage, inviteeEmail);
    await inviterCtx.close();

    // ─── Invitee creates their OWN workspace first ───────────
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();
    await signInE2E(inviteePage, inviteeEmail);
    await inviteePage.waitForURL('**/onboard**');
    await inviteePage.getByLabel(/workspace name/i).fill('Invitee Solo');
    await inviteePage.getByRole('button', { name: /continue/i }).click();
    await inviteePage.waitForURL('**/onboard?step=invite**');
    await inviteePage
      .getByRole('button', { name: /skip for now/i })
      .click();
    await inviteePage.waitForURL('**/**', { timeout: 5_000 });

    // Now they click the invite link from the OTHER workspace
    await inviteePage.goto(inviteLink);
    // Should land on /invite/accept and show the blocked page
    await expect(
      inviteePage.getByRole('heading', { name: /already have/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      inviteePage.getByText(/one workspace per account/i),
    ).toBeVisible();

    await inviteeCtx.close();
  });

  test('B1: signed-in user accepts via the one-click fast path', async ({
    browser,
  }) => {
    // B1 == invitee is already authenticated when they land on
    // /auth/invite/accept. The accept-flow page detects the live session via
    // GET /auth/me, POSTs /workspaces/invites/:id/accept optimistically,
    // refreshes the workspace store, and redirects to /. The dashboard then
    // mounts already pointed at the inviter's workspace.
    //
    // This is distinct from the "happy path" test above, which exercises B3
    // (no session — Path A through /auth/verify with the magic-link token).
    const stamp = Date.now();
    const inviterEmail = `e2e-inviter-b1+${stamp}@example.com`;
    const inviteeEmail = `e2e-invitee-b1+${stamp}@example.com`;

    // ─── Inviter creates workspace + invites invitee ─────────
    const inviterCtx = await browser.newContext();
    const inviterPage = await inviterCtx.newPage();
    await signInE2E(inviterPage, inviterEmail);
    await inviterPage.waitForURL('**/auth/onboard**');
    await inviterPage.getByLabel(/workspace name/i).fill('Fast Path Co');
    await inviterPage.getByRole('button', { name: /continue/i }).click();
    await inviterPage.waitForURL('**/auth/onboard?step=invite**');
    await inviterPage.getByLabel(/email addresses/i).fill(inviteeEmail);
    await inviterPage
      .getByRole('button', { name: /send invites/i })
      .click();
    await inviterPage.waitForURL('**/auth/home**', { timeout: 15_000 });
    const inviteLink = await readTestInviteLink(inviterPage, inviteeEmail);
    await inviterCtx.close();

    // ─── Invitee signs in to a fresh account FIRST ───────────
    //
    // Sign-in via Path A is unrelated to invite acceptance. We then send the
    // invitee through the onboarding "skip" path so they end up on /auth/home
    // with NO workspace of their own — exercising the B1 branch where the
    // user has a session but is not blocked by the P1 "one workspace per
    // account" rule.
    //
    // NOTE: if /auth/onboard mandates picking a workspace name (no "skip
    // account creation"), the invitee will end up owning their own workspace
    // and the accept-flow page should detect the email match and join them
    // into the inviter's workspace as an additional membership. Today we
    // support that via the workspace switcher (Slack-style multi-workspace).
    const inviteeCtx = await browser.newContext();
    const inviteePage = await inviteeCtx.newPage();
    await signInE2E(inviteePage, inviteeEmail);
    await inviteePage.waitForURL('**/auth/onboard**');
    await inviteePage.getByLabel(/workspace name/i).fill('Solo Brain');
    await inviteePage.getByRole('button', { name: /continue/i }).click();
    await inviteePage.waitForURL('**/auth/onboard?step=invite**');
    await inviteePage
      .getByRole('button', { name: /skip for now/i })
      .click();
    await inviteePage.waitForURL('**/auth/home**', { timeout: 5_000 });

    // ─── Invitee clicks the invite link while already signed-in ──
    //
    // The accept-flow page reads /auth/me, sees a live session, POSTs
    // /workspaces/invites/:id/accept, then refresh+switch the store onto the
    // inviter's workspace and redirect to /. We expect to land on /, NOT on
    // the /sign_in fallback, and NOT on the mismatch state.
    await inviteePage.goto(inviteLink);

    // Either the page renders a brief "Join workspace Fast Path Co?" confirm
    // card and the user clicks it, OR the implementation POSTs optimistically
    // and lands on / directly. The current implementation in
    // apps/web/pages/auth/invite/accept-flow.ts takes the optimistic path —
    // assert that.
    await inviteePage.waitForURL(/\/(auth\/home)?$/, { timeout: 15_000 });

    // Dashboard should now be in the inviter's workspace. The dashboard
    // hero/ingesting shell prints the workspace name in the top-left
    // "open42 · <name>" badge.
    await expect(inviteePage.getByText(/Fast Path Co/)).toBeVisible({
      timeout: 10_000,
    });

    // The workspace switcher should now list BOTH workspaces. Open the
    // switcher and verify both names show up.
    await inviteePage
      .getByRole('button', { name: /fast path co/i })
      .first()
      .click();
    await expect(
      inviteePage.getByRole('menuitem', { name: /fast path co/i }),
    ).toBeVisible();
    await expect(
      inviteePage.getByRole('menuitem', { name: /solo brain/i }),
    ).toBeVisible();

    await inviteeCtx.close();
  });
});
