import Anthropic from '@anthropic-ai/sdk';
import { Value } from '@sinclair/typebox/value';

import type { ResolvedLlmKey } from '../auth/llm-keys.js';
import { REQUIRED_SKILL_BODY_HEADINGS, SkillDraftSchema, type SkillDraft } from './schema.js';
import { SKILLIFY_META_PROMPT } from './skillify-meta.js';

/**
 * Wide-Skillify generator — turns a chat thread + the user's intent into a
 * validated SKILL.md draft (frontmatter + body) that the SkillPanel can
 * render and the user can iterate on.
 *
 * BYOK + budget contract (must match `routes/chat.ts`):
 *   - The route layer calls
 *       `resolveLlmKey({ workspaceId, provider: 'anthropic', scope: 'chat' })`
 *     and short-circuits 503 when it returns null. Skillify reuses the
 *     `chat` scope — it's LLM completion against the same provider, and a
 *     per-skill scope split is only worth doing once a workspace owner
 *     wants distinct budgets / model overrides for skill generation.
 *   - The route layer calls
 *       `checkWorkspaceChatBudget({ workspaceId, inputChars })`
 *     before invoking the generator and returns 429 on cap. Skill
 *     generation spends the same daily token cap as chat.
 *   - `generateSkill` takes the resolved key as an explicit param so the
 *     function is testable without env / db, and so the route layer is the
 *     only auth boundary.
 *
 * Validation flow:
 *   - System prompt = `SKILLIFY_META_PROMPT` + an Open42 adaptation note +
 *     the JSON schema the model must hit. Prompt caching (cache_control:
 *     'ephemeral') is the obvious next perf win on the retry path but
 *     requires bumping `@anthropic-ai/sdk` past 0.32.x — punted to a
 *     follow-up so this PR stays surgical.
 *   - User message = the user's intent + thread citations as context.
 *   - Model returns a JSON object; we Value.Check it against
 *     `SkillDraftSchema`. On schema fail we send ONE repair message back to
 *     the model with the validation error and ask for a corrected draft.
 *   - After the retry, a second failure throws — the route surfaces it as
 *     `skill_generation_failed` for the UI.
 */

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_OUTPUT_TOKENS = 4_000;
const MAX_REPAIR_RETRIES = 1;
const DEFAULT_SKILLIFY_TIMEOUT_MS = 60_000;

export const SKILLIFY_TIMEOUT_MS = positiveInt(
  process.env.OPEN42_SKILLIFY_TIMEOUT_MS,
  DEFAULT_SKILLIFY_TIMEOUT_MS,
);

const REVISE_PREAMBLE = `## Open42 adaptation — REVISE mode

You are revising an EXISTING SKILL.md draft. The user message includes
the prior frontmatter, the prior body, and a revision request. Apply
the request while preserving:

- The skill's slug (the \`name\` in the frontmatter must NOT change).
- The structural sections of the body (## Contract, ## Phases, ##
  Output Format) — only edit content within them unless the request is
  explicitly to add/remove a section.
- The triggers list — append a new trigger only if the request asks
  for it; never remove existing triggers without an explicit ask.

Bump the \`version\` patch number (e.g. 0.1.0 → 0.1.1; 0.1.5 → 0.1.6).
Cite the same \`cited_doc_slugs\` unless the user asked you to add or
remove sources.

Return a SINGLE JSON object — no prose around it, no markdown fences,
no preamble. The object MUST validate against this JSON Schema:

\`\`\`json
__SCHEMA__
\`\`\``;

const ADAPTATION_PREAMBLE = `## Open42 adaptation

You are NOT running inside the gbrain CLI. The host product persists the
skill you produce in a Postgres-backed registry — there is no Git repo,
no \`gbrain check-resolvable\`, no fixture-brain E2E. Drop checklist
items 8 (CLI check-resolvable) and 9 (fixture-brain E2E) from the
contract. Items 1–7 and 10 still apply.

## Output contract

Return a SINGLE JSON object — no prose around it, no markdown fences,
no preamble. The object MUST validate against this JSON Schema:

\`\`\`json
__SCHEMA__
\`\`\`

The \`body\` field is the post-frontmatter content of SKILL.md (markdown).
Headings (## Contract, ## Phases, ## Output Format) are required.
\`cited_doc_slugs\` is the deduplicated list of source slugs your draft
leans on — pull from the Sources section of the user message.`;

