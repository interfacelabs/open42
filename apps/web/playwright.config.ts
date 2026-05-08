import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the Open42 web app.
 *
 * Most specs are gated behind env vars so they don't fail in dev environments
 * that lack the full backend stack:
 *
 *   E2E_FULL=1     run the happy-path / refresh / invite specs (needs API + Postgres + Supabase)
 *   E2E_VISUAL=1   run the visual regression baselines
 *
 * Default `playwright test` invocation should report 0 specs run, not failures,
 * when neither flag is set.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_NO_WEB_SERVER
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
