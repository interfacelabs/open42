import { describe, expect, it } from 'vitest';

import { generateSkillExplainer } from './explainer.js';

describe('generateSkillExplainer', () => {
  it('uses the Haiku default model and returns cleaned product copy', async () => {
    const requests: unknown[] = [];

    const out = await generateSkillExplainer(
      {
        skillName: 'refund-policy',
        frontmatter: {
          name: 'refund-policy',
          description: 'Use when answering refund questions.',
        },
        body: '## Contract\n\nAnswer refund questions from cited sources.',
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
          return '  Use this skill   for refund-policy answers.  ';
        },
      },
    );

    expect(out).toBe('Use this skill for refund-policy answers.');
    expect(requests[0]).toMatchObject({
      model: 'claude-haiku-4-5-20251001',
    });
  });

  it('returns null when the explainer response is empty after cleanup', async () => {
    await expect(
      generateSkillExplainer(
        {
          skillName: 'refund-policy',
          frontmatter: { name: 'refund-policy' },
          body: '## Contract\n\nAnswer refund questions.',
          resolvedAnthropic: {
            apiKey: 'sk-ant-test',
            source: 'tenant',
            model: null,
          },
        },
        {
          complete: async () => '   \n\t  ',
        },
      ),
    ).resolves.toBeNull();
  });
});
