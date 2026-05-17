import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GbrainCitationChunk } from '../../apps/api/src/gbrain/client.js';
import {
  generateSkill,
  type CompleteFn,
  type GenerateSkillOutput,
} from '../../apps/api/src/skills/generate.js';

interface Prompt {
  id: string;
  fixture_id: string;
  question: string;
  expected_citations: string[];
  tier: 1 | 2 | 3;
}

interface FixtureBrain {
  id: string;
  chunks: GbrainCitationChunk[];
}

interface EvalResult {
  id: string;
  fixture_id: string;
  tier: Prompt['tier'];
  passed: boolean;
  reason: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

async function main() {
  const [prompts, fixtures] = await Promise.all([readPrompts(), readFixtures()]);
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const bundles = new Map<string, GenerateSkillOutput>();
  const results: EvalResult[] = [];

  for (const prompt of prompts) {
    const fixture = fixtureById.get(prompt.fixture_id);
    if (!fixture) {
      results.push({
        id: prompt.id,
        fixture_id: prompt.fixture_id,
        tier: prompt.tier,
        passed: false,
        reason: 'missing_fixture',
      });
      continue;
    }

    let bundle = bundles.get(fixture.id);
    if (!bundle) {
      bundle = await generateSkill(
        {
          workspaceId: fixture.id,
          intent:
            'Draft a skill that helps support agents decide refund requests from cited policy.',
          threadCitations: fixture.chunks.map((chunk) => ({
            slug: chunk.slug ?? 'unknown',
            excerpt: chunk.excerpt ?? chunk.chunk_text ?? '',
            versionId: String(chunk.version_id ?? ''),
            lastUpdated: String(chunk.last_updated ?? ''),
          })),
          resolvedAnthropic: {
            apiKey: 'sk-ant-eval-placeholder',
            source: 'tenant',
            model: 'eval-deterministic',
          },
        },
        { complete: deterministicComplete(fixture) },
      );
      bundles.set(fixture.id, bundle);
    }
    results.push(evaluatePrompt(prompt, renderSkillMarkdown(bundle)));
  }

  const tier12 = results.filter((result) => result.tier <= 2);
  const tier3 = results.filter((result) => result.tier === 3);
  const summary = {
    suite: 'refund-policy',
    fixtures: fixtures.length,
    prompts: prompts.length,
    pass_criteria: {
      tier_1_2: { required: tier12.length, passed: countPassed(tier12), total: tier12.length },
      tier_3: {
        required: Math.min(4, tier3.length),
        passed: countPassed(tier3),
        total: tier3.length,
      },
    },
    failures: results.filter((result) => !result.passed),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (
    summary.pass_criteria.tier_1_2.passed < summary.pass_criteria.tier_1_2.required ||
    summary.pass_criteria.tier_3.passed < summary.pass_criteria.tier_3.required
  ) {
    process.exitCode = 1;
  }
}

async function readPrompts(): Promise<Prompt[]> {
  const file = await readFile(join(root, 'eval/golden-prompts.jsonl'), 'utf8');
  return file
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Prompt);
}

async function readFixtures(): Promise<FixtureBrain[]> {
  const file = await readFile(join(root, 'eval/fixtures/refund-policy-brains.json'), 'utf8');
  return JSON.parse(file) as FixtureBrain[];
}

function evaluatePrompt(prompt: Prompt, skillMarkdown: string): EvalResult {
  if (prompt.expected_citations.length === 0) {
    const passed = skillMarkdown.includes('If a question is not covered by these citations');
    return {
      id: prompt.id,
      fixture_id: prompt.fixture_id,
      tier: prompt.tier,
      passed,
      reason: passed ? 'unsupported_question_guard_present' : 'unsupported_question_guard_missing',
    };
  }

  const missing = prompt.expected_citations.filter((slug) => !skillMarkdown.includes(`[${slug} v`));
  return {
    id: prompt.id,
    fixture_id: prompt.fixture_id,
    tier: prompt.tier,
    passed: missing.length === 0,
    reason: missing.length === 0 ? 'expected_citations_present' : `missing:${missing.join(',')}`,
  };
}

function countPassed(results: EvalResult[]): number {
  return results.filter((result) => result.passed).length;
}

function deterministicComplete(fixture: FixtureBrain): CompleteFn {
  return async () =>
    JSON.stringify({
      frontmatter: {
        name: 'refund-policy',
        version: '0.1.0',
        description:
          'Use when deciding customer refund requests from cited refund policy and operations sources.',
        triggers: ['refund request', 'customer refund', 'service credit'],
        mutating: false,
      },
      body: buildSkillBody(fixture.chunks),
      cited_doc_slugs: fixture.chunks.map((chunk) => chunk.slug).filter(isPresent),
    });
}

function buildSkillBody(chunks: GbrainCitationChunk[]): string {
  const citations = chunks
    .map((chunk) => {
      const slug = chunk.slug ?? 'unknown';
      const version = chunk.version_id ?? 'unknown';
      const excerpt = chunk.excerpt ?? chunk.chunk_text ?? '';
      return `- [${slug} v${version}] ${excerpt}`;
    })
    .join('\n');

  return [
    '## Contract',
    '',
    'Use the cited refund-policy sources below to decide support refund questions. Answer only from the cited material, include the cited slug/version when making a policy claim, and do not invent exceptions.',
    '',
    '## Phases',
    '',
    '1. Identify whether the user is asking for a standard refund, enterprise service credit, processing path, tax handling, or an unsupported edge case.',
    '2. Match the request to the cited source excerpt and preserve any escalation or approval conditions.',
    '3. If a question is not covered by these citations, say that the brain does not have the policy and do not approve the refund.',
    '',
    '## Output Format',
    '',
    'Return one support decision, one concise rationale, and the cited source slug/version for every factual policy claim.',
    '',
    '## Cited Sources',
    '',
    citations,
  ].join('\n');
}

function renderSkillMarkdown(bundle: GenerateSkillOutput): string {
  const frontmatter = bundle.draft.frontmatter;
  return [
    '---',
    `name: ${frontmatter.name}`,
    `version: ${frontmatter.version}`,
    `description: ${JSON.stringify(frontmatter.description)}`,
    `triggers: [${frontmatter.triggers.map((trigger) => JSON.stringify(trigger)).join(', ')}]`,
    `mutating: ${frontmatter.mutating}`,
    '---',
    '',
    bundle.draft.body,
  ].join('\n');
}

function isPresent(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

void main();
