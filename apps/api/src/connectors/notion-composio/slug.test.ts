import { describe, expect, it } from 'vitest';
import { notionPageSlug } from './slug.js';

describe('notionPageSlug', () => {
  it('uses page id only, never the title', () => {
    expect(notionPageSlug('a1b2c3d4-e5f6-7890-abcd-1234567890ab')).toBe(
      'notion-composio-a1b2c3d4e5f67890abcd1234567890ab',
    );
  });

  it('normalizes hyphens away to make a slug-safe identifier', () => {
    const slug = notionPageSlug('my-page-id-123');
    expect(slug).toMatch(/^notion-composio-[a-z0-9]+$/);
  });

  it('is stable: same input -> same output', () => {
    const id = '00000000-0000-0000-0000-000000000000';
    expect(notionPageSlug(id)).toBe(notionPageSlug(id));
  });

  it.each(['../secret', 'workspace/page', 'page id', '?token=secret', '---'])(
    'rejects path-like or empty page ids: %j',
    (id) => {
      expect(() => notionPageSlug(id)).toThrow('notion_page_id_invalid');
    },
  );
});
