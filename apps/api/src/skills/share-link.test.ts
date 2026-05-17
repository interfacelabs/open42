import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import {
  SHARE_LINK_TTL_MS,
  buildShareStorageKey,
  checkShareLinkRateLimit,
  hashShareToken,
  mintShareLink,
  readBundle,
  resetShareLinkRateLimitForTest,
  signShareToken,
  verifyShareToken,
  writeBundle,
} from './share-link.js';
import type { MintShareLinkDeps } from './share-link.js';

const TEST_KEK = 'f'.repeat(64);

describe('share-link helpers', () => {
  afterEach(() => {
    resetShareLinkRateLimitForTest();
  });

  it('signs opaque URL tokens with HMAC-SHA256', () => {
    process.env.OPEN42_KEK = TEST_KEK;
    const token = signShareToken('abc123abc123abc123abc1');
    const tampered = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

    expect(token).toMatch(/^sks_[A-Za-z0-9_-]+_[A-Za-z0-9_-]{43}$/);
    expect(verifyShareToken(token)).toBe(true);
    expect(verifyShareToken(tampered)).toBe(false);
    expect(verifyShareToken('abc123abc123abc123abc1')).toBe(false);
  });

  it('hashes opaque tokens without storing plaintext', () => {
    process.env.OPEN42_KEK = TEST_KEK;
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

  it('mints share URLs that expire 24 hours from the mint time', async () => {
    process.env.OPEN42_KEK = TEST_KEK;
    const root = await mkdtemp(join(tmpdir(), 'open42-share-link-'));
    const now = new Date('2026-05-17T10:00:00.000Z');
    let inserted:
      | {
          expiresAt: Date;
          tokenHash: Buffer;
          storageKey: string;
        }
      | undefined;
    const db = {
      insert: () => ({
        values: async (row: { expiresAt: Date; tokenHash: Buffer; storageKey: string }) => {
          inserted = row;
        },
      }),
    } as unknown as NonNullable<MintShareLinkDeps['db']>;

    try {
      const env = { OPEN42_SKILL_BUNDLE_STORE_DIR: root } as NodeJS.ProcessEnv;
      const result = await mintShareLink(
        {
          workspaceId: 'workspace',
          skillId: 'skill',
          skillVersionId: 'version',
          createdByUserId: 'user',
          bundle: Buffer.from('zip'),
          publicBaseUrl: 'https://app.example.test/',
        },
        {
          db,
          env,
          now: () => now,
          randomBytes: () => Buffer.alloc(32, 1),
        },
      );

      expect(result.expiresAt.getTime()).toBe(now.getTime() + SHARE_LINK_TTL_MS);
      expect(inserted?.expiresAt).toEqual(result.expiresAt);
      expect(inserted?.tokenHash).toEqual(hashShareToken(result.token));
      expect(inserted?.storageKey).toBe(result.storageKey);
      expect(JSON.stringify(inserted)).not.toContain(result.token);
      expect(result.url).toBe(`https://app.example.test/shared/${result.token}.zip`);
      await expect(readBundle(result.storageKey, env)).resolves.toEqual(Buffer.from('zip'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
