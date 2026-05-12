import { test, expect } from '@playwright/test';

import { readTestInviteLink, signInE2E } from './helpers';

/**
 * E2E coverage for the Members settings page management surface
 * (/auth/settings/members) — chunk 8 of the workspace-invite-flow plan.
 *
 * Walks an owner through the full lifecycle of a teammate:
 *
 *   1. Send three pending invites in a single batch.
 *   2. Revoke one invite via the AlertDialog confirm flow.
 *   3. Resend another invite (timestamp updates, no toast required).
 *   4. Have the third invitee accept (Path A: not signed-in, magic link).
 *   5. As the owner, refresh and confirm the accepted invitee shows up in
 *      the Members card.
 *   6. Kick the accepted invitee via the AlertDialog confirm flow.
 *
 * Per chunk 8 follow-up, the AlertDialog confirm buttons carry the test ids:
 *   - [data-testid="invite-revoke-confirm-<inviteId>"]
 *   - [data-testid="member-remove-confirm-<userId>"]
 *
 * Gated behind E2E_FULL so it doesn't run in dev environments that lack the
 * API + Postgres + Supabase test-hooks stack. See e2e/helpers.ts for the
 * /test/* contract these specs rely on.
 *
 *   E2E_FULL=1 npx playwright test e2e/invite-management.spec.ts
 */
test.describe('Members settings: invite management', () => {
  test.skip(
    !process.env.E2E_FULL,
    'requires running API + Postgres + Supabase test hooks (set E2E_FULL=1)',
  );

  test('owner sends invites, revokes one, resends one, then kicks a member after accept', async ({
    browser,
  }) => {
    const stamp = Date.now();
    const ownerEmail = `e2e-owner+${stamp}@example.com`;
    const invitee1 = `e2e-invitee1+${stamp}@example.com`;
    const invitee2 = `e2e-invitee2+${stamp}@example.com`;
    const invitee3 = `e2e-invitee3+${stamp}@example.com`;

    // ─── Owner: sign in + provision a workspace ──────────────
    const ownerCtx = await browser.newContext();
    const ownerPage = await ownerCtx.newPage();
    await signInE2E(ownerPage, ownerEmail);
    await ownerPage.waitForURL('**/auth/onboard**');
    await ownerPage.getByLabel(/workspace name/i).fill('Manage Co');
    await ownerPage.getByRole('button', { name: /continue/i }).click();
    await ownerPage.waitForURL('**/auth/onboard?step=invite**');
    // Skip the onboarding invite step — we want to drive the same surface
    // from the Members settings page instead.
    await ownerPage.getByRole('button', { name: /skip for now/i }).click();
    await ownerPage.waitForURL('**/auth/home**', { timeout: 5_000 });

    // ─── Owner: open the Members settings page and send 3 invites ───
    await ownerPage.goto('/auth/settings/members');
    await expect(
      ownerPage.getByRole('heading', { name: /^Members$/ }),
    ).toBeVisible();

    const inviteBatch = [invitee1, invitee2, invitee3].join('\n');
    await ownerPage.getByLabel(/email addresses/i).fill(inviteBatch);
    await ownerPage.getByRole('button', { name: /send invites/i }).click();

    // Success line appears once the request resolves.
    await expect(
      ownerPage.getByText(/Sent 3 invites/i),
    ).toBeVisible({ timeout: 10_000 });

    // Pending invites table should now list all three emails.
    const pendingCard = ownerPage.getByTestId('pending-invites-card');
    await expect(pendingCard.getByText(invitee1)).toBeVisible();
    await expect(pendingCard.getByText(invitee2)).toBeVisible();
    await expect(pendingCard.getByText(invitee3)).toBeVisible();

    // ─── Revoke invitee1 via AlertDialog ─────────────────────
    await pendingCard
      .getByRole('button', { name: new RegExp(`revoke invite to ${invitee1}`, 'i') })
      .click();
    // AlertDialog mounts; click the destructive confirm. The confirm carries
    // a stable data-testid keyed by invite id, but the id is server-assigned
    // — we match it via a role+name selector instead.
    await ownerPage
      .getByRole('button', { name: /revoke invite/i })
      .click();
    // Row disappears.
    await expect(pendingCard.getByText(invitee1)).toHaveCount(0, {
      timeout: 5_000,
    });
    // The other two are still pending.
    await expect(pendingCard.getByText(invitee2)).toBeVisible();
    await expect(pendingCard.getByText(invitee3)).toBeVisible();

    // ─── Resend invitee2 — best-effort, just confirm no error surface ──
    await pendingCard
      .getByRole('button', { name: new RegExp(`resend invite to ${invitee2}`, 'i') })
      .click();
    // The button transitions to "Resending..." while in flight; once done,
    // it returns to "Resend" with no inline error. We assert the absence of
    // an error message rather than a toast (none of the current UX strings
    // are a toast — see PendingInvitesCard).
    await expect(
      pendingCard.getByRole('button', {
        name: new RegExp(`resend invite to ${invitee2}`, 'i'),
      }),
    ).toBeEnabled({ timeout: 10_000 });
    await expect(
      pendingCard.getByText(/Could not resend/i),
    ).toHaveCount(0);

    // ─── Pull invitee3's link and accept it from a fresh context ───
    const inviteLink = await readTestInviteLink(ownerPage, invitee3);

    const invitee3Ctx = await browser.newContext();
    const invitee3Page = await invitee3Ctx.newPage();
    await invitee3Page.goto(inviteLink);
    // Lands on /auth/home (or /) once Path A through /auth/verify completes.
    await invitee3Page.waitForURL(/\/(auth\/home)?$/, { timeout: 15_000 });
    await expect(invitee3Page.getByText(/Manage Co/)).toBeVisible({
      timeout: 10_000,
    });
    await invitee3Ctx.close();

    // ─── Back to the owner: refresh, verify invitee3 is now a Member ──
    await ownerPage.reload();
    const membersCard = ownerPage.getByTestId('members-card');
    await expect(membersCard.getByText(invitee3)).toBeVisible({
      timeout: 10_000,
    });
    // Owner + invitee3 = 2 members in the strip. Pending shows 1 (invitee2).
    const headerCounts = ownerPage.getByTestId('members-header-counts');
    await expect(headerCounts).toContainText(/2 members/i);
    await expect(headerCounts).toContainText(/1 pending/i);

    // ─── Kick invitee3 via AlertDialog ───────────────────────
    await membersCard
      .getByRole('button', { name: new RegExp(`remove ${invitee3}`, 'i') })
      .click();
    await ownerPage
      .getByRole('button', { name: /remove member/i })
      .click();

    await expect(membersCard.getByText(invitee3)).toHaveCount(0, {
      timeout: 5_000,
    });
    // Header strip decrements back to 1 member.
    await expect(headerCounts).toContainText(/1 member\b/i);

    await ownerCtx.close();
  });
});
