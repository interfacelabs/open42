import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../env.js';
import { requireMembership as realRequireMembership } from '../../middleware/require-membership.js';

/**
 * Route-level coverage for the wide-Skillify endpoints. DB-backed: skipped
 * when DATABASE_URL is unset (matches `auth.test.ts` / `ingest.test.ts`
 * patterns). The LLM call and BYOK key resolution are mocked so the tests
 * don't need a real Anthropic key or workspace_credentials row.
 *
 * The router now lives under `/workspaces/:id/skills` and is gated by
 * `requireMembership({ from: 'param' })`. The test app mounts that real
 * middleware so the DB-side membership check still runs end-to-end (which
 * is what catches cross-tenant probes — exercised by the "another workspace"
 * tests below).
 */

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

const mocks = vi.hoisted(() => ({
  resolveLlmKey: vi.fn(),
  generateSkill: vi.fn(),
  getChunks: vi.fn(),
}));

vi.mock('../../auth/llm-keys.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../auth/llm-keys.js')>('../../auth/llm-keys.js');
  return { ...actual, resolveLlmKey: mocks.resolveLlmKey };
});

vi.mock('../../skills/generate.js', async () => {
  const actual = await vi.importActual<typeof import('../../skills/generate.js')>(
    '../../skills/generate.js',
  );
  return { ...actual, generateSkill: mocks.generateSkill };
});

vi.mock('../../gbrain/client.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../gbrain/client.js')>('../../gbrain/client.js');
  // GbrainClient is invoked with `new` in the route. Arrow functions in
  // `vi.fn().mockImplementation` aren't constructable, so the route hit the
  // real client and 500'd. Class form keeps `new` semantics.
  class MockGbrainClient {
    async getChunks(slug: string) {
      return mocks.getChunks(slug);
    }
  }
  return { ...actual, GbrainClient: MockGbrainClient };
});

const sampleDraft = {
  frontmatter: {
    name: 'sample-skill',
    version: '0.1.0',
    description:
      'Use when answering refund, return, cancellation, or enterprise SLA refund questions.',
    triggers: ['refund', 'return', 'enterprise refund'],
    mutating: false,
  },
  body: '## Contract\n\nUse cited sources when answering refunds.\n\n## Phases\n\n1. Read the question.\n2. Apply the cited policy.\n3. Cite [1] inline.\n\n## Output Format\n\nA bracketed citation per claim, plus the policy text the user asked about. This body is intentionally long enough to clear the 200-char minimum the schema enforces.',
  cited_doc_slugs: ['refund-policy-2024', 'enterprise-msa'],
};

function mintPayload(intent: string) {
  return {
    intent,
    threadCitations: sampleDraft.cited_doc_slugs.map((slug) => ({
      slug,
      excerpt: `forged browser excerpt for ${slug}`,
      lastUpdated: '2026-04-01',
    })),
  };
}

