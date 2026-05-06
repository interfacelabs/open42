import { expect, test } from '@playwright/test';

test('signup magic link verifies and lands on brain home with a session cookie', async ({ page, context }) => {
  await page.route('**/api/auth/signup', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        delivery: 'supabase_email',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
    });
  });
  await page.route('**/api/auth/verify', async (route) => {
    expect(await route.request().postDataJSON()).toEqual({ accessToken: 'e2e-token' });
    await context.addCookies([
      {
        name: 'open42_csrf',
        value: 'csrf-e2e',
        domain: 'localhost',
        path: '/',
      },
    ]);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'set-cookie': 'open42_session=session-e2e; Path=/; HttpOnly; SameSite=Lax',
      },
      body: JSON.stringify({ ok: true, redirectTo: '/home' }),
    });
  });

  await page.goto('/signup');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Send magic link' }).click();
  await expect(page.getByText('Check your email.')).toBeVisible();

  await page.goto('/auth/verify#access_token=e2e-token');

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: /brain/i })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === 'open42_session' && cookie.httpOnly)).toBe(true);
  expect(cookies.some((cookie) => cookie.name === 'open42_csrf')).toBe(true);
});
