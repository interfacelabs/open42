import cookieParser from 'cookie-parser';
import express from 'express';
import { eq } from 'drizzle-orm';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runChatEval } from './run.js';
import { CHAT_EVAL_DOCS, seedBrain } from './seed-brain.js';

interface LocalFixtureServer {
  server: Server;
  url: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const EVAL_USER_AGENT = 'open42-chat-eval-local';

config({ path: resolve(repoRoot, '.env.local'), override: false });
config({ path: resolve(repoRoot, '.env'), override: false });

type EvalProvider = 'openai' | 'anthropic';

async function main() {
  const provider = resolveEvalProvider();
  const apiKey = keyForProvider(provider);

  const [{ db, schema }, { encryptSecret }, { upsertLlmKey }, { chatRouter }] = await Promise.all([
    import('../../apps/api/src/db/client.js'),
    import('../../apps/api/src/crypto/envelope.js'),
    import('../../apps/api/src/auth/llm-keys.js'),
    import('../../apps/api/src/routes/chat.js'),
  ]);

  const gbrain = await startFakeGbrain();
  const api = await startChatApi(chatRouter);
  let workspaceId: string | null = null;
  let userId: string | null = null;

  try {
    await seedBrain({ mcpUrl: `${gbrain.url}/mcp`, token: 'eval-token' });

    const [user] = await db
      .insert(schema.users)
      .values({ email: `chat-eval-${Date.now()}-${randomUUID()}@open42.test` })
      .returning();
    if (!user) throw new Error('chat eval fixture user insert failed');
    userId = user.id;

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        name: 'Chat eval fixture',
        ownerUserId: user.id,
        gbrainVersion: 'eval-fixture',
        gbrainBaseUrl: gbrain.url,
        gbrainOauthClientId: 'eval-client',
        gbrainOauthClientSecretCiphertext: Buffer.from('fixture-pending-secret'),
        chatProvider: provider,
        status: 'ready',
      })
      .returning();
    if (!workspace) throw new Error('chat eval fixture workspace insert failed');
    workspaceId = workspace.id;

    await db.insert(schema.memberships).values({
      userId: user.id,
      workspaceId: workspace.id,
      role: 'owner',
    });

    const secretCiphertext = encryptSecret('eval-secret', {
      workspaceId: workspace.id,
      purpose: 'gbrain_oauth_secret',
    });
    await db
      .update(schema.workspaces)
      .set({ gbrainOauthClientSecretCiphertext: secretCiphertext })
      .where(eq(schema.workspaces.id, workspace.id));

    await upsertLlmKey({
      workspaceId: workspace.id,
      provider,
      scope: 'chat',
      apiKey,
      model: modelForProvider(provider),
    });

    const [session] = await db
      .insert(schema.sessions)
      .values({
        userId: user.id,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
        csrfToken: 'chat-eval-csrf',
        userAgent: EVAL_USER_AGENT,
        ipFirstOctet: '127',
      })
      .returning();
    if (!session) throw new Error('chat eval fixture session insert failed');

    const summary = await runChatEval({
      apiUrl: api.url,
      workspaceId: workspace.id,
      cookie: `open42_session=${session.id}`,
      userAgent: EVAL_USER_AGENT,
    });

    console.log(JSON.stringify(summary, null, 2));
    if (summary.passed < summary.passThreshold) process.exitCode = 1;
  } finally {
    if (workspaceId) {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    if (userId) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    await closeServer(api.server);
    await closeServer(gbrain.server);
  }
}

function resolveEvalProvider(): EvalProvider {
  const configured = process.env.OPEN42_CHAT_EVAL_PROVIDER?.trim();
  if (configured === 'openai' || configured === 'anthropic') return configured;
  if (process.env.OPENAI_API_KEY?.trim()) return 'openai';
  return 'anthropic';
}

