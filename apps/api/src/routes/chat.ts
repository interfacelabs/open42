import Anthropic from '@anthropic-ai/sdk';
import { eq } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { validateSession } from '../auth/sessions.js';
import { db, schema } from '../db/client.js';
import { GbrainCitationChunk, GbrainClient } from '../gbrain/client.js';

export const chatRouter = Router();

chatRouter.post('/', async (req, res, next) => {
  try {
    const query = String(req.body?.query ?? '').trim();
    if (!query) {
      res.status(400).json({ error: 'query_required' });
      return;
    }

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

    const gbrain = new GbrainClient({
      workspaceId: workspace.id,
      baseUrl: workspace.gbrainBaseUrl,
      oauthClientId: workspace.gbrainOauthClientId,
      oauthClientSecretCiphertext: workspace.gbrainOauthClientSecretCiphertext,
    });
    const retrieval = await gbrain.query({ query, limit: 8, detail: 'chunks' });
    const chunks = normalizeChunks(retrieval.chunks ?? retrieval.results ?? []);
    const citations = chunks.map((chunk, index) => ({
      index: index + 1,
      slug: chunk.slug ?? `source-${index + 1}`,
      version_id: chunk.version_id ?? null,
      last_updated: chunk.last_updated ?? null,
      excerpt: chunk.excerpt ?? chunk.chunk_text ?? '',
    }));

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

    await streamAnthropicAnswer({ query, chunks, res });
    res.end(JSON.stringify({ type: 'done' }) + '\n');
  } catch (err) {
    next(err);
  }
});

function normalizeChunks(chunks: GbrainCitationChunk[]): GbrainCitationChunk[] {
  return chunks.slice(0, 8).map((chunk) => ({
    ...chunk,
    excerpt: chunk.excerpt ?? chunk.chunk_text,
  }));
}

async function streamAnthropicAnswer(options: {
  query: string;
  chunks: GbrainCitationChunk[];
  res: { write: (chunk: string) => void };
}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === 'sk-ant-...') {
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

  const anthropic = new Anthropic({ apiKey });
  const context = options.chunks
    .map(
      (chunk, index) =>
        `[${index + 1}] slug=${chunk.slug ?? 'unknown'} version=${chunk.version_id ?? 'unknown'} updated=${chunk.last_updated ?? 'unknown'}\n${chunk.excerpt ?? chunk.chunk_text ?? ''}`,
    )
    .join('\n\n');
  const stream = anthropic.messages.stream({
    model: process.env.ANTHROPIC_MODEL ?? 'claude-3-5-sonnet-latest',
    max_tokens: 700,
    system:
      'You answer as Open42. Use only the provided context. Every factual claim must include a bracketed citation like [1]. If the context is insufficient, say so plainly.',
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
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user?.currentWorkspaceId) return null;

  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, user.currentWorkspaceId))
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
