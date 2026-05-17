import Anthropic from '@anthropic-ai/sdk';

import type { ResolvedLlmKey } from '../auth/llm-keys.js';

const DEFAULT_EXPLAINER_MODEL = 'claude-3-5-haiku-latest';
const MAX_EXPLAINER_TOKENS = 120;
const MAX_EXPLAINER_CHARS = 240;

export interface GenerateSkillExplainerInput {
  skillName: string;
  frontmatter: Record<string, unknown>;
  body: string;
  resolvedAnthropic: ResolvedLlmKey;
}

export interface GenerateExplainerRequest {
  systemPrompt: string;
  userPrompt: string;
  model: string;
}

export type GenerateExplainerCompleteFn = (req: GenerateExplainerRequest) => Promise<string>;

export interface GenerateSkillExplainerDeps {
  complete?: GenerateExplainerCompleteFn;
  env?: NodeJS.ProcessEnv;
}

export async function generateSkillExplainer(
  input: GenerateSkillExplainerInput,
  deps: GenerateSkillExplainerDeps = {},
): Promise<string | null> {
  const env = deps.env ?? process.env;
  const model =
    input.resolvedAnthropic.model?.trim() ||
    env.ANTHROPIC_EXPLAINER_MODEL?.trim() ||
    env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_EXPLAINER_MODEL;
  const complete = deps.complete ?? buildAnthropicExplainerComplete(input.resolvedAnthropic);

  const raw = await complete({
    model,
    systemPrompt:
      'Write one concise product-facing sentence explaining when this Open42 SKILL.md is useful. No markdown, no citations, no preamble.',
    userPrompt: [
      `Skill name: ${input.skillName}`,
      '',
      'Frontmatter:',
      JSON.stringify(input.frontmatter, null, 2),
      '',
      'Body:',
      input.body.slice(0, 4_000),
    ].join('\n'),
  });

  const cleaned = raw.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, MAX_EXPLAINER_CHARS) : null;
}

function buildAnthropicExplainerComplete(resolved: ResolvedLlmKey): GenerateExplainerCompleteFn {
  return async (req) => {
    const client = new Anthropic({
      apiKey: resolved.apiKey,
      maxRetries: 0,
    });
    const response = await client.messages.create({
      model: req.model,
      max_tokens: MAX_EXPLAINER_TOKENS,
      system: req.systemPrompt,
      messages: [{ role: 'user', content: req.userPrompt }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') return '';
    return block.text;
  };
}
