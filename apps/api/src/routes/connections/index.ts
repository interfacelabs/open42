import { Router, type Request } from 'express';
import { and, eq, sql } from 'drizzle-orm';

import { validateSession } from '../../auth/sessions.js';
import type { ComposioClient } from '../../composio/client.js';
import { db, schema } from '../../db/client.js';

export function buildConnectionsRouter(deps: { composio?: ComposioClient | null } = {}) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const session = await sessionFromRequest(req);
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const workspaceId = await callerWorkspaceId(session.userId);
      if (!workspaceId) {
        res.status(403).json({ error: 'no_workspace' });
        return;
      }
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

  router.delete('/:id', async (req, res, next) => {
    try {
      const session = await sessionFromRequest(req);
      if (!session) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const workspaceId = await callerWorkspaceId(session.userId);
      if (!workspaceId) {
        res.status(403).json({ error: 'no_workspace' });
        return;
      }

      const [row] = await db
        .select()
        .from(schema.connections)
        .where(and(eq(schema.connections.id, req.params.id), eq(schema.connections.workspaceId, workspaceId)))
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

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, { userAgent: req.header('user-agent'), ip: req.ip });
}

async function callerWorkspaceId(userId: string): Promise<string | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user?.currentWorkspaceId ?? null;
}
