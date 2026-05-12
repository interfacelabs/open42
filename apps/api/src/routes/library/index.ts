import { eq, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { db, schema } from '../../db/client.js';
import { GbrainClient } from '../../gbrain/client.js';
import {
  assembleLibrary,
  chunksToDocDetail,
  enrichWithCitationCounts,
  normalizeListPages,
  pageToDoc,
} from './assemble.js';

/**
 * Library router — list / read docs for the workspace named in the parent
 * path (`/workspaces/:id/library`). `requireMembership` (mounted on the
 * parent in `apps/api/src/index.ts`) validates the session and asserts
 * membership before any handler runs, so we read `req.workspace!.id` and
 * `req.session!.userId` directly. `mergeParams: true` is required so the
 * parent `:id` is visible from within this nested router.
 *
 * Previously this router lived at `/library` and resolved the workspace via
 * `resolveOwnerWorkspaceId(session.userId)` — that returned "first owned
 * workspace" non-deterministically (LIMIT 1, undefined ordering), which is
 * broken under multi-workspace.
 */
export const libraryRouter = Router({ mergeParams: true });

libraryRouter.get('/', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const { gbrain, workspace } = ctx;

    const collection = firstQuery(req.query.collection);
    const source = firstQuery(req.query.source);

    const [raw, citationCounts, citedInSkills] = await Promise.all([
      gbrain.listPages({ limit: 200 }),
      loadCitationCounts(workspace.id),
      loadCitedInSkills(workspace.id),
    ]);

    const pages = normalizeListPages(raw);
    const baseDocs = pages.map(pageToDoc).filter((d): d is NonNullable<typeof d> => d !== null);
    const enriched = enrichWithCitationCounts(baseDocs, citationCounts);
    const filtered = assembleLibrary(enriched, {
      collection,
      source,
      citedInSkills,
    });

    res.json({ docs: filtered });
  } catch (err) {
    next(err);
  }
});

/**
 * `SELECT doc_slug, COUNT(*) FROM document_citations WHERE workspace_id = $1
 *  GROUP BY doc_slug` — Map keyed by slug for O(1) lookup during enrichment.
 */
async function loadCitationCounts(workspaceId: string): Promise<Map<string, number>> {
  const rows = await db
    .select({
      slug: schema.documentCitations.docSlug,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.documentCitations)
    .where(eq(schema.documentCitations.workspaceId, workspaceId))
    .groupBy(schema.documentCitations.docSlug);
  return new Map(rows.map((r) => [r.slug, r.count]));
}

/**
 * Union of all `cited_doc_slugs` jsonb arrays across the workspace's
 * skill_versions, flattened to a Set for O(1) membership tests.
 */
export async function loadCitedInSkills(workspaceId: string): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({
      slug: sql<string>`jsonb_array_elements_text(${schema.skillVersions.citedDocSlugs})`,
    })
    .from(schema.skills)
    .innerJoin(schema.skillVersions, eq(schema.skillVersions.skillId, schema.skills.id))
    .where(eq(schema.skills.workspaceId, workspaceId));
  return new Set(rows.map((r) => r.slug));
}

libraryRouter.get('/doc/:docId', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const { gbrain } = ctx;

    const id = req.params.docId;
    if (!id) {
      res.status(400).json({ error: 'missing_id' });
      return;
    }

    const chunks = await gbrain.getChunks(id);
    if (chunks.length === 0) {
      res.status(404).json({ error: 'doc_not_found' });
      return;
    }
    const doc = chunksToDocDetail(id, chunks);
    res.json({ doc });
  } catch (err) {
    next(err);
  }
});

/**
 * Resolves the workspace runtime + gbrain client for the current request.
 * `requireMembership` has already validated the session and asserted
 * membership, so the workspace id is trusted. We only need to confirm the
 * tenant runtime is provisioned (gbrain credentials populated) before
 * issuing upstream calls — if it isn't, the route 409s and the caller can
 * back off until ingest comes up. Returns null after writing the response.
 */
async function resolveContext(req: Request, res: import('express').Response) {
  const session = req.session!;
  const workspaceId = req.workspace!.id;
  const workspace = await loadWorkspaceRuntime(workspaceId);
  if (!workspace) {
    res.status(409).json({ error: 'workspace_not_ready' });
    return null;
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
  return { session, workspace, gbrain };
}

async function loadWorkspaceRuntime(workspaceId: string) {
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
    gbrainVersion: workspace.gbrainVersion,
  };
}

function formatGbrainBaseUrl(privateIp: string): string {
  const host = privateIp.includes(':') && !privateIp.startsWith('[') ? `[${privateIp}]` : privateIp;
  return `http://${host}:8080`;
}

function firstQuery(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}
