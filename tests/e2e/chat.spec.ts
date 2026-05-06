import { expect, test } from '@playwright/test';

test('empty brain query shows an honest empty answer', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({ type: 'citations', citations: [] }) +
        '\n' +
        JSON.stringify({
          type: 'token',
          text: "I don't have anything about this in your brain.",
        }) +
        '\n' +
        JSON.stringify({ type: 'done' }) +
        '\n',
    });
  });

  await page.goto('/chat');
  await page.getByPlaceholder('Ask the brain').fill('What is the refund policy?');
  await page.getByRole('button', { name: 'Ask' }).click();

  await expect(page.getByText("I don't have anything about this in your brain.")).toBeVisible();
});

test('query renders inline citations and opens detail pane', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          type: 'citations',
          citations: [
            {
              index: 1,
              slug: 'refund-policy-2024',
              version_id: 7,
              last_updated: '2026-04-02T00:00:00.000Z',
              excerpt: 'Enterprise customers can request refunds within 90 days.',
            },
          ],
        }) +
        '\n' +
        JSON.stringify({
          type: 'token',
          text: 'Enterprise refunds are available within 90 days [1].',
        }) +
        '\n' +
        JSON.stringify({ type: 'done' }) +
        '\n',
    });
  });

  await page.goto('/chat');
  await page.getByPlaceholder('Ask the brain').fill('What is our enterprise refund policy?');
  await page.getByRole('button', { name: 'Ask' }).click();

  await expect(page.getByText('Enterprise refunds are available within 90 days')).toBeVisible();
  await page.getByRole('button', { name: '[1]' }).click();
  await expect(page.getByRole('heading', { name: 'refund-policy-2024' })).toBeVisible();
  await expect(page.getByText('Enterprise customers can request refunds within 90 days.')).toBeVisible();
});
