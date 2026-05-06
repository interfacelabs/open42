import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GbrainCitationChunk } from '../../apps/api/src/gbrain/client.js';
import { generateRefundPolicySkill } from '../../apps/api/src/skills/refund-policy/generate.js';

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
  const bundles = new Map<string, Awaited<ReturnType<typeof generateRefundPolicySkill>>>();
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
      bundle = await generateRefundPolicySkill({
        workspaceId: fixture.id,
        gbrainVersion: '0.27.1',
        now: new Date('2026-05-06T12:00:00.000Z'),
        gbrain: fixtureGbrain(fixture),
      });
      bundles.set(fixture.id, bundle);
    }
    results.push(evaluatePrompt(prompt, bundle.skillMarkdown));
  }

  const tier12 = results.filter((result) => result.tier <= 2);
  const tier3 = results.filter((result) => result.tier === 3);
  const summary = {
    suite: 'refund-policy',
    fixtures: fixtures.length,
    prompts: prompts.length,
    pass_criteria: {
      tier_1_2: { required: tier12.length, passed: countPassed(tier12), total: tier12.length },
      tier_3: { required: Math.min(4, tier3.length), passed: countPassed(tier3), total: tier3.length },
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

function fixtureGbrain(fixture: FixtureBrain) {
  return {
    async query() {
      return { chunks: fixture.chunks };
    },
    async getChunks(slug: string) {
      return fixture.chunks.filter((chunk) => chunk.slug === slug);
    },
  };
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

void main();
