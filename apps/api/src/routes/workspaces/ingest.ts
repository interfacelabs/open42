import { setImmediate } from 'node:timers';

import { Type } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';

import { db, schema } from '../../db/client.js';
import { acquireWorkspaceLock, releaseLockWithoutAdvancing } from '../../ingest/locks.js';
import type { RunCycleOptions, RunCycleResult } from '../../ingest/orchestrator.js';
import { requireMembership } from '../../middleware/require-membership.js';

const patchSchema = Type.Object({
  ingestMode: Type.Union([Type.Literal('import_once'), Type.Literal('periodic_pull')]),
  // intervalHours is a legacy alias; interval is optional because mode-only PATCHes are valid.
  ingestIntervalHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
  intervalHours: Type.Optional(Type.Integer({ minimum: 1, maximum: 168 })),
});

/**
 * Workspace ingest router (`/workspaces/:id/ingest/*`).
 *
 * Membership is asserted by the shared `requireMembership({ from: 'param' })`
 * middleware applied to each route — handlers can read `req.workspace!.id`
 * and `req.workspace!.role` directly. Mutating routes additionally enforce
 * owner-only on the role.
 */
export function buildIngestRouter(deps: {
  runCycle: (workspaceId: string, opts?: RunCycleOptions) => Promise<RunCycleResult>;
}) {
  const router = Router();
  const member = requireMembership({ from: 'param' });

  router.get('/:id/ingest', member, async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const [workspace] = await db
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .limit(1);
      if (!workspace) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      const [lastJob] = await db
        .select()
        .from(schema.ingestJobs)
        .where(eq(schema.ingestJobs.workspaceId, workspace.id))
        .orderBy(desc(schema.ingestJobs.createdAt))
        .limit(1);
      res.json({
        ingestMode: workspace.ingestMode,
        ingestIntervalHours: workspace.ingestIntervalHours,
        ingestLastCycleAt: workspace.ingestLastCycleAt,
        lastJob: lastJob ?? null,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/:id/ingest', member, async (req, res, next) => {
    try {
      if (req.workspace!.role !== 'owner') {
        res.status(403).json({ error: 'forbidden' });
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
        .where(eq(schema.workspaces.id, req.workspace!.id))
        .returning();
      res.json({ workspace });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/ingest/sync', member, async (req, res, next) => {
    try {
      if (req.workspace!.role !== 'owner') {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      const workspaceId = req.workspace!.id;

      const lease = await acquireWorkspaceLock(db, workspaceId);
      if (!lease) {
        res.status(409).json({ error: 'cycle_in_progress' });
        return;
      }

      let jobId = '';
      try {
        const [job] = await db
          .insert(schema.ingestJobs)
          .values({
            workspaceId,
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
        await releaseLockWithoutAdvancing(db, workspaceId, lease).catch(() => undefined);
        throw err;
      }

      res.status(202).json({ jobId });
      setImmediate(() => {
        void deps.runCycle(workspaceId, {
          preAcquiredLease: lease,
          preAcquiredJobId: jobId,
        });
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/ingest/jobs', member, async (req, res, next) => {
    try {
      const workspaceId = req.workspace!.id;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 25), 1), 100);
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : '';
      const rows = await db
        .select()
        .from(schema.ingestJobs)
        .where(
            and(
              eq(schema.ingestJobs.workspaceId, workspaceId),
              // TODO(P1.5): switch to seek pagination by passing created_at as &cursor= directly.
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
