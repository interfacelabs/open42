import type { Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Test-only helpers. They depend on the API exposing a small set of dev-only
 * routes when NODE_ENV=test (or a similar test mode):
 *
 *   GET /test/otp?email=…           → { code: '123456' }
 *   GET /test/magic-link?email=…    → { url: 'https://…' }
 *   GET /test/invite?email=…        → { url: 'https://…/auth/invite/accept?invite_id=…&token_hash=…&type=invite' }
 *
 * These routes are NOT part of the production surface. The expectation is that
 * the API mounts them only when an env flag is set (e.g. OPEN42_TEST_HOOKS=1)
 * and CI brings up the API with that flag during the E2E job.
 *
 * If those routes aren't wired up yet, the helpers throw with a clear message
 * so the spec author can wire them up before flipping the E2E_FULL gate on.
 */

const apiBase = () => process.env.E2E_API_BASE_URL ?? 'http://localhost:3001';

async function fetchTestEndpoint(
  page: Page,
  pathname: string,
  email: string,
): Promise<Record<string, unknown>> {
  const url = `${apiBase()}${pathname}?email=${encodeURIComponent(email)}`;
  const res = await page.request.get(url);
  if (!res.ok()) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Test hook ${pathname} returned ${res.status()}: ${body || '(empty body)'}\n` +
        `Make sure the API is running with OPEN42_TEST_HOOKS=1 (or your project's equivalent) ` +
        `so /test/* routes are mounted.`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Read the most recent OTP issued to a given email.
 */
export async function readTestOtp(page: Page, email: string): Promise<string> {
  const body = await fetchTestEndpoint(page, '/test/otp', email);
  const code = body.code;
  if (typeof code !== 'string' || code.length !== 6) {
    throw new Error(`Test OTP for ${email} was not a 6-digit string: ${JSON.stringify(body)}`);
  }
  return code;
}

/**
 * Read the most recent magic-link URL issued to a given email.
 */
export async function readTestMagicLink(page: Page, email: string): Promise<string> {
  const body = await fetchTestEndpoint(page, '/test/magic-link', email);
  const url = body.url;
  if (typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error(`Test magic link for ${email} was not a URL: ${JSON.stringify(body)}`);
  }
  return url;
}

/**
 * Read the most recent invite-acceptance URL issued to a given email.
 */
export async function readTestInviteLink(page: Page, email: string): Promise<string> {
  const body = await fetchTestEndpoint(page, '/test/invite', email);
  const url = body.url;
  if (typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error(`Test invite link for ${email} was not a URL: ${JSON.stringify(body)}`);
  }
  return url;
}

/**
 * Drive sign-in from email entry through code verification, ending on
 * /auth/onboard (or wherever the API redirects). Caller should have already
 * navigated to /sign_in or be on a page where the test starts.
 */
export async function signInE2E(page: Page, email: string): Promise<void> {
  await page.goto('/sign_in');
  await page.getByLabel(/work email/i).fill(email);
  await page.getByRole('button', { name: /continue/i }).click();

  // Wait for the code-entry view.
  await page.waitForSelector('[aria-label="digit 1 of 6"]', { timeout: 10_000 });

  const code = await readTestOtp(page, email);
  for (let i = 0; i < 6; i++) {
    await page.getByLabel(new RegExp(`digit ${i + 1} of 6`, 'i')).fill(code.charAt(i));
  }

  // 6th digit auto-submits → land on /auth/onboard or /auth/home depending on state.
  await page.waitForURL(/\/auth\/(onboard|home)/, { timeout: 15_000 });
}

/**
 * Resolve the path to a checked-in fixture, or null if the fixture is missing.
 * Used to gracefully skip the upload portion of the E2E when the fixture has
 * not been provided.
 */
export function fixturePath(name: string): string | null {
  const p = path.resolve(__dirname, 'fixtures', name);
  return existsSync(p) ? p : null;
}
