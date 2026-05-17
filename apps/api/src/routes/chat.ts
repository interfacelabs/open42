import { and, desc, eq } from 'drizzle-orm';
import { Router } from 'express';

import { resolveLlmKey, type LlmProvider, type ResolvedLlmKey } from '../auth/llm-keys.js';
import { recordCloudLlmUsage } from '../cloud-hooks.js';
import { isUuid } from '../auth/uuid.js';
import { db, schema } from '../db/client.js';
import { GbrainCitationChunk, GbrainClient } from '../gbrain/client.js';
import { requireMembership } from '../middleware/require-membership.js';
import { checkWorkspaceChatBudget } from './chat-budget.js';
import {
  bodySizeBytes,
  MAX_CHAT_BODY_BYTES,
  MAX_CHAT_HISTORY_MESSAGES,
  truncateHistory,
} from './chat-history.js';
import { buildSystemPrompt, type SkillContext } from './chat-prompt.js';
import {
  ChatProviderError,
  createChatProvider,
  type NormalizedMessage,
} from './chat-providers.js';

export { buildSystemPrompt, type SkillContext } from './chat-prompt.js';

export const chatRouter = Router();

chatRouter.post('/', requireMembership({ from: 'body' }), async (req, res, next) => {
  try {
    if (bodySizeBytes(req.body) > MAX_CHAT_BODY_BYTES) {
      res.status(413).json({ error: 'chat_body_too_large' });
      return;
    }

    const query = String(req.body?.query ?? '').trim();
    if (!query) {
      res.status(400).json({ error: 'query_required' });
      return;
    }
    const priorMessages = parsePriorMessages(req.body?.messages);
    if (!priorMessages.ok) {
      res.status(400).json({ error: priorMessages.error });
      return;
    }
    if (priorMessages.messages.length > MAX_CHAT_HISTORY_MESSAGES) {
      res.status(400).json({ error: 'chat_history_too_long' });
      return;
    }

    const skillId =
      typeof req.body?.skillId === 'string' && req.body.skillId.trim()
        ? req.body.skillId.trim()
        : null;

    // `requireMembership` validated the session cookie and asserted membership
    // in the body-supplied workspace_id. Both are guaranteed to be set here.
    const session = req.session!;
    const workspaceId = req.workspace!.id;

    const workspace = await loadWorkspaceRuntime(workspaceId);
    if (!workspace) {
      res.status(409).json({ error: 'workspace_not_ready' });
      return;
    }

    const skillContext = skillId ? await loadSkillContext(workspace.id, skillId) : null;
    if (skillId && !skillContext) {
      // The user pointed at a skill that doesn't exist (or doesn't belong
      // to their workspace). Treat as a routing error, not a chat error.
      res.status(404).json({ error: 'skill_not_found' });
      return;
    }

    const budget = checkWorkspaceChatBudget({
      workspaceId: workspace.id,
      inputChars:
        query.length +
        priorMessages.messages.reduce((sum, message) => sum + message.content.length, 0) +
        (skillContext?.body.length ?? 0),
    });
    if (!budget.ok) {
      res.setHeader('Retry-After', String(budget.retryAfter));
      res.status(429).json({ error: budget.error });
      return;
    }

    const gbrain = new GbrainClient(
      {
        workspaceId: workspace.id,
        baseUrl: workspace.gbrainBaseUrl,
        oauthClientId: workspace.gbrainOauthClientId,
        oauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
      },
      { callerUserId: session.userId },
    );
    const retrieval = await gbrain.query({ query, limit: 8, detail: 'chunks' });
    const chunks = normalizeChunks(retrieval.chunks ?? retrieval.results ?? []);
    const citations = chunks.map((chunk, index) => ({
      index: index + 1,
      slug: chunk.slug ?? `source-${index + 1}`,
      version_id: chunk.version_id ?? null,
      last_updated: chunk.last_updated ?? null,
      excerpt: chunk.excerpt ?? chunk.chunk_text ?? '',
    }));

    // Log one row per (turn, distinct-slug) so the Library "Most cited"
    // collection has real data to rank from. Best-effort — a write failure
    // here doesn't fail the chat response (the user still gets their answer).
    await logDocumentCitations(workspace.id, citations);
    const chatProvider = workspace.chatProvider;
    const resolvedLlmKey =
      citations.length > 0
        ? await resolveLlmKey({
            workspaceId: workspace.id,
            provider: chatProvider,
            scope: 'chat',
          })
        : null;

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.write(JSON.stringify({ type: 'citations', citations }) + '\n');

    if (citations.length === 0) {
      res.write(
        JSON.stringify({
          type: 'token',
          text: "I don't have anything about this in your brain.",
        }) + '\n',
      );
      res.end(JSON.stringify({ type: 'done' }) + '\n');
      return;
    }

    const usedSharedKey = await streamProviderAnswer({
      provider: chatProvider,
      resolvedLlmKey,
      messages: buildProviderMessages({
        history: truncateHistory({ messages: priorMessages.messages }),
        query,
        chunks,
      }),
      skillContext,
      res,
    });
    if (usedSharedKey && resolvedLlmKey?.source === 'shared') {
      void recordCloudLlmUsage({
        workspaceId: workspace.id,
        provider: chatProvider,
        scope: 'chat',
        keySource: 'shared',
        units: 1,
      }).catch(() => {
        // Billing ledger writes must never corrupt a completed chat stream.
      });
    }
    res.end(JSON.stringify({ type: 'done' }) + '\n');
  } catch (err) {
    next(err);
  }
});

