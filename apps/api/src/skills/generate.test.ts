import { describe, expect, it, vi } from 'vitest';

import { buildSystemPrompt as buildChatSystemPrompt } from '../routes/chat-prompt.js';
import {
  checkDraft,
  generateSkill,
  parseDraftJson,
  SKILLIFY_TIMEOUT_MS,
  type CompleteFn,
  type GenerateSkillInput,
} from './generate.js';

function makeValidDraft(overrides: Partial<{ name: string; version: string }> = {}) {
  return {
    frontmatter: {
      name: overrides.name ?? 'refund-policy',
      version: overrides.version ?? '0.1.0',
      description:
        'Use when answering refund, return, cancellation, or enterprise SLA refund questions.',
      triggers: ['refund', 'return', 'enterprise refund'],
      mutating: false,
    },
    body: '## Contract\n\nUse cited sources when answering refunds.\n\n## Phases\n\n1. Read the user question.\n2. Check whether the cited refund-policy applies.\n3. Answer with the citation chip.\n\n## Output Format\n\nA bracketed citation per claim, plus the policy text the user asked about.\n\nThis body is intentionally long enough to clear the 200-char minimum the schema enforces, because thinner bodies are not useful skills.',
    cited_doc_slugs: ['refund-policy-2024'],
  };
}

const baseInput: GenerateSkillInput = {
  workspaceId: 'workspace-1',
  intent: 'Draft a skill for refund questions',
  threadCitations: [
    {
      slug: 'refund-policy-2024',
      excerpt: 'Customers may request a refund within 30 days.',
      lastUpdated: '2026-04-01',
    },
  ],
  resolvedAnthropic: {
    apiKey: 'sk-ant-test',
    source: 'tenant',
    model: null,
  },
};

