import express from 'express';
import cookieParser from 'cookie-parser';
import { eq } from 'drizzle-orm';
import AdmZip from 'adm-zip';
import { createHash, webcrypto } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request, { type Response } from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import '../../env.js';
import { requireMembership as realRequireMembership } from '../../middleware/require-membership.js';
import { resetShareLinkRateLimitForTest } from '../../skills/share-link.js';

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
  generateSkillExplainer: vi.fn(),
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

vi.mock('../../skills/explainer.js', async () => {
  const actual = await vi.importActual<typeof import('../../skills/explainer.js')>(
    '../../skills/explainer.js',
  );
  return { ...actual, generateSkillExplainer: mocks.generateSkillExplainer };
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
  let sharedMod: typeof import('../shared-skills.js');
  let signingKeyMod: typeof import('../workspaces/signing-key.js');
  let dbMod: typeof import('../../db/client.js');
  let shareStoreDir: string;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    process.env.OPEN42_KEK ??= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    shareStoreDir = await mkdtemp(join(tmpdir(), 'open42-mint-share-'));
    process.env.OPEN42_SKILL_BUNDLE_STORE_DIR = shareStoreDir;
    mod = await import('./mint.js');
    sharedMod = await import('../shared-skills.js');
    signingKeyMod = await import('../workspaces/signing-key.js');
    dbMod = await import('../../db/client.js');
  });

  afterAll(async () => {
    if (shareStoreDir) await rm(shareStoreDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    resetShareLinkRateLimitForTest();
    mocks.resolveLlmKey.mockReset();
    mocks.generateSkill.mockReset();
    mocks.generateSkillExplainer.mockReset();
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
        version_id: slug === 'refund-policy-2024' ? 3 : 2,
        last_updated: '2026-04-01',
      },
    ]);
    mocks.generateSkillExplainer.mockResolvedValue('Use this skill for refund-policy answers.');
    mocks.generateSkill.mockResolvedValue({
      draft: sampleDraft,
      model: 'claude-3-5-sonnet-latest',
      retries: 0,
    });
  });

  afterEach(async () => {
    resetShareLinkRateLimitForTest();
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
    app.use('/shared', sharedMod.buildSharedSkillsRouter());
    app.use('/workspaces', signingKeyMod.buildWorkspaceSigningKeyRouter());
    app.use('/workspaces/:id/skills', realRequireMembership({ from: 'param' }), mod.skillsRouter);
    return app;
  }

  // Path helpers — the old tests used `/skills/...`; rebuild them under the
  // new workspace-scoped mount. Each test gets the correct workspace id from
  // its `makeOwnerWorkspace` result.
  const skillsPath = (workspaceId: string) => `/workspaces/${workspaceId}/skills`;
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

    it('persists verified citation excerpts as provenance without whole-page appendix text', async () => {
      mocks.getChunks.mockImplementation(async (slug: string) => {
        if (slug === 'refund-policy-2024') {
          return [
            {
              slug,
              chunk_text: 'Relevant refund span.\n\nUnrelated appendix that changed later.',
              version_id: 3,
              last_updated: '2026-04-01',
            },
          ];
        }
        return [
          {
            slug,
            chunk_text: `Canonical server excerpt for ${slug}`,
            version_id: 2,
            last_updated: '2026-04-01',
          },
        ];
      });
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');

      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send({
          intent: 'Draft a sample skill',
          threadCitations: [
            {
              slug: 'refund-policy-2024',
              excerpt: 'Relevant refund span.',
              lastUpdated: '2026-04-01',
            },
            { slug: 'enterprise-msa' },
          ],
        });

      expect(minted.status).toBe(201);
      const generateInput = mocks.generateSkill.mock.calls[0]?.[0];
      expect(generateInput.threadCitations[0]).toMatchObject({
        slug: 'refund-policy-2024',
        excerpt: 'Relevant refund span.',
      });
      const skillId = minted.body.draft.id as string;
      const [version] = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skillId));
      const beforeExport = await dbMod.db
        .select()
        .from(dbMod.schema.skillCitationProvenance)
        .where(eq(dbMod.schema.skillCitationProvenance.skillVersionId, version!.id));
      expect(beforeExport.find((row) => row.slug === 'refund-policy-2024')).toMatchObject({
        citedText: 'Relevant refund span.',
      });

      const exported = await request(buildApp())
        .post(skillPath(workspaceId, skillId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .buffer(true)
        .parse(binaryParser);
      expect(exported.status).toBe(200);

      const afterExport = await dbMod.db
        .select()
        .from(dbMod.schema.skillCitationProvenance)
        .where(eq(dbMod.schema.skillCitationProvenance.skillVersionId, version!.id));
      expect(afterExport.find((row) => row.slug === 'refund-policy-2024')).toMatchObject({
        citedText: 'Relevant refund span.',
      });
      expect(
        afterExport.find((row) => row.slug === 'refund-policy-2024')?.citedText,
      ).not.toContain('Unrelated appendix');
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
        .set('Cookie', `open42_session=${sessionId}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      expect(res.header['content-type']).toContain('application/zip');
      const zip = new AdmZip(zipResponseBuffer(res));
      const skillMd = zip.readAsText('sample-skill/SKILL.md');
      const signature = zip.readAsText('sample-skill/SKILL.md.sig').trim();
      const manifest = JSON.parse(zip.readAsText('sample-skill/manifest.json')) as {
        signed_payload_sha256: string;
        public_key_url: string;
      };
      expect(skillMd).toContain('explainer: "Use this skill for refund-policy answers."');
      expect(manifest.signed_payload_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifest.public_key_url).toContain(`/workspaces/${workspaceId}/signing-key.pub`);

      const keyRes = await request(buildApp()).get(`/workspaces/${workspaceId}/signing-key.pub`);
      expect(keyRes.status).toBe(200);
      expect(keyRes.text).toContain('BEGIN PUBLIC KEY');
      await expect(
        verifyExportedSkillSignatureWithWebCrypto({
          markdown: skillMd,
          signatureBase64: signature,
          publicKeyPem: keyRes.text,
        }),
      ).resolves.toBe(true);

      const versions = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skillId));
      expect(versions[0]?.frontmatter).toMatchObject({
        explainer: 'Use this skill for refund-policy answers.',
      });

      const provenance = await dbMod.db
        .select()
        .from(dbMod.schema.skillCitationProvenance)
        .where(eq(dbMod.schema.skillCitationProvenance.skillVersionId, versions[0]!.id));
      expect(provenance).toHaveLength(2);
      expect(provenance[0]).toMatchObject({
        citationIndex: 1,
        slug: 'refund-policy-2024',
        versionId: '3',
      });

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

    it('creates a refreshed version before exporting a stale skill', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      expect(minted.status).toBe(201);
      const skillId = minted.body.draft.id as string;

      const [initialVersion] = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skillId));
      expect(initialVersion?.version).toBe('0.1.0');

      await dbMod.db.insert(dbMod.schema.skillStaleness).values({
        workspaceId,
        skillId,
        skillVersionId: initialVersion!.id,
        citationIndex: 1,
        slug: 'refund-policy-2024',
        previousVersionId: '3',
        latestVersionId: '4',
        previousCitedTextSha256: 'a'.repeat(64),
        latestCitedTextSha256: 'b'.repeat(64),
        changelog: 'Refund policy changed since export.',
        status: 'stale',
        detectedAt: new Date('2026-05-17T05:00:00.000Z'),
      });

      const res = await request(buildApp())
        .post(skillPath(workspaceId, skillId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .buffer(true)
        .parse(binaryParser);

      expect(res.status).toBe(200);
      const zip = new AdmZip(zipResponseBuffer(res));
      const skillMd = zip.readAsText('sample-skill/SKILL.md');
      expect(skillMd).toContain('version: 0.1.1');

      const versions = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skillId));
      expect(versions.map((version) => version.version).sort()).toEqual(['0.1.0', '0.1.1']);
      const refreshedVersion = versions.find((version) => version.version === '0.1.1');
      expect(refreshedVersion).toBeTruthy();

      const provenance = await dbMod.db
        .select()
        .from(dbMod.schema.skillCitationProvenance)
        .where(eq(dbMod.schema.skillCitationProvenance.skillVersionId, refreshedVersion!.id));
      expect(provenance).toHaveLength(2);

      const refreshedDraft = await request(buildApp())
        .get(`${skillPath(workspaceId, skillId)}/draft`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`);
      expect(refreshedDraft.status).toBe(200);
      expect(refreshedDraft.body.draft).toMatchObject({
        version: '0.1.1',
        staleness: null,
      });
      expect(refreshedDraft.body.draft.revisions.at(-1)).toMatchObject({
        role: 'brain',
        text: 'Re-exported v0.1.1 from refreshed sources.',
      });
    });

    it('mints an ephemeral signed share link and serves the stored bundle', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      expect(minted.status).toBe(201);
      const skillId = minted.body.draft.id as string;

      const share = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/share`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`);

      expect(share.status).toBe(200);
      expect(share.body.url).toMatch(/\/shared\/[A-Za-z0-9_-]+\.zip$/);
      expect(share.body.expiresAt).toEqual(expect.any(String));
      expect(share.body.publicKeyUrl).toContain(`/workspaces/${workspaceId}/signing-key.pub`);

      const shareRows = await dbMod.db
        .select()
        .from(dbMod.schema.skillShareLinks)
        .where(eq(dbMod.schema.skillShareLinks.skillId, skillId));
      expect(shareRows).toHaveLength(1);
      expect(shareRows[0]?.tokenHash).toHaveLength(32);

      const bundle = await request(buildApp())
        .get(new URL(share.body.url).pathname)
        .buffer(true)
        .parse(binaryParser);
      expect(bundle.status).toBe(200);
      const zip = new AdmZip(zipResponseBuffer(bundle));
      expect(zip.readAsText('sample-skill/SKILL.md.sig')).toMatch(/\S+/);

      const [used] = await dbMod.db
        .select()
        .from(dbMod.schema.skillShareLinks)
        .where(eq(dbMod.schema.skillShareLinks.id, shareRows[0]!.id));
      expect(used?.lastUsedAt).toBeInstanceOf(Date);

      await dbMod.db
        .update(dbMod.schema.skillShareLinks)
        .set({ expiresAt: new Date(Date.now() - 1_000) })
        .where(eq(dbMod.schema.skillShareLinks.id, shareRows[0]!.id));
      const expired = await request(buildApp()).get(new URL(share.body.url).pathname);
      expect(expired.status).toBe(404);
    });

    it('rate-limits share link minting after 10 mints per workspace minute', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      expect(minted.status).toBe(201);
      const skillId = minted.body.draft.id as string;

      for (let i = 0; i < 10; i += 1) {
        const share = await request(buildApp())
          .post(`${skillPath(workspaceId, skillId)}/share`)
          .set('User-Agent', 'test-agent')
          .set('Cookie', `open42_session=${sessionId}`);
        expect(share.status).toBe(200);
      }

      const limited = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/share`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`);

      expect(limited.status).toBe(429);
      expect(limited.headers['retry-after']).toEqual(expect.any(String));
      expect(limited.body).toEqual({ error: 'share_link_rate_limited' });
    });

    it('creates a refreshed version before minting a share link for a stale skill', async () => {
      const { workspaceId, sessionId } = await makeOwnerWorkspace('test-agent');
      const minted = await request(buildApp())
        .post(skillsPath(workspaceId))
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`)
        .send(mintPayload('Draft'));
      expect(minted.status).toBe(201);
      const skillId = minted.body.draft.id as string;

      const [initialVersion] = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skillId));
      expect(initialVersion?.version).toBe('0.1.0');

      await dbMod.db.insert(dbMod.schema.skillStaleness).values({
        workspaceId,
        skillId,
        skillVersionId: initialVersion!.id,
        citationIndex: 1,
        slug: 'refund-policy-2024',
        previousVersionId: '3',
        latestVersionId: '4',
        previousCitedTextSha256: 'a'.repeat(64),
        latestCitedTextSha256: 'b'.repeat(64),
        changelog: 'Refund policy changed since export.',
        status: 'stale',
        detectedAt: new Date('2026-05-17T05:00:00.000Z'),
      });

      const share = await request(buildApp())
        .post(`${skillPath(workspaceId, skillId)}/share`)
        .set('User-Agent', 'test-agent')
        .set('Cookie', `open42_session=${sessionId}`);

      expect(share.status).toBe(200);
      const shareRows = await dbMod.db
        .select()
        .from(dbMod.schema.skillShareLinks)
        .where(eq(dbMod.schema.skillShareLinks.skillId, skillId));
      expect(shareRows).toHaveLength(1);

      const versions = await dbMod.db
        .select()
        .from(dbMod.schema.skillVersions)
        .where(eq(dbMod.schema.skillVersions.skillId, skillId));
      const refreshedVersion = versions.find((version) => version.version === '0.1.1');
      expect(refreshedVersion).toBeTruthy();
      expect(shareRows[0]?.skillVersionId).toBe(refreshedVersion!.id);

      const bundle = await request(buildApp())
        .get(new URL(share.body.url).pathname)
        .buffer(true)
        .parse(binaryParser);
      expect(bundle.status).toBe(200);
      const zip = new AdmZip(zipResponseBuffer(bundle));
      expect(zip.readAsText('sample-skill/SKILL.md')).toContain('version: 0.1.1');
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

function zipResponseBuffer(res: Response): Buffer {
  if (Buffer.isBuffer(res.body)) return res.body;
  if (res.body instanceof Uint8Array) return Buffer.from(res.body);
  return Buffer.from(res.text, 'binary');
}

function binaryParser(res: Response, callback: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  res.on('end', () => callback(null, Buffer.concat(chunks)));
  res.on('error', callback);
}

async function verifyExportedSkillSignatureWithWebCrypto(input: {
  markdown: string;
  signatureBase64: string;
  publicKeyPem: string;
}): Promise<boolean> {
  const canonical = input.markdown
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n*$/, '\n');
  const digest = createHash('sha256').update(canonical, 'utf8').digest();
  const keyDer = Buffer.from(
    input.publicKeyPem.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s+/g, ''),
    'base64',
  );
  const publicKey = await webcrypto.subtle.importKey('spki', keyDer, 'Ed25519', false, ['verify']);

  return webcrypto.subtle.verify(
    'Ed25519',
    publicKey,
    Buffer.from(input.signatureBase64, 'base64'),
    digest,
  );
}
