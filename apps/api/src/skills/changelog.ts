import Anthropic from '@anthropic-ai/sdk';

import type { ResolvedLlmKey } from '../auth/llm-keys.js';

const DEFAULT_CHANGELOG_MODEL = 'claude-3-5-haiku-latest';
const MAX_CHANGELOG_TOKENS = 140;
const MAX_CHANGELOG_CHARS = 320;

export interface GenerateSkillChangelogInput {
  slug: string;
  previousText: string;
  latestText: string;
  resolvedAnthropic: ResolvedLlmKey;
}

export interface GenerateChangelogRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
}

export type GenerateChangelogCompleteFn = (req: GenerateChangelogRequest) => Promise<string>;

export interface GenerateSkillChangelogDeps {
  complete?: GenerateChangelogCompleteFn;
  env?: NodeJS.ProcessEnv;
}

export async function generateSkillChangelog(
  input: GenerateSkillChangelogInput,
  deps: GenerateSkillChangelogDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env;
  const model =
    input.resolvedAnthropic.model?.trim() ||
    env.ANTHROPIC_CHANGELOG_MODEL?.trim() ||
    DEFAULT_CHANGELOG_MODEL;
  const complete = deps.complete ?? buildAnthropicChangelogComplete(input.resolvedAnthropic);
  const raw = await complete({
    model,
    systemPrompt:
      'Write one concise product-facing changelog sentence for a skill whose cited source changed. No markdown, no citations, no preamble.',
    userPrompt: [
      `Source slug: ${input.slug}`,
      '',
      'Previous cited span:',
      input.previousText.slice(0, 3_000),
      '',
      'Latest cited span:',
      input.latestText.slice(0, 3_000),
    ].join('\n'),
  });
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, MAX_CHANGELOG_CHARS) : null;
}

export function fallbackSkillChangelog(slug: string): string {
  return `${slug} changed since this skill was exported.`;
}

function buildAnthropicChangelogComplete(resolved: ResolvedLlmKey): GenerateChangelogCompleteFn {
  return async (req) => {
    const client = new Anthropic({ apiKey: resolved.apiKey, maxRetries: 0 });
    const response = await client.messages.create({
      model: req.model,
      max_tokens: MAX_CHANGELOG_TOKENS,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') return '';
    return block.text;
  };
}