describe('generateSkill', () => {
  it('returns the parsed draft on the happy path with zero retries', async () => {
    const draft = makeValidDraft();
    const complete: CompleteFn = vi.fn(async () => JSON.stringify(draft));

    const out = await generateSkill(baseInput, { complete });

    expect(out.retries).toBe(0);
    expect(out.draft.frontmatter.name).toBe('refund-policy');
    expect(out.draft.cited_doc_slugs).toEqual(['refund-policy-2024']);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('strips a ```json code fence the model adds', async () => {
    const draft = makeValidDraft();
    const fenced = '```json\n' + JSON.stringify(draft) + '\n```';
    const complete: CompleteFn = vi.fn(async () => fenced);

    const out = await generateSkill(baseInput, { complete });
    expect(out.draft.frontmatter.name).toBe('refund-policy');
  });

  it('retries once with a repair message when the first draft fails validation', async () => {
    const bad = JSON.stringify({
      frontmatter: {
        name: 'BAD',
        version: 'wrong',
        description: 'too short',
        triggers: [],
        mutating: false,
      },
      body: 'too short',
      cited_doc_slugs: [],
    });
    const good = JSON.stringify(makeValidDraft());
    const complete: CompleteFn = vi.fn();
    (complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(bad);
    (complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(good);

    const out = await generateSkill(baseInput, { complete });

    expect(out.retries).toBe(1);
    expect(complete).toHaveBeenCalledTimes(2);
    // Second call must include the assistant's bad response + a repair user turn.
    const secondCall = (complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[1].role).toBe('assistant');
    expect(secondCall.messages[2].role).toBe('user');
    expect(secondCall.messages[2].content).toMatch(/did not validate/i);
  });

  it('throws skill_generation_failed when both attempts fail', async () => {
    const bad = JSON.stringify({ nope: 1 });
    const complete: CompleteFn = vi.fn(async () => bad);

    await expect(generateSkill(baseInput, { complete })).rejects.toThrow('skill_generation_failed');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('throws skill_generation_timeout when completion never resolves', async () => {
    vi.useFakeTimers();
    try {
      const complete: CompleteFn = vi.fn(() => new Promise<string>(() => undefined));
      const promise = generateSkill(baseInput, { complete });
      const assertion = expect(promise).rejects.toThrow('skill_generation_timeout');

      await vi.advanceTimersByTimeAsync(SKILLIFY_TIMEOUT_MS);

      await assertion;
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('also retries once when the response is unparseable JSON', async () => {
    const garbage = 'here is your skill, hope this helps';
    const good = JSON.stringify(makeValidDraft());
    const complete: CompleteFn = vi.fn();
    (complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(garbage);
    (complete as ReturnType<typeof vi.fn>).mockResolvedValueOnce(good);

    const out = await generateSkill(baseInput, { complete });
    expect(out.retries).toBe(1);
    const secondCall = (complete as ReturnType<typeof vi.fn>).mock.calls[1]?.[0];
    expect(secondCall.messages[2].content).toMatch(/not parseable as JSON/i);
  });

  it('honours a BYOK model override on the resolved key', async () => {
    const complete: CompleteFn = vi.fn(async () => JSON.stringify(makeValidDraft()));
    const out = await generateSkill(
      {
        ...baseInput,
        resolvedAnthropic: {
          apiKey: 'sk-ant-test',
          source: 'tenant',
          model: 'claude-haiku-4-5',
        },
      },
      { complete },
    );
    expect(out.model).toBe('claude-haiku-4-5');
    const firstCall = (complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(firstCall.model).toBe('claude-haiku-4-5');
  });

  it('embeds the JSON schema and the user citations in the prompts', async () => {
    const complete: CompleteFn = vi.fn(async () => JSON.stringify(makeValidDraft()));
    await generateSkill(baseInput, { complete });
    const call = (complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(call.systemPrompt).toContain('Open42 adaptation');
    expect(call.systemPrompt).toContain('"properties"');
    expect(call.messages[0].content).toContain('Customers may request a refund within 30 days.');
    expect(call.messages[0].content).toContain('[1] refund-policy-2024');
  });

  describe('revise mode', () => {
    const previousDraft = {
      frontmatter: {
        name: 'refund-policy',
        version: '0.1.0',
        description: 'Old description.',
      },
      body: 'Existing body content with structural sections.',
    };

    it('uses the REVISE preamble (not the mint preamble) when previousDraft is set', async () => {
      const complete: CompleteFn = vi.fn(async () =>
        JSON.stringify(makeValidDraft({ version: '0.1.1' })),
      );
      await generateSkill(
        { ...baseInput, previousDraft, intent: 'Make it more concise' },
        { complete },
      );
      const call = (complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
      expect(call.systemPrompt).toContain('REVISE mode');
      expect(call.systemPrompt).toContain('Bump the `version` patch number');
      expect(call.systemPrompt).not.toContain('You are NOT running inside the gbrain CLI');
    });

    it('folds prior frontmatter, prior body, and the revision request into the user message', async () => {
      const complete: CompleteFn = vi.fn(async () =>
        JSON.stringify(makeValidDraft({ version: '0.1.1' })),
      );
      await generateSkill(
        { ...baseInput, previousDraft, intent: 'Drop the partial-refunds section' },
        { complete },
      );
      const userContent = (complete as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].messages[0]
        .content as string;
      expect(userContent).toContain('Existing draft frontmatter:');
      expect(userContent).toContain('"name": "refund-policy"');
      expect(userContent).toContain('Existing draft body:');
      expect(userContent).toContain('Existing body content with structural sections.');
      expect(userContent).toContain('Revision request from the user:');
      expect(userContent).toContain('Drop the partial-refunds section');
    });

    it('returns the bumped version on success', async () => {
      const complete: CompleteFn = vi.fn(async () =>
        JSON.stringify(makeValidDraft({ version: '0.1.1' })),
      );
      const out = await generateSkill(
        { ...baseInput, previousDraft, intent: 'Tighten the body' },
        { complete },
      );
      expect(out.draft.frontmatter.version).toBe('0.1.1');
    });
  });
});

describe('parseDraftJson', () => {
  it('parses raw JSON', () => {
    const out = parseDraftJson('{"a":1}');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    const out = parseDraftJson('```json\n{"a":1}\n```');
    expect(out.ok).toBe(true);
  });

  it('returns an error result instead of throwing on bad JSON', () => {
    const out = parseDraftJson('not json');
    expect(out.ok).toBe(false);
  });
});

describe('checkDraft', () => {
  it('passes a fully-formed draft', () => {
    const out = checkDraft(makeValidDraft());
    expect(out.ok).toBe(true);
  });

  it('reports the schema path on a bad draft', () => {
    const bad = makeValidDraft();
    (bad.frontmatter as { name: string }).name = 'NotKebab';
    const out = checkDraft(bad);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.errors.some((e) => e.includes('/frontmatter/name'))).toBe(true);
    }
  });

  it('truncates long error lists', () => {
    const out = checkDraft({
      frontmatter: {
        name: 'BAD',
        version: 'wrong',
        description: '',
        triggers: [],
        mutating: false,
      },
      body: '',
      cited_doc_slugs: [],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors.length).toBeLessThanOrEqual(9);
  });

  it('rejects bodies missing a required section heading', () => {
    const draft = makeValidDraft();
    draft.body =
      '## Contract\n\nUse cited sources when answering refunds.\n\n## Phases\n\n1. Read the question.\n2. Apply the cited policy.\n3. Cite [1] inline.\n\nThis body is intentionally long enough to clear the 200-char minimum the schema enforces, because thinner bodies are not useful skills.';

    const out = checkDraft(draft);

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.errors).toContain('/body: missing required section "## Output Format"');
    }
  });
});

describe('chat skill-mode system prompt', () => {
  const skillContext = {
    id: 'skill-1',
    name: 'refund-policy',
    version: '0.1.0',
    body: '## Contract\n\nAnswer refund questions in the approved structure.',
  };

  it('includes active skill metadata and body content', () => {
    const prompt = buildChatSystemPrompt(skillContext);

    expect(prompt).toContain('## Active skill: refund-policy v0.1.0');
    expect(prompt).toContain('Answer refund questions in the approved structure.');
  });

  it('states that citations are the factual source of truth over skill body', () => {
    const prompt = buildChatSystemPrompt(skillContext);

    expect(prompt).toContain('Chat citations are the ONLY source of factual claims.');
    expect(prompt).toContain('citation wins');
    expect(prompt).toContain('Do not assert uncited facts from the skill body.');
    expect(prompt).toContain("the brain doesn't have this in its\ncurrent sources.");
  });
});
