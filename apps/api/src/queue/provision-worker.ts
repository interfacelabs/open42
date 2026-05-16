/**
 * BullMQ worker that processes tenant-provision jobs.
 *
 * Each job:
 *   1. Cleans up any leftover tenant from a prior failed attempt (idempotency).
 *   2. Runs `provisionTenant` — the same function that used to be invoked
 *      fire-and-forget. Success path persists `status='ready'` + gbrain
 *      credentials via `createWorkspace`.
 *   3. On error, BullMQ schedules the next retry (exponential backoff). When
 *      attempts are exhausted, BullMQ marks the job `failed`; the worker's
 *      `failed` event handler writes `status='failed'` to the DB so the UI
 *      can surface a retry button.
 *
 * Why we don't call `safelyProvisionTenant`: that wrapper writes
 * `status='failed'` after the *first* error, but BullMQ may still retry. We
 * only want the DB to flip to `failed` after BullMQ has truly given up.
 * Inside the worker we let raw `provisionTenant` errors bubble up to BullMQ.
 *
 * Stalled-job recovery: BullMQ Workers renew an internal lock every
 * `lockRenewTime` (default 15s). If the worker process dies, the lock
 * expires after `stalledInterval` (default 30s) and BullMQ moves the job
 * back to `waiting` for another worker to pick up. This is the durability
 * guarantee that replaces our crash-prone fire-and-forget Promise.
 */
import { Worker, type Job } from 'bullmq';
import { and, desc, eq, sql } from 'drizzle-orm';
import pino from 'pino';

import { db, schema } from '../db/client.js';
import {
  classifyProvisioningError,
  provisionFailureDetail,
  provisionTenant,
} from '../tenants/provision.js';
import { buildBullSubscriber } from './connection.js';
import { PROVISION_QUEUE_NAME, type ProvisionJobData } from './provision-queue.js';

const logger = pino({ name: 'provision-worker' });

/**
 * Backward-compat for jobs enqueued by the previous worker (Chunk-5 deploy
 * boundary). Older jobs were keyed by `ownerUserId` only — their `job.data`
 * has no `workspaceId`. On the cross-deploy boundary those jobs are still
 * persisted in Redis; without this fallback the new worker would call
 * `provisionTenant({ workspaceId: undefined, ... })` and silently strand
 * the workspace. Resolve the owner's most recently-created provisioning
 * workspace and proceed with that id.
 */
export async function resolveLegacyProvisioningWorkspaceId(
  ownerUserId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(
      and(
        eq(schema.workspaces.ownerUserId, ownerUserId),
        eq(schema.workspaces.status, 'provisioning'),
        sql`${schema.workspaces.deletedAt} IS NULL`,
      ),
    )
    .orderBy(desc(schema.workspaces.createdAt))
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Read job.data.workspaceId if present; otherwise resolve via the legacy
 * fallback. Returns null when neither path produces a workspace — caller
 * should log + return without flipping any DB state.
 */
async function resolveJobWorkspaceId(
  job: Pick<Job<ProvisionJobData>, 'id' | 'data'>,
): Promise<string | null> {
  if (job.data.workspaceId) return job.data.workspaceId;
  const resolved = await resolveLegacyProvisioningWorkspaceId(job.data.ownerUserId);
  if (!resolved) {
    logger.warn(
      { jobId: job.id, ownerUserId: job.data.ownerUserId },
      'provision_job_missing_workspace_id_and_no_provisioning_row',
    );
  }
  return resolved;
}

let cachedWorker: Worker<ProvisionJobData> | null = null;

export function startProvisionWorker(): Worker<ProvisionJobData> {
  if (cachedWorker) return cachedWorker;

  const worker = new Worker<ProvisionJobData>(
    PROVISION_QUEUE_NAME,
    async (job) => processProvisionJob(job),
    {
      connection: buildBullSubscriber(),
      // 2 simultaneous provisions per worker — Docker pulls and gbrain health
      // polling are I/O-bound, so a small concurrency keeps us responsive
      // without saturating the host. Tune up in prod if needed.
      concurrency: 2,
      // Default 30s stalled-job recovery is fine — provisioning errors are
      // rare and the user-visible cost of a stall+restart is just an extra
      // ~30s waiting before retry kicks in.
    },
  );

  worker.on('active', (job) => {
    logger.info(
      { jobId: job.id, attempt: job.attemptsMade + 1, of: job.opts.attempts },
      'provision_job_active',
    );
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'provision_job_completed');
  });

  worker.on('failed', async (job, err) => {
    if (!job) {
      logger.error({ err: err?.message }, 'provision_job_failed_no_job');
      return;
    }
    const remaining = (job.opts.attempts ?? 1) - job.attemptsMade;
    if (remaining > 0) {
      // BullMQ will retry; don't flip the DB to failed yet.
      logger.warn(
        { jobId: job.id, remaining, err: err?.message },
        'provision_job_failed_will_retry',
      );
      return;
    }
    logger.error({ jobId: job.id, err: err?.message }, 'provision_job_failed_terminal');
    // Resolve workspaceId with the legacy fallback so the failure handler
    // still flips the DB row to 'failed' for jobs enqueued by the old worker
    // (which only carried ownerUserId). Without this the workspace would
    // stay 'provisioning' forever after the deploy boundary.
    const workspaceId = await resolveJobWorkspaceId(job);
    if (!workspaceId) return;
    await markWorkspaceFailed(
      workspaceId,
      classifyProvisioningError(err),
      provisionFailureDetail(err),
    );
  });

  worker.on('error', (err) => {
    // Worker-level (not job-level) errors — connection drops, etc. Log only;
    // BullMQ reconnects automatically.
    logger.error({ err: err.message }, 'provision_worker_error');
  });

  cachedWorker = worker;
  return worker;
}

