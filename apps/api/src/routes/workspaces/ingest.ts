import { setImmediate } from 'node:timers';

import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';

import { validateSession } from '../../auth/sessions.js';
import { db, schema } from '../../db/client.js';
import { acquireWorkspaceLock, releaseLockWithoutAdvancing } from '../../ingest/locks.js';
import type { RunCycleOptions, RunCycleResult } from '../../ingest/orchestrator.js';

const patchSchema = Type.Object({
  ingestMode: Type.Union([Type.Literal('import_once'), Type.Literal('periodic_pull')]),
  ingestIntervalHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
  intervalHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
});

export function buildIngestRouter(deps: {
  runCycle: (workspaceId: string, opts?: RunCycleOptions) => Promise<RunCycleResult>;
}) {
  const router = Router();

  router.get('/:id/ingest', async (req, res, next) => {
    try {
      const auth = await requireWorkspace(req, req.params.id, false);
      if ('status' in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const [lastJob] = await db
        .select()
        .from(schema.ingestJobs)
        .where(eq(schema.ingestJobs.workspaceId, auth.workspace.id))
        .orderBy(desc(schema.ingestJobs.createdAt))
        .limit(1);
      res.json({
        ingestMode: auth.workspace.ingestMode,
        ingestIntervalHours: auth.workspace.ingestIntervalHours,
        ingestLastCycleAt: auth.workspace.ingestLastCycleAt,
        lastJob: lastJob ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/ingest', async (req, res, next) => {
    try {
      const auth = await requireWorkspace(req, req.params.id, true);
      if ('status' in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      if (!Value.Check(patchSchema, req.body)) {
        res.status(400).json({ error: 'invalid_payload' });
        return;
      }
      const interval = req.body.ingestIntervalHours ?? req.body.intervalHours;
      const [workspace] = await db
        .update(schema.workspaces)
        .set({
          ingestMode: req.body.ingestMode,
          ...(interval ? { ingestIntervalHours: interval } : {}),
        })
        .where(eq(schema.workspaces.id, auth.workspace.id))
        .returning();
      res.json({ workspace });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/ingest/sync', async (req, res, next) => {
    try {
      const auth = await requireWorkspace(req, req.params.id, true);
      if ('status' in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }

      const lease = await acquireWorkspaceLock(db, auth.workspace.id);
      if (!lease) {
        res.status(409).json({ error: 'cycle_in_progress' });
        return;
      }

      let jobId = '';
      try {
        const [job] = await db
          .insert(schema.ingestJobs)
          .values({
            workspaceId: auth.workspace.id,
            status: 'running',
            pagesTotal: 0,
            connectorsSummary: [],
            gbrainJobId: null,
            startedAt: new Date(),
          })
          .returning();
        if (!job) throw new Error('insert ingest_jobs failed');
        jobId = job.id;
      } catch (err) {
        await releaseLockWithoutAdvancing(db, auth.workspace.id, lease).catch(() => undefined);
        throw err;
      }

      res.status(202).json({ jobId });
      setImmediate(() => {
        void deps.runCycle(auth.workspace.id, {
          preAcquiredLease: lease,
          preAcquiredJobId: jobId,
        });
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/ingest/jobs', async (req, res, next) => {
    try {
      const auth = await requireWorkspace(req, req.params.id, false);
      if ('status' in auth) {
        res.status(auth.status).json({ error: auth.error });
        return;
      }
      const limit = Math.min(Math.max(Number(req.query.limit ?? 25), 1), 100);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
      const rows = await db
        .select()
        .from(schema.ingestJobs)
        .where(
          and(
            eq(schema.ingestJobs.workspaceId, auth.workspace.id),
            cursor
              ? sql`${schema.ingestJobs.createdAt} < (
                  SELECT created_at FROM ingest_jobs WHERE id = ${cursor}
                )`
              : sql`true`,
          ),
        )
        .orderBy(desc(schema.ingestJobs.createdAt))
        .limit(limit);
      res.json({ jobs: rows, nextCursor: rows.at(-1)?.id ?? null });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

type AuthResult =
  | { workspace: typeof schema.workspaces.$inferSelect }
  | { status: number; error: string };

async function requireWorkspace(
  req: Request,
  workspaceId: string,
  ownerOnly: boolean,
): Promise<AuthResult> {
  const session = await sessionFromRequest(req);
  if (!session) return { status: 401, error: 'unauthorized' };
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId)).limit(1);
  if (!user?.currentWorkspaceId || user.currentWorkspaceId !== workspaceId) {
    return { status: 404, error: 'not_found' };
  }
  const [workspace] = await db
    .select()
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return { status: 404, error: 'not_found' };
  if (ownerOnly) {
    const [membership] = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, session.userId),
          eq(schema.memberships.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!membership || membership.role !== 'owner') {
      return { status: 403, error: 'forbidden' };
    }
  }
  return { workspace };
}

async function sessionFromRequest(req: Request) {
  const sessionId = req.cookies?.[process.env.SESSION_COOKIE_NAME ?? 'open42_session'];
  if (!sessionId) return null;
  return validateSession(sessionId, { userAgent: req.header('user-agent'), ip: req.ip });
}
