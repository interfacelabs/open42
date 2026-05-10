import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  assembleLibrary,
  chunksToDocDetail,
  enrichWithCitationCounts,
  normalizeListPages,
  pageToDoc,
} from './assemble.js';

const RUN_DB_TESTS = !!process.env.DATABASE_URL;
const describeDb = RUN_DB_TESTS ? describe : describe.skip;

describe('normalizeListPages', () => {
  it('passes a plain array through', () => {
    const out = normalizeListPages([{ slug: 'a' }, { slug: 'b' }]);
    expect(out).toHaveLength(2);
  });

  it('extracts a `pages` field', () => {
    const out = normalizeListPages({ pages: [{ slug: 'a' }] });
    expect(out).toHaveLength(1);
  });

  it('extracts a `results` field', () => {
    const out = normalizeListPages({ results: [{ slug: 'a' }, { slug: 'b' }] });
    expect(out).toHaveLength(2);
  });

  it('returns [] for unrecognized shapes', () => {
    expect(normalizeListPages(null)).toEqual([]);
    expect(normalizeListPages('hello')).toEqual([]);
    expect(normalizeListPages({ foo: 'bar' })).toEqual([]);
  });
});

describe('pageToDoc', () => {
  it('returns null when slug is missing', () => {
    expect(pageToDoc({})).toBeNull();
  });

  it('maps slug, last_updated, and tags array', () => {
    const doc = pageToDoc({
      slug: 'refund-policy',
      title: 'Refund Policy',
      last_updated: '2026-04-01T00:00:00.000Z',
      tags: ['policy', 'billing', 42],
      source_url: 'https://www.notion.so/refund',
      author: 'sarah@x.com',
    });
    expect(doc).toMatchObject({
      id: 'refund-policy',
      title: 'Refund Policy',
      source: 'notion',
      sourceUrl: 'https://www.notion.so/refund',
      author: 'sarah@x.com',
      lastModifiedAt: '2026-04-01T00:00:00.000Z',
      tags: ['policy', 'billing'],
      citationCount: 0,
    });
  });

  it('falls back to slug for title and accepts a single tag string', () => {
    const doc = pageToDoc({ slug: 'foo', tag: 'pricing' });
    expect(doc?.title).toBe('foo');
    expect(doc?.tags).toEqual(['pricing']);
  });
});

describe('assembleLibrary', () => {
  const NOW = new Date('2026-05-09T00:00:00.000Z');
  const docs = [
    {
      id: 'fresh',
      title: 'Fresh',
      source: 'notion',
      lastModifiedAt: '2026-05-08T00:00:00.000Z',
      tags: ['policy'],
      citationCount: 0,
    },
    {
      id: 'aging',
      title: 'Aging',
      source: 'notion',
      lastModifiedAt: '2026-02-01T00:00:00.000Z',
      tags: [],
      citationCount: 0,
    },
    {
      id: 'ancient',
      title: 'Ancient',
      source: 'notion',
      lastModifiedAt: '2025-01-01T00:00:00.000Z',
      tags: ['legacy'],
      citationCount: 0,
    },
    {
      id: 'drive-thing',
      title: 'Drive thing',
      source: 'drive',
      lastModifiedAt: '2026-04-01T00:00:00.000Z',
      tags: [],
      citationCount: 0,
    },
  ];

  it('returns everything when no collection or source is given', () => {
    expect(assembleLibrary(docs, { now: NOW })).toHaveLength(4);
  });

  it('recently-changed sorts by lastModifiedAt desc', () => {
    const out = assembleLibrary(docs, { collection: 'recently-changed', now: NOW });
    expect(out.map((d) => d.id)).toEqual(['fresh', 'drive-thing', 'aging', 'ancient']);
  });

  it('stale filters to docs older than 90 days', () => {
    const out = assembleLibrary(docs, { collection: 'stale', now: NOW });
    expect(out.map((d) => d.id)).toEqual(['aging', 'ancient']);
  });

  it('untagged filters to docs with no tags', () => {
    const out = assembleLibrary(docs, { collection: 'untagged', now: NOW });
    expect(out.map((d) => d.id).sort()).toEqual(['aging', 'drive-thing']);
  });

  it('most-cited returns docs with citationCount > 0, sorted desc', () => {
    const enriched = enrichWithCitationCounts(
      docs,
      new Map([
        ['fresh', 14],
        ['aging', 3],
        ['drive-thing', 7],
        // 'ancient' not in the map → citationCount stays 0
      ]),
    );
    const out = assembleLibrary(enriched, {
      collection: 'most-cited',
      now: NOW,
    });
    expect(out.map((d) => d.id)).toEqual(['fresh', 'drive-thing', 'aging']);
  });

  it('most-cited returns [] when no doc has citations', () => {
    expect(assembleLibrary(docs, { collection: 'most-cited', now: NOW })).toEqual([]);
  });

  it('cited-in-skills filters to docs whose slug is in the set', () => {
    const out = assembleLibrary(docs, {
      collection: 'cited-in-skills',
      now: NOW,
      citedInSkills: new Set(['fresh', 'ancient']),
    });
    expect(out.map((d) => d.id).sort()).toEqual(['ancient', 'fresh']);
  });

  it('cited-in-skills returns [] when no slugs are passed', () => {
    expect(assembleLibrary(docs, { collection: 'cited-in-skills', now: NOW })).toEqual([]);
    expect(
      assembleLibrary(docs, {
        collection: 'cited-in-skills',
        now: NOW,
        citedInSkills: new Set(),
      }),
    ).toEqual([]);
  });

  it('source filter is applied before the collection filter', () => {
    const out = assembleLibrary(docs, {
      source: 'notion',
      collection: 'untagged',
      now: NOW,
    });
    expect(out.map((d) => d.id)).toEqual(['aging']);
  });
});

