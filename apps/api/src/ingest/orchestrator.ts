import { mkdir, rm, writeFile } from 'node:fs/promises';

import { eq, sql } from 'drizzle-orm';

import type { ComposioClient } from '../composio/client.js';
import type { Connector } from '../connectors/interface.js';
import { db, schema } from '../db/client.js';
import type { GbrainClient } from '../gbrain/client.js';
import {
  acquireWorkspaceLock,
  heartbeatLock,
  reclaimExpiredLocks,
  releaseLockOnSuccess,
  releaseLockWithoutAdvancing,
} from './locks.js';
import {
  cleanupCycle,
  connectionStagingDir,
  createCycleStagingDir,
  finalStagingDir,
  mergeIntoFinal,
  sweepStaleCycles,
} from './staging.js';
import { docStagingPath } from './doc-path.js';

export interface OrchestratorDeps {
  composio: ComposioClient;
  gbrain: (workspaceId: string) => Promise<GbrainClient>;
  resolveConnector: (kind: string) => Connector;
  now?: () => Date;
  cycleConcurrency?: number;
  gbrainPollMaxMs?: number;
  heartbeatIntervalMs?: number;
  tickIntervalMs?: number;
}

export interface RunCycleOptions {
  preAcquiredLease?: Date;
  preAcquiredJobId?: string;
}

export type RunCycleStatus = 'completed' | 'failed' | 'aborted_lock_lost' | 'skipped_lock_held';

export interface ConnectorSummaryEntry {
  connection_id: string;
  kind: string;
  pages: number;
  error?: string;
}

export interface RunCycleResult {
  jobId: string;
  status: RunCycleStatus;
  pagesTotal: number;
  connectorsSummary: ConnectorSummaryEntry[];
}

export interface SchedulerHandle {
  stop(): Promise<void>;
  kick(workspaceId: string): Promise<void>;
}

type ConnectionRow = typeof schema.connections.$inferSelect;

