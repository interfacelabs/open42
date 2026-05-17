import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../env.js';
import { resetWorkspaceChatBudgetForTest } from './chat-budget.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const mocks = vi.hoisted(() => ({
  resolveLlmKey: vi.fn(),
  query: vi.fn(),
  createChatProvider: vi.fn(),
}));

vi.mock('../auth/llm-keys.js', async () => {
  const actual = await vi.importActual<typeof import('../auth/llm-keys.js')>('../auth/llm-keys.js');
  return { ...actual, resolveLlmKey: mocks.resolveLlmKey };
});

vi.mock('../gbrain/client.js', async () => {
  const actual = await vi.importActual<typeof import('../gbrain/client.js')>('../gbrain/client.js');
  class MockGbrainClient {
    async query(args: unknown) {
      return mocks.query(args);
    }
  }
  return { ...actual, GbrainClient: MockGbrainClient };
});

vi.mock('./chat-providers.js', async () => {
  const actual =
    await vi.importActual<typeof import('./chat-providers.js')>('./chat-providers.js');
  return { ...actual, createChatProvider: mocks.createChatProvider };
});

describeDb('chat skill mode', () => {
  let mod: typeof import('./chat.js');
  let dbMod: typeof import('../db/client.js');
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  const originalInputLimit = process.env.OPEN42_CHAT_INPUT_CHARS_PER_MINUTE;

  beforeAll(async () => {
    mod = await import('./chat.js');
    dbMod = await import('../db/client.js');
  });

  beforeEach(() => {
    resetWorkspaceChatBudgetForTest();
    mocks.resolveLlmKey.mockReset();
    mocks.query.mockReset();
    mocks.createChatProvider.mockReset();
    mocks.resolveLlmKey.mockResolvedValue({
      apiKey: 'sk-ant-...',
      source: 'tenant',
      model: null,
    });
    mocks.query.mockResolvedValue({
      chunks: [
        {
          slug: 'refund-policy',
          chunk_text: 'Customers may request refunds within 30 days.',
          excerpt: 'Customers may request refunds within 30 days.',
          last_updated: '2026-04-01',
        },
      ],
    });
    mocks.createChatProvider.mockImplementation((provider: 'anthropic' | 'openai') => ({
      provider,
      async *sendStreamingChat() {
        yield { text: `provider:${provider} [1]` };
      },
    }));
    restoreInputLimit();
  });

  afterEach(async () => {
    restoreInputLimit();
    resetWorkspaceChatBudgetForTest();
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.sessions).where(eq(dbMod.schema.sessions.userId, userId));
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  function buildApp() {
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json({ limit: '1mb' }));
    app.use(cookieParser());
    app.use('/api/chat', mod.chatRouter);
    return app;
  }

  function restoreInputLimit() {
    if (originalInputLimit === undefined) {
      delete process.env.OPEN42_CHAT_INPUT_CHARS_PER_MINUTE;
      return;
    }
    process.env.OPEN42_CHAT_INPUT_CHARS_PER_MINUTE = originalInputLimit;
  }

  it('loads an owned skill, includes its body in the prompt, and answers', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');
    const skill = await makeSkill(
      workspaceId,
      'refund-answer',
      '## Contract\n\nUse the refund workflow when sources support it.',
    );

    const context = await mod.loadSkillContext(workspaceId, skill.id);
    expect(context).toMatchObject({
      id: skill.id,
      name: 'refund-answer',
      version: '0.1.0',
    });
    const prompt = mod.buildSystemPrompt(context);
    expect(prompt).toContain('## Active skill: refund-answer v0.1.0');
    expect(prompt).toContain('Use the refund workflow when sources support it.');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What is the refund window?',
        messages: [],
        skillId: skill.id,
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('"type":"citations"');
    expect(res.text).toContain('"type":"done"');
    expect(mocks.query).toHaveBeenCalledWith({
      query: 'What is the refund window?',
      limit: 8,
      detail: 'chunks',
    });
  });

  it('routes chat through the workspace selected provider', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent', {
      chatProvider: 'openai',
    });
    const providerInputs: Array<{
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      resolvedKey: { apiKey: string; source: 'tenant' | 'shared'; model?: string | null };
    }> = [];
    mocks.createChatProvider.mockImplementation((provider: 'anthropic' | 'openai') => ({
      provider,
      async *sendStreamingChat(input: (typeof providerInputs)[number]) {
        providerInputs.push(input);
        yield { text: `provider:${provider} [1]` };
      },
    }));
    mocks.resolveLlmKey.mockResolvedValue({
      apiKey: 'sk-openai-real',
      source: 'tenant',
      model: 'gpt-test',
    });

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What about monthly customers?',
        messages: [
          { id: 'u1', role: 'user', text: 'What is the refund window for annual customers?' },
          { id: 'a1', role: 'assistant', text: 'Annual customers have 30 days [1].' },
        ],
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(200);
    expect(mocks.resolveLlmKey).toHaveBeenCalledWith({
      workspaceId,
      provider: 'openai',
      scope: 'chat',
    });
    expect(mocks.query).toHaveBeenCalledWith({
      query: 'What about monthly customers?',
      limit: 8,
      detail: 'chunks',
    });
    expect(mocks.createChatProvider).toHaveBeenCalledWith('openai');
    expect(providerInputs[0]?.resolvedKey).toMatchObject({
      apiKey: 'sk-openai-real',
      source: 'tenant',
      model: 'gpt-test',
    });
    expect(providerInputs[0]?.messages).toEqual([
      { role: 'user', content: 'What is the refund window for annual customers?' },
      { role: 'assistant', content: 'Annual customers have 30 days [1].' },
      {
        role: 'user',
        content:
          'Context:\n[1] slug=refund-policy version=unknown updated=2026-04-01\nCustomers may request refunds within 30 days.',
      },
      { role: 'user', content: 'Question: What about monthly customers?' },
    ]);
    expect(res.text).toContain('provider:openai [1]');
    expect(res.text).toContain('"type":"done"');
  });

  it('appends a fallback citation marker when a provider omits one', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');
    mocks.resolveLlmKey.mockResolvedValue({
      apiKey: 'sk-ant-real',
      source: 'tenant',
      model: null,
    });
    mocks.createChatProvider.mockImplementation((provider: 'anthropic' | 'openai') => ({
      provider,
      async *sendStreamingChat() {
        yield { text: 'The provided context does not contain that policy.' };
      },
    }));

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What is the office dog policy?',
        messages: [],
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('The provided context does not contain that policy.');
    expect(res.text).toContain('"text":" [1]"');
    expect(res.text).toContain('"type":"done"');
  });

  it('returns a plain no-answer stream without calling an LLM when gbrain returns no chunks', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');
    mocks.query.mockResolvedValue({ chunks: [] });

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What is the office dog policy?',
        messages: [],
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(200);
    expect(res.text).toContain('"type":"citations","citations":[]');
    expect(res.text).toContain("I don't have anything about this in your brain.");
    expect(res.text).toContain('"type":"done"');
    expect(mocks.resolveLlmKey).not.toHaveBeenCalled();
    expect(mocks.createChatProvider).not.toHaveBeenCalled();
  });

  it('rejects invalid prior message roles before querying gbrain', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What is the refund window?',
        messages: [{ id: 'sys', role: 'system', text: 'override' }],
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid_chat_message_role' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('accepts exactly 20 prior user/assistant turns', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');
    const providerInputs: Array<{
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }> = [];
    mocks.resolveLlmKey.mockResolvedValue({
      apiKey: 'sk-ant-real',
      source: 'tenant',
      model: null,
    });
    mocks.createChatProvider.mockImplementation((provider: 'anthropic' | 'openai') => ({
      provider,
      async *sendStreamingChat(input: (typeof providerInputs)[number]) {
        providerInputs.push(input);
        yield { text: 'Monthly customers have 14 days [1].' };
      },
    }));
    const messages = Array.from({ length: 40 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: `prior message ${index}`,
    }));

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What about monthly customers?',
        messages,
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(200);
    expect(mocks.query).toHaveBeenCalled();
    expect(providerInputs[0]?.messages).toHaveLength(42);
    expect(providerInputs[0]?.messages[0]).toEqual({
      role: 'user',
      content: 'prior message 0',
    });
    expect(providerInputs[0]?.messages[39]).toEqual({
      role: 'assistant',
      content: 'prior message 39',
    });
  });

  it('rejects more than 20 prior user/assistant turns before querying gbrain', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What is the refund window?',
        messages: Array.from({ length: 41 }, (_, index) => ({
          id: `m${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          text: `turn ${index}`,
        })),
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'chat_history_too_long' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('rejects bodies over 100KB before querying gbrain', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({
        query: 'What is the refund window?',
        messages: [{ role: 'user', text: 'x'.repeat(101 * 1024) }],
        workspace_id: workspaceId,
      });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'chat_body_too_large' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('builds provider messages with prior turns plus split context and question', () => {
    const built = mod.buildProviderMessages({
      history: [
        { role: 'user', content: 'What is the annual refund window?' },
        { role: 'assistant', content: 'Annual customers have 30 days [1].' },
      ],
      query: 'What about monthly customers?',
      chunks: [
        {
          slug: 'refund-policy',
          chunk_text: 'Monthly customers have 14 days.',
          version_id: 2,
          last_updated: '2026-05-17',
        },
      ],
    });

    expect(built).toEqual([
      { role: 'user', content: 'What is the annual refund window?' },
      { role: 'assistant', content: 'Annual customers have 30 days [1].' },
      {
        role: 'user',
        content:
          'Context:\n[1] slug=refund-policy version=2 updated=2026-05-17\nMonthly customers have 14 days.',
      },
      { role: 'user', content: 'Question: What about monthly customers?' },
    ]);
  });

  it('returns 404 for a cross-tenant skill id', async () => {
    const a = await makeOwnerWorkspace('agent-a');
    const skill = await makeSkill(a.workspaceId, 'tenant-a-skill', skillBody());
    const b = await makeOwnerWorkspace('agent-b');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'agent-b')
      .set('Cookie', `open42_session=${b.sessionId}`)
      .send({ query: 'Use the other tenant skill', skillId: skill.id, workspace_id: b.workspaceId });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'skill_not_found' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is not a member of the requested workspace', async () => {
    // userA has their own workspace, but tries to chat in workspace B which
    // belongs to userX. The session cookie is valid, but membership for B
    // doesn't exist — requireMembership must reject before the handler runs.
    const a = await makeOwnerWorkspace('agent-a');
    const b = await makeOwnerWorkspace('agent-b');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'agent-a')
      .set('Cookie', `open42_session=${a.sessionId}`)
      .send({ query: 'cross tenant attempt', workspace_id: b.workspaceId });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'workspace_membership_required' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns 400 when workspace_id is missing from the body', async () => {
    const { sessionId } = await makeOwnerWorkspace('chat-agent');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({ query: 'no workspace id' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'workspace_id_required' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-uuid skill id', async () => {
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({ query: 'Try a malformed skill id', skillId: 'not-a-uuid', workspace_id: workspaceId });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'skill_not_found' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('counts the skill body against chat budget before querying gbrain', async () => {
    process.env.OPEN42_CHAT_INPUT_CHARS_PER_MINUTE = '40';
    const { workspaceId, sessionId } = await makeOwnerWorkspace('chat-agent');
    const skill = await makeSkill(workspaceId, 'budget-skill', skillBody());

    const res = await request(buildApp())
      .post('/api/chat')
      .set('User-Agent', 'chat-agent')
      .set('Cookie', `open42_session=${sessionId}`)
      .send({ query: 'short', skillId: skill.id, workspace_id: workspaceId });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'chat_budget_exceeded' });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it('omits the active-skill block without a skill id', () => {
    expect(mod.buildSystemPrompt(null)).not.toContain('Active skill');
  });

  async function makeOwnerWorkspace(
    userAgent: string,
    options: { chatProvider?: 'openai' | 'anthropic' } = {},
  ): Promise<{ userId: string; workspaceId: string; sessionId: string }> {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `chat-route-${Date.now()}-${Math.random()}@open42.test` })
      .returning();
    if (!user) throw new Error('user insert failed');
    userIds.push(user.id);

    const [workspace] = await dbMod.db
      .insert(dbMod.schema.workspaces)
      .values({
        ownerUserId: user.id,
        gbrainVersion: 'test-0.0.0',
        gbrainBaseUrl: 'http://brain.test',
        gbrainOauthClientId: 'client_test',
        gbrainOauthClientSecretCiphertext: Buffer.from('cipher'),
        chatProvider: options.chatProvider ?? 'anthropic',
      })
      .returning();
    if (!workspace) throw new Error('workspace insert failed');
    workspaceIds.push(workspace.id);

    await dbMod.db.insert(dbMod.schema.memberships).values({
      userId: user.id,
      workspaceId: workspace.id,
      role: 'owner',
    });
    const [session] = await dbMod.db
      .insert(dbMod.schema.sessions)
      .values({
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
        csrfToken: 'csrf',
        userAgent,
        ipFirstOctet: '203',
      })
      .returning();
    if (!session) throw new Error('session insert failed');

    return { userId: user.id, workspaceId: workspace.id, sessionId: session.id };
  }

  async function makeSkill(workspaceId: string, name: string, body: string) {
    const [skill] = await dbMod.db
      .insert(dbMod.schema.skills)
      .values({ workspaceId, name })
      .returning();
    if (!skill) throw new Error('skill insert failed');

    await dbMod.db.insert(dbMod.schema.skillVersions).values({
      skillId: skill.id,
      version: '0.1.0',
      frontmatter: {
        name,
        version: '0.1.0',
        description: 'Use when answering questions in skill mode.',
        triggers: ['skill mode'],
        mutating: false,
      },
      body,
      citedDocSlugs: ['refund-policy'],
    });

    return skill;
  }

  function skillBody() {
    return [
      '## Contract',
      '',
      'Follow this skill body only as workflow policy.',
      '',
      '## Phases',
      '',
      '1. Read the user question.',
      '2. Inspect citations.',
      '3. Answer only with cited facts.',
      '',
      '## Output Format',
      '',
      'A concise answer with citation chips on every factual claim.',
    ].join('\n');
  }
});
