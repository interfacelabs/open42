import { describe, expect, it } from 'vitest';

import { gradeChatAnswer, gradeChatAnswerWithOptionalJudge } from './grader.js';

describe('chat eval grader', () => {
  it('scores resolution, source overlap, and no-regression criteria deterministically', () => {
    const grade = gradeChatAnswer(
      {
        id: 'refund-monthly-followup',
        turns: ['What is the refund window for annual customers?', 'What about monthly customers?'],
        expected: ['monthly', '14', '[1]'],
        avoid: ['30 days'],
      },
      { id: 'refund-monthly-followup', answer: 'Monthly customers have 14 days [1].' },
    );

    expect(grade).toMatchObject({
      passed: true,
      grader: 'deterministic',
      criteria: [
        { name: 'resolution', passed: true },
        { name: 'source_overlap', passed: true },
        { name: 'no_regression', passed: true },
      ],
    });
  });

  it('fails answers that miss citations or repeat contradicted terms', () => {
    const grade = gradeChatAnswer(
      {
        id: 'refund-monthly-followup',
        turns: ['What is the refund window for annual customers?', 'What about monthly customers?'],
        expected: ['monthly', '14', '[1]'],
        avoid: ['30 days'],
      },
      { id: 'refund-monthly-followup', answer: 'Monthly customers have 30 days.' },
    );

    expect(grade.passed).toBe(false);
    expect(grade.missing).toEqual(['14', '[citation]', 'avoid:30 days']);
  });

  it('falls back to deterministic grading unless Anthropic grading is explicitly enabled', async () => {
    await expect(
      gradeChatAnswerWithOptionalJudge(
        {
          id: 'source-aware-followup',
          turns: ['Which source explains annual refunds?', 'Use that same source.'],
          expected: ['refund-policy', '[1]'],
        },
        { id: 'source-aware-followup', answer: 'refund-policy [1]' },
        {} as NodeJS.ProcessEnv,
      ),
    ).resolves.toMatchObject({ passed: true, grader: 'deterministic' });
  });
});
