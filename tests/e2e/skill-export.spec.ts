import { expect, test } from '@playwright/test';

test('refund-policy skill page downloads a zip bundle', async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'open42_csrf',
      value: 'csrf-e2e',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.route('**/api/skills/refund-policy', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('csrf-e2e');
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/zip',
      },
      body: Buffer.from('zip-bundle'),
    });
  });

  await page.goto('/skills/refund-policy');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download zip' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('refund-policy-skill.zip');
});
