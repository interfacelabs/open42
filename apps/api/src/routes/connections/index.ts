import { Router } from 'express';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { ComposioClient } from '../../composio/client.js';
import { resolveComposioClientForConnection } from '../../composio/profiles.js';
import { publicComposioServiceCatalog } from '../../connectors/catalog.js';
import { db, schema } from '../../db/client.js';
import { COMPOSIO_NOTION_AUTH_CONFIG_ID, OPEN42_COMPOSIO_ENABLED } from '../../env.js';
import type { GbrainClient } from '../../gbrain/client.js';
import { buildGbrainForWorkspace } from '../../gbrain/factory.js';

/**
 * Connections router — list and disconnect, scoped to the workspace named in
 * the parent path (`/workspaces/:id/connections`). The `requireMembership`
 * middleware (mounted on the parent path in `apps/api/src/index.ts`) has
 * already validated the session and asserted membership, so handlers can
 * read `req.workspace!.id` directly. `mergeParams: true` is required so the
 * parent `:id` is visible from within this nested router.
 */
export function buildConnectionsRouter(
  deps: {
    composio?: ComposioClient | null;
    resolveComposioClient?: typeof resolveComposioClientForConnection;
    gbrain?: (workspaceId: string) => Promise<Pick<GbrainClient, 'sourcesRemove'>>;
  } = {},
) {
  const router = Router({ mergeParams: true });
  const gbrainForWorkspace = deps.gbrain ?? buildGbrainForWorkspace;
  const resolveComposioClient =
    deps.resolveComposioClient ??
    ((connection: Parameters<typeof resolveComposioClientForConnection>[0]) =>
      deps.composio
        ? Promise.resolve(deps.composio)
        : resolveComposioClientForConnection(connection));

  router.get('/', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const rows = await db
        .select()
        .from(schema.connections)
        .where(
          and(
            eq(schema.connections.workspaceId, workspaceId),
            sql`${schema.connections.deletedAt} IS NULL`,
          ),
        );
      const githubRows =
        rows.length > 0
          ? await db
              .select()
              .from(schema.githubRepoConnections)
              .where(
                inArray(
                  schema.githubRepoConnections.connectionId,
                  rows.map((row) => row.id),
                ),
              )
          : [];
      const githubByConnectionId = new Map(
        githubRows.map((row) => [
          row.connectionId,
          {
            repoId: row.repoId,
            owner: row.owner,
            repo: row.repo,
            branch: row.branch,
            repoPrivate: row.repoPrivate,
            gbrainSourceId: row.gbrainSourceId,
            syncTransport: row.syncTransport,
            syncStatus: row.syncStatus,
            lastIndexedCommitSha: row.lastIndexedCommitSha,
            branchHeadSha: row.branchHeadSha,
            lastSyncedAt: row.lastSyncedAt,
            lastError: row.lastError,
            webhookHealth: row.webhookHealth,
          },
        ]),
      );
      res.json({
        workspaceId,
        connections: rows.map((row) => ({
          ...row,
          github: githubByConnectionId.get(row.id) ?? null,
        })),
        composioEnabled: OPEN42_COMPOSIO_ENABLED,
        composioServices: publicComposioServiceCatalog({
          composioEnabled: OPEN42_COMPOSIO_ENABLED,
          configuredAuthConfigs: {
            notion: Boolean(COMPOSIO_NOTION_AUTH_CONFIG_ID),
          },
        }),
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:connectionId', async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;

      const [row] = await db
        .select()
        .from(schema.connections)
        .where(
          and(
            eq(schema.connections.id, req.params.connectionId),
            eq(schema.connections.workspaceId, workspaceId),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      if (row.kind === 'github-repo') {
        const [githubRepo] = await db
          .select()
          .from(schema.githubRepoConnections)
          .where(eq(schema.githubRepoConnections.connectionId, row.id))
          .limit(1);
        if (githubRepo?.gbrainSourceRegisteredAt) {
          try {
            const gbrain = await gbrainForWorkspace(workspaceId);
            await gbrain.sourcesRemove({
              id: githubRepo.gbrainSourceId,
              confirmDestructive: true,
            });
          } catch (err) {
            console.warn('github source remove failed', {
              connectionId: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
            res.status(502).json({ error: 'github_source_remove_failed' });
            return;
          }
        }
        await db
          .update(schema.githubRepoConnections)
          .set({
            gitProxyTokenHash: null,
            syncStatus: 'fresh',
            updatedAt: new Date(),
          })
          .where(eq(schema.githubRepoConnections.connectionId, row.id));
      }

      await db
        .update(schema.connections)
        .set({ status: 'disconnected', deletedAt: new Date() })
        .where(eq(schema.connections.id, row.id));

      if (row.composioConnectedAccountId) {
        resolveComposioClient(row)
          .then((composio) => {
            composio.deleteConnection(row.composioConnectedAccountId!).catch((err) => {
              console.warn('composio delete failed', {
                connectionId: row.id,
                message: err instanceof Error ? err.message : String(err),
              });
            });
          })
          .catch((err) => {
            console.warn('composio delete resolver failed', {
              connectionId: row.id,
              message: err instanceof Error ? err.message : String(err),
            });
          });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
