import { expect, test } from '@playwright/test';

test('notion zip import creates a connection and enters ingesting state', async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'open42_csrf',
      value: 'csrf-e2e',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.route('**/api/connections', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        workspaceId: 'workspace-42',
        connections: [{ id: 'conn-42', kind: 'notion-zip', status: 'pending_import' }],
      }),
    });
  });
  await page.route('**/api/connections/notion-zip', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().headers()['x-csrf-token']).toBe('csrf-e2e');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, connectionId: 'conn-42' }),
    });
  });
  await page.route('**/api/workspaces/workspace-42/ingest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ lastJob: { status: 'running', pagesTotal: 0 } }),
    });
  });

  await page.goto('/onboard');
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'notion.zip', mimeType: 'application/zip', buffer: Buffer.from('zip') });

  await expect(page).toHaveURL(/\/onboard\?step=ingesting/);
  await expect(page.getByText('running')).toBeVisible();
});

test('notion live OAuth redirects through Composio', async ({ context, page }) => {
  await context.addCookies([
    {
      name: 'open42_csrf',
      value: 'csrf-e2e',
      domain: 'localhost',
      path: '/',
    },
  ]);
  await page.route('**/api/connections', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ workspaceId: 'workspace-42', connections: [] }),
    });
  });
  await page.route('**/api/connections/init', async (route) => {
    expect(route.request().method()).toBe('POST');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ redirect_url: 'https://composio.fake/oauth?state=fake' }),
    });
  });

  await page.goto('/onboard');
  await page.getByRole('button', { name: /Connect Notion live/ }).click();
  await expect(page).toHaveURL('https://composio.fake/oauth?state=fake');
});
