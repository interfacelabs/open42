import { describe, expect, it } from 'vitest';

import { GbrainVersionMismatchError, assertGbrainVersion } from './version-check.js';

describe('assertGbrainVersion', () => {
  it('accepts the pinned version', async () => {
    await expect(
      assertGbrainVersion({ getHealth: async () => ({ version: '0.31.3' }) }, '0.31.3'),
    ).resolves.toBeUndefined();
  });

  it('refuses mismatched versions', async () => {
    await expect(
      assertGbrainVersion({ getHealth: async () => ({ version: '0.31.2' }) }, '0.31.3'),
    ).rejects.toBeInstanceOf(GbrainVersionMismatchError);
  });
});
