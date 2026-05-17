export interface ChatEvalQuestion {
  id: string;
  turns: [string, string];
  expected: string[];
  avoid?: string[];
}

export interface ChatEvalAnswer {
  id: string;
  answer: string;
  citations?: Array<{ slug?: string | null }>;
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
  const expectedTerms = question.expected.filter((expected) => expected !== '[1]');
  const missingTerms = expectedTerms.filter((expected) => !containsExpected(answer, expected));
  const needsCitation = question.expected.includes('[1]');
  const hasCitation = /\[\d+]/.test(answer.answer);
  const avoided = (question.avoid ?? []).filter((term) => containsTerm(answer.answer, term));
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

function containsExpected(answer: ChatEvalAnswer, term: string): boolean {
  if (containsTerm(answer.answer, term)) return true;
  if (normalizeText(term) === 'don t have') {
    return [
      "don't have",
      'do not have',
      'cannot answer',
      'can not answer',
      'does not contain',
      'not contain',
    ].some((phrase) => containsTerm(answer.answer, phrase));
  }

  return (answer.citations ?? []).some((citation) => {
    return typeof citation.slug === 'string' && containsTerm(citation.slug, term);
  });
}

function containsTerm(value: string, term: string): boolean {
  return normalizeText(value).includes(normalizeText(term));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
      model: env.OPEN42_CHAT_EVAL_GRADER_MODEL || 'claude-haiku-4-5-20251001',
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
      missing: criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.name),
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
