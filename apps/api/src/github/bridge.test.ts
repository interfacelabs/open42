import { describe, expect, it } from 'vitest';

import {
  createGbrainSourceId,
  createGitProxyToken,
  directGithubCloneUrl,
  hashGitProxyToken,
  normalizeGithubPathFilters,
} from './bridge.js';

describe('github bridge helpers', () => {
  it('creates gbrain-safe source ids without exposing repo ids', () => {
    const id = createGbrainSourceId();
    expect(id).toMatch(/^gh-[a-f0-9]{20}$/);
    expect(id.length).toBeLessThanOrEqual(32);
  });

  it('hashes opaque git proxy tokens deterministically', () => {
    const token = createGitProxyToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(hashGitProxyToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashGitProxyToken(token)).toBe(hashGitProxyToken(token));
  });

  it('normalizes path filters conservatively for future gbrain support', () => {
    expect(normalizeGithubPathFilters([' docs ', '/handbook/', '../secret', 'docs'])).toEqual([
      'docs',
      'handbook',
    ]);
  });

  it('builds public GitHub clone URLs without embedded credentials', () => {
    expect(directGithubCloneUrl('openai', 'open42')).toBe(
      'https://github.com/openai/open42.git',
    );
  });
});
