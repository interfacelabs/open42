import { describe, expect, it } from 'vitest';

import { summarizeFreshness } from './freshness.js';

describe('summarizeFreshness', () => {
  it('computes oldest, newest, and staleness', () => {
    expect(
      summarizeFreshness(
        [
          { last_updated: '2026-03-15T00:00:00.000Z' },
          { last_updated: '2026-05-01T00:00:00.000Z' },
        ],
        new Date('2026-05-06T00:00:00.000Z'),
      ),
    ).toEqual({
      oldest_source_at: '2026-03-15T00:00:00.000Z',
      newest_source_at: '2026-05-01T00:00:00.000Z',
      staleness_warning: false,
    });
  });
});
