export interface ChatEvalQuestion {
  id: string;
  turns: [string, string];
  expected: string[];
  avoid?: string[];
}

export interface ChatEvalAnswer {
  id: string;
  answer: string;
}

export interface ChatEvalCriterion {
  name: 'resolution' | 'source_overlap' | 'no_regression';
  passed: boolean;
  reason: string;
}

export interface ChatEvalGrade {
  id: string;
  passed: boolean;
  missing: string[];
  criteria: ChatEvalCriterion[];
  grader: 'deterministic' | 'anthropic';
}

export function gradeChatAnswer(question: ChatEvalQuestion, answer: ChatEvalAnswer): ChatEvalGrade {
  const normalized = answer.answer.toLowerCase();
  const expectedTerms = question.expected.filter((expected) => expected !== '[1]');
  const missingTerms = expectedTerms.filter((expected) => {
    return !normalized.includes(expected.toLowerCase());
  });
  const needsCitation = question.expected.includes('[1]');
  const hasCitation = /\[\d+]/.test(answer.answer);
  const avoided = (question.avoid ?? []).filter((term) => normalized.includes(term.toLowerCase()));
  const criteria: ChatEvalCriterion[] = [
    {
      name: 'resolution',
      passed: missingTerms.length === 0,
      reason:
        missingTerms.length === 0
          ? 'Answer includes required follow-up facts.'
          : `Missing expected terms: ${missingTerms.join(', ')}`,
    },
    {
      name: 'source_overlap',
      passed: !needsCitation || hasCitation,
      reason:
        !needsCitation || hasCitation
          ? 'Answer cites a source marker.'
          : 'Answer has no citation marker.',
    },
    {
      name: 'no_regression',
      passed: avoided.length === 0,
      reason:
        avoided.length === 0
          ? 'Answer avoids known contradicted terms.'
          : `Answer includes avoided terms: ${avoided.join(', ')}`,
    },
  ];
  return {
    id: question.id,
    passed: criteria.every((criterion) => criterion.passed),
    missing: [
      ...missingTerms,
      ...(needsCitation && !hasCitation ? ['[citation]'] : []),
      ...avoided.map((term) => `avoid:${term}`),
    ],
    criteria,
    grader: 'deterministic',
  };
}

export async function gradeChatAnswerWithOptionalJudge(
  question: ChatEvalQuestion,
  answer: ChatEvalAnswer,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ChatEvalGrade> {
  if (env.OPEN42_CHAT_EVAL_GRADER !== 'anthropic' || !env.ANTHROPIC_API_KEY) {
    return gradeChatAnswer(question, answer);
  }

  const fallback = gradeChatAnswer(question, answer);
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0 });
    const response = await client.messages.create({
      model: env.OPEN42_CHAT_EVAL_GRADER_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: 360,
      system:
        'Grade an Open42 multi-turn answer. Return strict JSON only with criteria for resolution, source_overlap, and no_regression. Each criterion needs passed boolean and reason string. Overall passed requires all criteria true.',
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            id: question.id,
            turns: question.turns,
            expected: question.expected,
            avoid: question.avoid ?? [],
            answer: answer.answer,
            deterministicFallback: fallback.criteria,
          }),
        },
      ],
    });
    const text = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const parsed = parseJudgeJson(text);
    if (!parsed) return fallback;
    const criteria = normalizeCriteria(parsed.criteria);
    return {
      id: question.id,
      passed: criteria.every((criterion) => criterion.passed),
      missing: criteria
        .filter((criterion) => !criterion.passed)
        .map((criterion) => criterion.name),
      criteria,
      grader: 'anthropic',
    };
  } catch {
    return fallback;
  }
}

function parseJudgeJson(text: string): { criteria?: unknown } | null {
  try {
    return JSON.parse(text) as { criteria?: unknown };
  } catch {
    const match = /\{[\s\S]*\}/.exec(text);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as { criteria?: unknown };
    } catch {
      return null;
    }
  }
}

function normalizeCriteria(value: unknown): ChatEvalCriterion[] {
  const byName = new Map<string, unknown>();
  if (Array.isArray(value)) {
    for (const item of value) {
      const name = (item as { name?: unknown }).name;
      if (typeof name === 'string') byName.set(name, item);
    }
  } else if (value && typeof value === 'object') {
    for (const [name, item] of Object.entries(value)) byName.set(name, item);
  }

  return (['resolution', 'source_overlap', 'no_regression'] as const).map((name) => {
    const item = byName.get(name) as { passed?: unknown; reason?: unknown } | undefined;
    return {
      name,
      passed: item?.passed === true,
      reason: typeof item?.reason === 'string' ? item.reason : 'Judge omitted reason.',
    };
  });
}