export async function runWorkspaceCycle(
  deps: OrchestratorDeps,
  workspaceId: string,
  opts: RunCycleOptions = {},
): Promise<RunCycleResult> {
  let expectedLease = opts.preAcquiredLease ?? null;
  let jobId = opts.preAcquiredJobId ?? '';

  if (!expectedLease) {
    expectedLease = await acquireWorkspaceLock(db, workspaceId);
    if (!expectedLease) {
      console.debug('ingest_cycle_skipped_lock_held', { workspaceId });
      return { jobId: '', status: 'skipped_lock_held', pagesTotal: 0, connectorsSummary: [] };
    }
    const [job] = await db
      .insert(schema.ingestJobs)
      .values({
        workspaceId,
        status: 'running',
        pagesTotal: 0,
        connectorsSummary: [],
        gbrainJobId: null,
        startedAt: deps.now?.() ?? new Date(),
      })
      .returning();
    if (!job) {
      await releaseLockWithoutAdvancing(db, workspaceId, expectedLease).catch(() => undefined);
      throw new Error('failed to insert ingest_jobs row');
    }
    jobId = job.id;
  } else if (!jobId) {
    throw new Error('preAcquiredLease without preAcquiredJobId');
  }

  let aborted = false;
  let abortReason = '';
  const abortController = new AbortController();
  const heartbeatMs = deps.heartbeatIntervalMs ?? 60_000;
  let hbHandle: NodeJS.Timeout | null = null;
  let hbInFlight = false;

  const scheduleHeartbeat = (): void => {
    if (aborted) return;
    // Spec D8 allows the first heartbeat after heartbeatMs; the initial lease TTL is 30 minutes.
    hbHandle = setTimeout(async () => {
      if (aborted) return;
      hbInFlight = true;
      try {
        const newLease = await heartbeatLock(db, workspaceId, expectedLease!).catch(() => null);
        if (!newLease) {
          aborted = true;
          abortReason = 'lock_lost';
          abortController.abort();
        } else {
          expectedLease = newLease;
        }
      } finally {
        hbInFlight = false;
        if (!aborted) scheduleHeartbeat();
      }
    }, heartbeatMs);
  };
  scheduleHeartbeat();

  const summary: ConnectorSummaryEntry[] = [];
  const successfulIds: string[] = [];
  const cursorsToCommit = new Map<string, Record<string, unknown>>();
  const oneShotCompletedIds = new Set<string>();
  let cycleDir: string | null = null;
  let pagesTotal = 0;
  let gbrainJobId: string | null = null;

  const commitIfStillOwned = async (fn: () => Promise<void>): Promise<boolean> => {
    if (aborted) return false;
    const rows = await db.execute(sql`
      SELECT 1 FROM workspaces
      WHERE id = ${workspaceId}
        AND ingest_lock_until = date_trunc('milliseconds', ${expectedLease}::timestamptz)
    `);
    const owned = rowsOf<unknown>(rows).length > 0;
    if (!owned) {
      aborted = true;
      abortReason = 'lock_lost';
      abortController.abort();
      return false;
    }
    await fn();
    return true;
  };

  const failJob = async (error: string): Promise<RunCycleResult> => {
    await db
      .update(schema.ingestJobs)
      .set({
        status: 'failed',
        error,
        completedAt: deps.now?.() ?? new Date(),
        connectorsSummary: summary,
      })
      .where(eq(schema.ingestJobs.id, jobId));
    if (expectedLease) {
      await releaseLockWithoutAdvancing(db, workspaceId, expectedLease).catch(() => undefined);
    }
    return { jobId, status: 'failed', pagesTotal, connectorsSummary: summary };
  };

  const abortLockLost = async (): Promise<RunCycleResult> => {
    // TODO(P1.5): keep aborted/failed cycles out of the settings "Last cycle" panel.
    await db
      .update(schema.ingestJobs)
      .set({
        status: 'failed',
        error: 'ingest lock lost',
        completedAt: deps.now?.() ?? new Date(),
        connectorsSummary: summary,
      })
      .where(eq(schema.ingestJobs.id, jobId))
      .catch(() => undefined);
    return { jobId, status: 'aborted_lock_lost', pagesTotal: 0, connectorsSummary: summary };
  };

  try {
    const connections = await db.select().from(schema.connections)
      .where(sql`${schema.connections.workspaceId} = ${workspaceId}
        AND ${schema.connections.status} IN ('pending_import','active')
        AND ${schema.connections.deletedAt} IS NULL`);

    cycleDir = await createCycleStagingDir(jobId);

    for (const connection of connections) {
      if (aborted) break;
      await extractConnection(deps, {
        connection,
        cycleDir,
        abortController,
        summary,
        successfulIds,
        cursorsToCommit,
        oneShotCompletedIds,
      });
    }

    if (aborted && abortReason === 'lock_lost') {
      return await abortLockLost();
    }

    const successfulWithDocs = successfulIds.filter((id) => {
      const entry = summary.find((item) => item.connection_id === id);
      return (entry?.pages ?? 0) > 0;
    });

    if (successfulWithDocs.length > 0) {
      await mergeIntoFinal(cycleDir, successfulWithDocs);
      let gbrain: GbrainClient;
      try {
        gbrain = await deps.gbrain(workspaceId);
      } catch (err) {
        return await failJob(errorMessage(err));
      }

      try {
        const submitted = (await gbrain.submitJob('import', {
          dir: finalStagingDir(cycleDir),
        })) as { id?: string | number; job_id?: string | number };
        gbrainJobId = String(submitted.id ?? submitted.job_id ?? '');
        await db
          .update(schema.ingestJobs)
          .set({ gbrainJobId })
          .where(eq(schema.ingestJobs.id, jobId));
      } catch (err) {
        return await failJob(errorMessage(err));
      }

      const poll = await pollGbrain(gbrain, gbrainJobId, deps, () => aborted);
      if (aborted && abortReason === 'lock_lost') {
        return await abortLockLost();
      }
      if (!poll.ok) {
        return await failJob(poll.error);
      }
    }

    // If the lock is lost between per-connection commits, partial cursor advancement is safe:
    // gbrain import is idempotent and unadvanced connectors will be retried into the same slugs.
    for (const id of successfulIds) {
      const connection = connections.find((item) => item.id === id);
      if (!connection) continue;
      const connector = deps.resolveConnector(connection.kind);
      const status = connector.mode === 'one_shot' ? 'completed' : 'active';
      const cursor = cursorsToCommit.get(id) ?? {};
      const owned = await commitIfStillOwned(async () => {
        await db
          .update(schema.connections)
          .set({
            cursor,
            lastPulledAt: deps.now?.() ?? new Date(),
            status,
            lastError: null,
          })
          .where(eq(schema.connections.id, id));
      });
      if (!owned) return await abortLockLost();
    }

    pagesTotal = summary.reduce((sum, item) => sum + item.pages, 0);
    const jobOwned = await commitIfStillOwned(async () => {
      await db
        .update(schema.ingestJobs)
        .set({
          status: 'completed',
          completedAt: deps.now?.() ?? new Date(),
          pagesTotal,
          connectorsSummary: summary,
          gbrainJobId,
        })
        .where(eq(schema.ingestJobs.id, jobId));
    });
    if (!jobOwned) return await abortLockLost();

    const released = await releaseLockOnSuccess(db, workspaceId, expectedLease!);
    if (!released) {
      return { jobId, status: 'aborted_lock_lost', pagesTotal, connectorsSummary: summary };
    }

    for (const id of oneShotCompletedIds) {
      const connection = connections.find((item) => item.id === id);
      const zipPath = (cursorsToCommit.get(id) ?? cursorRecord(connection?.cursor)).zipPath;
      if (typeof zipPath === 'string') {
        await rm(zipPath, { force: true }).catch(() => undefined);
      }
    }

    return { jobId, status: 'completed', pagesTotal, connectorsSummary: summary };
  } finally {
    aborted = true;
    if (hbHandle) clearTimeout(hbHandle);
    // TODO(P1.5): replace hbInFlight polling with an explicit Promise<void> for heartbeat drain.
    while (hbInFlight) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (cycleDir) await cleanupCycle(cycleDir).catch(() => undefined);
  }
}

