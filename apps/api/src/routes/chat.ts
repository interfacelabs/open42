import Anthropic from '@anthropic-ai/sdk';
import { and, desc, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { resolveLlmKey, type ResolvedLlmKey } from '../auth/llm-keys.js';
import { resolveOwnerWorkspaceId } from '../auth/membership.js';
import { validateSession } from '../auth/sessions.js';
import { isUuid } from '../auth/uuid.js';
import { db, schema } from '../db/client.js';
import { GbrainCitationChunk, GbrainClient } from '../gbrain/client.js';
import { checkWorkspaceChatBudget } from './chat-budget.js';
import { buildSystemPrompt, type SkillContext } from './chat-prompt.js';

export { buildSystemPrompt, type SkillContext } from './chat-prompt.js';

export const chatRouter = Router();

chatRouter.post('/', async (req, res, next) => {
  try {
    const query = String(req.body?.query ?? '').trim();
    if (!query) {
      res.status(400).json({ error: 'query_required' });
      return;
    }
    const skillId =
      typeof req.body?.skillId === 'string' && req.body.skillId.trim()
        ? req.body.skillId.trim()
        : null;

    const session = await sessionFromRequest(req);
    if (!session) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const workspace = await workspaceForUser(session.userId);
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
      inputChars: query.length + (skillContext?.body.length ?? 0),
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
    const resolvedAnthropic =
      citations.length > 0
        ? await resolveLlmKey({
            workspaceId: workspace.id,
            provider: 'anthropic',
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

    await streamAnthropicAnswer({
      resolvedAnthropic,
      query,
      chunks,
      skillContext,
      res,
    });
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

async function streamAnthropicAnswer(options: {
  resolvedAnthropic: ResolvedLlmKey | null;
  query: string;
  chunks: GbrainCitationChunk[];
  skillContext: SkillContext | null;
  res: { write: (chunk: string) => void };
}) {
  if (!options.resolvedAnthropic || options.resolvedAnthropic.apiKey === 'sk-ant-...') {
    const first = options.chunks[0];
    options.res.write(
      JSON.stringify({
        type: 'token',
        text: `The strongest source I found is ${first?.slug ?? 'the imported page'} [1]. `,
      }) + '\n',
    );
    options.res.write(
      JSON.stringify({
        type: 'token',
        text: 'Review the cited source before acting on this policy.',
      }) + '\n',
    );
    return;
  }

  const anthropic = new Anthropic({ apiKey: options.resolvedAnthropic.apiKey });
  const context = options.chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] slug=${chunk.slug ?? 'unknown'} version=${chunk.version_id ?? 'unknown'} updated=${chunk.last_updated ?? 'unknown'}\n${chunk.excerpt ?? chunk.chunk_text ?? ''}`,
    )
    .join('\n\n');
  const stream = anthropic.messages.stream({
    model:
      options.resolvedAnthropic.model?.trim() ||
      process.env.ANTHROPIC_MODEL ||
      'claude-3-5-sonnet-latest',
    max_tokens: 700,
    system: buildSystemPrompt(options.skillContext),
    messages: [
      {
        role: 'user',
        content: `Question: ${options.query}\n\nContext:\n${context}`,
      },
    ],
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      options.res.write(JSON.stringify({ type: 'token', text: event.delta.text }) + '\n');
    }
  }
}

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, { userAgent: req.header('user-agent'), ip: req.ip });
}

async function workspaceForUser(userId: string) {
  // Authorization claim comes from `memberships`, NOT `users.currentWorkspaceId`.
  // See apps/api/src/auth/membership.ts (Codex ship-blocker #1).
  const workspaceId = await resolveOwnerWorkspaceId(userId);
  if (!workspaceId) return null;

  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (
    !(workspace?.gbrainBaseUrl || workspace?.flyPrivateIp) ||
    !workspace.gbrainOauthClientId ||
    !workspace.gbrainOauthClientSecretCiphertext
  ) {
    return null;
  }
  return {
    id: workspace.id,
    gbrainBaseUrl: workspace.gbrainBaseUrl ?? formatGbrainBaseUrl(workspace.flyPrivateIp ?? ''),
    gbrainOauthClientId: workspace.gbrainOauthClientId,
    gbrainOauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
  };
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}