function keyForProvider(provider: EvalProvider): string {
  const envName = provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const key = process.env[envName]?.trim();
  if (!key) {
    throw new Error(`${envName} is required for npm run eval:chat:local`);
  }
  return key;
}

function modelForProvider(provider: EvalProvider): string | null {
  if (provider === 'openai') return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  return process.env.ANTHROPIC_MODEL?.trim() || null;
}

async function startChatApi(chatRouter: express.Router): Promise<LocalFixtureServer> {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use('/chat', chatRouter);
  return listen(app);
}

async function startFakeGbrain(): Promise<LocalFixtureServer> {
  const docs = new Map<string, string>();
  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/token') {
        json(res, 200, { access_token: 'eval-token', expires_in: 3600 });
        return;
      }

      if (req.method === 'POST' && req.url === '/mcp') {
        const body = (await readJson(req)) as {
          id?: unknown;
          params?: { name?: unknown; arguments?: Record<string, unknown> };
        };
        const name = typeof body.params?.name === 'string' ? body.params.name : '';
        const args = body.params?.arguments ?? {};

        if (name === 'put_page') {
          const slug = typeof args.slug === 'string' ? args.slug : '';
          const content = typeof args.content === 'string' ? args.content : '';
          if (slug) docs.set(slug, content);
          jsonRpc(res, body.id, { ok: true });
          return;
        }

        if (name === 'query') {
          const query = typeof args.query === 'string' ? args.query : '';
          jsonRpc(res, body.id, { chunks: chunksForQuery(docs, query) });
          return;
        }

        if (name === 'get_chunks') {
          const slug = typeof args.slug === 'string' ? args.slug : '';
          const content = docs.get(slug);
          jsonRpc(res, body.id, content ? [chunk(slug, content)] : []);
          return;
        }

        jsonRpc(res, body.id, { ok: true });
        return;
      }

      json(res, 404, { error: 'not_found' });
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : 'fixture_error' });
    }
  });
  return listenServer(server);
}

function chunksForQuery(docs: Map<string, string>, query: string) {
  const normalized = query.toLowerCase();
  if (normalized.includes('enterprise') || normalized.includes('exception')) {
    return [chunkFromDocs(docs, 'enterprise-msa'), chunkFromDocs(docs, 'refund-policy')].filter(
      Boolean,
    );
  }
  if (
    normalized.includes('after') ||
    normalized.includes('instead') ||
    normalized.includes('offer')
  ) {
    return [chunkFromDocs(docs, 'billing-faq'), chunkFromDocs(docs, 'refund-policy')].filter(
      Boolean,
    );
  }
  return [chunkFromDocs(docs, 'refund-policy')].filter(Boolean);
}

function chunkFromDocs(docs: Map<string, string>, slug: string) {
  const content = docs.get(slug);
  return content ? chunk(slug, content) : null;
}

function chunk(slug: string, content: string) {
  return {
    slug,
    version_id: 1,
    last_updated: '2026-05-17',
    chunk_text: content,
    excerpt: content,
    score: 0.99,
  };
}

function listen(handler: RequestListener | express.Express) {
  return listenServer(createServer(handler as RequestListener));
}

function listenServer(server: Server) {
  return new Promise<LocalFixtureServer>((resolveServer, reject) => {
    server.once('error', reject);
    server.once('listening', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('local fixture failed to allocate a TCP port'));
        return;
      }
      resolveServer({ server, url: `http://127.0.0.1:${address.port}` });
    });
    server.listen(0, '127.0.0.1');
  });
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveJson, reject) => {
    let body = '';
    req.on('data', (chunkValue: Buffer) => {
      body += chunkValue.toString('utf8');
    });
    req.on('end', () => {
      try {
        resolveJson(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function jsonRpc(res: ServerResponse, id: unknown, result: unknown) {
  json(res, 200, {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    },
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(`${JSON.stringify(body)}\n`);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, reject) => {
    server.close((err) => (err ? reject(err) : resolveClose()));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exitCode = 1;
  });
}
