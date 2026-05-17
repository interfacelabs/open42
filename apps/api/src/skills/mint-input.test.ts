import { describe, expect, it } from 'vitest';

import { estimateInputChars, parseMintInput } from './mint-input.js';

describe('parseMintInput', () => {
  it('rejects a non-object body', () => {
    const out = parseMintInput('hello');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('body_required');
  });

  it('requires a non-empty intent', () => {
    expect(parseMintInput({}).ok).toBe(false);
    expect(parseMintInput({ intent: '' }).ok).toBe(false);
    expect(parseMintInput({ intent: '   ' }).ok).toBe(false);
  });

  it('caps intent length', () => {
    const out = parseMintInput({ intent: 'x'.repeat(2_001) });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('intent_too_long');
  });

  it('accepts a minimal intent with no citations', () => {
    const out = parseMintInput({ intent: 'Draft a refund-policy skill' });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.intent).toBe('Draft a refund-policy skill');
      expect(out.threadCitations).toEqual([]);
    }
  });

  it('parses well-formed citation identifiers and trims fields', () => {
    const out = parseMintInput({
      intent: 'Draft something',
      threadCitations: [
        {
          slug: '  refund-policy-2024  ',
          excerpt: ' browser supplied text is verified later ',
          versionId: 3,
          lastUpdated: ' 2026-04-01 ',
        },
        { slug: 'billing-faq', excerpt: 'ignored' },
      ],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.threadCitations).toHaveLength(2);
      expect(out.threadCitations[0]?.slug).toBe('refund-policy-2024');
      expect(out.threadCitations[0]?.excerpt).toBe('browser supplied text is verified later');
      expect(out.threadCitations[0]?.versionId).toBe('3');
      expect(out.threadCitations[0]?.lastUpdated).toBe('2026-04-01');
      expect(out.threadCitations[1]?.excerpt).toBe('ignored');
      expect(out.threadCitations[1]?.lastUpdated).toBeUndefined();
    }
  });

  it('caps citation excerpt length', () => {
    const out = parseMintInput({
      intent: 'Draft something',
      threadCitations: [{ slug: 'refund-policy-2024', excerpt: 'x'.repeat(2_500) }],
    });

    expect(out.ok).toBe(true);
    if (out.ok) expect(out.threadCitations[0]?.excerpt).toHaveLength(2_000);
  });

  it('accepts citations without excerpts but rejects missing slugs', () => {
    expect(
      parseMintInput({
        intent: 'x',
        threadCitations: [{ excerpt: 'no slug here' }],
      }).ok,
    ).toBe(false);
    expect(
      parseMintInput({
        intent: 'x',
        threadCitations: [{ slug: 'fine' }],
      }).ok,
    ).toBe(true);
  });

  it('caps citation count', () => {
    const tooMany = Array.from({ length: 33 }, (_, i) => ({
      slug: `s${i}`,
    }));
    const out = parseMintInput({ intent: 'x', threadCitations: tooMany });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('too_many_citations');
  });
});

describe('estimateInputChars', () => {
  it('rolls intent + citation slug + excerpt + per-citation overhead', () => {
    const chars = estimateInputChars({
      intent: 'hello',
      threadCitations: [
        { slug: 'a', excerpt: 'bbbb', versionId: '3', lastUpdated: '2026' },
        { slug: 'cc' },
      ],
    });
    // 5 + (1 + 4 + 1 + 4 + 16) + (2 + 0 + 0 + 0 + 16)
    expect(chars).toBe(5 + 26 + 18);
  });
});