describe('enrichWithCitationCounts', () => {
  const docs = [
    {
      id: 'a',
      title: 'A',
      source: 'notion',
      lastModifiedAt: '2026-05-01T00:00:00.000Z',
      tags: [],
      citationCount: 0,
    },
    {
      id: 'b',
      title: 'B',
      source: 'notion',
      lastModifiedAt: '2026-05-01T00:00:00.000Z',
      tags: [],
      citationCount: 0,
    },
  ];

  it('overlays counts from the map onto matching docs', () => {
    const out = enrichWithCitationCounts(docs, new Map([['a', 9]]));
    expect(out.find((d) => d.id === 'a')?.citationCount).toBe(9);
    expect(out.find((d) => d.id === 'b')?.citationCount).toBe(0);
  });

  it('returns the input list unchanged when the map is empty', () => {
    const out = enrichWithCitationCounts(docs, new Map());
    expect(out).toBe(docs);
  });
});

describe('chunksToDocDetail', () => {
  it('joins chunk_text in order, picks the latest last_updated, and uses the first excerpt as snippet', () => {
    const out = chunksToDocDetail('refund-policy', [
      {
        slug: 'refund-policy',
        chunk_text: 'Annual plans are refundable within 30 days.',
        excerpt: 'Annual plans within 30 days.',
        last_updated: '2026-04-01T00:00:00.000Z',
      },
      {
        slug: 'refund-policy',
        chunk_text: 'After the window, credit only.',
        last_updated: '2026-04-15T00:00:00.000Z',
      },
    ]);
    expect(out.id).toBe('refund-policy');
    expect(out.body).toBe(
      'Annual plans are refundable within 30 days.\n\nAfter the window, credit only.',
    );
    expect(out.lastModifiedAt).toBe('2026-04-15T00:00:00.000Z');
    expect(out.snippet).toBe('Annual plans within 30 days.');
  });

  it('returns an empty body when there are no chunks', () => {
    const out = chunksToDocDetail('empty-page', []);
    expect(out.body).toBe('');
    expect(out.snippet).toBe('');
  });
});

describeDb('loadCitedInSkills', () => {
  let dbMod: typeof import('../../db/client.js');
  let routeMod: typeof import('./index.js');
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  beforeAll(async () => {
    dbMod = await import('../../db/client.js');
    routeMod = await import('./index.js');
  });

  afterEach(async () => {
    for (const workspaceId of workspaceIds.splice(0)) {
      await dbMod.db
        .delete(dbMod.schema.workspaces)
        .where(eq(dbMod.schema.workspaces.id, workspaceId));
    }
    for (const userId of userIds.splice(0)) {
      await dbMod.db.delete(dbMod.schema.users).where(eq(dbMod.schema.users.id, userId));
    }
  });

  it('reads cited-in-skills slugs from skill_versions for the workspace', async () => {
    const a = await makeWorkspace('library-a');
    const b = await makeWorkspace('library-b');
    const [skillA] = await dbMod.db
      .insert(dbMod.schema.skills)
      .values({ workspaceId: a.workspaceId, name: 'a-skill' })
      .returning();
    const [skillB] = await dbMod.db
      .insert(dbMod.schema.skills)
      .values({ workspaceId: b.workspaceId, name: 'b-skill' })
      .returning();
    if (!skillA || !skillB) throw new Error('skill insert failed');

    await dbMod.db.insert(dbMod.schema.skillVersions).values([
      {
        skillId: skillA.id,
        version: '0.1.0',
        frontmatter: { name: 'a-skill' },
        body: 'body',
        citedDocSlugs: ['refund-policy', 'enterprise-msa'],
      },
      {
        skillId: skillA.id,
        version: '0.1.1',
        frontmatter: { name: 'a-skill' },
        body: 'body',
        citedDocSlugs: ['refund-policy', 'security-policy'],
      },
      {
        skillId: skillB.id,
        version: '0.1.0',
        frontmatter: { name: 'b-skill' },
        body: 'body',
        citedDocSlugs: ['other-workspace-only'],
      },
    ]);

    const slugs = await routeMod.loadCitedInSkills(a.workspaceId);

    expect(Array.from(slugs).sort()).toEqual([
      'enterprise-msa',
      'refund-policy',
      'security-policy',
    ]);
  });

  async function makeWorkspace(label: string) {
    const [user] = await dbMod.db
      .insert(dbMod.schema.users)
      .values({ email: `${label}-${Date.now()}-${Math.random()}@open42.test` })
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
    return { userId: user.id, workspaceId: workspace.id };
  }
});