describeDb('skills routes', () => {
  let mod: typeof import('./mint.js');
  let dbMod: typeof import('../../db/client.js');
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    mod = await import('./mint.js');
    dbMod = await import('../../db/client.js');
  });

  beforeEach(() => {
    mocks.resolveLlmKey.mockReset();
    mocks.generateSkill.mockReset();
    mocks.getChunks.mockReset();
    mocks.resolveLlmKey.mockResolvedValue({
      apiKey: 'sk-ant-test',
      source: 'tenant',
      model: null,
    });
    mocks.getChunks.mockImplementation(async (slug: string) => [
      {
        slug,
        chunk_text: `Canonical server excerpt for ${slug}`,
        last_updated: '2026-04-01',
      },
    ]);
    mocks.generateSkill.mockResolvedValue({
      draft: sampleDraft,
      model: 'claude-3-5-sonnet-latest',
      retries: 0,
    });
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.skills)
        .where(eq(dbMod.schema.skills.workspaceId, workspaceId));
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
    app.use(express.json());
    app.use(cookieParser());
    app.use(
      '/workspaces/:id/skills',
      realRequireMembership({ from: 'param' }),
      mod.skillsRouter,
    );
    return app;
  }

  // Path helpers — the old tests used `/skills/...`; rebuild them under the
  // new workspace-scoped mount. Each test gets the correct workspace id from
  // its `makeOwnerWorkspace` result.
  const skillsPath = (workspaceId: string) =>
    `/workspaces/${workspaceId}/skills`;
  const skillPath = (workspaceId: string, skillId: string) =>
    `/workspaces/${workspaceId}/skills/${skillId}`;

  describe('POST /workspaces/:id/skills (mint)', () => {
    it('returns 401 without a session cookie', async () => {
      const { workspaceId } = await makeOwnerWorkspace('test-agent');
      const res = await request(buildApp())
        .post(skillsPath(workspaceId))
        .send({ intent: 'Draft a refund-policy skill' });
      expect(res.status).toBe(401);
    });

    it('returns 403 when the caller is not a member of the workspace', async () => {
      // A mints in workspace A, B holds workspace B's session but pokes A's path.
      const a = await makeOwnerWorkspace('agent-a');
      const b = await makeOwnerWorkspace('agent-b');
      const res = await request(buildApp())
        .post(skillsPath(a.workspaceId))
        .set('User-Agent', 'agent-b')
        .set('Cookie', `open42_session=${b.sessionId}`)
        .send(mintPayload('Cross-tenant mint'));
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'workspace_membership_required' });
    });

    it('returns 400 when intent is missing', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const res = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'intent_required' });
    });

    it('returns 503 when no LLM key is configured', async () => {
      mocks.resolveLlmKey.mockResolvedValueOnce(null);
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const res = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({ intent: 'Draft something' });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: 'upstream_key_unconfigured' });
    });

    it('returns 201 + persists skills + skill_versions + skill_revisions on success', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const res = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft a sample skill'));
      expect(res.status).toBe(201);
      expect(res.body.draft.name).toBe('sample-skill');
      expect(res.body.draft.version).toBe('0.1.0');
      expect(res.body.draft.cites).toHaveLength(2);
      expect(res.body.draft.revisions).toHaveLength(1);
      expect(res.body.draft.revisions[0]).toMatchObject({
        role: 'brain',
        cites: '[1] [2]',
      });
      expect(mocks.getChunks).toHaveBeenCalledWith('refund-policy-2024');
      expect(mocks.getChunks).toHaveBeenCalledWith('enterprise-msa');
      const generateInput = mocks.generateSkill.mock.calls[0]?.[0];
      expect(generateInput.threadCitations[0]).toMatchObject({
        slug: 'refund-policy-2024',
        excerpt: 'Canonical server excerpt for refund-policy-2024',
      });
      expect(generateInput.threadCitations[0].excerpt).not.toContain('forged');

      // Persistence assertions — every layer of the wide-skillify table set
      // got a row, and they're scoped to the right workspace.
      const skills = await dbMod.db
        .select()
        .from(dbMod.schema.skills)
        .where(eq(dbMod.schema.skills.workspaceId, workspaceId));
      expect(skills).toHaveLength(1);
      expect(skills[0]?.name).toBe('sample-skill');

      const versions = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skills[0]!.id));
      expect(versions).toHaveLength(1);
      expect(versions[0]?.version).toBe('0.1.0');

      const revisions = await dbMod.db
        .select()
        .from(dbMod.schema.skillRevisions)
        .where(eq(dbMod.schema.skillRevisions.skillId, skills[0]!.id));
      expect(revisions).toHaveLength(1);
      expect(revisions[0]?.role).toBe('brain');
    });

    it('returns 409 when the LLM picks a name that already exists', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      // First call wins.
      const first = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft once'));
      expect(first.status).toBe(201);
      // Same draft → same `name` → unique-violation maps to 409.
      const second = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft again'));
      expect(second.status).toBe(409);
      expect(second.body).toEqual({ error: 'skill_name_already_exists' });
    });

    it('returns 422 when the model cites a slug the server did not fetch', async () => {
      mocks.generateSkill.mockResolvedValueOnce({
        draft: {
          ...sampleDraft,
          cited_doc_slugs: ['invented-source'],
        },
        model: 'claude-3-5-sonnet-latest',
        retries: 0,
      });
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');

      const res = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({
          intent: 'Draft once',
          threadCitations: [{ slug: 'refund-policy-2024' }],
        });

      expect(res.status).toBe(422);
      expect(res.body).toEqual({ error: 'skill_citations_invalid' });
    });

    it('returns 504 when skill generation times out', async () => {
      mocks.generateSkill.mockRejectedValueOnce(new Error('skill_generation_timeout'));
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');

      const res = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft once'));

      expect(res.status).toBe(504);
      expect(res.body).toEqual({ error: 'skill_generation_timeout' });
    });
  });

  describe('GET /workspaces/:id/skills/:skillId/draft', () => {
    it('returns 404 for an invalid uuid', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const res = await request(buildApp())
        .get(`${skillsPath(workspaceId)}/not-a-uuid/draft`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'skill_not_found' });
    });

    it('returns 404 for a skill that belongs to another workspace', async () => {
      // Mint in workspace A.
      const a = await makeOwnerWorkspace('agent-a');
      const minted = await request(buildApp())
        .post(skillsPath(a.workspaceId))
        .set('User-Agent', 'agent-a')
        .set('Cookie', `open42_session=${a.sessionId}`)
        .send(mintPayload('Draft'));
      expect(minted.status).toBe(201);
      const skillId = minted.body.draft.id;

      // Fetch from workspace B (B owns its own workspace and points at it) →
      // 404 because A's skill isn't visible there. Cross-tenant probing
      // reveals nothing.
      const b = await makeOwnerWorkspace('agent-b');
      const res = await request(buildApp())
        .get(`${skillPath(b.workspaceId, skillId)}/draft`)
        .set('User-Agent', 'agent-b')
        .set('Cookie', `open42_session=${b.sessionId}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /workspaces/:id/skills/:skillId (download)', () => {
    it('returns 404 for an invalid uuid', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const res = await request(buildApp())
        .post(`${skillsPath(workspaceId)}/not-a-uuid`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'skill_not_found' });
    });

    it('downloads the zip and writes a skill_exports audit row', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      expect(minted.status).toBe(201);
      const skillId = minted.body.draft.id as string;

      const res = await request(buildApp())
        .post(skillPath(workspaceId, skillId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('application/zip');

      const exports = await dbMod.db
        .select()
        .from(dbMod.schema.skillExports)
        .where(eq(dbMod.schema.skillExports.skillId, skillId));
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatchObject({
        citationsCount: 2,
        citedDocSlugs: sampleDraft.cited_doc_slugs,
        stalenessWarning: false,
      });
    });
  });

  describe('POST /workspaces/:id/skills/:skillId/revise', () => {
    it('writes a new version + two revisions and returns the bumped draft', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      expect(minted.status).toBe(201);
      const skillId = minted.body.draft.id as string;

      // Next generateSkill call returns a bumped version.
      mocks.generateSkill.mockResolvedValueOnce({
        draft: {
          ...sampleDraft,
          frontmatter: { ...sampleDraft.frontmatter, version: '0.1.1' },
        },
        model: 'claude-3-5-sonnet-latest',
        retries: 0,
      });

      const res = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/revise`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({ text: 'Make it more concise.' });
      expect(res.status).toBe(200);
      expect(res.body.draft.version).toBe('0.1.1');
      // Initial brain revision + 'you' + new brain revision.
      expect(res.body.draft.revisions).toHaveLength(3);
      expect(res.body.draft.revisions[1]).toMatchObject({
        role: 'you',
        text: 'Make it more concise.',
      });
      expect(res.body.draft.revisions[2]).toMatchObject({
        role: 'brain',
        text: 'Revised to v0.1.1.',
      });
    });

    it('bumps to v0.1.1 even when the model returns the same version string', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      const skillId = minted.body.draft.id as string;

      mocks.generateSkill.mockResolvedValueOnce({
        draft: sampleDraft,
        model: 'claude-3-5-sonnet-latest',
        retries: 0,
      });

      const res = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/revise`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({ text: 'Tweak nothing.' });
      expect(res.status).toBe(200);
      expect(res.body.draft.version).toBe('0.1.1');
      expect(res.body.draft.revisions.at(-1)).toMatchObject({
        role: 'brain',
        text: 'Revised to v0.1.1.',
      });
    });

    it('keeps the original skill name when the model changes frontmatter.name', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      const skillId = minted.body.draft.id as string;

      mocks.generateSkill.mockResolvedValueOnce({
        draft: {
          ...sampleDraft,
          frontmatter: {
            ...sampleDraft.frontmatter,
            name: 'model-renamed-skill',
            version: '9.9.9',
          },
        },
        model: 'claude-3-5-sonnet-latest',
        retries: 0,
      });

      const res = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/revise`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({ text: 'Rename it maliciously.' });
      expect(res.status).toBe(200);
      expect(res.body.draft.name).toBe('sample-skill');
      expect(res.body.draft.version).toBe('0.1.1');

      const versions = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skillId));
      expect(
        versions.every(
          (version) => (version.frontmatter as { name?: string }).name === 'sample-skill',
        ),
      ).toBe(true);
    });

    it('returns 400 when text is missing', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      const skillId = minted.body.draft.id as string;

      const res = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/revise`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'text_required' });
    });

    it('returns 404 for an invalid uuid', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const res = await request(buildApp())
        .post(`${skillsPath(workspaceId)}/not-a-uuid/revise`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({ text: 'Trying to revise' });
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'skill_not_found' });
    });

    it('returns 504 when revision generation times out', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      const skillId = minted.body.draft.id as string;
      mocks.generateSkill.mockRejectedValueOnce(new Error('skill_generation_timeout'));

      const res = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/revise`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({ text: 'Make it time out.' });
      expect(res.status).toBe(504);
      expect(res.body).toEqual({ error: 'skill_generation_timeout' });
    });

    it('returns 404 when reviseing a skill from another workspace', async () => {
      const a = await makeOwnerWorkspace('agent-a');
      const minted = await request(buildApp())
        .post(skillsPath(a.workspaceId))
        .set('User-Agent', 'agent-a')
        .set('Cookie', `open42_session=${a.sessionId}`)
        .send(mintPayload('Draft'));
      const skillId = minted.body.draft.id as string;

      // B authenticated against B's workspace; A's skill not found there.
      const b = await makeOwnerWorkspace('agent-b');
      const res = await request(buildApp())
        .post(`${skillPath(b.workspaceId, skillId)}/revise`)
        .set('User-Agent', 'agent-b')
        .set('Cookie', `open42_session=${b.sessionId}`)
        .send({ text: 'Trying to revise across tenants' });
      expect(res.status).toBe(404);
    });
  });

  async function makeOwnerWorkspace(
    userAgent: string,
  ): Promise<{ userId: string; workspaceId: string; sessionId: string }> {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `skills-route-${Date.now()}-${Math.random()}@open42.test` })
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
});
