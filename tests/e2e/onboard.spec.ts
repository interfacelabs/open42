import { expect, test } from '@playwright/test';

test('notion zip import submits a gbrain sync job and shows progress', async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'open42_csrf',
      value: 'csrf-e2e',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.route('http://localhost:3001/connectors/notion-zip', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('csrf-e2e');
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({ jobId: 'job-42', pagesTotal: 4 }),
    });
  });
  await page.route('**/api/connectors/notion-zip/jobs/job-42', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'completed', pagesProcessed: 4, pagesTotal: 4 }),
    });
  });

  await page.goto('/onboard');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'notion.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') });

  await expect(page.getByText('completed')).toBeVisible();
  await expect(page.getByText('100%')).toBeVisible();
});
