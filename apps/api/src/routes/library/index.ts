import { eq, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { resolveOwnerWorkspaceId } from '../../auth/membership.js';
import { validateSession } from '../../auth/sessions.js';
import { db, schema } from '../../db/client.js';
import { GbrainClient } from '../../gbrain/client.js';
import {
  assembleLibrary,
  chunksToDocDetail,
  enrichWithCitationCounts,
  normalizeListPages,
  pageToDoc,
} from './assemble.js';

export const libraryRouter = Router();

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

libraryRouter.get('/doc/:id', async (req, res, next) => {
  try {
    const ctx = await resolveContext(req, res);
    if (!ctx) return;
    const { gbrain } = ctx;

    const id = req.params.id;
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
 * Resolves the request's session + workspace + gbrain client. Writes the
 * 401/409 response and returns null when the request can't proceed; callers
 * should bail in that case. Mirrors the inlined helper in
 * `routes/skills/refund-policy.ts` to keep behavior identical until that
 * route is migrated to a shared helper.
 */
async function resolveContext(req: Request, res: import('express').Response) {
  const session = await sessionFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  const workspace = await workspaceForUser(session.userId);
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

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, {
    userAgent: req.header('user-agent'),
    ip: req.ip,
  });
}

async function workspaceForUser(userId: string) {
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
