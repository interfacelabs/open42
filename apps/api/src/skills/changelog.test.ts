import { describe, expect, it } from 'vitest';

import { fallbackSkillChangelog, generateSkillChangelog } from './changelog.js';

describe('generateSkillChangelog', () => {
  it('uses the Haiku default model and returns cleaned single-sentence copy', async () => {
    const requests: unknown[] = [];

    const out = await generateSkillChangelog(
      {
        slug: 'refund-policy',
        previousText: 'Annual customers have thirty days.',
        latestText: 'Annual customers have fourteen days.',
        resolvedAnthropic: {
          apiKey: 'sk-ant-test',
          source: 'tenant',
          model: null,
        },
      },
      {
        env: {},
        complete: async (req) => {
          requests.push(req);
          return '  Refund policy changed   from thirty days to fourteen days.  ';
        },
      },
    );

    expect(out).toBe('Refund policy changed from thirty days to fourteen days.');
    expect(requests[0]).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
    });
  });
});

describe('fallbackSkillChangelog', () => {
  it('returns product-facing fallback copy for changed sources', () => {
    expect(fallbackSkillChangelog('refund-policy')).toBe(
      'refund-policy changed since this skill was exported.',
    );
  });
});