async function extractConnection(
  deps: OrchestratorDeps,
  params: {
    connection: ConnectionRow;
    cycleDir: string;
    abortController: AbortController;
    summary: ConnectorSummaryEntry[];
    successfulIds: string[];
    cursorsToCommit: Map<string, Record<string, unknown>>;
    oneShotCompletedIds: Set<string>;
  },
): Promise<void> {
  const { connection, cycleDir, abortController, summary, successfulIds, cursorsToCommit } = params;

  if (connection.composioConnectedAccountId) {
    try {
      const account = await deps.composio.getConnection(connection.composioConnectedAccountId);
      if (account.user_id !== connection.workspaceId) {
        await db
          .update(schema.connections)
          .set({
            status: 'errored',
            lastError: 'integrity check failed: workspace mismatch',
          })
          .where(eq(schema.connections.id, connection.id));
        summary.push({
          connection_id: connection.id,
          kind: connection.kind,
          pages: 0,
          error: 'integrity_check_failed',
        });
        return;
      }
    } catch (err) {
      const message = errorMessage(err);
      await db
        .update(schema.connections)
        .set({ status: 'errored', lastError: `integrity check error: ${message}` })
        .where(eq(schema.connections.id, connection.id));
      summary.push({
        connection_id: connection.id,
        kind: connection.kind,
        pages: 0,
        error: message,
      });
      return;
    }
  }

  const connector = deps.resolveConnector(connection.kind);
  const connDir = connectionStagingDir(cycleDir, connection.id);
  await mkdir(connDir, { recursive: true });

  let pages = 0;
  try {
    const cursor = cursorRecord(connection.cursor);
    const result = connector.extract(
      {
        cursor,
        source:
          connection.kind === 'notion-zip'
            ? { kind: 'notion-zip', zipPath: String(cursor.zipPath ?? '') }
            : { kind: 'notion-composio' },
        account: connection.composioConnectedAccountId
          ? { composio_connected_account_id: connection.composioConnectedAccountId }
          : undefined,
        workspaceId: connection.workspaceId,
      },
      { signal: abortController.signal },
    );

    for await (const doc of result.docs) {
      abortController.signal.throwIfAborted();
      await writeFile(docStagingPath(connDir, doc.slug), doc.content_md, 'utf8');
      pages += 1;
    }

    cursorsToCommit.set(connection.id, result.finalize());
    successfulIds.push(connection.id);
    summary.push({ connection_id: connection.id, kind: connection.kind, pages });
    if (connector.mode === 'one_shot') params.oneShotCompletedIds.add(connection.id);
  } catch (err) {
    await rm(connDir, { recursive: true, force: true });
    const message = errorMessage(err);
    summary.push({ connection_id: connection.id, kind: connection.kind, pages: 0, error: message });
    await db
      .update(schema.connections)
      .set({ lastError: message })
      .where(eq(schema.connections.id, connection.id));
  }
}

