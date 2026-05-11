import { test, expect, type Page } from '@playwright/test';

/**
 * Visual regression baselines for the editorial onboarding layer.
 *
 * Each test mocks /api/workspaces/current (and any other state-shaping
 * routes) so we can render every state deterministically without driving
 * the real backend. That keeps these snapshots reproducible across
 * machines and CI runs.
 *
 * Run:
 *
 *   E2E_VISUAL=1 npx playwright test e2e/visual.spec.ts
 *
 * To regenerate baselines after an intentional design change:
 *
 *   E2E_VISUAL=1 npx playwright test e2e/visual.spec.ts --update-snapshots
 *
 * Note on flake: the `motion` library does enter animations even when the
 * browser advertises `prefers-reduced-motion`, and Chromium animates the
 * blinking caret + the shimmer keyframes. `freezePage()` neutralizes all
 * three so two consecutive screenshots converge to the same bytes.
 */
test.describe('Visual baselines — onboarding layer', () => {
  test.skip(
    !process.env.E2E_VISUAL,
    'visual regression: set E2E_VISUAL=1 to run',
  );

  test.use({ viewport: { width: 1280, height: 800 } });

  // ─────────────────────────── helpers ───────────────────────────

  /** Mock /api/workspaces/current with a payload shape. */
  function mockCurrent(page: Page, payload: Record<string, unknown>) {
    return page.route('**/api/workspaces/current', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      }),
    );
  }

  /**
   * Hard-disable carets, transitions, and CSS animations, blur the
   * focused element, hide the Next.js dev-mode build indicator, and
   * wait long enough for any motion.div enter animations to settle.
   * Call right before `toHaveScreenshot`.
   */
  async function freezePage(page: Page) {
    await page.addStyleTag({
      content: `
        *, *::before, *::after {
          caret-color: transparent !important;
          transition-duration: 0s !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
          animation-iteration-count: 1 !important;
        }
        /* Hide the Next.js dev-mode "Compiling..." pip + DevTools floater */
        nextjs-portal,
        [data-next-mark-loading],
        [data-next-badge-root] {
          display: none !important;
          visibility: hidden !important;
        }
      `,
    });
    await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.blur(),
    );
    // One settle frame for motion.div / framer-motion's enter values.
    await page.waitForTimeout(800);
  }

  const READY_WORKSPACE = {
    id: 'ws',
    name: 'Speedrun',
    plan: null,
    status: 'ready',
    runtime: 'ready' as const,
    gbrainReady: true,
    createdAt: new Date('2026-05-08T00:00:00Z').toISOString(),
  };

  // ─────────────────────────── tests ─────────────────────────────

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
  });

  test('/sign_in idle', async ({ page }) => {
    await page.goto('/sign_in');
    await page.getByRole('heading', { name: /A brain/i }).waitFor();
    await freezePage(page);
    await expect(page).toHaveScreenshot('sign_in-idle.png', { fullPage: true });
  });

  test('/sign_in awaiting code', async ({ page }) => {
    await page.route('**/api/auth/signin', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        }),
      }),
    );
    await page.goto('/sign_in');
    await page.getByLabel(/work email/i).fill('a@x.com');
    await page.getByRole('button', { name: /continue/i }).click();
    await page.waitForSelector('[aria-label="digit 1 of 6"]');
    await freezePage(page);
    await expect(page).toHaveScreenshot('sign_in-awaiting-code.png', {
      fullPage: true,
      // Mask the resend-countdown copy: it tick-tocks every second
      // ("Resend in 30s" → "Resend in 29s" → …) and would otherwise
      // make the snapshot non-deterministic across runs.
      mask: [page.locator('button:has-text("Resend")')],
    });
  });

  test('/onboard workspace step', async ({ page }) => {
    await mockCurrent(page, {
      user: { id: 'u', email: 'a@x.com' },
      workspace: null,
      invites: [],
      connections: [],
      lastJob: null,
    });
    await page.goto('/onboard');
    await page.waitForSelector('label[for="workspace-name"]');
    await freezePage(page);
    await expect(page).toHaveScreenshot('onboard-workspace.png', {
      fullPage: true,
    });
  });

  test('/onboard invite step with envelopes', async ({ page }) => {
    await mockCurrent(page, {
      user: { id: 'u', email: 'a@x.com' },
      workspace: READY_WORKSPACE,
      invites: [],
      connections: [],
      lastJob: null,
    });
    await page.goto('/onboard?step=invite');
    await page.waitForSelector('textarea#invite-emails');
    await page
      .locator('textarea#invite-emails')
      .fill('a@x.com\nb@x.com\nc@x.com');
    await freezePage(page);
    await expect(page).toHaveScreenshot('onboard-invite-3.png', {
      fullPage: true,
    });
  });

  test('/ empty', async ({ page }) => {
    await mockCurrent(page, {
      user: { id: 'u', email: 'a@x.com' },
      workspace: READY_WORKSPACE,
      invites: [],
      connections: [],
      lastJob: null,
    });
    await page.goto('/');
    await page.getByRole('heading', { name: /Your brain/i }).waitFor();
    await freezePage(page);
    await expect(page).toHaveScreenshot('home-empty.png', { fullPage: true });
  });

  test('/ ingesting', async ({ page }) => {
    await mockCurrent(page, {
      user: { id: 'u', email: 'a@x.com' },
      workspace: READY_WORKSPACE,
      invites: [],
      connections: [
        {
          id: 'c1',
          kind: 'notion-zip',
          status: 'ingesting',
          displayName: 'export.zip',
        },
      ],
      lastJob: {
        id: 'j1',
        status: 'running',
        pagesTotal: 247,
        pagesIndexed: 84,
        recentPages: [
          'Engineering / Roadmap.md',
          'People / Onboarding.md',
          'Sales / Q2 plan.md',
        ],
        createdAt: new Date('2026-05-08T00:00:00Z').toISOString(),
      },
    });
    await page.goto('/');
    await page.getByRole('heading', { name: /Reading/i }).waitFor();
    await freezePage(page);
    await expect(page).toHaveScreenshot('home-ingesting.png', {
      fullPage: true,
    });
  });

  test('/invite/accept blocked', async ({ page }) => {
    await page.route('**/api/auth/verify', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'invite_blocked' }),
      }),
    );
    await page.goto(
      '/invite/accept?invite_id=inv_1&token_hash=tok&type=invite',
    );
    await page
      .getByRole('heading', { name: /already have/i })
      .waitFor({ timeout: 10_000 });
    await freezePage(page);
    await expect(page).toHaveScreenshot('invite-blocked.png', { fullPage: true });
  });
});
