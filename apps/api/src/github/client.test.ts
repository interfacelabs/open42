import { describe, expect, it } from 'vitest';

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
});