async function pollGbrain(
  gbrain: GbrainClient,
  jobId: string | null,
  deps: OrchestratorDeps,
  isAborted: () => boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const maxMs = deps.gbrainPollMaxMs ?? 25 * 60_000;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (isAborted()) return { ok: false, error: 'ingest lock lost' };
    try {
      const progress = (await gbrain.getJobProgress(jobId ?? '')) as {
        status?: string;
        error?: string;
      };
      if (progress.status === 'completed' || progress.status === 'success') return { ok: true };
      if (['failed', 'dead', 'cancelled'].includes(progress.status ?? '')) {
        return { ok: false, error: progress.error ?? `gbrain status=${progress.status}` };
      }
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return { ok: false, error: 'gbrain poll timed out' };
}

export function startScheduler(deps: OrchestratorDeps): SchedulerHandle {
  const tickMs = deps.tickIntervalMs ?? 60_000;
  const concurrencyCap = deps.cycleConcurrency ?? 5;
  const inFlight = new Set<string>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    await reclaimExpiredLocks(db).catch(() => undefined);
    await sweepStaleCycles(60 * 60 * 1000).catch(() => undefined);
    await db
      .delete(schema.connectionInitStates)
      .where(sql`${schema.connectionInitStates.expiresAt} < now()`)
      .catch(() => undefined);

    const dueRows = await db.execute(sql`
      SELECT w.id
      FROM workspaces w
      WHERE w.deleted_at IS NULL
        AND (w.ingest_lock_until IS NULL OR w.ingest_lock_until < now())
        AND (
          EXISTS (
            SELECT 1 FROM connections c
            WHERE c.workspace_id = w.id
              AND c.status = 'pending_import'
              AND c.deleted_at IS NULL
          )
          OR (
            w.ingest_mode = 'periodic_pull'
            AND (
              w.ingest_last_cycle_at IS NULL
              OR w.ingest_last_cycle_at <= now() - (w.ingest_interval_hours * interval '1 hour')
            )
            AND EXISTS (
              SELECT 1 FROM connections c
              WHERE c.workspace_id = w.id
                AND c.status = 'active'
                AND c.kind IN ('notion-composio')
                AND c.deleted_at IS NULL
            )
          )
        )
    `);
    const ids = rowsOf<{ id: string }>(dueRows).map((row) => row.id);

    for (const id of ids) {
      if (stopped) break;
      if (inFlight.has(id)) continue;
      if (inFlight.size >= concurrencyCap) break;
      inFlight.add(id);
      runWorkspaceCycle(deps, id)
        .catch(() => undefined)
        .finally(() => {
          inFlight.delete(id);
        });
    }
  };

  const runTick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await tick();
    } catch (err) {
      // Never let a tick failure crash the API process. Log and reschedule —
      // a transient DB hiccup (network blip, schema mid-migration) shouldn't
      // take down ingest, auth, and every other route.
      console.error('ingest_tick_failed', errorMessage(err));
    } finally {
      if (!stopped) {
        timer = setTimeout(() => {
          void runTick();
        }, tickMs);
      }
    }
  };
  void runTick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      while (inFlight.size > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    async kick(workspaceId: string) {
      if (inFlight.has(workspaceId)) return;
      inFlight.add(workspaceId);
      try {
        await runWorkspaceCycle(deps, workspaceId);
      } finally {
        inFlight.delete(workspaceId);
      }
    },
  };
}

function cursorRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rowsOf<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
