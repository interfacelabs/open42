import { describe, expect, it } from 'vitest';

import { GbrainVersionMismatchError, assertGbrainVersion } from './version-check.js';

describe('assertGbrainVersion', () => {
  it('accepts the pinned version', async () => {
    await expect(
      assertGbrainVersion({ getHealth: async () => ({ version: '0.27.1' }) }, '0.27.1'),
    ).resolves.toBeUndefined();
  });

  it('refuses mismatched versions', async () => {
    await expect(
      assertGbrainVersion({ getHealth: async () => ({ version: '0.28.0' }) }, '0.27.1'),
    ).rejects.toBeInstanceOf(GbrainVersionMismatchError);
  });
});
