import { expect, test } from '@playwright/test';

test('signup magic link verifies and lands on brain home with a session cookie', async ({ page, context }) => {
  await page.goto('/signup');
  await page.getByLabel('Email').fill(`e2e-${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Send magic link' }).click();

  const magicLink = page.getByRole('link', { name: /auth\/verify\?token=/ });
  await expect(magicLink).toBeVisible();
  await magicLink.click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: /brain/i })).toBeVisible();
  const cookies = await context.cookies();
  expect(cookies.some((cookie) => cookie.name === 'open42_session' && cookie.httpOnly)).toBe(true);
  expect(cookies.some((cookie) => cookie.name === 'open42_csrf')).toBe(true);
});
