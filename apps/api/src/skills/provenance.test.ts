import { describe, expect, it } from 'vitest';

import {
  MAX_PROVENANCE_EXCERPT_CHARS,
  citedTextFromChunks,
  citedTextSha256,
  latestVersionIdFromChunks,
} from './provenance.js';

describe('skill provenance helpers', () => {
  it('stores capped cited-text snapshots instead of unbounded page text', () => {
    const text = citedTextFromChunks([
      { slug: 'refund-policy', chunk_text: 'Relevant span.' },
      { slug: 'refund-policy', chunk_text: 'x'.repeat(MAX_PROVENANCE_EXCERPT_CHARS * 2) },
    ]);

    expect(text).toHaveLength(MAX_PROVENANCE_EXCERPT_CHARS);
    expect(text.startsWith('Relevant span.')).toBe(true);
  });

  it('uses chunk_text before excerpt and ignores empty chunks', () => {
    expect(
      citedTextFromChunks([
        { slug: 'empty', chunk_text: '   ' },
        { slug: 'excerpt-only', excerpt: 'Excerpt fallback.' },
        { slug: 'both', chunk_text: 'Chunk text wins.', excerpt: 'Ignored excerpt.' },
      ]),
    ).toBe('Excerpt fallback.\n\nChunk text wins.');
  });

  it('records the latest numeric source version id', () => {
    expect(
      latestVersionIdFromChunks([
        { slug: 'refund-policy', chunk_text: 'one', version_id: 2 },
        { slug: 'refund-policy', chunk_text: 'two', version_id: 11 },
        { slug: 'refund-policy', chunk_text: 'three' },
      ]),
    ).toBe('11');
  });

  it('hashes the exact cited-text snapshot', () => {
    expect(citedTextSha256('Relevant span.')).toBe(citedTextSha256('Relevant span.'));
    expect(citedTextSha256('Relevant span.')).not.toBe(citedTextSha256('Relevant span changed.'));
  });
});
