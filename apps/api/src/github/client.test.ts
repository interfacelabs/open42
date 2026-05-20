import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { GitHubAppClient } from './client.js';

describe('GitHubAppClient', () => {
  it('uses explicit app config before environment config', () => {
    const client = new GitHubAppClient({
      appId: '123',
      appSlug: 'open42-local',
      privateKey: 'unused',
    });

    expect(client.isConfigured()).toBe(true);
    expect(client.installUrl('state-a')).toBe(
      'https://github.com/apps/open42-local/installations/new?state=state-a',
    );
  });

  it('reads installation repository selection from the app installation endpoint', async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
      const [url, init] = args;
      expect(url).toBe('https://api.github.test/app/installations/123');
      const headers = init?.headers as Headers;
      expect(headers.get('Authorization')).toMatch(/^Bearer /);
      return new Response(
        JSON.stringify({
          id: 123,
          repository_selection: 'selected',
          html_url: 'https://github.com/organizations/acme/settings/installations/123',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    const client = new GitHubAppClient({
      appId: '123',
      appSlug: 'open42-local',
      privateKey: createTestPrivateKey(),
      apiBaseUrl: 'https://api.github.test',
      fetch: fetchMock as typeof fetch,
    });

    await expect(client.getInstallation('123')).resolves.toEqual({
      id: 123,
      repositorySelection: 'selected',
      htmlUrl: 'https://github.com/organizations/acme/settings/installations/123',
    });
  });
});

function createTestPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}