/**
 * Resolve the latest version of a workspace-owned skill so the chat thread
 * can run "in skill mode": the skill's body is prepended to the system
 * prompt as a binding policy. Returns null on cross-tenant or unknown ids
 * — the caller must surface 404, not silently ignore.
 */
export async function loadSkillContext(
  workspaceId: string,
  skillId: string,
): Promise<SkillContext | null> {
  if (!isUuid(skillId)) return null;

  const [skill] = await db
    .select()
    .from(schema.skills)
    .where(and(eq(schema.skills.id, skillId), eq(schema.skills.workspaceId, workspaceId)))
    .limit(1);
  if (!skill) return null;

  const [version] = await db
    .select()
    .from(schema.skillVersions)
    .where(eq(schema.skillVersions.skillId, skill.id))
    .orderBy(desc(schema.skillVersions.createdAt))
    .limit(1);
  if (!version) return null;

  return {
    id: skill.id,
    name: skill.name,
    version: version.version,
    body: version.body,
  };
}

async function logDocumentCitations(workspaceId: string, citations: Array<{ slug: string }>) {
  const uniqueSlugs = Array.from(
    new Set(
      citations.map((c) => c.slug).filter((s): s is string => !!s && !s.startsWith('source-')),
    ),
  );
  if (uniqueSlugs.length === 0) return;
  try {
    await db.insert(schema.documentCitations).values(
      uniqueSlugs.map((slug) => ({
        workspaceId,
        docSlug: slug,
      })),
    );
  } catch {
    // Audit-style write — never fail the user's chat response on this path.
  }
}

function normalizeChunks(chunks: GbrainCitationChunk[]): GbrainCitationChunk[] {
  return chunks.slice(0, 8).map((chunk) => ({
    ...chunk,
    excerpt: chunk.excerpt ?? chunk.chunk_text,
  }));
}