export async function processProvisionJob(job: Job<ProvisionJobData>): Promise<void> {
  const { ownerUserId } = job.data;
  // Backward-compat for jobs enqueued by the previous worker (which only
  // stored ownerUserId). Resolve the owner's currently-provisioning
  // workspace and proceed with that id; bail out cleanly when nothing
  // matches (e.g. workspace was cleaned up in the meantime).
  const workspaceId = await resolveJobWorkspaceId(job);
  if (!workspaceId) return;

  const attempt = job.attemptsMade + 1;
  // On any retry (attempt 2+), reset the workspace row so its
  // `provisioning_started_at` reflects this attempt — the UI's "overdue"
  // threshold is keyed off it, and stale timestamps would make a fresh
  // attempt look overdue from the start.
  if (attempt > 1 || job.data.manualRetry) {
    await resetWorkspaceProvisioningRow(workspaceId);
  }
  // The bulk of the work — Docker, gbrain, OAuth, encrypted secret persist,
  // status='ready'. Throws on any failure; BullMQ converts that to retry-or-
  // permanent-failure based on attempts.
  await provisionTenant({ workspaceId, ownerUserId });
}

export async function resetWorkspaceProvisioningRow(workspaceId: string): Promise<void> {
  await db
    .update(schema.workspaces)
    .set({
      status: 'provisioning',
      lastError: null,
      lastErrorDetail: null,
      // Reset the attempt counter alongside the timestamp — this row is
      // about to be re-tried as a fresh attempt, so the user-visible
      // "attempt N of M" UI on the provisioning screen should restart at 0.
      // (Without this reset, the counter monotonically climbed across
      // manual retries.)
      provisionAttempts: 0,
      provisioningStartedAt: new Date(),
    })
    .where(eq(schema.workspaces.id, workspaceId));
}

export async function markWorkspaceFailed(
  workspaceId: string,
  errorCode: string,
  errorDetail?: string | null,
): Promise<void> {
  try {
    await db
      .update(schema.workspaces)
      .set({
        status: 'failed',
        lastError: errorCode,
        lastErrorDetail: errorDetail ?? null,
      })
      .where(eq(schema.workspaces.id, workspaceId));
  } catch (err) {
    logger.error(
      { workspaceId, err: err instanceof Error ? err.message : String(err) },
      'mark_workspace_failed_db_write_failed',
    );
  }
}

export async function stopProvisionWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.close();
    cachedWorker = null;
  }
}
