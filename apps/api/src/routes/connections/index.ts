import { Router } from 'express';
import { and, eq, sql } from 'drizzle-orm';

import type { ComposioClient } from '../../composio/client.js';
import { db, schema } from '../../db/client.js';

/**
 * Connections router — list and disconnect, scoped to the workspace named in
 * the parent path (`/workspaces/:id/connections`). The `requireMembership`
 * middleware (mounted on the parent path in `apps/api/src/index.ts`) has
 * already validated the session and asserted membership, so handlers can
 * read `req.workspace!.id` directly. `mergeParams: true` is required so the
 * parent `:id` is visible from within this nested router.
 */
export function buildConnectionsRouter(deps: { composio?: ComposioClient | null } = {}) {
  const router = Router({ mergeParams: true });

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
      res.json({ workspaceId, connections: rows });
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
        .where(and(eq(schema.connections.id, req.params.connectionId), eq(schema.connections.workspaceId, workspaceId)))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: 'not_found' });
        return;
      }

      await db
        .update(schema.connections)
        .set({ status: 'disconnected', deletedAt: new Date() })
        .where(eq(schema.connections.id, row.id));

      if (row.composioConnectedAccountId && deps.composio) {
        deps.composio.deleteConnection(row.composioConnectedAccountId).catch((err) => {
          console.warn('composio delete failed', { connectionId: row.id, err });
        });
      }

      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