export function buildProviderMessages(input: {
  history: NormalizedMessage[];
  query: string;
  chunks: GbrainCitationChunk[];
}): NormalizedMessage[] {
  const context = input.chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] slug=${chunk.slug ?? 'unknown'} version=${chunk.version_id ?? 'unknown'} updated=${chunk.last_updated ?? 'unknown'}\n${chunk.excerpt ?? chunk.chunk_text ?? ''}`,
    )
    .join('\n\n');
  return [
    ...input.history,
    { role: 'user', content: `Context:\n${context}` },
    { role: 'user', content: `Question: ${input.query}` },
  ];
}

function parsePriorMessages(
  value: unknown,
): { ok: true; messages: NormalizedMessage[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, messages: [] };
  if (!Array.isArray(value)) return { ok: false, error: 'invalid_chat_messages' };

  const messages: NormalizedMessage[] = [];
  for (const item of value) {
    const candidate = item as { role?: unknown; text?: unknown; content?: unknown };
    if (candidate.role !== 'user' && candidate.role !== 'assistant') {
      return { ok: false, error: 'invalid_chat_message_role' };
    }
    const content =
      typeof candidate.text === 'string'
        ? candidate.text.trim()
        : typeof candidate.content === 'string'
          ? candidate.content.trim()
          : '';
    if (!content) continue;
    messages.push({ role: candidate.role, content });
  }
  return { ok: true, messages };
}

async function streamProviderAnswer(options: {
  provider: LlmProvider;
  resolvedLlmKey: ResolvedLlmKey | null;
  messages: NormalizedMessage[];
  skillContext: SkillContext | null;
  res: { write: (chunk: string) => void };
}): Promise<boolean> {
  if (!options.resolvedLlmKey || isPlaceholderApiKey(options.resolvedLlmKey.apiKey)) {
    const first = firstCitationMessage(options.messages);
    options.res.write(
      JSON.stringify({
        type: 'token',
        text: `The strongest source I found is ${first ?? 'the imported page'} [1]. `,
      }) + '\n',
    );
    options.res.write(
      JSON.stringify({
        type: 'token',
        text: 'Review the cited source before acting on this policy.',
      }) + '\n',
    );
    return false;
  }

  const adapter = createChatProvider(options.provider);
  try {
    const stream = adapter.sendStreamingChat({
      systemPrompt: buildSystemPrompt(options.skillContext),
      messages: options.messages,
      resolvedKey: options.resolvedLlmKey,
      maxTokens: 700,
    });

    for await (const event of stream) {
      options.res.write(JSON.stringify({ type: 'token', text: event.text }) + '\n');
    }
  } catch (err) {
    const code = err instanceof ChatProviderError ? err.code : 'chat_provider_error';
    options.res.write(JSON.stringify({ type: 'error', error: code }) + '\n');
    return false;
  }
  return true;
}

function isPlaceholderApiKey(apiKey: string): boolean {
  return apiKey === 'sk-ant-...' || apiKey === 'sk-...' || apiKey.endsWith('-...');
}

function firstCitationMessage(messages: NormalizedMessage[]): string | null {
  const contextMessage = messages.find((message) => message.content.startsWith('Context:\n'));
  const match = /\[1\]\s+slug=([^\s]+)/.exec(contextMessage?.content ?? '');
  return match?.[1] ?? null;
}

/**
 * Load workspace runtime fields needed to talk to the per-tenant gbrain.
 * Membership has already been asserted by `requireMembership`; this only
 * reads the gbrain credentials and falls back to `gbrainPrivateAddress` when no
 * public baseUrl is configured (legacy ingest path).
 */
async function loadWorkspaceRuntime(workspaceId: string) {
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (
    !workspace ||
    !(workspace.gbrainBaseUrl || workspace.gbrainPrivateAddress) ||
    !workspace.gbrainOauthClientId ||
    !workspace.gbrainOauthClientSecretCiphertext
  ) {
    return null;
  }
  return {
    id: workspace.id,
    gbrainBaseUrl: workspace.gbrainBaseUrl ?? formatGbrainBaseUrl(workspace.gbrainPrivateAddress ?? ''),
    gbrainOauthClientId: workspace.gbrainOauthClientId,
    gbrainOauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
    chatProvider: workspace.chatProvider ?? 'anthropic',
  };
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}
