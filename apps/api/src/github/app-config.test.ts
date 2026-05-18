import { describe, expect, it, vi } from 'vitest';

import { buildGitHubAppManifestUrl, convertGitHubAppManifestCode } from './app-config.js';

describe('github app config helpers', () => {
  it('builds a least-privilege self-host GitHub App manifest URL', () => {
    const url = new URL(
      buildGitHubAppManifestUrl({
        workspaceId: 'workspace-1',
        state: 'state-a',
        nameSeed: 'abc12345',
      }),
    );
    const manifest = JSON.parse(url.searchParams.get('manifest') ?? '{}') as Record<
      string,
      unknown
    >;

    expect(url.origin).toBe('https://github.com');
    expect(url.pathname).toBe('/settings/apps/new');
    expect(url.searchParams.get('state')).toBe('state-a');
    expect(manifest).toMatchObject({
      name: 'Open42 abc12345',
      public: false,
      default_events: ['push', 'installation'],
      default_permissions: {
        contents: 'read',
        metadata: 'read',
      },
    });
    expect(manifest.hook_attributes).toMatchObject({
      active: true,
    });
    expect(String((manifest.hook_attributes as { url?: string }).url)).toContain(
      '/webhooks/github/workspace-1',
    );
  });

  it('converts a GitHub App manifest code into a validated app payload', async () => {
    const fetchMock = vi.fn(async () =>
      json({
        id: 42,
        slug: 'open42-local',
        name: 'Open42 local',
        html_url: 'https://github.com/apps/open42-local',
        pem: '-----BEGIN RSA PRIVATE KEY-----\\nkey\\n-----END RSA PRIVATE KEY-----',
        webhook_secret: 'secret',
      }),
    );

    await expect(
      convertGitHubAppManifestCode('code-a', fetchMock as typeof fetch),
    ).resolves.toMatchObject({
      id: 42,
      slug: 'open42-local',
      pem: expect.stringContaining('BEGIN RSA PRIVATE KEY'),
      webhook_secret: 'secret',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/app-manifests/code-a/conversions',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}
