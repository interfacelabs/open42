import { test, expect } from '@playwright/test';

import { signInE2E } from './helpers';

/**
 * E2E coverage for cross-tenant access guards (chunk 9 of the
 * workspace-invite-flow plan).
 *
 * Two complementary tests:
 *
 *   1. API-level: user B authenticates, then POSTs to /api/chat with the
 *      workspace_id of user A's workspace. The requireMembership middleware
 *      blocks with 403.
 *
 *   2. UI-level: user B has their workspace store cookie pointed at a
 *      workspace they are NOT a member of. Hitting /auth/settings/members
 *      should render the AccessDenied empty state AND kick off the
 *      recoverFromTenant403 flow (switch into another workspace they own,
 *      or bounce to /auth/onboard if they have none).
 *
 *   E2E_FULL=1 npx playwright test e2e/cross-tenant-access.spec.ts
 */
test.describe('Cross-tenant access guards', () => {
  test.skip(
    !process.env.E2E_FULL,
    'requires running API + Postgres + Supabase test hooks (set E2E_FULL=1)',
  );

  test('API-level: non-member POST /chat against another workspace returns 403', async ({
    browser,
  }) => {
    const stamp = Date.now();
    const aEmail = `e2e-tenant-a+${stamp}@example.com`;
    const bEmail = `e2e-tenant-b+${stamp}@example.com`;

    // ─── User A: sign in, onboard, capture their workspace id ──
    const aCtx = await browser.newContext();
    const aPage = await aCtx.newPage();
    await signInE2E(aPage, aEmail);
    await aPage.waitForURL('**/auth/onboard**');
    await aPage.getByLabel(/workspace name/i).fill('Tenant Alpha');
    await aPage.getByRole('button', { name: /continue/i }).click();
    await aPage.waitForURL('**/auth/onboard?step=invite**');
    await aPage.getByRole('button', { name: /skip for now/i }).click();
    await aPage.waitForURL('**/auth/home**', { timeout: 5_000 });

    // The /workspaces/current endpoint returns the workspace id. Use the
    // page's request context (cookies attached) to fetch it.
    const aCurrentRes = await aPage.request.get('/api/workspaces/current');
    expect(aCurrentRes.ok()).toBe(true);
    const aBody = (await aCurrentRes.json()) as {
      workspace?: { id?: string };
    };
    const aWorkspaceId = aBody.workspace?.id;
    expect(aWorkspaceId).toBeTruthy();
    await aCtx.close();

    // ─── User B: separate context, sign in, onboard their own ws ──
    const bCtx = await browser.newContext();
    const bPage = await bCtx.newPage();
    await signInE2E(bPage, bEmail);
    await bPage.waitForURL('**/auth/onboard**');
    await bPage.getByLabel(/workspace name/i).fill('Tenant Beta');
    await bPage.getByRole('button', { name: /continue/i }).click();
    await bPage.waitForURL('**/auth/onboard?step=invite**');
    await bPage.getByRole('button', { name: /skip for now/i }).click();
    await bPage.waitForURL('**/auth/home**', { timeout: 5_000 });

    // ─── B POSTs /chat against A's workspace → expect 403 ────
    //
    // The chat route is mounted as `chatRouter.post('/', requireMembership({
    // from: 'body' }), ...)`. requireMembership pulls workspace_id from the
    // request body, looks up the session user's membership, and returns 403
    // with an error code when there is no row.
    //
    // Use the page's request context so the session cookie travels with the
    // call. Same-origin /api/* is proxied to the API in dev — the request
    // helper uses the same base URL.
    const chatRes = await bPage.request.post('/api/chat', {
      data: {
        workspace_id: aWorkspaceId,
        query: 'hi',
      },
    });

    expect(chatRes.status()).toBe(403);
    // The error body should carry a stable error code (the API uses
    // `not_a_member` or similar — we accept either to avoid coupling to one
    // exact string before chunk-9 lands the canonical name).
    const errBody = (await chatRes.json().catch(() => ({}))) as {
      error?: string;
    };
    expect(errBody.error).toMatch(/not_a_member|forbidden|membership/i);

    await bCtx.close();
  });

  // The UI flow for "store points at someone else's workspace" needs either
  // a /test hook that flips users.current_workspace_id directly, or a
  // race-condition contrivance (B is kicked from a shared workspace while
  // they're on /members). The cleanest construction is a test hook; until
  // that ships, mark this fixme so the spec is visible but doesn't run.
  test.fixme(
    'UI: visiting a workspace the user is not a member of shows access-denied state',
    async () => {
      // Implementation outline once a /test hook to seed cross-tenant state
      // is available:
      //
      //   1. Owner A signs in, onboards workspace A.
      //   2. Invite B; B accepts (via Path A magic link).
      //   3. Owner A kicks B from /auth/settings/members.
      //   4. As B (still signed in, store currentWorkspaceId pinned to A in
      //      their cookie), navigate to /auth/settings/members.
      //   5. The page calls /api/workspaces/:id/members, which 403s.
      //   6. Assert the AccessDenied component renders (look for the
      //      "no longer have access" copy).
      //   7. recoverFromTenant403 kicks in — either we land on /auth/onboard
      //      (B has no other workspaces) or on / (B switched into another).
      //
      // The wrinkle: kicking B should ALSO invalidate their currentWorkspaceId
      // server-side, in which case /workspaces/current may already redirect
      // them. The 403 path is only observable if B has the page open at the
      // moment they're kicked OR if their cookie carries a stale id — both
      // are hard to reproduce deterministically without a hook.
    },
  );
});