export interface ThreadCitation {
  slug: string;
  excerpt: string;
  lastUpdated?: string;
}

export interface PreviousDraft {
  /** Frontmatter from the prior committed version. */
  frontmatter: Record<string, unknown>;
  /** Markdown body from the prior committed version. */
  body: string;
}

export interface GenerateSkillInput {
  workspaceId: string;
  /**
   * Mint mode: what the user wants the skill to do.
   * Revise mode: what the user wants changed about the existing draft.
   * Free-form in both cases.
   */
  intent: string;
  /**
   * Mint mode: sources from the chat thread that grounded the answer.
   * Revise mode: empty array — the existing draft body carries the
   * substance, citations are already encoded in `cited_doc_slugs`.
   */
  threadCitations: ThreadCitation[];
  /**
   * If set, the generator runs in REVISE mode: the meta-prompt's adaptation
   * preamble is replaced with a revise-mode preamble, and the user message
   * includes the previous draft so the model amends in place.
   */
  previousDraft?: PreviousDraft;
  /**
   * Resolved BYOK Anthropic key + optional model override. The route layer
   * MUST call `resolveLlmKey({ workspaceId, provider: 'anthropic', scope: 'chat' })`
   * and short-circuit 503 when it returns null before invoking this function.
   */
  resolvedAnthropic: ResolvedLlmKey;
}

export interface GenerateSkillOutput {
  draft: SkillDraft;
  /** Anthropic model that produced the final draft (after any retries). */
  model: string;
  /** Number of repair retries we ran (0 = first attempt validated). */
  retries: number;
}

/**
 * One model turn. Maps onto `messages[]` for `anthropic.messages.create`.
 * Kept narrow on purpose — the dependency-injected `complete` callback
 * receives the same shape so tests can mock without an SDK.
 */
export interface GenerateMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateRequest {
  systemPrompt: string;
  messages: GenerateMessage[];
  model: string;
  signal?: AbortSignal;
}

export type CompleteFn = (req: GenerateRequest) => Promise<string>;

export interface GenerateSkillDeps {
  /**
   * Optional override for the LLM call. Defaults to a real Anthropic SDK
   * call honouring `resolvedAnthropic.apiKey` + the optional `.model`
   * override. Tests inject a stub.
   */
  complete?: CompleteFn;
}

