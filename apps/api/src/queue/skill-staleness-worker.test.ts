import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { db, schema } from '../db/client.js';
import { citedTextSha256 } from '../skills/provenance.js';
import { isB3Enabled } from './skill-staleness-queue.js';
import {
  runSkillStalenessSweep,
  type SkillStalenessRepo,
  type StalenessCandidate,
} from './skill-staleness-worker.js';

const baseCandidate: StalenessCandidate = {
  workspaceId: 'workspace-1',
  skillId: 'skill-1',
  skillVersionId: 'version-1',
  citationIndex: 1,
  slug: 'refund-policy',
  previousVersionId: '1',
  previousCitedText: 'Annual customers have thirty days.',
  previousCitedTextSha256: citedTextSha256('Annual customers have thirty days.'),
};

describe('isB3Enabled', () => {
  it('defaults on and accepts false-like opt-outs', () => {
    expect(isB3Enabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isB3Enabled({ OPEN42_B3_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isB3Enabled({ open42_b3_enabled: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isB3Enabled({ OPEN42_B3_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('runSkillStalenessSweep', () => {
  it('records stale cited spans with a cached changelog when hashes change', async () => {
    const staleWrites: unknown[] = [];
    const repo = fakeRepo([baseCandidate], { staleWrites });
    const generateChangelog = vi.fn(async () => 'Refund window changed to fourteen days.');

    const result = await runSkillStalenessSweep(
      {},
      {
        repo,
        buildGbrain: async () => ({
          getChunks: async () => [
            {
              slug: 'refund-policy',
              version_id: 2,
              chunk_text: 'Annual customers have fourteen days.',
            },
          ],
        }),
        resolveLlmKey: async () => ({
          apiKey: 'sk-ant-test',
          source: 'tenant',
          model: 'claude-haiku-test',
        }),
        generateChangelog,
        now: () => new Date('2026-05-17T05:00:00.000Z'),
      },
    );

    expect(result).toEqual({ checked: 1, stale: 1, resolved: 0 });
    expect(generateChangelog).toHaveBeenCalledWith({
      slug: 'refund-policy',
      previousText: 'Annual customers have thirty days.',
      latestText: 'Annual customers have fourteen days.',
      resolvedAnthropic: {
        apiKey: 'sk-ant-test',
        source: 'tenant',
        model: 'claude-haiku-test',
      },
    });
    expect(staleWrites[0]).toMatchObject({
      skillVersionId: 'version-1',
      citationIndex: 1,
      slug: 'refund-policy',
      latestVersionId: '2',
      changelog: 'Refund window changed to fourteen days.',
      detectedAt: new Date('2026-05-17T05:00:00.000Z'),
    });
  });

  it('resolves existing stale rows when the cited span hash matches again', async () => {
    const resolvedWrites: unknown[] = [];
    const repo = fakeRepo([baseCandidate], { resolvedWrites });

    const result = await runSkillStalenessSweep(
      {},
      {
        repo,
        buildGbrain: async () => ({
          getChunks: async () => [
            {
              slug: 'refund-policy',
              version_id: 1,
              chunk_text: 'Annual customers have thirty days.',
            },
          ],
        }),
        resolveLlmKey: async () => null,
        now: () => new Date('2026-05-17T05:10:00.000Z'),
      },
    );

    expect(result).toEqual({ checked: 1, stale: 0, resolved: 1 });
    expect(resolvedWrites[0]).toEqual({
      skillVersionId: 'version-1',
      citationIndex: 1,
      resolvedAt: new Date('2026-05-17T05:10:00.000Z'),
    });
  });

  it('does not mark a skill stale when unrelated page text changes around the cited span', async () => {
    const resolvedWrites: unknown[] = [];
    const staleWrites: unknown[] = [];
    const repo = fakeRepo([baseCandidate], { resolvedWrites, staleWrites });

    const result = await runSkillStalenessSweep(
      {},
      {
        repo,
        buildGbrain: async () => ({
          getChunks: async () => [
            {
              slug: 'refund-policy',
              version_id: 2,
              chunk_text: 'Annual customers have thirty days.\n\nUnrelated appendix changed.',
            },
          ],
        }),
        resolveLlmKey: async () => null,
        now: () => new Date('2026-05-17T05:12:00.000Z'),
      },
    );

    expect(result).toEqual({ checked: 1, stale: 0, resolved: 1 });
    expect(staleWrites).toHaveLength(0);
    expect(resolvedWrites[0]).toEqual({
      skillVersionId: 'version-1',
      citationIndex: 1,
      resolvedAt: new Date('2026-05-17T05:12:00.000Z'),
    });
  });
});

describe('runSkillStalenessSweep default repo', () => {
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it('persists stale rows from real provenance records', async () => {
    const previousText = 'Annual customers have thirty days.';
    const { workspaceId, skillId, skillVersionId } = await makeSkillWithProvenance(previousText);

    const result = await runSkillStalenessSweep(
      { workspaceId },
      {
        buildGbrain: async () => ({
          getChunks: async () => [
            {
              slug: 'refund-policy',
              version_id: 2,
              chunk_text: 'Annual customers have fourteen days.',
            },
          ],
        }),
        resolveLlmKey: async () => ({
          apiKey: 'sk-ant-test',
          source: 'tenant',
          model: 'claude-haiku-test',
        }),
        generateChangelog: async () => 'Refund window changed to fourteen days.',
        now: () => new Date('2026-05-17T05:00:00.000Z'),
      },
    );

    expect(result).toEqual({ checked: 1, stale: 1, resolved: 0 });

    const rows = await db
      .select()
      .from(schema.skillStaleness)
      .where(eq(schema.skillStaleness.skillVersionId, skillVersionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId,
      skillId,
      citationIndex: 1,
      slug: 'refund-policy',
      previousVersionId: '1',
      latestVersionId: '2',
      changelog: 'Refund window changed to fourteen days.',
      status: 'stale',
      detectedAt: new Date('2026-05-17T05:00:00.000Z'),
    });
    expect(rows[0]?.previousCitedTextSha256).toBe(citedTextSha256(previousText));
    expect(rows[0]?.latestCitedTextSha256).toBe(
      citedTextSha256('Annual customers have fourteen days.'),
    );
  });

  async function makeSkillWithProvenance(previousText: string) {
    const [user] = await db
      .insert(schema.users)
      .values({ email: `stale-sweep-${Date.now()}-${Math.random()}@open42.test` })
      .returning();
    if (!user) throw new Error('staleness test user insert failed');
    userIds.push(user.id);

    const [workspace] = await db
      .insert(schema.workspaces)
      .values({
        ownerUserId: user.id,
        gbrainVersion: 'test-0.0.0',
        gbrainBaseUrl: 'http://brain.test',
        gbrainOauthClientId: 'client_test',
        gbrainOauthClientSecretCiphertext: Buffer.from('cipher'),
      })
      .returning();
    if (!workspace) throw new Error('staleness test workspace insert failed');
    workspaceIds.push(workspace.id);

    const [skill] = await db
      .insert(schema.skills)
      .values({ workspaceId: workspace.id, name: 'refund-policy' })
      .returning();
    if (!skill) throw new Error('staleness test skill insert failed');

    const [version] = await db
      .insert(schema.skillVersions)
      .values({
        skillId: skill.id,
        version: '0.1.0',
        frontmatter: {
          name: 'refund-policy',
          version: '0.1.0',
          description: 'Use when answering refund-policy questions.',
          triggers: ['refund'],
          mutating: false,
        },
        body: '## Contract\n\nAnswer refund-policy questions with citations.',
        citedDocSlugs: ['refund-policy'],
        createdByUserId: user.id,
      })
      .returning();
    if (!version) throw new Error('staleness test version insert failed');

    await db.insert(schema.skillCitationProvenance).values({
      skillVersionId: version.id,
      citationIndex: 1,
      slug: 'refund-policy',
      versionId: '1',
      citedText: previousText,
      citedTextSha256: citedTextSha256(previousText),
    });

    return { workspaceId: workspace.id, skillId: skill.id, skillVersionId: version.id };
  }
});

function fakeRepo(
  candidates: StalenessCandidate[],
  writes: { staleWrites?: unknown[]; resolvedWrites?: unknown[] },
): SkillStalenessRepo {
  return {
    async listCandidates() {
      return candidates;
    },
    async markResolved(input) {
      writes.resolvedWrites?.push(input);
    },
    async upsertStale(input) {
      writes.staleWrites?.push(input);
    },
  };
}
