import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildShareStorageKey,
  checkShareLinkRateLimit,
  hashShareToken,
  readBundle,
  resetShareLinkRateLimitForTest,
  writeBundle,
} from './share-link.js';

describe('share-link helpers', () => {
  afterEach(() => {
    resetShareLinkRateLimitForTest();
  });

  it('hashes opaque tokens without storing plaintext', () => {
    expect(hashShareToken('secret-token')).toHaveLength(32);
    expect(hashShareToken('secret-token').equals(Buffer.from('secret-token'))).toBe(false);
  });

  it('builds per-workspace bundle storage keys', () => {
    expect(
      buildShareStorageKey({
        workspaceId: 'workspace',
        skillId: 'skill',
        skillVersionId: 'version',
      }),
    ).toBe('workspace/skill/version.zip');
  });

  it('rate-limits share link mints to 10 per minute per workspace', () => {
    for (let i = 0; i < 10; i += 1) {
      expect(checkShareLinkRateLimit('workspace', 1_000).ok).toBe(true);
    }
    expect(checkShareLinkRateLimit('workspace', 1_000)).toEqual({
      ok: false,
      retryAfter: 60,
    });
    expect(checkShareLinkRateLimit('other-workspace', 1_000).ok).toBe(true);
    expect(checkShareLinkRateLimit('workspace', 61_001).ok).toBe(true);
  });

  it('writes and reads bundles from the configured store', async () => {
    const root = await mkdtemp(join(tmpdir(), 'open42-share-link-'));
    try {
      const env = { OPEN42_SKILL_BUNDLE_STORE_DIR: root } as NodeJS.ProcessEnv;
      await writeBundle('workspace/skill/version.zip', Buffer.from('zip'), env);
      await expect(readBundle('workspace/skill/version.zip', env)).resolves.toEqual(
        Buffer.from('zip'),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