export async function generateSkill(
  input: GenerateSkillInput,
  deps: GenerateSkillDeps = {},
): Promise<GenerateSkillOutput> {
  const complete = deps.complete ?? buildAnthropicComplete(input.resolvedAnthropic);
  const model = pickModel(input.resolvedAnthropic);
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('skill_generation_timeout'));
    }, SKILLIFY_TIMEOUT_MS);
  });

  const generation = runGenerateSkill(input, complete, model, controller.signal);
  generation.catch(() => undefined);

  try {
    return await Promise.race([generation, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function runGenerateSkill(
  input: GenerateSkillInput,
  complete: CompleteFn,
  model: string,
  signal: AbortSignal,
): Promise<GenerateSkillOutput> {
  const systemPrompt = buildSystemPrompt(!!input.previousDraft);
  const userMessage = buildUserMessage(input);
  const messages: GenerateMessage[] = [{ role: 'user', content: userMessage }];

  for (let attempt = 0; attempt <= MAX_REPAIR_RETRIES; attempt += 1) {
    const raw = await complete({ systemPrompt, messages, model, signal });
    const parsed = parseDraftJson(raw);
    if (parsed.ok) {
      const validation = checkDraft(parsed.value);
      if (validation.ok) {
        return { draft: validation.value, model, retries: attempt };
      }
      // Schema failure — feed the validator's complaint back as a repair turn.
      messages.push({ role: 'assistant', content: raw });
      messages.push({
        role: 'user',
        content: buildRepairMessage(validation.errors),
      });
      continue;
    }
    // Parse failure — same repair loop, different error message.
    messages.push({ role: 'assistant', content: raw });
    messages.push({
      role: 'user',
      content: `Your previous response was not parseable as JSON. Error: ${parsed.error}. Return ONLY a single JSON object matching the schema — no markdown fences, no prose.`,
    });
  }

  throw new Error('skill_generation_failed');
}

export function bumpPatch(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error('invalid_semver');
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3]) + 1}`;
}

function buildSystemPrompt(isRevise: boolean): string {
  const schemaJson = JSON.stringify(SkillDraftSchema, null, 2);
  const preamble = isRevise ? REVISE_PREAMBLE : ADAPTATION_PREAMBLE;
  return `${SKILLIFY_META_PROMPT}\n\n${preamble.replace('__SCHEMA__', schemaJson)}`;
}

function buildUserMessage(input: GenerateSkillInput): string {
  if (input.previousDraft) {
    const fm = JSON.stringify(input.previousDraft.frontmatter, null, 2);
    return [
      'Existing draft frontmatter:',
      fm,
      '',
      'Existing draft body:',
      input.previousDraft.body,
      '',
      'Revision request from the user:',
      input.intent,
    ].join('\n');
  }
  const sources = input.threadCitations.length
    ? input.threadCitations
        .map((c, idx) => {
          const stamp = c.lastUpdated ? ` (updated ${c.lastUpdated})` : '';
          return `[${idx + 1}] ${c.slug}${stamp}\n${c.excerpt}`;
        })
        .join('\n\n')
    : '(no thread citations available — draft from intent alone)';
  return `Intent:\n${input.intent}\n\nSources:\n${sources}`;
}

function buildRepairMessage(errors: string[]): string {
  return [
    'Your previous draft did not validate. Fix these problems and return a corrected JSON object:',
    '',
    ...errors.map((e) => `- ${e}`),
    '',
    'Return ONLY the corrected JSON object — no prose, no markdown fences.',
  ].join('\n');
}

interface ParseOk {
  ok: true;
  value: unknown;
}

interface ParseErr {
  ok: false;
  error: string;
}

/** Tolerant JSON parser — strips a leading ```json fence if the model adds one. */
export function parseDraftJson(raw: string): ParseOk | ParseErr {
  const trimmed = raw.trim();
  const stripped = trimmed
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  try {
    return { ok: true, value: JSON.parse(stripped) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown JSON parse error';
    return { ok: false, error: message };
  }
}

interface CheckOk {
  ok: true;
  value: SkillDraft;
}

interface CheckErr {
  ok: false;
  errors: string[];
}

/** Validate against the SkillDraft TypeBox schema, collect human-readable errors. */
export function checkDraft(value: unknown): CheckOk | CheckErr {
  if (Value.Check(SkillDraftSchema, value)) {
    const draft = value as SkillDraft;
    for (const heading of REQUIRED_SKILL_BODY_HEADINGS) {
      if (!draft.body.includes(heading)) {
        return {
          ok: false,
          errors: [`/body: missing required section "${heading}"`],
        };
      }
    }
    return { ok: true, value: draft };
  }
  const errors: string[] = [];
  for (const e of Value.Errors(SkillDraftSchema, value)) {
    const path = e.path || '/';
    errors.push(`${path}: ${e.message}`);
    if (errors.length >= 8) {
      errors.push('… (further errors truncated)');
      break;
    }
  }
  return { ok: false, errors };
}

function pickModel(resolved: ResolvedLlmKey): string {
  return resolved.model?.trim() || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

function buildAnthropicComplete(resolved: ResolvedLlmKey): CompleteFn {
  return async (req) => {
    const client = new Anthropic({
      apiKey: resolved.apiKey,
      timeout: SKILLIFY_TIMEOUT_MS,
      maxRetries: 0,
    });
    const response = await client.messages.create(
      {
        model: req.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: req.systemPrompt,
        messages: req.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      },
      {
        signal: req.signal,
        timeout: SKILLIFY_TIMEOUT_MS,
        maxRetries: 0,
      },
    );
    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error('skill_generation_no_text_response');
    }
    return block.text;
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Re-export for callers that want to inspect the prompt without invoking the
// generator (tests, dev tools, the future SkillPanel debug view).
export { SKILLIFY_META_PROMPT };
