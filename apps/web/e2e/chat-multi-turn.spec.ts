import { expect, test } from '@playwright/test';

test.describe('chat multi-turn request shape', () => {
  test('sends prior user and assistant turns with the second chat request', async ({ page }) => {
    const requests: Array<Record<string, unknown>> = [];

    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'u1', currentWorkspaceId: 'ws1' }),
      }),
    );
    await page.route('**/api/workspaces', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          allowMultiWorkspace: true,
          workspaces: [{ id: 'ws1', name: 'Acme Corp', role: 'owner', status: 'ready' }],
        }),
      }),
    );
    await page.route('**/api/workspaces/current', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workspace: { id: 'ws1', name: 'Acme Corp' },
          connections: [{ id: 'c1', kind: 'notion-zip', status: 'active' }],
        }),
      }),
    );
    await page.route('**/api/chat', async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      requests.push(body);
      const answer =
        requests.length === 1
          ? 'Annual customers have 30 days [1].'
          : 'Monthly customers have 14 days [1].';
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson',
        body: [
          JSON.stringify({
            type: 'citations',
            citations: [
              {
                index: 1,
                slug: 'refund-policy',
                version_id: 3,
                last_updated: '2026-05-17',
                excerpt: 'Refund windows by plan.',
              },
            ],
          }),
          JSON.stringify({ type: 'token', text: answer }),
          JSON.stringify({ type: 'done' }),
          '',
        ].join('\n'),
      });
    });

    await page.goto('/chat');
    const composer = page.getByPlaceholder(/ask the brain/i);
    await composer.fill('What is the refund window for annual customers?');
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page.getByText(/Annual customers have 30 days/)).toBeVisible();

    await composer.fill('What about monthly customers?');
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page.getByText(/Monthly customers have 14 days/)).toBeVisible();

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      query: 'What about monthly customers?',
      workspace_id: 'ws1',
      messages: [
        {
          role: 'user',
          text: 'What is the refund window for annual customers?',
        },
        {
          role: 'assistant',
          text: 'Annual customers have 30 days [1].',
        },
      ],
    });
  });
});
